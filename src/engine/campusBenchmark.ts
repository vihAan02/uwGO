/**
 * The campus-aware walk decided for every pair of places, summarised so two versions of the engine, the
 * network or the knowledge can be compared decision by decision: how many walks are corrected because of
 * a door that may not be used, how many go through a building or over a bridge, what they save, and how
 * many door walks Google is asked for. Run by hand through campusBenchmark.tool.ts; a change that moves
 * these numbers should be read before it is accepted.
 *
 * Without real Google walks the benchmark stands Google in with a straight line, 30% longer, at 1.33 m/s,
 * for the trip and for every door walk alike. That shows what the engine does, not what Google's real
 * timing would make of it; a file of real walks can be given instead.
 */
import { encode } from "@googlemaps/polyline-codec";
import type { CampusLocation, CampusOutcome, LatLng, RouteOption } from "@/domain/types";
import type { PlannerConfig } from "@/domain/config";
import { buildingLocation, findBuilding, residencePresets } from "@/data/buildings";
import { haversineMeters } from "@/routing/EstimateRoutingProvider";
import { pairKey } from "@/routing/RoutingProvider";
import { campusWalk } from "./campusRoute";
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

/** Walks from a table of real ones (keyed by `pairKey`), or the stand-in where the table has none; counts what was asked. */
export class BenchmarkWalks implements ConnectorFetcher {
  asked = 0;
  /** Pairs the table did not have, when there is a table. */
  readonly missing = new Set<string>();
  constructor(private readonly table?: Readonly<Record<string, RouteOption>>) {}
  async walk(from: LatLng, to: LatLng): Promise<RouteOption | undefined> {
    this.asked++;
    if (!this.table) return standInWalk(from, to);
    const hit = this.table[pairKey(from, to)];
    if (!hit) this.missing.add(pairKey(from, to));
    return hit;
  }
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

/** Every ordered pair of places decided. */
export async function campusSnapshot(g: IndoorGraph, cfg: PlannerConfig, at: Date, walks: BenchmarkWalks | undefined = undefined, places: CampusLocation[] = benchmarkPlaces(g)): Promise<CampusSnapshot> {
  const started = Date.now();
  const pairs: Record<string, PairDecision> = {};
  const isLink = new Set(g.net.edges.map((e, i) => [e.kind, i] as const).filter(([k]) => k === "BRIDGE" || k === "TUNNEL").map(([, i]) => g.ids[i]));
  for (const from of places) {
    for (const to of places) {
      if (from.id === to.id) continue;
      const fetcher = walks ?? new BenchmarkWalks();
      const before = fetcher.asked;
      const google = await fetcher.walk(from, to);
      const r = google ? await campusWalk({ from, to, at }, google, fetcher, cfg, at, g) : undefined;
      const d = r?.decision;
      const chosen = d?.chosen;
      const ends = [from.buildingCode, to.buildingCode];
      const through = chosen ? [...new Set((r?.route?.indoorPath ?? chosen.via.filter((v) => v.startsWith("through ")).map((v) => v.slice("through ".length))))].filter((b) => !ends.includes(b)) : [];
      pairs[`${from.buildingCode}>${to.buildingCode}`] = {
        outcome: d?.outcome ?? "NONE",
        google: Math.round(google ? (google.durationSeconds ?? google.durationMinutes * 60) : 0),
        googleTotal: Math.round((d?.googleSeconds ?? 0) + (d?.inside?.originSeconds ?? 0) + (d?.inside?.destinationSeconds ?? 0)),
        ...(chosen ? { seconds: chosen.seconds, total: chosen.totalSeconds ?? chosen.seconds, via: chosen.via, edgeIds: chosen.edgeIds } : {}),
        through,
        links: chosen ? chosen.edgeIds.filter((id) => isLink.has(id)).length : 0,
        lookups: Math.max(0, fetcher.asked - before - 1),
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
