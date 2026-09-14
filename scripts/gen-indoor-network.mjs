// Generates src/data/indoor/uw-indoor-network.generated.ts: UW Go's own representation of the
// campus indoor network (tunnels, bridges, hallways, doors, stairs, elevators, ramps and the short
// outdoor walkways that join them), derived from the WATIsGrass project's GeoJSON.
//
// Source: https://github.com/rickyqin005/WATIsGrass (Ricky Qin, Manasva Katyal), GPL-3.0.
// The two GeoJSON files are fetched from the pinned commit below and are NOT vendored; only the
// facts (coordinates, what joins what, and how) are kept, in our own shape. See
// src/data/indoor/README.md for the attribution and licence notes.
//
// Usage: node scripts/gen-indoor-network.mjs [--out FILE] [--accept] [paths.json buildings.json]
//   With no files, the two GeoJSON files are downloaded from GitHub at SOURCE_COMMIT.
//   The result is compared with the committed network before anything is written. An unchanged
//   network is written as it is; a changed one only with --accept, once the comparison has been
//   read, so a survey update never replaces the network silently. --out writes the result somewhere
//   else instead, for a trial run whose routes can be compared first:
//   UWGO_NETWORK_CANDIDATE=FILE npm run campus:regression
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { edgeId } from "../src/data/indoor/edgeId.ts";
import { diffNetworks, isUnchanged, renderNetworkDiff } from "../src/data/indoor/networkDiff.ts";

const SOURCE_REPO = "rickyqin005/WATIsGrass";
const SOURCE_COMMIT = "b88e455";
const RAW = `https://raw.githubusercontent.com/${SOURCE_REPO}/${SOURCE_COMMIT}/web/src/geojson/`;

/** WATIsGrass codes that UW's campus map (our building registry) spells differently. */
const CODE_ALIASES = { DP: "LIB", E7: "PSE" };

const here = path.dirname(new URL(import.meta.url).pathname);
const committed = path.join(here, "..", "src", "data", "indoor", "uw-indoor-network.generated.ts");

const args = process.argv.slice(2);
function take(name, withValue) {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  const removed = args.splice(i, withValue ? 2 : 1);
  return withValue ? removed[1] : true;
}
const accept = Boolean(take("--accept", false));
const out = path.resolve(take("--out", true) ?? committed);
const [pathsArg, buildingsArg] = args;

async function load(name, localPath) {
  if (localPath) return JSON.parse(fs.readFileSync(localPath, "utf8"));
  const res = await fetch(RAW + name);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  return res.json();
}

const paths = await load("paths.json", pathsArg);
const buildings = await load("buildings.json", buildingsArg);

const code = (c) => CODE_ALIASES[c] ?? c;
const R = 6371000;
const toRad = (d) => (d * Math.PI) / 180;
function metres([lng1, lat1], [lng2, lat2]) {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
const round6 = (n) => Number(n.toFixed(6));

// Nodes are identified the way the source identifies them: coordinate + building + floor.
const nodes = [];
const nodeIndex = new Map();
function node([lng, lat], building, floor) {
  const b = code(building);
  const key = `${round6(lng)},${round6(lat)}|${b}|${floor}`;
  let id = nodeIndex.get(key);
  if (id === undefined) {
    id = nodes.length;
    nodeIndex.set(key, id);
    nodes.push({ id, lat: round6(lat), lng: round6(lng), building: b, floor: String(floor) });
  }
  return id;
}

/** Corridors, links between buildings and paths outside. */
const LINE_KIND = { hallway: "HALLWAY", bridge: "BRIDGE", tunnel: "TUNNEL", walkway: "OUTDOOR" };
/** Two places joined at one point. */
const JOIN_KIND = { door: "DOOR", open: "OPEN" };
/**
 * Changes of floor, kept as what the survey says they are. The format documents `stairs` and
 * `elevator`; `ramp` is kept too should the survey add one. A point of any other type that lists the
 * floors it connects is still a change of floor, of a kind UW Go does not recognise: it becomes
 * OTHER_VERTICAL with the survey's own word kept, and is never taken for stairs or an elevator.
 */
const VERTICAL_KIND = { stairs: "STAIRS", elevator: "ELEVATOR", ramp: "RAMP" };

const edges = [];
const problems = [];
/** Point features that change floor, by the survey's type. */
const verticalFeatures = {};
const same = (a, b) => a.buildingCode === b.buildingCode && a.floor === b.floor;

for (const f of paths.features) {
  const p = f.properties ?? {};
  const g = f.geometry;
  if (g.type === "LineString") {
    const kind = LINE_KIND[p.type];
    if (!kind || !p.start || !p.end) { problems.push(`line ${f.id}: unknown type ${p.type}`); continue; }
    const c = g.coordinates;
    if (c.length < 2) { problems.push(`line ${f.id}: fewer than 2 points`); continue; }
    if (same(p.start, p.end)) {
      // A hallway (or walkway) along one floor: every vertex is a node so branches can meet it.
      for (let i = 0; i < c.length - 1; i++) {
        edges.push({ a: node(c[i], p.start.buildingCode, p.start.floor), b: node(c[i + 1], p.end.buildingCode, p.end.floor), kind, metres: Math.round(metres(c[i], c[i + 1]) * 10) / 10, floors: 0, path: [c[i], c[i + 1]].map(([lng, lat]) => [round6(lat), round6(lng)]) });
      }
    } else {
      // A bridge or tunnel between two building-floors: one edge with its whole geometry. Lines carry
      // no levels, so a line from one floor of a building to another has a climb nobody recorded.
      if (p.start.buildingCode === p.end.buildingCode) problems.push(`line ${f.id}: a ${p.type} from floor ${p.start.floor} to floor ${p.end.floor} of ${p.start.buildingCode} has no levels; kept with no climb, so the change of floor along it is unknown`);
      let m = 0;
      for (let i = 0; i < c.length - 1; i++) m += metres(c[i], c[i + 1]);
      edges.push({ a: node(c[0], p.start.buildingCode, p.start.floor), b: node(c[c.length - 1], p.end.buildingCode, p.end.floor), kind, metres: Math.round(m * 10) / 10, floors: 0, path: c.map(([lng, lat]) => [round6(lat), round6(lng)]) });
    }
  } else if (g.type === "Point") {
    const join = JOIN_KIND[p.type];
    const vertical = VERTICAL_KIND[p.type] ?? (Array.isArray(p.connections) ? "OTHER_VERTICAL" : undefined);
    if (join) {
      edges.push({ a: node(g.coordinates, p.start.buildingCode, p.start.floor), b: node(g.coordinates, p.end.buildingCode, p.end.floor), kind: join, metres: 0, floors: 0, path: [[round6(g.coordinates[1]), round6(g.coordinates[0])]] });
    } else if (vertical) {
      if (vertical === "OTHER_VERTICAL") problems.push(`point ${f.id}: a change of floor of unrecognised type "${p.type}", kept as OTHER_VERTICAL`);
      verticalFeatures[p.type] = (verticalFeatures[p.type] ?? 0) + 1;
      const cs = p.connections ?? [];
      for (let i = 0; i < cs.length; i++) {
        for (let j = i + 1; j < cs.length; j++) {
          edges.push({
            a: node(g.coordinates, cs[i].buildingCode, cs[i].floor),
            b: node(g.coordinates, cs[j].buildingCode, cs[j].floor),
            kind: vertical,
            metres: 0,
            floors: Math.round((cs[j].level - cs[i].level) * 2) / 2,
            path: [[round6(g.coordinates[1]), round6(g.coordinates[0])]],
            ...(vertical === "OTHER_VERTICAL" ? { sourceType: String(p.type) } : {}),
          });
        }
      }
    } else problems.push(`point ${f.id}: unknown type ${p.type}`);
  }
  // Polygons are building outlines for their map; UW Go has its own building registry.
}

// Anchors: where a building's floors join the graph, for starting and ending a route.
const anchors = [];
for (const f of buildings.features) {
  if (f.properties?.type !== "building") continue;
  const b = f.properties.building;
  for (const floor of b.floors) {
    const key = `${round6(f.geometry.coordinates[0])},${round6(f.geometry.coordinates[1])}|${code(b.buildingCode)}|${floor}`;
    const id = nodeIndex.get(key);
    if (id === undefined) { problems.push(`anchor ${b.buildingCode} floor ${floor}: no path touches its coordinate`); continue; }
    anchors.push({ building: code(b.buildingCode), floor: String(floor), node: id });
  }
}

const source = { name: "WATIsGrass", url: `https://github.com/${SOURCE_REPO}`, commit: SOURCE_COMMIT, licence: "GPL-3.0" };
const network = { source, nodes, edges, anchors };

// Closure reports and campus facts attach to segment ids, so every segment needs its own.
const seen = new Set();
const duplicates = [];
for (const e of edges) {
  const id = edgeId(network, e);
  if (seen.has(id)) duplicates.push(id);
  seen.add(id);
}
if (duplicates.length) {
  console.error(`${duplicates.length} segment ids are shared by more than one segment: ${duplicates.join(", ")}. Nothing written.`);
  process.exit(1);
}

if (fs.existsSync(committed)) {
  const previous = (await import(pathToFileURL(committed).href)).UW_INDOOR_NETWORK;
  const diff = diffNetworks(previous, network, edgeId);
  console.log(`Compared with the committed network (${path.relative(process.cwd(), committed)}):`);
  console.log(renderNetworkDiff(diff));
  if (!isUnchanged(diff) && out === committed && !accept) {
    console.error("\nThe committed network would change. Read the comparison above, compare the routes (write the candidate with --out FILE, then UWGO_NETWORK_CANDIDATE=FILE npm run campus:regression), and run again with --accept to replace it. Nothing written.");
    process.exit(2);
  }
}

const header = `// GENERATED by scripts/gen-indoor-network.mjs — do not edit by hand.
// Derived from WATIsGrass (https://github.com/${SOURCE_REPO}, commit ${SOURCE_COMMIT}), GPL-3.0,
// by Ricky Qin and Manasva Katyal. Facts only, in UW Go's own shape: see src/data/indoor/README.md.
// Codes mapped to UW Go's registry: ${Object.entries(CODE_ALIASES).map(([k, v]) => `${k}→${v}`).join(", ")}.
import type { IndoorNetwork } from "./network";

export const UW_INDOOR_NETWORK: IndoorNetwork = {
  source: { name: "${source.name}", url: "${source.url}", commit: "${source.commit}", licence: "${source.licence}" },
  nodes: [
${nodes.map((n) => `    ${JSON.stringify(n)},`).join("\n")}
  ],
  edges: [
${edges.map((e) => `    ${JSON.stringify(e)},`).join("\n")}
  ],
  anchors: [
${anchors.map((a) => `    ${JSON.stringify(a)},`).join("\n")}
  ],
};
`;
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, header);
const byKind = {};
for (const e of edges) byKind[e.kind] = (byKind[e.kind] ?? 0) + 1;
console.log(`\nwrote ${out}: ${nodes.length} nodes, ${edges.length} edges ${JSON.stringify(byKind)}, ${anchors.length} anchors over ${new Set(anchors.map((a) => a.building)).size} buildings`);
const verticalSegments = ["STAIRS", "ELEVATOR", "RAMP", "OTHER_VERTICAL"].map((k) => `${k} ${byKind[k] ?? 0}`).join(", ");
console.log(`changes of floor: ${Object.entries(verticalFeatures).map(([t, n]) => `${n} "${t}"`).join(", ") || "no"} point features in the survey -> segments ${verticalSegments}`);
if (problems.length) { console.log("problems:"); for (const p of problems) console.log("  " + p); }
