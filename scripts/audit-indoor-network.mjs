// Connectivity audit of the generated campus indoor network. Writes docs/indoor-network-audit.md.
// Reads the generated TypeScript directly (Node strips the types), so it needs Node 22.6+.
// Usage: node scripts/audit-indoor-network.mjs
import fs from "node:fs";
import path from "node:path";
import { UW_INDOOR_NETWORK as net } from "../src/data/indoor/uw-indoor-network.generated.ts";
import { INDOOR_CONNECTIONS } from "../src/data/indoor/connections.ts";
import { UW_BUILDING_ROWS } from "../src/data/buildings/uw-buildings.generated.ts";

const here = path.dirname(new URL(import.meta.url).pathname);
const out = path.join(here, "..", "docs", "indoor-network-audit.md");
const OUT = "OUT";

const R = 6371000;
const toRad = (d) => (d * Math.PI) / 180;
const metres = (a, b) => {
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
};
const registry = new Map(UW_BUILDING_ROWS.map((b) => [b.code, b]));
const name = (code) => registry.get(code)?.name ?? "(not in UW Go's building registry)";

// ---- counts
const byKind = {};
for (const e of net.edges) byKind[e.kind] = (byKind[e.kind] ?? 0) + 1;
const buildings = [...new Set(net.anchors.map((a) => a.building))].sort();
const buildingsInEdges = new Set(net.nodes.map((n) => n.building));
buildingsInEdges.delete(OUT);

// ---- degree and adjacency
const degree = new Map();
const adj = new Map();
for (const e of net.edges) {
  degree.set(e.a, (degree.get(e.a) ?? 0) + 1);
  degree.set(e.b, (degree.get(e.b) ?? 0) + 1);
  (adj.get(e.a) ?? adj.set(e.a, []).get(e.a)).push(e.b);
  (adj.get(e.b) ?? adj.set(e.b, []).get(e.b)).push(e.a);
}

// ---- components at the building level
function components(edgeFilter) {
  const parent = new Map();
  const find = (x) => { while (parent.get(x) !== undefined && parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } if (!parent.has(x)) parent.set(x, x); return x; };
  const union = (a, b) => parent.set(find(a), find(b));
  for (const e of net.edges) if (edgeFilter(e)) union(e.a, e.b);
  const groups = new Map();
  for (const b of buildings) {
    const ids = net.anchors.filter((a) => a.building === b).map((a) => find(a.node));
    const root = ids[0];
    // A building whose anchors fall in different node components is itself split; note it.
    if (new Set(ids).size > 1) for (const id of ids) union(id, root);
    const r = find(root);
    (groups.get(r) ?? groups.set(r, []).get(r)).push(b);
  }
  return [...groups.values()].map((g) => g.sort()).sort((x, y) => y.length - x.length);
}
const indoorOnly = components((e) => e.kind !== "OUTDOOR" && net.nodes[e.a].building !== OUT && net.nodes[e.b].building !== OUT);
const withOutdoor = components(() => true);

// ---- node-level checks
const anchorNodes = new Set(net.anchors.map((a) => a.node));
const coincident = new Map(); // "lat,lng" -> node ids
for (const n of net.nodes) { const k = `${n.lat},${n.lng}`; (coincident.get(k) ?? coincident.set(k, []).get(k)).push(n.id); }
// Nodes at one point are joined by zero-length edges (a door, stairs, an open join), possibly
// through a third node at the same point. Two that share a point but no such chain are suspect.
const zeroParent = new Map();
const zfind = (x) => { while (zeroParent.has(x) && zeroParent.get(x) !== x) x = zeroParent.get(x); return zeroParent.has(x) ? x : (zeroParent.set(x, x), x); };
for (const e of net.edges) if (e.metres === 0) zeroParent.set(zfind(e.a), zfind(e.b));
const unjoinedCoincident = [];
for (const ids of coincident.values()) {
  if (ids.length < 2) continue;
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    if (zfind(ids[i]) !== zfind(ids[j])) unjoinedCoincident.push([net.nodes[ids[i]], net.nodes[ids[j]]]);
  }
}
const danglers = net.nodes.filter((n) => (degree.get(n.id) ?? 0) === 1 && !anchorNodes.has(n.id) && n.building !== OUT);
// A dangling end within a few metres of another node on the same floor is probably a missed join.
const nearMisses = [];
for (const d of danglers) {
  for (const n of net.nodes) {
    if (n.id === d.id || n.building !== d.building || n.floor !== d.floor) continue;
    if ((adj.get(d.id) ?? []).includes(n.id)) continue;
    const m = metres(d, n);
    if (m > 0 && m <= 4) nearMisses.push([d, n, m]);
  }
}
const isolated = net.nodes.filter((n) => (degree.get(n.id) ?? 0) === 0);
const missingRegistry = buildings.filter((b) => !registry.has(b));
const anchorFarFromRegistry = [];
for (const a of net.anchors) {
  const b = registry.get(a.building);
  const n = net.nodes[a.node];
  if (b) { const m = metres({ lat: b.latitude, lng: b.longitude }, n); if (m > 80) anchorFarFromRegistry.push([a.building, a.floor, Math.round(m)]); }
}

// ---- building-level adjacency, for the cross-check against the accessibility pages
const linkKinds = new Map(); // "A-B" sorted -> Set(kinds)
for (const e of net.edges) {
  const a = net.nodes[e.a].building, b = net.nodes[e.b].building;
  if (a === b || a === OUT || b === OUT) continue;
  const k = [a, b].sort().join("-");
  (linkKinds.get(k) ?? linkKinds.set(k, new Set()).get(k)).add(e.kind);
}
const pairKey = (a, b) => [a, b].sort().join("-");
const coverGroup = new Map();
indoorOnly.forEach((g, i) => g.forEach((b) => coverGroup.set(b, i)));
const underCover = (a, b) => coverGroup.has(a) && coverGroup.get(a) === coverGroup.get(b);
const statedAndPresent = INDOOR_CONNECTIONS.filter((c) => linkKinds.has(pairKey(c.a, c.b)));
const statedIndirect = INDOOR_CONNECTIONS.filter((c) => !linkKinds.has(pairKey(c.a, c.b)) && underCover(c.a, c.b));
const statedOnly = INDOOR_CONNECTIONS.filter((c) => !linkKinds.has(pairKey(c.a, c.b)) && !underCover(c.a, c.b));
const networkOnly = [...linkKinds.keys()].filter((k) => !INDOOR_CONNECTIONS.some((c) => pairKey(c.a, c.b) === k)).sort();

// ---- the report
const lines = (e) => net.edges.filter((x) => x.kind === e).map((x) => {
  const a = net.nodes[x.a], b = net.nodes[x.b];
  return `| ${a.building} floor ${a.floor} | ${b.building} floor ${b.floor} | ${Math.round(x.metres)} m |`;
});
const unmapped = UW_BUILDING_ROWS.filter((b) => !buildings.includes(b.code) && !b.parentCode).map((b) => `${b.code} (${b.name})`);
const md = `# Campus indoor network audit

Generated by \`scripts/audit-indoor-network.mjs\` from \`src/data/indoor/uw-indoor-network.generated.ts\`
(source: ${net.source.name}, ${net.source.url}, commit \`${net.source.commit}\`, ${net.source.licence}).

## Size

| | |
|---|---|
| Buildings with an entry point | ${buildings.length} |
| Nodes | ${net.nodes.length} |
| Edges (undirected) | ${net.edges.length} |
${Object.entries(byKind).sort().map(([k, v]) => `| … ${k} | ${v} |`).join("\n")}
| Changes of floor: stairs / elevators / ramps / other | ${["STAIRS", "ELEVATOR", "RAMP", "OTHER_VERTICAL"].map((k) => byKind[k] ?? 0).join(" / ")} |
| Entry points (building × floor) | ${net.anchors.length} |

## Buildings imported

${buildings.map((b) => `- **${b}** — ${name(b)}`).join("\n")}

${missingRegistry.length ? `Codes not in UW Go's building registry: ${missingRegistry.join(", ")}.` : "Every code is in UW Go's building registry."}
${anchorFarFromRegistry.length ? `Entry points more than 80 m from the registry's building point: ${anchorFarFromRegistry.map(([b, f, m]) => `${b} floor ${f} (${m} m)`).join(", ")}.` : "Every entry point is within 80 m of the registry's point for its building."}

## Tunnels (${byKind.TUNNEL ?? 0})

| From | To | Length |
|---|---|---|
${lines("TUNNEL").join("\n")}

## Bridges (${byKind.BRIDGE ?? 0})

| From | To | Length |
|---|---|---|
${lines("BRIDGE").join("\n")}

## Connectivity

**Under cover only** (tunnels, bridges, hallways, doors between buildings, stairs; no outdoor walkway):

${indoorOnly.map((g) => `- ${g.join(", ")}`).join("\n")}

**Including the short outdoor walkways the source maps:**

${withOutdoor.map((g) => `- ${g.join(", ")}`).join("\n")}

A building alone in the first list has no indoor link to any other; it is reached only by
walking outside. A winter route between two buildings in different groups of the first list
crosses at least one walkway, and is offered only when it is still mostly under cover.

## Data checks

- Isolated nodes (no edges): ${isolated.length}${isolated.length ? " — " + isolated.map((n) => `${n.building}/${n.floor} @ ${n.lat},${n.lng}`).join("; ") : ""}
- Coincident nodes not joined by any edge (same point, different building or floor, no door or stairs between them): ${unjoinedCoincident.length}${unjoinedCoincident.length ? "\n" + unjoinedCoincident.map(([a, b]) => `  - ${a.building}/${a.floor} and ${b.building}/${b.floor} @ ${a.lat},${a.lng}`).join("\n") : ""}
- Dangling ends (degree 1, not an entry point): ${danglers.length}. These are corridor ends the survey stopped at; they only matter if one should have joined something.${nearMisses.length ? "\n  - Possible missed joins (a dangling end within 4 m of another node on the same floor): " + nearMisses.map(([d, , m]) => `${d.building}/${d.floor} @ ${d.lat},${d.lng} is ${m.toFixed(1)} m from a node`).join("; ") : "\n  - No dangling end lies within 4 m of another node on its floor."}
- Duplicate nodes: none can exist; the generator merges any feature endpoints at the same coordinate, building and floor into one node.

## Cross-check against UW's Campus Accessibility pages

\`connections.ts\` lists ${INDOOR_CONNECTIONS.length} building-to-building links stated on the university's accessibility
pages. ${statedAndPresent.length} of them are direct links in the network. ${statedIndirect.length} more are not drawn as a direct
link but the two buildings are joined under cover through others (the pages name a tunnel by the buildings
it serves, the survey draws it segment by segment):

${statedIndirect.map((c) => `- ${c.a}–${c.b} (${c.kind.toLowerCase()}): "${c.note}"`).join("\n")}

The remaining ${statedOnly.length} are **not in the network at all**, and the network follows its source rather
than adding them, because a bridge drawn where none stands is worse than none. Someone should check these
on the ground and, if they exist, they belong in the survey upstream:

${statedOnly.map((c) => `- ${c.a}–${c.b} (${c.kind.toLowerCase()}): "${c.note}"`).join("\n")}

Links the network has that the accessibility pages do not state (${networkOnly.length}):

${networkOnly.map((k) => `- ${k}: ${[...linkKinds.get(k)].map((x) => x.toLowerCase()).join(", ")}`).join("\n")}

## UW Go buildings with no winter-network mapping (${unmapped.length})

Top-level buildings in UW Go's registry that the network does not reach. A leg starting or ending
at one of these gets a winter route only if a Google walking route to a network door within
${400} m exists and the rest of the way is mostly under cover.

${unmapped.join(", ")}
`;
fs.writeFileSync(out, md);
console.log(`wrote ${out}`);
console.log(`buildings ${buildings.length}, nodes ${net.nodes.length}, edges ${net.edges.length}, isolated ${isolated.length}, unjoined coincident ${unjoinedCoincident.length}, danglers ${danglers.length}, near misses ${nearMisses.length}, stated-only ${statedOnly.length}, network-only ${networkOnly.length}, unmapped ${unmapped.length}`);
