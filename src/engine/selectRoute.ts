/**
 * The one route-selection path. Given two places, a departure window and the student's route
 * preference, it prices every way of getting there — the outdoor walk, transit, and the winter
 * route over the campus indoor network — and says which one to take.
 *
 * The weekly plan and a live reroute in Trip Mode both come through here, so a route recomputed
 * from where the student is standing is chosen by exactly the rules that chose the original one.
 */
import type { CampusLocation, RouteOption, RoutePreference } from "@/domain/types";
import type { PlannerConfig } from "@/domain/config";
import { resolveBestRoute, type BestRoute, type RouteFetcher, type RouteRequest } from "./bestRoute";
import { indoorIsReasonable, indoorRouteBetween, type ConnectorFetcher } from "./indoorRoute";
import { clampDeparture, expectedArrival, recommendedDeparture } from "./departure";

export interface RouteSelectionRequest extends RouteRequest {
  /** FASTEST takes Google's answer; INDOORS takes the winter route when it is not unreasonably slower. */
  preference: RoutePreference;
  /**
   * Price the winter route even when it cannot be recommended. The plan does, because the
   * timeline offers it as an alternative row; a live reroute does not, because an option that
   * cannot win is not worth the walking-route lookups it costs to join the ends to the network.
   */
  indoorAlternative?: boolean;
}

export interface RouteSelection extends BestRoute {
  /** The winter route, when the network offers one. Present whether or not it was recommended. */
  indoor?: RouteOption;
}

/**
 * What a selection needs. `best` is separate from `connector` so the planner can keep its
 * per-leg cache of walk-vs-transit resolutions while the indoor joins go through its route memo.
 */
export interface SelectionDeps {
  best(req: RouteRequest): Promise<BestRoute>;
  connector: ConnectorFetcher;
}

/** Deps for a caller that has nothing but a fetcher: price each request from scratch. */
export function fetcherDeps(fetcher: RouteFetcher, cfg: PlannerConfig): SelectionDeps {
  return { best: (req) => resolveBestRoute(req, fetcher, cfg), connector: fetcher };
}

/**
 * The best route for one trip. Walking and transit are compared first, as complete door-to-door
 * options. The winter route then displaces the walk only when the student asked for indoors,
 * the fastest answer was on foot in the first place (a bus is never overridden: that decision
 * was about time), and staying inside does not cost unreasonably more.
 */
export async function selectRoute(req: RouteSelectionRequest, deps: SelectionDeps, cfg: PlannerConfig, now?: Date): Promise<RouteSelection> {
  const best = await deps.best(req);
  const wantIndoor = req.indoorAlternative ?? true;
  const indoor = wantIndoor || req.preference === "INDOORS"
    ? await indoorRouteBetween(req.from, req.to, deps.connector, now)
    : undefined;

  if (!indoor || req.preference !== "INDOORS" || best.recommended?.mode !== "WALK" || !best.walking || !indoorIsReasonable(indoor, best.walking, cfg)) {
    return { ...best, indoor };
  }

  const hasDeadline = req.arriveBy !== undefined;
  const departure = hasDeadline
    ? clampDeparture(recommendedDeparture(req.arriveBy!, indoor.durationMinutes, cfg.arrivalBufferMinutes), req.departAfter)
    : req.departAfter;
  const extra = indoor.durationMinutes - best.walking.durationMinutes;
  return {
    ...best,
    indoor,
    recommended: indoor,
    departure,
    arrival: expectedArrival(departure, indoor.durationMinutes),
    reason: extra > 0 ? `Indoor route: ${extra} min slower than the fastest walk, but you stay inside.` : "Indoor route: as fast as the outdoor walk.",
  };
}

/** A place that is nowhere on the map but where the student actually is. Never rendered; only routed from. */
export function livePosition(at: { latitude: number; longitude: number }): CampusLocation {
  return { id: "live-position", name: "Your location", latitude: at.latitude, longitude: at.longitude, kind: "HOME" };
}
