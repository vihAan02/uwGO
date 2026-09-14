/**
 * Route regression for the campus network and the knowledge over it.
 *
 * Every trip between two buildings the network knows is routed three ways — the winter route, the
 * network search behind the campus-aware fastest walk, and a step-free winter route — and summarised,
 * so that two versions of the network or of the knowledge can be compared route by route. A
 * regenerated survey or a promoted field observation should change the routes it is meant to change,
 * and someone should read which ones before it is accepted. Run by hand through
 * src/engine/networkRegression.tool.ts.
 */
import { torontoDate } from "@/time/toronto";
import { CAMPUS_PACE, CAMPUS_UNCERTAINTY_SECONDS } from "./campusRoute";
import { arcsOf, routeOf, searchFrom, type IndoorGraph, type RouteOptions } from "./indoorGraph";

export type RegressionMode = "winter" | "fastest" | "stepFree";
export const REGRESSION_MODES: readonly RegressionMode[] = ["winter", "fastest", "stepFree"];

export interface RouteSummary {
  seconds: number;
  /** Buildings passed through, in order. */
  buildings: string[];
  edgeIds: string[];
}

/** Keyed "FROM>TO|mode"; null where there is no route. */
export type RouteSnapshot = Record<string, RouteSummary | null>;

/**
 * A Tuesday at noon in term: inside every posted opening window and inside the hours UW Go assumes for
 * a building whose hours are unknown, so a comparison is about the network and not about the clock.
 */
export const REGRESSION_AT = torontoDate("2026-09-15", 12 * 60);

export function regressionOptions(mode: RegressionMode, at: Date = REGRESSION_AT): RouteOptions {
  switch (mode) {
    case "winter": return { constraints: { at } };
    case "fastest": return { outdoorPenalty: 1, pace: CAMPUS_PACE, constraints: { at, uncertaintySeconds: CAMPUS_UNCERTAINTY_SECONDS } };
    case "stepFree": return { constraints: { at, access: { stepFree: true } } };
  }
}

/** The cheapest of `nodes` a search reached. Ties go to the lower node id, as they do inside the search. */
function cheapest(nodes: readonly number[], cost: ReadonlyMap<number, number>): number | undefined {
  let best: number | undefined;
  for (const n of [...nodes].sort((a, b) => a - b)) {
    const c = cost.get(n);
    if (c !== undefined && (best === undefined || c < cost.get(best)!)) best = n;
  }
  return best;
}

/**
 * Every ordered pair of network buildings, in each mode. One search per origin and mode: the route to a
 * building is the one `routeBetweenBuildings` finds, read off the full search instead of a search that
 * stops at the destination.
 */
export function routeSnapshot(g: IndoorGraph, modes: readonly RegressionMode[] = REGRESSION_MODES): RouteSnapshot {
  const buildings = [...g.anchorsByBuilding.keys()].sort();
  const snapshot: RouteSnapshot = {};
  for (const mode of modes) {
    const opts = regressionOptions(mode);
    for (const from of buildings) {
      const search = searchFrom(g.anchorsByBuilding.get(from)!, opts, g);
      for (const to of buildings) {
        if (to === from) continue;
        const key = `${from}>${to}|${mode}`;
        const target = cheapest(g.anchorsByBuilding.get(to)!, search.cost);
        if (target === undefined) { snapshot[key] = null; continue; }
        const route = routeOf(arcsOf(search, target), opts, g, target);
        snapshot[key] = { seconds: Math.round(route.seconds), buildings: route.buildings, edgeIds: route.edgeIds };
      }
    }
  }
  return snapshot;
}

export type RouteChangeKind = "LOST" | "GAINED" | "REROUTED" | "RETIMED";

export interface RouteChange {
  key: string;
  kind: RouteChangeKind;
  before: RouteSummary | null;
  after: RouteSummary | null;
}

export interface RouteComparison {
  compared: number;
  unchanged: number;
  changes: RouteChange[];
}

/** Route by route: a trip that can no longer be routed, one that now can, one that takes other segments, one that takes the same segments in a different time. */
export function compareSnapshots(before: RouteSnapshot, after: RouteSnapshot): RouteComparison {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  const changes: RouteChange[] = [];
  let unchanged = 0;
  for (const key of keys) {
    const was = before[key] ?? null;
    const now = after[key] ?? null;
    if (!was && !now) unchanged++;
    else if (was && !now) changes.push({ key, kind: "LOST", before: was, after: null });
    else if (!was && now) changes.push({ key, kind: "GAINED", before: null, after: now });
    else if (was!.edgeIds.join(",") !== now!.edgeIds.join(",")) changes.push({ key, kind: "REROUTED", before: was, after: now });
    else if (was!.seconds !== now!.seconds) changes.push({ key, kind: "RETIMED", before: was, after: now });
    else unchanged++;
  }
  return { compared: keys.length, unchanged, changes };
}

const describe = (r: RouteSummary | null) => (r ? `${r.seconds} s via ${r.buildings.join(", ")}` : "no route");

export function renderRouteComparison(c: RouteComparison): string {
  const count = (k: RouteChangeKind) => c.changes.filter((x) => x.kind === k).length;
  const lines = [`${c.compared} routes compared: ${c.unchanged} unchanged, ${count("LOST")} lost, ${count("GAINED")} gained, ${count("REROUTED")} rerouted, ${count("RETIMED")} retimed.`];
  for (const kind of ["LOST", "GAINED", "REROUTED", "RETIMED"] as const) {
    const of = c.changes.filter((x) => x.kind === kind);
    if (!of.length) continue;
    lines.push("", `${kind} (${of.length}):`);
    for (const x of of) {
      const [pair, mode] = x.key.split("|");
      lines.push(`  ${pair.replace(">", " > ")} (${mode}): ${describe(x.before)} -> ${describe(x.after)}`);
    }
  }
  return lines.join("\n");
}

export interface Arrival {
  from: string;
  mode: RegressionMode;
  seconds?: number;
  /** Id of the last segment crossed into the destination building. */
  lastCrossing?: string;
}

/** How routes reach a building from others, in each mode: the time, and the segment they enter it by. */
export function arrivalsInto(g: IndoorGraph, to: string, froms: readonly string[]): Arrival[] {
  const out: Arrival[] = [];
  const ends = g.anchorsByBuilding.get(to);
  if (!ends) return out;
  for (const mode of REGRESSION_MODES) {
    const opts = regressionOptions(mode);
    for (const from of froms) {
      const starts = g.anchorsByBuilding.get(from);
      if (!starts || from === to) continue;
      const search = searchFrom(starts, opts, g);
      const target = cheapest(ends, search.cost);
      if (target === undefined) { out.push({ from, mode }); continue; }
      const arcs = arcsOf(search, target);
      const into = [...arcs].reverse().find((arc) => g.net.nodes[arc.to].building === to && g.net.nodes[arc.from].building !== to);
      out.push({ from, mode, seconds: Math.round(routeOf(arcs, opts, g, target).seconds), lastCrossing: into ? g.ids[into.index] : undefined });
    }
  }
  return out;
}
