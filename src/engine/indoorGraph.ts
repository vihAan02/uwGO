/**
 * Shortest routes over the campus indoor network. The network is a weighted graph of
 * (coordinate, building, floor) nodes; the cost of an edge is the seconds it takes, with
 * seconds spent outdoors counted several times over for the winter route, so the route found is
 * the one that keeps the student under a roof unless the indoor way round is far longer than the
 * dash outside it saves. Pure and synchronous: nothing here talks to a routing API.
 *
 * The survey's segments are undirected and say nothing about permission, hours or access. What
 * may be used, in which direction, when, and by whom comes from the campus routing knowledge
 * (src/data/campus): a door documented as exit-only is simply not an arc inwards, a link the
 * research says not to use is not an arc at all, and a demolished bridge can never come back
 * through a later survey import. Restrictions apply whatever their evidence; anything that would
 * widen what a route may use needs official or corroborated evidence.
 */
import { UW_INDOOR_NETWORK } from "@/data/indoor/uw-indoor-network.generated";
import { isVertical, type IndoorEdge, type IndoorEdgeKind, type IndoorNetwork, type IndoorNode } from "@/data/indoor/network";
import { haversineMeters } from "@/routing/EstimateRoutingProvider";
import { edgeId } from "@/data/indoor/edgeId";
import { CAMPUS_KNOWLEDGE } from "@/data/campus";
import { claimsUsable, type CampusKnowledge } from "@/data/campus/knowledge";
import type { Access, Availability, EdgeFact, Evidence, HistoricalLink, Passage } from "@/data/campus/types";
import { torontoClock } from "@/time/toronto";

export const OUTSIDE = "OUT";

export interface Pace {
  indoorMetresPerSecond: number;
  outdoorMetresPerSecond: number;
  /** A flight of stairs, one floor, either direction. Also a change of floor of a kind UW Go does not recognise. */
  secondsPerFloor: number;
  secondsPerDoor: number;
  /** Waiting for an elevator, getting in and getting out, however many floors it goes. */
  elevatorWaitSeconds: number;
  /** An elevator's travel, per floor. */
  elevatorSecondsPerFloor: number;
  /** A ramp's climb, per floor. */
  rampSecondsPerFloor: number;
}

/** Walking paces. Corridors, doors and people make indoor walking slower than a pavement. */
export const INDOOR_PACE = {
  indoorMetresPerSecond: 1.2,
  outdoorMetresPerSecond: 1.35,
  /** A flight of stairs, one floor, either direction. */
  secondsPerFloor: 14,
  /** Opening and passing a door. */
  secondsPerDoor: 3,
  /** UW Go's estimate, not a measurement: no elevator on campus has been timed. */
  elevatorWaitSeconds: 45,
  elevatorSecondsPerFloor: 5,
  /** One storey at an accessible gradient (1:12) is some 45 m of ramp and landings. An estimate, not a measurement. */
  rampSecondsPerFloor: 40,
} as const;

/**
 * How many indoor seconds one outdoor second is worth avoiding. Chosen against real pairs
 * (see indoorGraph.test.ts): at 4, MC→DC takes the C2 tunnel and bridge rather than the
 * two-minute walk across the courtyard, and MC→M3 still crosses the short walkway outside
 * M3 (there is no indoor way there at all) instead of wandering.
 */
export const OUTDOOR_PENALTY = 4;

/**
 * With a building's hours unknown, a route only passes through it (rather than starting or ending
 * there) between these times, in minutes past midnight. This is UW Go's policy, not a fact about any
 * building: a door locked at 2 AM turns a shortcut into a dead end, and the way outside is always
 * there instead.
 */
export const UNKNOWN_HOURS_PASS_THROUGH = { open: 7 * 60, close: 22 * 60 } as const;

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
  /** Canonical ids of every segment travelled, in order. What a closure report targets. */
  edgeIds: string[];
  /** The value Dijkstra minimised. */
  cost: number;
}

/** One way along a segment. The survey's undirected segments become two of these. */
export interface Arc {
  edge: IndoorEdge;
  index: number;
  from: number;
  to: number;
}

/** A door between a building and outside. */
export interface ExteriorDoor {
  building: string;
  /** Edge index of the door. */
  index: number;
  /** The node on the building's side. */
  inside: number;
  /** The node outside. */
  outside: number;
}

const samePair = (x: string, y: string, pair: readonly [string, string]) => (pair[0] === x && pair[1] === y) || (pair[0] === y && pair[1] === x);

class Graph {
  /** Arcs leaving each node. */
  readonly adj: Arc[][];
  /** Arcs arriving at each node, for searching backwards from a destination. */
  readonly radj: Arc[][];
  /** Canonical id of each edge, by index. */
  readonly ids: string[];
  readonly indexById = new Map<string, number>();
  readonly facts: (EdgeFact | undefined)[];
  readonly historical: (HistoricalLink | undefined)[];
  readonly anchorsByBuilding = new Map<string, number[]>();
  /** Building-side nodes of doors to outside, keyed by building. Where an outdoor walk can enter. */
  readonly entrancesByBuilding = new Map<string, number[]>();
  readonly exteriorDoors: ExteriorDoor[] = [];

  constructor(readonly net: IndoorNetwork, readonly knowledge?: CampusKnowledge) {
    this.adj = net.nodes.map(() => []);
    this.radj = net.nodes.map(() => []);
    this.ids = net.edges.map((e) => edgeId(net, e));
    this.facts = this.ids.map((id) => knowledge?.edgeFacts.get(id));
    this.historical = net.edges.map((e) => {
      const a = net.nodes[e.a].building;
      const b = net.nodes[e.b].building;
      return knowledge?.historical.find((h) => h.kind === e.kind && samePair(a, b, h.between));
    });
    net.edges.forEach((edge, index) => {
      this.indexById.set(this.ids[index], index);
      const forward: Arc = { edge, index, from: edge.a, to: edge.b };
      const backward: Arc = { edge, index, from: edge.b, to: edge.a };
      this.adj[edge.a].push(forward);
      this.adj[edge.b].push(backward);
      this.radj[edge.b].push(forward);
      this.radj[edge.a].push(backward);
      if (edge.kind === "DOOR") {
        const na = net.nodes[edge.a];
        const nb = net.nodes[edge.b];
        if (na.building === OUTSIDE && nb.building !== OUTSIDE) {
          push(this.entrancesByBuilding, nb.building, edge.b);
          this.exteriorDoors.push({ building: nb.building, index, inside: edge.b, outside: edge.a });
        }
        if (nb.building === OUTSIDE && na.building !== OUTSIDE) {
          push(this.entrancesByBuilding, na.building, edge.a);
          this.exteriorDoors.push({ building: na.building, index, inside: edge.a, outside: edge.b });
        }
      }
    });
    for (const a of net.anchors) push(this.anchorsByBuilding, a.building, a.node);
  }
}

export type IndoorGraph = Graph;

function push<K, V>(m: Map<K, V[]>, k: K, v: V) {
  const list = m.get(k);
  if (list) { if (!list.includes(v)) list.push(v); } else m.set(k, [v]);
}

let graph: Graph | undefined;
function theGraph(): Graph {
  return (graph ??= new Graph(UW_INDOOR_NETWORK, CAMPUS_KNOWLEDGE));
}

/** The graph production routes over: the surveyed network with the campus routing knowledge applied. */
export function campusGraph(): Graph {
  return theGraph();
}

/** For tests and audits: a graph over another network, with only the knowledge given (none: the survey as it is). */
export function graphOver(net: IndoorNetwork, knowledge?: CampusKnowledge): Graph {
  return new Graph(net, knowledge);
}

export function isOnIndoorNetwork(code: string | undefined, g: Graph = theGraph()): boolean {
  return Boolean(code) && g.anchorsByBuilding.has(code!);
}

export function indoorNetworkBuildings(): string[] {
  return [...theGraph().anchorsByBuilding.keys()].sort();
}

/** Seconds to walk an edge, and how many of them are outdoors. */
export function edgeSeconds(edge: IndoorEdge, pace: Pace = INDOOR_PACE): { seconds: number; outdoor: number } {
  const floors = Math.abs(edge.floors);
  switch (edge.kind) {
    case "OUTDOOR": { const s = edge.metres / pace.outdoorMetresPerSecond; return { seconds: s, outdoor: s }; }
    // A change of floor of a kind UW Go does not recognise is timed as stairs, the survey's usual meaning.
    case "STAIRS":
    case "OTHER_VERTICAL": return { seconds: floors * pace.secondsPerFloor, outdoor: 0 };
    case "ELEVATOR": return { seconds: floors ? pace.elevatorWaitSeconds + floors * pace.elevatorSecondsPerFloor : 0, outdoor: 0 };
    case "RAMP": return { seconds: floors * pace.rampSecondsPerFloor, outdoor: 0 };
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
      if (a[p].cost < a[i].cost || (a[p].cost === a[i].cost && a[p].node <= a[i].node)) break;
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
      // Ties break on node id, so the same inputs always produce the same route.
      const less = (x: number, y: number) => a[x].cost < a[y].cost || (a[x].cost === a[y].cost && a[x].node < a[y].node);
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && less(l, m)) m = l;
        if (r < a.length && less(r, m)) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

export interface AccessNeeds {
  /** No steps anywhere. Unknown is not step-free: stairs are refused, and so is an elevator or ramp nobody has confirmed is step-free. */
  stepFree?: boolean;
  /** Nothing that needs a key, a call button or someone's help. */
  independent?: boolean;
  /** Prefer doors documented as automatic. Undocumented doors are allowed, at a cost. */
  automaticDoors?: boolean;
}

export interface CampusConstraints {
  /** When the trip happens. Opening hours are checked only when this is given. */
  at?: Date;
  /** Buildings the trip starts or ends in. Their own hours never refuse the trip. */
  endpoints?: readonly string[];
  access?: AccessNeeds;
  /** Also use experimental segments, and claims whose evidence is anecdotal or inferred. Never quarantined or historical ones. */
  experimental?: boolean;
  /** Seconds added at each crossing between buildings or to outside, by how well that crossing is evidenced. */
  uncertaintySeconds?: Partial<Record<Evidence, number>>;
  /** Seconds added at each such crossing whose accessibility is not documented, when access needs are set. */
  unknownAccessSeconds?: number;
}

export interface RouteOptions {
  outdoorPenalty?: number;
  pace?: Pace;
  /**
   * Canonical ids of segments students have reported shut (see engine/closures.ts). They are
   * removed from the search entirely rather than made expensive: a locked tunnel is not a slow
   * tunnel. The rest of the network still routes, so one closed link costs a detour, never the
   * whole journey.
   */
  closedEdgeIds?: ReadonlySet<string>;
  constraints?: CampusConstraints;
}

/** Why a route may not use a segment in one direction. */
export type Refusal =
  | "HISTORICAL"
  | "QUARANTINED"
  | "EXPERIMENTAL"
  | "CLOSED"
  | "DIRECTION"
  | "CREDENTIAL"
  | "EMERGENCY_ONLY"
  | "NOT_STEP_FREE"
  /** A change of floor by stairs. */
  | "STAIRS"
  /** A change of floor by an elevator, a ramp or something the survey does not name, that nobody has confirmed is step-free. */
  | "VERTICAL_UNCONFIRMED"
  | "NOT_INDEPENDENT"
  | "HOURS_CLOSED"
  | "HOURS_UNKNOWN";

export const REFUSAL_TEXT: Record<Refusal, string> = {
  HISTORICAL: "no longer exists",
  QUARANTINED: "not routed until confirmed",
  EXPERIMENTAL: "experimental, not used in normal routing",
  CLOSED: "reported closed",
  DIRECTION: "cannot be used in this direction",
  CREDENTIAL: "needs a key or card",
  EMERGENCY_ONLY: "emergency exit only",
  NOT_STEP_FREE: "not step-free",
  STAIRS: "a change of floor by stairs",
  VERTICAL_UNCONFIRMED: "an elevator or ramp nobody has confirmed is step-free",
  NOT_INDEPENDENT: "needs a key, a call button or help",
  HOURS_CLOSED: "closed at that time",
  HOURS_UNKNOWN: "hours unknown, and it is outside the hours UW Go routes through buildings",
};

/** Whether a stated availability means open, closed or unknown at a Toronto day and minute. */
export function openState(av: Availability, clock: { weekday: number; minutes: number; dateISO?: string }): "OPEN" | "CLOSED" | "UNKNOWN" {
  switch (av.kind) {
    case "ALWAYS": return "OPEN";
    case "UNKNOWN": return "UNKNOWN";
    case "TEMPORARILY_CLOSED":
      // A temporary closure past its stated end says nothing any more.
      return av.until && clock.dateISO && clock.dateISO > av.until ? "UNKNOWN" : "CLOSED";
    case "SCHEDULE": {
      if (av.unknownDays?.includes(clock.weekday as never)) return "UNKNOWN";
      const yesterday = (clock.weekday + 6) % 7;
      for (const w of av.windows) {
        if (w.days.includes(clock.weekday as never) && clock.minutes >= w.open && clock.minutes < Math.min(w.close, 1440)) return "OPEN";
        if (w.close > 1440 && w.days.includes(yesterday as never) && clock.minutes < w.close - 1440) return "OPEN";
      }
      return "CLOSED";
    }
  }
}

/** A building's stated availability, if there is one the evidence lets a route rely on. */
export function buildingAvailability(g: Graph, building: string, experimental = false): Availability | undefined {
  const fact = g.knowledge?.buildingFacts.get(building)?.availability;
  return fact && claimsUsable(fact.evidence, experimental) ? fact.value : undefined;
}

function hoursRefusal(g: Graph, buildings: readonly string[], c: CampusConstraints, atMs: number): Refusal | undefined {
  const clock = torontoClock(new Date(atMs));
  for (const b of buildings) {
    if (b === OUTSIDE || c.endpoints?.includes(b)) continue;
    const state = openState(buildingAvailability(g, b, Boolean(c.experimental)) ?? { kind: "UNKNOWN" }, clock);
    if (state === "CLOSED") return "HOURS_CLOSED";
    if (state === "UNKNOWN" && (clock.minutes < UNKNOWN_HOURS_PASS_THROUGH.open || clock.minutes >= UNKNOWN_HOURS_PASS_THROUGH.close)) return "HOURS_UNKNOWN";
  }
  return undefined;
}

/**
 * The access claims a fact attaches that a route may rely on to widen what it uses. They carry their own
 * evidence: confirming which door a fact is about does not confirm what was said about its opener.
 */
export function usableAccess(fact: EdgeFact | undefined, experimental: boolean): Partial<Access> | undefined {
  return fact && claimsUsable(fact.accessEvidence ?? fact.evidence, experimental) ? fact.access : undefined;
}

/** The passage a fact states for a direction, if it states one. */
export function statedPassage(fact: EdgeFact | undefined, fromBuilding: string, toBuilding: string): Passage | undefined {
  return fact?.passage?.[`${fromBuilding}>${toBuilding}`];
}

/**
 * Why a route may not take this arc, or undefined when it may. `atMs` is when the student reaches
 * the arc; hours are only checked when the constraints carry a time.
 */
export function refusalFor(g: Graph, arc: Arc, opts: RouteOptions = {}, atMs?: number): Refusal | undefined {
  const i = arc.index;
  const c = opts.constraints ?? {};
  const experimental = Boolean(c.experimental);
  if (g.historical[i]) return "HISTORICAL";
  const fact = g.facts[i];
  if (fact?.activation === "HISTORICAL") return "HISTORICAL";
  if (fact?.activation === "QUARANTINED") return "QUARANTINED";
  if (fact?.activation === "EXPERIMENTAL" && !experimental) return "EXPERIMENTAL";
  if (opts.closedEdgeIds?.has(g.ids[i])) return "CLOSED";

  const from = g.net.nodes[arc.from];
  const to = g.net.nodes[arc.to];
  // A restriction is honoured whatever its evidence: it only ever removes an option.
  switch (statedPassage(fact, from.building, to.building)) {
    case "PROHIBITED": return "DIRECTION";
    case "CREDENTIAL": return "CREDENTIAL";
    case "EMERGENCY_ONLY": return "EMERGENCY_ONLY";
  }

  if (c.access) {
    const stated = fact?.access;
    const usable = usableAccess(fact, experimental);
    if (c.access.stepFree) {
      if (stated?.stepFree === false) return "NOT_STEP_FREE";
      // A change of floor is step-free only on documented word: stairs never are by their kind, and an
      // elevator or ramp the survey records says nothing about whether it works, needs a key or is too steep.
      if (isVertical(arc.edge.kind) && arc.edge.floors !== 0 && usable?.stepFree !== true) return arc.edge.kind === "STAIRS" ? "STAIRS" : "VERTICAL_UNCONFIRMED";
    }
    if (c.access.independent && stated?.independent === false) return "NOT_INDEPENDENT";
  }

  if (c.at && atMs !== undefined) {
    const buildings = from.building === to.building ? [from.building] : [from.building, to.building];
    const hours = hoursRefusal(g, buildings, c, atMs);
    if (hours) return hours;
  }
  return undefined;
}

/** Whether crossing this segment moves between buildings, or between a building and outside. */
export function isCrossing(g: Graph, edge: IndoorEdge): boolean {
  return g.net.nodes[edge.a].building !== g.net.nodes[edge.b].building;
}

/** The evidence behind using a segment: its fact's, where the fact can be relied on, otherwise the survey's. */
export function evidenceFor(g: Graph, index: number, experimental = false): Evidence {
  const fact = g.facts[index];
  return fact && claimsUsable(fact.evidence, experimental) ? fact.evidence : "SURVEYED";
}

/** Whether a crossing's accessibility is documented for the needs asked about. */
function accessDocumented(g: Graph, index: number, needs: AccessNeeds, experimental: boolean): boolean {
  const a = usableAccess(g.facts[index], experimental);
  if (needs.automaticDoors && a?.automaticDoor !== true) return false;
  if ((needs.stepFree || needs.independent) && a?.stepFree !== true && a?.accessibleDesignation !== true) return false;
  return true;
}

/**
 * What crossing a segment into, out of or between buildings adds to a route's cost beyond its time:
 * a charge for how well the crossing is evidenced, and, when access matters, for accessibility nobody
 * has documented. Also used for a door a walk from outside enters by, which no search step crosses.
 */
export function crossingCost(g: Graph, index: number, opts: RouteOptions = {}): number {
  const c = opts.constraints;
  if (!c) return 0;
  const experimental = Boolean(c.experimental);
  let cost = c.uncertaintySeconds?.[evidenceFor(g, index, experimental)] ?? 0;
  if (c.access && c.unknownAccessSeconds && !accessDocumented(g, index, c.access, experimental)) cost += c.unknownAccessSeconds;
  return cost;
}

/**
 * The kind a traveller crosses a segment as. For a change of floor someone has seen, that is the way
 * they would make it: an elevator or ramp when they need step-free (reached only once it is documented as
 * step-free; see `refusalFor`), otherwise whichever way seen is quickest. Anything else is as surveyed.
 */
export function travelKind(g: Graph, index: number, opts: RouteOptions = {}, pace: Pace = INDOOR_PACE): IndoorEdgeKind {
  const edge = g.net.edges[index];
  const fact = g.facts[index];
  const seen = fact?.vertical;
  if (!fact || !seen?.length || !isVertical(edge.kind)) return edge.kind;
  const c = opts.constraints ?? {};
  if (!claimsUsable(fact.verticalEvidence ?? fact.evidence, Boolean(c.experimental))) return edge.kind;
  if (c.access?.stepFree) return seen.includes("ELEVATOR") ? "ELEVATOR" : seen.includes("RAMP") ? "RAMP" : edge.kind;
  return [...seen].sort((x, y) => edgeSeconds({ ...edge, kind: x }, pace).seconds - edgeSeconds({ ...edge, kind: y }, pace).seconds)[0];
}

/** Seconds to cross a segment the way this traveller would. */
function secondsOf(g: Graph, arc: Arc, opts: RouteOptions, pace: Pace): { seconds: number; outdoor: number } {
  const kind = travelKind(g, arc.index, opts, pace);
  return edgeSeconds(kind === arc.edge.kind ? arc.edge : { ...arc.edge, kind }, pace);
}

function arcCost(g: Graph, arc: Arc, opts: RouteOptions, pace: Pace, penalty: number): { cost: number; seconds: number } {
  const t = secondsOf(g, arc, opts, pace);
  const cost = (t.seconds - t.outdoor) + t.outdoor * penalty + (isCrossing(g, arc.edge) ? crossingCost(g, arc.index, opts) : 0);
  return { cost, seconds: t.seconds };
}

/** Costs from a set of nodes to everywhere reachable (or, reversed, from everywhere to them). */
export interface Search {
  cost: Map<number, number>;
  seconds: Map<number, number>;
  /** The arc a node was reached by (forward), or leaves by toward the targets (reverse). */
  via: Map<number, Arc>;
  /** The first target settled, when the search was given targets. */
  reached?: number;
}

function run(g: Graph, sources: readonly number[], opts: RouteOptions, reverse: boolean, targets?: ReadonlySet<number>): Search {
  const penalty = opts.outdoorPenalty ?? OUTDOOR_PENALTY;
  const pace = opts.pace ?? INDOOR_PACE;
  const atMs = opts.constraints?.at?.getTime();
  const cost = new Map<number, number>();
  const seconds = new Map<number, number>();
  const via = new Map<number, Arc>();
  const done = new Set<number>();
  const heap = new Heap();
  for (const s of [...new Set(sources)].sort((x, y) => x - y)) { cost.set(s, 0); seconds.set(s, 0); heap.push(0, s); }
  while (heap.size) {
    const { cost: c, node } = heap.pop();
    if (done.has(node)) continue;
    done.add(node);
    if (targets?.has(node)) return { cost, seconds, via, reached: node };
    for (const arc of reverse ? g.radj[node] : g.adj[node]) {
      const next = reverse ? arc.from : arc.to;
      if (done.has(next)) continue;
      // Going forward the student reaches this arc after the time spent so far. Searching back from
      // a destination that time is not known yet, so the trip's own time stands in for it.
      const when = atMs === undefined ? undefined : reverse ? atMs : atMs + (seconds.get(node) ?? 0) * 1000;
      if (refusalFor(g, arc, opts, when)) continue;
      const step = arcCost(g, arc, opts, pace, penalty);
      const total = c + step.cost;
      if (total < (cost.get(next) ?? Infinity)) {
        cost.set(next, total);
        seconds.set(next, (seconds.get(node) ?? 0) + step.seconds);
        via.set(next, arc);
        heap.push(total, next);
      }
    }
  }
  return { cost, seconds, via };
}

/** Everywhere reachable from `starts`, and what it costs to get there. */
export function searchFrom(starts: readonly number[], opts: RouteOptions = {}, g: Graph = theGraph()): Search {
  return run(g, starts, opts, false);
}

/** Everywhere `ends` can be reached from, and what it costs from there. */
export function searchTo(ends: readonly number[], opts: RouteOptions = {}, g: Graph = theGraph()): Search {
  return run(g, ends, opts, true);
}

/** The route a search found to (forward) or from (reverse) a node, as the arcs travelled in order. */
export function arcsOf(search: Search, node: number, reverse = false): Arc[] {
  const arcs: Arc[] = [];
  for (let n = node; ; ) {
    const arc = search.via.get(n);
    if (!arc) break;
    arcs.push(arc);
    n = reverse ? arc.to : arc.from;
  }
  return reverse ? arcs : arcs.reverse();
}

/** A travelled sequence of arcs as a route: segments, totals, buildings and ids. */
export function routeOf(arcs: readonly Arc[], opts: RouteOptions = {}, g: Graph = theGraph(), startNode?: number): IndoorGraphRoute {
  const pace = opts.pace ?? INDOOR_PACE;
  const penalty = opts.outdoorPenalty ?? OUTDOOR_PENALTY;
  const segments: IndoorSegment[] = arcs.map((arc) => {
    const e = arc.edge;
    const t = secondsOf(g, arc, opts, pace);
    const forward = arc.from === e.a;
    return {
      kind: travelKind(g, arc.index, opts, pace),
      from: g.net.nodes[arc.from],
      to: g.net.nodes[arc.to],
      metres: e.metres,
      seconds: t.seconds,
      floors: forward ? e.floors : -e.floors,
      path: forward ? e.path : [...e.path].reverse(),
    };
  });
  const buildings: string[] = [];
  const first = arcs.length ? g.net.nodes[arcs[0].from] : startNode !== undefined ? g.net.nodes[startNode] : undefined;
  for (const b of [first?.building, ...segments.map((s) => s.to.building)]) {
    if (b && b !== OUTSIDE && buildings[buildings.length - 1] !== b) buildings.push(b);
  }
  const sum = (f: (s: IndoorSegment) => number) => segments.reduce((n, s) => n + f(s), 0);
  return {
    segments,
    edgeIds: arcs.map((arc) => g.ids[arc.index]),
    metres: sum((s) => s.metres),
    seconds: sum((s) => s.seconds),
    outdoorMetres: sum((s) => (s.kind === "OUTDOOR" ? s.metres : 0)),
    outdoorSeconds: sum((s) => (s.kind === "OUTDOOR" ? s.seconds : 0)),
    buildings,
    cost: arcs.reduce((n, arc) => n + arcCost(g, arc, opts, pace, penalty).cost, 0),
  };
}

/**
 * Cheapest route from any of `starts` to any of `ends` (multi-source, multi-target Dijkstra).
 * Undefined when nothing joins them.
 */
export function routeBetweenNodes(starts: readonly number[], ends: readonly number[], opts: RouteOptions = {}, g: Graph = theGraph()): IndoorGraphRoute | undefined {
  const search = run(g, starts, opts, false, new Set(ends));
  if (search.reached === undefined) return undefined;
  const route = routeOf(arcsOf(search, search.reached), opts, g, search.reached);
  return { ...route, cost: search.cost.get(search.reached) ?? 0 };
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
  /** The door's canonical id. */
  edgeId: string;
}

/**
 * Doors from outside into the network, nearest first, for joining a place that is not on the
 * network (a residence, say) to it. `limit` keeps the caller's routing calls few. With a
 * `direction`, only doors that may be used that way under `opts` are offered: a walk that enters
 * the network needs a door that can be entered, and one that leaves it a door that can be left.
 */
export function nearestEntrances(point: { latitude: number; longitude: number }, limit = 3, g: Graph = theGraph(), filter?: { direction: "IN" | "OUT"; opts?: RouteOptions }): Entrance[] {
  const all: Entrance[] = [];
  for (const door of g.exteriorDoors) {
    if (filter) {
      const arc = (filter.direction === "IN" ? g.adj[door.outside] : g.adj[door.inside]).find((a) => a.index === door.index)!;
      if (refusalFor(g, arc, filter.opts, filter.opts?.constraints?.at?.getTime())) continue;
    }
    const node = g.net.nodes[door.inside];
    all.push({ node, building: door.building, metres: haversineMeters(point, { latitude: node.lat, longitude: node.lng }), edgeId: g.ids[door.index] });
  }
  all.sort((x, y) => x.metres - y.metres || x.node.id - y.node.id);
  return all.slice(0, limit);
}

/** The anchor nodes of a building (one per floor the network knows). */
export function anchorsOf(building: string, g: Graph = theGraph()): IndoorNode[] {
  return (g.anchorsByBuilding.get(building) ?? []).map((id) => g.net.nodes[id]);
}
