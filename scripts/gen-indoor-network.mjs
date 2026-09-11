// Generates src/data/indoor/uw-indoor-network.generated.ts: UW Go's own representation of the
// campus indoor network (tunnels, bridges, hallways, doors, stairs and the short outdoor
// walkways that join them), derived from the WATIsGrass project's GeoJSON.
//
// Source: https://github.com/rickyqin005/WATIsGrass (Ricky Qin, Manasva Katyal), GPL-3.0.
// The two GeoJSON files are fetched from the pinned commit below and are NOT vendored; only the
// facts (coordinates, what joins what, and how) are kept, in our own shape. See
// src/data/indoor/README.md for the attribution and licence notes.
//
// Usage: node scripts/gen-indoor-network.mjs [paths.json buildings.json]
//   With no arguments the files are downloaded from GitHub at SOURCE_COMMIT.
import fs from "node:fs";
import path from "node:path";

const SOURCE_REPO = "rickyqin005/WATIsGrass";
const SOURCE_COMMIT = "b88e455";
const RAW = `https://raw.githubusercontent.com/${SOURCE_REPO}/${SOURCE_COMMIT}/web/src/geojson/`;

/** WATIsGrass codes that UW's campus map (our building registry) spells differently. */
const CODE_ALIASES = { DP: "LIB", E7: "PSE" };

const here = path.dirname(new URL(import.meta.url).pathname);
const out = path.join(here, "..", "src", "data", "indoor", "uw-indoor-network.generated.ts");

async function load(name, localPath) {
  if (localPath) return JSON.parse(fs.readFileSync(localPath, "utf8"));
  const res = await fetch(RAW + name);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  return res.json();
}

const [pathsArg, buildingsArg] = process.argv.slice(2);
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

const KIND = { hallway: "HALLWAY", bridge: "BRIDGE", tunnel: "TUNNEL", walkway: "OUTDOOR", door: "DOOR", open: "OPEN", stairs: "STAIRS", elevator: "STAIRS" };
const edges = [];
const problems = [];
const same = (a, b) => a.buildingCode === b.buildingCode && a.floor === b.floor;

for (const f of paths.features) {
  const p = f.properties ?? {};
  const g = f.geometry;
  if (g.type === "LineString") {
    const kind = KIND[p.type];
    if (!kind || !p.start || !p.end) { problems.push(`line ${f.id}: unknown type ${p.type}`); continue; }
    const c = g.coordinates;
    if (c.length < 2) { problems.push(`line ${f.id}: fewer than 2 points`); continue; }
    if (same(p.start, p.end)) {
      // A hallway (or walkway) along one floor: every vertex is a node so branches can meet it.
      for (let i = 0; i < c.length - 1; i++) {
        edges.push({ a: node(c[i], p.start.buildingCode, p.start.floor), b: node(c[i + 1], p.end.buildingCode, p.end.floor), kind, metres: Math.round(metres(c[i], c[i + 1]) * 10) / 10, floors: 0, path: [c[i], c[i + 1]].map(([lng, lat]) => [round6(lat), round6(lng)]) });
      }
    } else {
      // A bridge or tunnel between two building-floors: one edge with its whole geometry.
      let m = 0;
      for (let i = 0; i < c.length - 1; i++) m += metres(c[i], c[i + 1]);
      edges.push({ a: node(c[0], p.start.buildingCode, p.start.floor), b: node(c[c.length - 1], p.end.buildingCode, p.end.floor), kind, metres: Math.round(m * 10) / 10, floors: 0, path: c.map(([lng, lat]) => [round6(lat), round6(lng)]) });
    }
  } else if (g.type === "Point") {
    const kind = KIND[p.type];
    if (p.type === "door" || p.type === "open") {
      edges.push({ a: node(g.coordinates, p.start.buildingCode, p.start.floor), b: node(g.coordinates, p.end.buildingCode, p.end.floor), kind, metres: 0, floors: 0, path: [[round6(g.coordinates[1]), round6(g.coordinates[0])]] });
    } else if (p.type === "stairs" || p.type === "elevator") {
      const cs = p.connections ?? [];
      for (let i = 0; i < cs.length; i++) {
        for (let j = i + 1; j < cs.length; j++) {
          edges.push({ a: node(g.coordinates, cs[i].buildingCode, cs[i].floor), b: node(g.coordinates, cs[j].buildingCode, cs[j].floor), kind, metres: 0, floors: Math.round((cs[j].level - cs[i].level) * 2) / 2, path: [[round6(g.coordinates[1]), round6(g.coordinates[0])]] });
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

const header = `// GENERATED by scripts/gen-indoor-network.mjs — do not edit by hand.
// Derived from WATIsGrass (https://github.com/${SOURCE_REPO}, commit ${SOURCE_COMMIT}), GPL-3.0,
// by Ricky Qin and Manasva Katyal. Facts only, in UW Go's own shape: see src/data/indoor/README.md.
// Codes mapped to UW Go's registry: ${Object.entries(CODE_ALIASES).map(([k, v]) => `${k}→${v}`).join(", ")}.
import type { IndoorNetwork } from "./network";

export const UW_INDOOR_NETWORK: IndoorNetwork = {
  source: { name: "WATIsGrass", url: "https://github.com/${SOURCE_REPO}", commit: "${SOURCE_COMMIT}", licence: "GPL-3.0" },
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
console.log(`wrote ${out}: ${nodes.length} nodes, ${edges.length} edges ${JSON.stringify(byKind)}, ${anchors.length} anchors over ${new Set(anchors.map((a) => a.building)).size} buildings`);
if (problems.length) { console.log("problems:"); for (const p of problems) console.log("  " + p); }
