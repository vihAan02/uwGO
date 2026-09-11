/**
 * Shortest routes over the campus indoor network. The network is a weighted graph of
 * (coordinate, building, floor) nodes; the cost of an edge is the seconds it takes, with
 * seconds spent outdoors counted several times over, so the route found is the one that
 * keeps the student under a roof unless the indoor way round is far longer than the dash
 * outside it saves. Pure and synchronous: nothing here talks to a routing API.
 */
import { UW_INDOOR_NETWORK } from "@/data/indoor/uw-indoor-network.generated";
import type { IndoorEdge, IndoorEdgeKind, IndoorNetwork, IndoorNode } from "@/data/indoor/network";
import { haversineMeters } from "@/routing/EstimateRoutingProvider";

export const OUTSIDE = "OUT";

/** Walking paces. Corridors, doors and people make indoor walking slower than a pavement. */
export const INDOOR_PACE = {
  indoorMetresPerSecond: 1.2,
  outdoorMetresPerSecond: 1.35,
  /** A flight of stairs, one floor, either direction. */
  secondsPerFloor: 14,
  /** Opening and passing a door. */
  secondsPerDoor: 3,
} as const;

/**
 * How many indoor seconds one outdoor second is worth avoiding. Chosen against real pairs
 * (see indoorGraph.test.ts): at 4, MC→DC takes the C2 tunnel and bridge rather than the
 * two-minute walk across the courtyard, and MC→M3 still crosses the short walkway outside
 * M3 (there is no indoor way there at all) instead of wandering.
 */
export const OUTDOOR_PENALTY = 4;

export interface IndoorSegment {
  kind: IndoorEdgeKind;
  from: IndoorNode;
  to: IndoorNode;
  metres: number;
  seconds: number;
  /** Floors climbed (negative going down). */
  floors: number;
  /** [lat, lng] vertices from `from` to `to`. */
  path: [number, number][];
}

export interface IndoorGraphRoute {
  segments: IndoorSegment[];
  metres: number;
  seconds: number;
  outdoorMetres: number;
  outdoorSeconds: number;
  /** Buildings passed through, in order, without repeats; never includes OUT. */
  buildings: string[];
  /** The value Dijkstra minimised. */
  cost: number;
}

interface Arc { edge: IndoorEdge; to: number; forward: boolean }

class Graph {
  readonly adj: Arc[][];
  readonly anchorsByBuilding = new Map<string, number[]>();
  /** Building-side nodes of doors to outside, keyed by building. Where an outdoor walk can enter. */
  readonly entrancesByBuilding = new Map<string, number[]>();

  constructor(readonly net: IndoorNetwork) {
    this.adj = net.nodes.map(() => []);
    for (const edge of net.edges) {
      this.adj[edge.a].push({ edge, to: edge.b, forward: true });
      this.adj[edge.b].push({ edge, to: edge.a, forward: false });
      if (edge.kind === "DOOR") {
        const na = net.nodes[edge.a];
        const nb = net.nodes[edge.b];
        if (na.building === OUTSIDE && nb.building !== OUTSIDE) push(this.entrancesByBuilding, nb.building, edge.b);
        if (nb.building === OUTSIDE && na.building !== OUTSIDE) push(this.entrancesByBuilding, na.building, edge.a);
      }
    }
    for (const a of net.anchors) push(this.anchorsByBuilding, a.building, a.node);
  }
}

function push<K, V>(m: Map<K, V[]>, k: K, v: V) {
  const list = m.get(k);
  if (list) { if (!list.includes(v)) list.push(v); } else m.set(k, [v]);
}

let graph: Graph | undefined;
function theGraph(): Graph {
  return (graph ??= new Graph(UW_INDOOR_NETWORK));
}

/** For tests and audits: build a graph over another network. */
export function graphOver(net: IndoorNetwork): Graph {
  return new Graph(net);
}

export function isOnIndoorNetwork(code: string | undefined): boolean {
  return Boolean(code) && theGraph().anchorsByBuilding.has(code!);
}

export function indoorNetworkBuildings(): string[] {
  return [...theGraph().anchorsByBuilding.keys()].sort();
}

/** Seconds to walk an edge, and how many of them are outdoors. */
export function edgeSeconds(edge: IndoorEdge, pace = INDOOR_PACE): { seconds: number; outdoor: number } {
  switch (edge.kind) {
    case "OUTDOOR": { const s = edge.metres / pace.outdoorMetresPerSecond; return { seconds: s, outdoor: s }; }
    case "STAIRS": return { seconds: Math.abs(edge.floors) * pace.secondsPerFloor, outdoor: 0 };
    case "DOOR": return { seconds: pace.secondsPerDoor, outdoor: 0 };
    case "OPEN": return { seconds: 0, outdoor: 0 };
    default: return { seconds: edge.metres / pace.indoorMetresPerSecond, outdoor: 0 };
  }
}

/** Binary min-heap keyed on cost; the graph is small but a linear scan per pop would still show. */
class Heap {
  private readonly items: { cost: number; node: number }[] = [];
  get size() { return this.items.length; }
  push(cost: number, node: number) {
    const a = this.items;
    a.push({ cost, node });
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].cost <= a[i].cost) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): { cost: number; node: number } {
    const a = this.items;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l].cost < a[m].cost) m = l;
        if (r < a.length && a[r].cost < a[m].cost) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

export interface RouteOptions {
  outdoorPenalty?: number;
  pace?: typeof INDOOR_PACE;
}

/**
 * Cheapest route from any of `starts` to any of `ends` (multi-source, multi-target Dijkstra).
 * Undefined when nothing joins them.
 */
export function routeBetweenNodes(starts: readonly number[], ends: readonly number[], opts: RouteOptions = {}, g: Graph = theGraph()): IndoorGraphRoute | undefined {
  const penalty = opts.outdoorPenalty ?? OUTDOOR_PENALTY;
  const pace = opts.pace ?? INDOOR_PACE;
  const target = new Set(ends);
  const dist = new Map<number, number>();
  const prev = new Map<number, Arc>();
  const done = new Set<number>();
  const heap = new Heap();
  for (const s of starts) { dist.set(s, 0); heap.push(0, s); }
  let reached: number | undefined;
  while (heap.size) {
    const { cost, node } = heap.pop();
    if (done.has(node)) continue;
    done.add(node);
    if (target.has(node)) { reached = node; break; }
    for (const arc of g.adj[node]) {
      if (done.has(arc.to)) continue;
      const t = edgeSeconds(arc.edge, pace);
      const next = cost + (t.seconds - t.outdoor) + t.outdoor * penalty;
      if (next < (dist.get(arc.to) ?? Infinity)) {
        dist.set(arc.to, next);
        prev.set(arc.to, arc);
        heap.push(next, arc.to);
      }
    }
  }
  if (reached === undefined) return undefined;

  const arcs: Arc[] = [];
  for (let n = reached; ; ) {
    const arc = prev.get(n);
    if (!arc) break;
    arcs.push(arc);
    n = arc.forward ? arc.edge.a : arc.edge.b;
  }
  arcs.reverse();

  const segments: IndoorSegment[] = arcs.map((arc) => {
    const e = arc.edge;
    const t = edgeSeconds(e, pace);
    const path = arc.forward ? e.path : [...e.path].reverse();
    return {
      kind: e.kind,
      from: g.net.nodes[arc.forward ? e.a : e.b],
      to: g.net.nodes[arc.forward ? e.b : e.a],
      metres: e.metres,
      seconds: t.seconds,
      floors: arc.forward ? e.floors : -e.floors,
      path,
    };
  });
  const buildings: string[] = [];
  const startNode = g.net.nodes[arcs.length ? (arcs[0].forward ? arcs[0].edge.a : arcs[0].edge.b) : reached];
  for (const b of [startNode.building, ...segments.map((s) => s.to.building)]) {
    if (b !== OUTSIDE && buildings[buildings.length - 1] !== b) buildings.push(b);
  }
  const sum = (f: (s: IndoorSegment) => number) => segments.reduce((n, s) => n + f(s), 0);
  return {
    segments,
    metres: sum((s) => s.metres),
    seconds: sum((s) => s.seconds),
    outdoorMetres: sum((s) => (s.kind === "OUTDOOR" ? s.metres : 0)),
    outdoorSeconds: sum((s) => (s.kind === "OUTDOOR" ? s.seconds : 0)),
    buildings,
    cost: dist.get(reached) ?? 0,
  };
}

/** Cheapest route between two buildings on the network, from any floor's anchor to any floor's anchor. */
export function routeBetweenBuildings(from: string, to: string, opts: RouteOptions = {}, g: Graph = theGraph()): IndoorGraphRoute | undefined {
  const starts = g.anchorsByBuilding.get(from);
  const ends = g.anchorsByBuilding.get(to);
  if (!starts || !ends) return undefined;
  return routeBetweenNodes(starts, ends, opts, g);
}

export interface Entrance {
  node: IndoorNode;
  building: string;
  /** Straight-line metres from the point asked about. */
  metres: number;
}

/**
 * Doors from outside into the network, nearest first, for joining a place that is not on the
 * network (a residence, say) to it. `limit` keeps the caller's routing calls few.
 */
export function nearestEntrances(point: { latitude: number; longitude: number }, limit = 3, g: Graph = theGraph()): Entrance[] {
  const all: Entrance[] = [];
  for (const [building, ids] of g.entrancesByBuilding) {
    for (const id of ids) {
      const node = g.net.nodes[id];
      all.push({ node, building, metres: haversineMeters(point, { latitude: node.lat, longitude: node.lng }) });
    }
  }
  all.sort((x, y) => x.metres - y.metres);
  return all.slice(0, limit);
}

/** The anchor nodes of a building (one per floor the network knows). */
export function anchorsOf(building: string, g: Graph = theGraph()): IndoorNode[] {
  return (g.anchorsByBuilding.get(building) ?? []).map((id) => g.net.nodes[id]);
}
