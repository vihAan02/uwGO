/**
 * The campus-aware walk decided for every pair of places, summarised so two versions of the engine, the
 * network or the knowledge can be compared decision by decision: how many walks are corrected because of
 * a door that may not be used, how many go through a building or over a bridge, what they save, how
 * many door walks Google is asked for, and whether the line drawn for each route passes through the
 * doors and links it names. Run by hand through campusBenchmark.tool.ts; a change that moves these
 * numbers should be read before it is accepted.
 *
 * Without real Google walks the benchmark stands Google in with a straight line, 30% longer, at 1.33 m/s,
 * for the trip and for every door walk alike. That shows what the engine does, not what Google's real
 * timing would make of it. A table of real walks can be given instead, and filled from Google as the
 * engine asks; a walk kept in one direction is served reversed for the other, as the engine already
 * treats door walks.
 */
import { decode, encode } from "@googlemaps/polyline-codec";
import type { CampusLocation, CampusOutcome, LatLng, RouteOption } from "@/domain/types";
import type { PlannerConfig } from "@/domain/config";
import { buildingLocation, findBuilding, residencePresets } from "@/data/buildings";
import { edgeLabel } from "@/data/indoor/edgeId";
import { haversineMeters } from "@/routing/EstimateRoutingProvider";
import { pairKey } from "@/routing/RoutingProvider";
import { deserializeRoute, serializeRoute, type RouteOptionJSON } from "@/routing/serialize";
import { campusWalk, type CampusSearchOptions } from "./campusRoute";
import { campusGraph, type IndoorGraph } from "./indoorGraph";
import type { ConnectorFetcher } from "./indoorRoute";

/** A stand-in for Google's walk, shaped like one: the straight line, 30% longer, at 1.33 m/s. */
export const STAND_IN_WALK = { detour: 1.3, metresPerSecond: 1.33 } as const;

export function standInWalk(from: LatLng, to: LatLng): RouteOption {
  const metres = haversineMeters(from, to) * STAND_IN_WALK.detour;
  const seconds = metres / STAND_IN_WALK.metresPerSecond;
  return {
    mode: "WALK", durationMinutes: Math.max(1, Math.ceil(seconds / 60)), durationSeconds: Math.round(seconds), distanceMeters: Math.round(metres),
    polyline: encode([[from.latitude, from.longitude], [to.latitude, to.longitude]]), provider: "stand-in", computedAt: "", isEstimate: false,
  };
}

/** One of Google's walks as a table keeps it: the route (null when Google had none) and when it was fetched. */
export interface StoredWalk {
  route: RouteOptionJSON | null;
  fetchedAt: string;
}

/** Where a walk the engine asked for came from. */
export type WalkSource = "STAND_IN" | "TABLE" | "REVERSED" | "FETCHED" | "MISSING";

export type WalkFetch = (from: LatLng, to: LatLng) => Promise<RouteOption | undefined>;

/** A walk served for the opposite direction: the same time and distance, the line drawn the other way. */
export function reversedWalk(r: RouteOption): RouteOption {
  return { ...r, polyline: r.polyline ? encode(decode(r.polyline).reverse()) : undefined, steps: undefined };
}

const latLngOf = (p: LatLng): LatLng => ({ latitude: p.latitude, longitude: p.longitude });

/**
 * The walks the benchmark gives the engine: the stand-in, or a table of real ones keyed by `pairKey`.
 * The table serves a walk reversed when it only keeps the other direction, and asks `fetch` for the rest
 * when one is given, keeping what comes back. Every walk asked for is counted and logged.
 */
export class BenchmarkWalks implements ConnectorFetcher {
  asked = 0;
  /** Walks fetched, in all. */
  fetched = 0;
  /** Pairs neither the table nor a fetch could give. */
  readonly missing = new Set<string>();
  /** Every walk asked for, in order, and where it came from. */
  readonly log: { key: string; source: WalkSource }[] = [];
  private readonly inflight = new Map<string, Promise<RouteOption | undefined>>();

  constructor(
    readonly table?: Record<string, StoredWalk>,
    private readonly fetch?: WalkFetch,
    /** `serveReversed` false fetches each direction rather than reversing the other: Google's two directions can differ by several seconds. */
    private readonly options: { onFetched?: () => void; serveReversed?: boolean } = {},
  ) {}

  async walk(from: LatLng, to: LatLng): Promise<RouteOption | undefined> {
    this.asked++;
    const { route, source } = await this.lookup(from, to, this.options.serveReversed ?? true);
    this.log.push({ key: pairKey(from, to), source });
    return route;
  }

  /** Makes sure the table has a walk, without counting it as asked; `reversible` false insists on this very direction. */
  async ensure(from: LatLng, to: LatLng, reversible = true): Promise<WalkSource> {
    return (await this.lookup(from, to, reversible)).source;
  }

  private async lookup(from: LatLng, to: LatLng, reversible: boolean): Promise<{ route: RouteOption | undefined; source: WalkSource }> {
    if (!this.table) return { route: standInWalk(from, to), source: "STAND_IN" };
    const key = pairKey(from, to);
    const hit = this.table[key];
    if (hit) return { route: hit.route ? deserializeRoute(hit.route) : undefined, source: "TABLE" };
    const back = reversible ? this.table[pairKey(to, from)] : undefined;
    if (back) return { route: back.route ? reversedWalk(deserializeRoute(back.route)) : undefined, source: "REVERSED" };
    if (!this.fetch) {
      this.missing.add(key);
      return { route: undefined, source: "MISSING" };
    }
    let pending = this.inflight.get(key);
    if (!pending) {
      pending = this.fetch(latLngOf(from), latLngOf(to))
        .then((route) => {
          this.table![key] = { route: route ? serializeRoute(route) : null, fetchedAt: new Date().toISOString() };
          this.fetched++;
          this.options.onFetched?.();
          return route;
        })
        .finally(() => this.inflight.delete(key));
      this.inflight.set(key, pending);
    }
    try {
      return { route: await pending, source: "FETCHED" };
    } catch {
      this.missing.add(key);
      return { route: undefined, source: "MISSING" };
    }
  }
}

/** How a chosen route uses Google's walks: to a door first, from a door last, both, or neither. */
export type RouteShape = "NETWORK" | "ENTRY" | "EXIT" | "THROUGH";

/** The line drawn for a chosen route, checked against what the route says it uses. */
export interface LineCheck {
  /** Surveyed segments (doors, links, corridors) whose ends are not on the line, or not in the order walked. */
  offLine: string[];
  /** Metres drawn straight from where a Google-priced walk's line ends to the door it was priced to. */
  joins: number[];
  /** Metres drawn straight from the building's map point to where the network starts, and from where it ends to the map point. */
  startStub: number;
  endStub: number;
}

export interface PairDecision {
  outcome: CampusOutcome | "NONE";
  /** Google's walk, as timed. */
  google: number;
  /** Google's walk floor to floor, when the engine charges the inside of the buildings. */
  googleTotal: number;
  /** The chosen campus route, when one was taken. */
  seconds?: number;
  total?: number;
  via?: string[];
  edgeIds?: string[];
  /** Buildings the chosen route passes through, other than the ends. */
  through: string[];
  /** Bridges and tunnels the chosen route uses. */
  links: number;
  /** Google door walks priced for this pair, beyond Google's own walk. */
  lookups: number;
  /** What the leg shows and plans with: the chosen route's own seconds, or Google's when its walk stands. */
  shown?: number;
  cost?: number;
  shape?: RouteShape;
  googleUsable?: boolean;
  /** What Google's walk is charged for the inside of the buildings at its ends, and by which doors. */
  inside?: { origin: number; destination: number; originDoor?: string; destinationDoor?: string };
  margin?: number;
  summary?: string;
  /** The door the chosen route last goes in by, and the door it last leaves by. */
  entrance?: string;
  exit?: string;
  bridges?: string[];
  tunnels?: string[];
  evidence?: string;
  provenance?: { label: string; evidence?: string; from: string[] }[];
  surveyedSegments?: number;
  rejected?: { label: string; because: string; seconds?: number }[];
  /** The walks asked for this pair, in order: Google's own first, then door walks. */
  asked?: { key: string; source: WalkSource }[];
  line?: LineCheck;
}

export interface CampusSnapshot {
  at: string;
  places: string[];
  pairs: Record<string, PairDecision>;
  ms: number;
}

/** The places trips are made between: every building on the network, and every residence off it. */
export function benchmarkPlaces(g: IndoorGraph = campusGraph()): CampusLocation[] {
  const network = [...g.anchorsByBuilding.keys()].sort();
  const residences = residencePresets("UW").filter((b) => !g.anchorsByBuilding.has(b.code)).map((b) => b.code).sort();
  return [...network, ...residences].map((code) => buildingLocation(findBuilding("UW", code)!)).filter((l): l is CampusLocation => Boolean(l));
}

type Point = [number, number];
const metres = (a: Point, b: Point) => haversineMeters({ latitude: a[0], longitude: a[1] }, { latitude: b[0], longitude: b[1] });

export function shapeOf(timing: readonly string[] | undefined): RouteShape {
  const lead = timing?.[0] === "GOOGLE";
  const tail = (timing?.length ?? 0) > 1 && timing?.[timing.length - 1] === "GOOGLE";
  return lead && tail ? "THROUGH" : lead ? "ENTRY" : tail ? "EXIT" : "NETWORK";
}

/** The last door a route goes in by from outside, and the last it leaves by, as its `via` names them. */
export function doorsOf(via: readonly string[]): { entrance?: string; exit?: string } {
  let entrance: string | undefined;
  let exit: string | undefined;
  via.forEach((v, i) => {
    if (v === "outside" || v.startsWith("through ")) return;
    if (via[i - 1] === "outside" && via[i + 1] !== "outside") entrance = v;
    if (via[i + 1] === "outside" && via[i - 1] !== "outside") exit = v;
  });
  return { entrance, exit };
}

/**
 * Whether the drawn line passes through every surveyed segment the route names, in order, and how far it
 * is drawn straight where it is not: between a Google-priced walk and its door, and between a building's
 * map point and the network.
 */
export function checkLine(g: IndoorGraph, route: RouteOption, shape: RouteShape, edgeIds: readonly string[]): LineCheck {
  const line = route.polyline ? (decode(route.polyline) as Point[]) : [];
  const ON_LINE_METRES = 1.5;
  const find = (p: Point, from: number) => {
    for (let i = from; i < line.length; i++) if (metres(line[i], p) <= ON_LINE_METRES) return i;
    return -1;
  };
  const findLast = (p: Point) => {
    for (let i = line.length - 1; i >= 0; i--) if (metres(line[i], p) <= ON_LINE_METRES) return i;
    return -1;
  };
  const lead = shape === "ENTRY" || shape === "THROUGH";
  const tail = shape === "EXIT" || shape === "THROUGH";
  const network = edgeIds.slice(lead ? 1 : 0, tail ? edgeIds.length - 1 : edgeIds.length);
  const offLine: string[] = [];
  let cursor = 0;
  for (const id of network) {
    const index = g.indexById.get(id);
    if (index === undefined) { offLine.push(id); continue; }
    const e = g.net.edges[index];
    const a = find([g.net.nodes[e.a].lat, g.net.nodes[e.a].lng], cursor);
    const b = find([g.net.nodes[e.b].lat, g.net.nodes[e.b].lng], cursor);
    if (a < 0 || b < 0) { offLine.push(id); continue; }
    cursor = Math.min(a, b);
  }
  const doorPoint = (id: string): Point | undefined => {
    const door = g.exteriorDoors.find((d) => g.ids[d.index] === id);
    const n = door ? g.net.nodes[door.inside] : undefined;
    return n ? [n.lat, n.lng] : undefined;
  };
  const joins: number[] = [];
  if (lead) {
    const p = doorPoint(edgeIds[0]);
    const i = p ? find(p, 0) : -1;
    joins.push(i > 0 ? Math.round(metres(line[i - 1], line[i])) : i === 0 ? 0 : -1);
  }
  if (tail) {
    const p = doorPoint(edgeIds[edgeIds.length - 1]);
    const i = p ? findLast(p) : -1;
    joins.push(i >= 0 && i < line.length - 1 ? Math.round(metres(line[i], line[i + 1])) : i === line.length - 1 ? 0 : -1);
  }
  const stub = (x?: Point, y?: Point) => (x && y ? Math.round(metres(x, y)) : 0);
  return {
    offLine,
    joins,
    startStub: lead ? 0 : stub(line[0], line[1]),
    endStub: tail ? 0 : stub(line[line.length - 2], line[line.length - 1]),
  };
}

/** Every ordered pair of places decided. */
export async function campusSnapshot(g: IndoorGraph, cfg: PlannerConfig, at: Date, walks: BenchmarkWalks | undefined = undefined, places: CampusLocation[] = benchmarkPlaces(g), search: CampusSearchOptions = {}): Promise<CampusSnapshot> {
  const started = Date.now();
  const pairs: Record<string, PairDecision> = {};
  const kindById = new Map(g.net.edges.map((e, i) => [g.ids[i], e.kind] as const));
  const labelOf = (id: string) => {
    const i = g.indexById.get(id)!;
    return g.facts[i]?.label ?? edgeLabel(g.net, g.net.edges[i]);
  };
  for (const from of places) {
    for (const to of places) {
      if (from.id === to.id) continue;
      const fetcher = walks ?? new BenchmarkWalks();
      const before = fetcher.asked;
      const logged = fetcher.log.length;
      const google = await fetcher.walk(from, to);
      const r = google ? await campusWalk({ from, to, at }, google, fetcher, cfg, at, g, search) : undefined;
      // Read loosely: an older engine's decision has no inside charge, margin or floor-to-floor total.
      const d = r?.decision as (NonNullable<typeof r>["decision"] & { thresholdSeconds?: number }) | undefined;
      const chosen = d?.chosen;
      const googleSeconds = google ? (google.durationSeconds ?? google.durationMinutes * 60) : 0;
      const ends = [from.buildingCode, to.buildingCode];
      const through = chosen ? [...new Set((r?.route?.indoorPath ?? chosen.via.filter((v) => v.startsWith("through ")).map((v) => v.slice("through ".length))))].filter((b) => !ends.includes(b)) : [];
      const ofKind = (kind: string) => (chosen ? [...new Set(chosen.edgeIds.filter((id) => kindById.get(id) === kind).map(labelOf))] : []);
      const shape = chosen ? shapeOf(chosen.timing) : undefined;
      const inside = d?.inside;
      pairs[`${from.buildingCode}>${to.buildingCode}`] = {
        outcome: d?.outcome ?? "NONE",
        google: Math.round(googleSeconds),
        googleTotal: Math.round((d?.googleSeconds ?? googleSeconds) + (inside?.originSeconds ?? 0) + (inside?.destinationSeconds ?? 0)),
        ...(chosen ? { seconds: chosen.seconds, total: chosen.totalSeconds ?? chosen.seconds, cost: chosen.cost, via: chosen.via, edgeIds: chosen.edgeIds } : {}),
        through,
        links: ofKind("BRIDGE").length + ofKind("TUNNEL").length,
        lookups: Math.max(0, fetcher.asked - before - 1),
        shown: Math.round(chosen ? chosen.seconds : googleSeconds),
        ...(shape ? { shape } : {}),
        ...(d ? { googleUsable: d.googleUsable, margin: d.marginSeconds ?? d.thresholdSeconds, summary: d.summary } : {}),
        ...(inside ? { inside: { origin: inside.originSeconds, destination: inside.destinationSeconds, originDoor: inside.originDoor, destinationDoor: inside.destinationDoor } } : {}),
        ...(chosen ? {
          ...doorsOf(chosen.via),
          bridges: ofKind("BRIDGE"),
          tunnels: ofKind("TUNNEL"),
          evidence: chosen.evidence,
          provenance: chosen.provenance.map((p) => ({ label: p.label, evidence: p.evidence, from: [...p.from] })),
          surveyedSegments: chosen.surveyedSegments,
        } : {}),
        ...(d?.rejected.length ? { rejected: d.rejected.slice(0, 4).map((x) => ({ label: x.label, because: x.because, seconds: x.seconds })) } : {}),
        asked: fetcher.log.slice(logged),
        ...(r?.route?.polyline && chosen && shape ? { line: checkLine(g, r.route, shape, chosen.edgeIds) } : {}),
      };
    }
  }
  return { at: at.toISOString(), places: places.map((p) => p.buildingCode!), pairs, ms: Date.now() - started };
}

export interface CampusMetrics {
  pairs: number;
  outcomes: Record<string, number>;
  /** Google's walk replaced because it relied on a way in or out that may not be used, or a closure. */
  corrected: number;
  /** Nothing allowed could be routed: Google's walk kept with a warning. */
  noUsableRoute: number;
  /** Chosen routes that pass through a building. */
  walkThroughs: number;
  /** Chosen routes that use a bridge or tunnel, and how many they use in all. */
  linkRoutes: number;
  links: number;
  /** Seconds saved floor to floor by the routes taken over a usable Google walk. */
  savings: { count: number; mean: number; max: number; maxPair?: string };
  /** Google door walks priced, in all and per pair. */
  lookups: { total: number; mean: number; max: number };
}

export function campusMetrics(s: CampusSnapshot): CampusMetrics {
  const all = Object.entries(s.pairs);
  const outcomes: Record<string, number> = {};
  const savings: { pair: string; saved: number }[] = [];
  let corrected = 0, noUsableRoute = 0, walkThroughs = 0, linkRoutes = 0, links = 0, lookups = 0, maxLookups = 0;
  for (const [pair, d] of all) {
    outcomes[d.outcome] = (outcomes[d.outcome] ?? 0) + 1;
    if (d.outcome === "CORRECTED") corrected++;
    if (d.outcome === "NO_USABLE_ROUTE") noUsableRoute++;
    if (d.total !== undefined && d.through.length) walkThroughs++;
    if (d.links) { linkRoutes++; links += d.links; }
    if ((d.outcome === "SHORTCUT" || d.outcome === "BETTER_ENTRANCE") && d.total !== undefined) savings.push({ pair, saved: d.googleTotal - d.total });
    lookups += d.lookups;
    maxLookups = Math.max(maxLookups, d.lookups);
  }
  const best = savings.reduce<{ pair: string; saved: number } | undefined>((m, x) => (!m || x.saved > m.saved ? x : m), undefined);
  return {
    pairs: all.length,
    outcomes,
    corrected,
    noUsableRoute,
    walkThroughs,
    linkRoutes,
    links,
    savings: { count: savings.length, mean: savings.length ? Math.round(savings.reduce((n, x) => n + x.saved, 0) / savings.length) : 0, max: best ? Math.round(best.saved) : 0, maxPair: best?.pair },
    lookups: { total: lookups, mean: all.length ? Math.round((lookups / all.length) * 100) / 100 : 0, max: maxLookups },
  };
}

export interface CampusChange {
  pair: string;
  kind: "OUTCOME" | "REROUTED" | "SHORTER" | "LONGER" | "NOW_INVALID" | "NOW_ROUTED";
  before: PairDecision;
  after: PairDecision;
}

export interface CampusComparison {
  compared: number;
  unchanged: number;
  changes: CampusChange[];
  counts: Record<CampusChange["kind"], number>;
}

/**
 * Pair by pair: a different outcome, the same outcome by other segments, the same segments in less or
 * more time, a walk that can no longer be routed, or one that now can. A pair changes in one way only,
 * the first that applies.
 */
export function compareCampusSnapshots(before: CampusSnapshot, after: CampusSnapshot): CampusComparison {
  const keys = [...new Set([...Object.keys(before.pairs), ...Object.keys(after.pairs)])].sort();
  const changes: CampusChange[] = [];
  const counts: CampusComparison["counts"] = { OUTCOME: 0, REROUTED: 0, SHORTER: 0, LONGER: 0, NOW_INVALID: 0, NOW_ROUTED: 0 };
  let unchanged = 0;
  for (const pair of keys) {
    const b = before.pairs[pair];
    const a = after.pairs[pair];
    if (!b || !a) continue;
    let kind: CampusChange["kind"] | undefined;
    if (a.outcome === "NO_USABLE_ROUTE" && b.outcome !== "NO_USABLE_ROUTE") kind = "NOW_INVALID";
    else if (a.total !== undefined && b.total === undefined) kind = "NOW_ROUTED";
    else if (a.outcome !== b.outcome) kind = "OUTCOME";
    else if ((a.edgeIds ?? []).join(",") !== (b.edgeIds ?? []).join(",")) kind = "REROUTED";
    else if (a.total !== undefined && b.total !== undefined && a.total < b.total - 1) kind = "SHORTER";
    else if (a.total !== undefined && b.total !== undefined && a.total > b.total + 1) kind = "LONGER";
    if (kind) { changes.push({ pair, kind, before: b, after: a }); counts[kind]++; } else unchanged++;
  }
  return { compared: keys.length, unchanged, changes, counts };
}

const seconds = (s: number | undefined) => (s === undefined ? "-" : `${Math.round(s)} s`);
const describe = (d: PairDecision) => `${d.outcome}${d.total !== undefined ? ` ${seconds(d.total)} via ${d.via?.join(" > ")}` : ` (Google ${seconds(d.googleTotal)})`}`;

export function renderCampusMetrics(m: CampusMetrics, label: string): string[] {
  return [
    `## ${label}`,
    "",
    `Pairs decided: ${m.pairs}. Outcomes: ${Object.entries(m.outcomes).sort().map(([k, v]) => `${k} ${v}`).join(", ")}.`,
    `Google's walk corrected because it relied on a way that may not be used: ${m.corrected}. Kept with a warning, nothing allowed routable: ${m.noUsableRoute}.`,
    `Routes taken through a building: ${m.walkThroughs}. Routes taken over a bridge or tunnel: ${m.linkRoutes} (${m.links} crossings).`,
    `Savings over a usable Google walk, floor to floor: ${m.savings.count} routes, mean ${m.savings.mean} s, max ${m.savings.max} s${m.savings.maxPair ? ` (${m.savings.maxPair})` : ""}.`,
    `Google door walks priced: ${m.lookups.total} in all, ${m.lookups.mean} per pair, at most ${m.lookups.max} for one pair.`,
  ];
}

export function renderCampusComparison(c: CampusComparison, limit = 40): string[] {
  const lines = [`Pairs compared: ${c.compared}; unchanged ${c.unchanged}; ${Object.entries(c.counts).map(([k, v]) => `${k.toLowerCase().replace("_", " ")} ${v}`).join(", ")}.`];
  for (const kind of ["NOW_INVALID", "NOW_ROUTED", "OUTCOME", "REROUTED", "SHORTER", "LONGER"] as const) {
    const of = c.changes.filter((x) => x.kind === kind);
    if (!of.length) continue;
    lines.push("", `${kind} (${of.length}${of.length > limit ? `, first ${limit}` : ""}):`);
    for (const x of of.slice(0, limit)) lines.push(`  ${x.pair.replace(">", " > ")}: ${describe(x.before)} -> ${describe(x.after)}`);
  }
  return lines;
}

/** The routes that save most, and the corrections, for reading what the engine does with a version. */
export function renderCampusHighlights(s: CampusSnapshot, limit = 25): string[] {
  const taken = Object.entries(s.pairs).filter(([, d]) => d.total !== undefined && (d.outcome === "SHORTCUT" || d.outcome === "BETTER_ENTRANCE"))
    .map(([pair, d]) => ({ pair, d, saved: d.googleTotal - d.total! }))
    .sort((x, y) => y.saved - x.saved);
  const lines = [`Largest savings (${Math.min(limit, taken.length)} of ${taken.length}):`];
  for (const { pair, d, saved } of taken.slice(0, limit)) lines.push(`  ${pair.replace(">", " > ")}: ${Math.round(saved)} s, ${d.outcome} ${seconds(d.total)} vs Google ${seconds(d.googleTotal)} via ${d.via?.join(" > ")}`);
  const corrected = Object.entries(s.pairs).filter(([, d]) => d.outcome === "CORRECTED");
  const into: Record<string, number> = {};
  for (const [pair] of corrected) { const to = pair.split(">")[1]; into[to] = (into[to] ?? 0) + 1; }
  lines.push("", `Corrections by destination: ${Object.entries(into).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}.`);
  return lines;
}
