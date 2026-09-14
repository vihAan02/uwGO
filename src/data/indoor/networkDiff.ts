/**
 * What changed between two versions of the campus network: counts, segments that disappeared or
 * appeared, segments whose kind, length or climb changed, and entry points. The generator prints this
 * before it replaces the committed network, and will not write a changed network unless told to, so a
 * survey update is read before it is accepted.
 *
 * Type-only imports, and the id function is passed in: Node loads this file directly for the generator.
 */
import type { IndoorEdge, IndoorEdgeKind, IndoorNetwork } from "./network";

export type IdOf = (net: IndoorNetwork, edge: IndoorEdge) => string;

export interface EdgeSummary {
  id: string;
  kind: IndoorEdgeKind;
  /** "BUILDING/floor" at each end, in the segment's canonical order (the order its id is built in). */
  ends: [string, string];
  metres: number;
  /** Floors climbed going from the first end to the second: negative going down. */
  climb: number;
}

export interface NetworkDiff {
  nodes: [before: number, after: number];
  edges: [before: number, after: number];
  anchors: [before: number, after: number];
  /** Segments of each kind, before and after. */
  kinds: Record<string, [before: number, after: number]>;
  removedEdges: EdgeSummary[];
  addedEdges: EdgeSummary[];
  /** The same segment (same id) with a different kind, length or climb. */
  changedEdges: { before: EdgeSummary; after: EdgeSummary; changes: string[] }[];
  removedAnchors: string[];
  addedAnchors: string[];
  /** Buildings with an entry point in one version only. */
  removedBuildings: string[];
  addedBuildings: string[];
  /** Ids more than one segment of the new network shares. Closures and facts need each to name one thing. */
  duplicateIds: string[];
}

const KINDS: readonly IndoorEdgeKind[] = ["HALLWAY", "BRIDGE", "TUNNEL", "OUTDOOR", "DOOR", "OPEN", "STAIRS", "ELEVATOR", "RAMP", "OTHER_VERTICAL"];

/**
 * A segment described the same way whichever end the file lists first: its ends in the order its id uses, and
 * its climb along that order. A climb that changes sign between two versions is then a real reversal, not a
 * swap of which end came first.
 */
function summarise(net: IndoorNetwork, edge: IndoorEdge, idOf: IdOf): EdgeSummary {
  const end = (i: number) => {
    const n = net.nodes[i];
    return { key: `${n.lat},${n.lng}@${n.building}/${n.floor}`, text: `${n.building}/${n.floor}` };
  };
  const a = end(edge.a);
  const b = end(edge.b);
  const forward = a.key <= b.key;
  return { id: idOf(net, edge), kind: edge.kind, ends: forward ? [a.text, b.text] : [b.text, a.text], metres: edge.metres, climb: forward ? edge.floors : -edge.floors };
}

const climbWords = (n: number) => (n === 0 ? "level" : `${n > 0 ? "up" : "down"} ${Math.abs(n)}`);

const anchorKeys = (net: IndoorNetwork) => new Set(net.anchors.map((a) => `${a.building} floor ${a.floor} @ ${net.nodes[a.node].lat},${net.nodes[a.node].lng}`));
const anchorBuildings = (net: IndoorNetwork) => new Set(net.anchors.map((a) => a.building));
const byId = (x: EdgeSummary, y: EdgeSummary) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0);

export function diffNetworks(before: IndoorNetwork, after: IndoorNetwork, idOf: IdOf): NetworkDiff {
  const was = new Map(before.edges.map((e) => { const s = summarise(before, e, idOf); return [s.id, s] as const; }));
  const now = new Map<string, EdgeSummary>();
  const duplicateIds: string[] = [];
  for (const e of after.edges) {
    const s = summarise(after, e, idOf);
    if (now.has(s.id)) duplicateIds.push(s.id);
    else now.set(s.id, s);
  }

  const changedEdges: NetworkDiff["changedEdges"] = [];
  for (const [id, b] of [...was].sort(([x], [y]) => (x < y ? -1 : 1))) {
    const a = now.get(id);
    if (!a) continue;
    const changes: string[] = [];
    if (b.kind !== a.kind) changes.push(`kind ${b.kind} -> ${a.kind}`);
    if (Math.abs(b.metres - a.metres) > 0.05) changes.push(`length ${b.metres} m -> ${a.metres} m`);
    if (b.climb !== a.climb) changes.push(`climb ${climbWords(b.climb)} -> ${climbWords(a.climb)}`);
    if (changes.length) changedEdges.push({ before: b, after: a, changes });
  }

  const kinds: NetworkDiff["kinds"] = {};
  for (const k of KINDS) kinds[k] = [before.edges.filter((e) => e.kind === k).length, after.edges.filter((e) => e.kind === k).length];
  for (const e of [...before.edges, ...after.edges]) if (!kinds[e.kind]) kinds[e.kind] = [before.edges.filter((x) => x.kind === e.kind).length, after.edges.filter((x) => x.kind === e.kind).length];

  const anchorsBefore = anchorKeys(before);
  const anchorsAfter = anchorKeys(after);
  const buildingsBefore = anchorBuildings(before);
  const buildingsAfter = anchorBuildings(after);
  return {
    nodes: [before.nodes.length, after.nodes.length],
    edges: [before.edges.length, after.edges.length],
    anchors: [before.anchors.length, after.anchors.length],
    kinds,
    removedEdges: [...was.values()].filter((s) => !now.has(s.id)).sort(byId),
    addedEdges: [...now.values()].filter((s) => !was.has(s.id)).sort(byId),
    changedEdges,
    removedAnchors: [...anchorsBefore].filter((k) => !anchorsAfter.has(k)).sort(),
    addedAnchors: [...anchorsAfter].filter((k) => !anchorsBefore.has(k)).sort(),
    removedBuildings: [...buildingsBefore].filter((b) => !buildingsAfter.has(b)).sort(),
    addedBuildings: [...buildingsAfter].filter((b) => !buildingsBefore.has(b)).sort(),
    duplicateIds: [...new Set(duplicateIds)].sort(),
  };
}

/** Nothing about the network's shape or meaning differs. */
export function isUnchanged(d: NetworkDiff): boolean {
  return d.nodes[0] === d.nodes[1] && d.edges[0] === d.edges[1] && d.anchors[0] === d.anchors[1]
    && !d.removedEdges.length && !d.addedEdges.length && !d.changedEdges.length
    && !d.removedAnchors.length && !d.addedAnchors.length && !d.duplicateIds.length;
}

const edgeLine = (s: EdgeSummary) => `  ${s.id} ${s.kind} ${s.ends[0]} - ${s.ends[1]}${s.metres ? ` ${s.metres} m` : ""}${s.climb ? ` climb ${climbWords(s.climb)}` : ""}`;

export function renderNetworkDiff(d: NetworkDiff): string {
  const pair = ([b, a]: readonly [number, number]) => (b === a ? `${a}` : `${b} -> ${a}`);
  const lines = [
    `nodes ${pair(d.nodes)}, segments ${pair(d.edges)}, entry points ${pair(d.anchors)}`,
    `by kind: ${Object.entries(d.kinds).map(([k, v]) => `${k} ${pair(v)}`).join(", ")}`,
  ];
  const section = (title: string, items: readonly string[]) => {
    if (items.length) lines.push(`${title} (${items.length}):`, ...items);
  };
  section("segments removed", d.removedEdges.map(edgeLine));
  section("segments added", d.addedEdges.map(edgeLine));
  section("segments changed", d.changedEdges.map((c) => `${edgeLine(c.after)}: ${c.changes.join("; ")}`));
  section("entry points removed", d.removedAnchors.map((a) => `  ${a}`));
  section("entry points added", d.addedAnchors.map((a) => `  ${a}`));
  section("buildings no longer on the network", d.removedBuildings.map((b) => `  ${b}`));
  section("buildings new to the network", d.addedBuildings.map((b) => `  ${b}`));
  section("ids shared by more than one segment", d.duplicateIds.map((id) => `  ${id}`));
  if (isUnchanged(d)) lines.push("No segment, entry point or building differs.");
  return lines.join("\n");
}
