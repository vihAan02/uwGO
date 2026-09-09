/**
 * The one place a trip is turned into a route. Every leg of the day, the go-home decision,
 * the timeline, the map and Trip Mode all get their answer from here, so a decision made
 * on one model of travel can never be displayed on another.
 */
import type { CampusLocation, LatLng, RouteOption, TravelMode } from "@/domain/types";
import type { PlannerConfig } from "@/domain/config";
import type { TransitOptions } from "@/routing/RoutingProvider";
import { addMin, minutesBetween } from "@/time/toronto";
import { clampDeparture } from "./departure";
import { chooseRoute, shouldConsiderTransit, type RouteChoice } from "./transitCompare";

/** The raw candidates. A lookup that fails resolves to undefined; reporting the error is the caller's job. */
export interface RouteFetcher {
  walk(from: LatLng, to: LatLng): Promise<RouteOption | undefined>;
  transit(from: LatLng, to: LatLng, opts: TransitOptions): Promise<RouteOption | undefined>;
}

export interface RouteRequest {
  from: CampusLocation;
  to: CampusLocation;
  /** Earliest the traveller can set off. */
  departAfter: Date;
  /** When they must be there. Undefined when nothing is waiting at the other end. */
  arriveBy?: Date;
  crossCampus?: boolean;
}

export interface BestRoute extends RouteChoice {
  walking?: RouteOption;
  transit?: RouteOption;
  /** Modes actually priced for this request. */
  consideredModes: TravelMode[];
}

export const SAME_PLACE: RouteOption = { mode: "WALK", durationMinutes: 0, distanceMeters: 0, provider: "same-building", computedAt: "", isEstimate: false };

/**
 * The fastest practical door-to-door option for one trip. Walking and transit are priced as
 * complete trips (transit includes its own walking legs and waits) and compared by
 * `chooseRoute`; nothing here fakes a duration.
 */
export async function resolveBestRoute(req: RouteRequest, fetcher: RouteFetcher, cfg: PlannerConfig): Promise<BestRoute> {
  const hasDeadline = req.arriveBy !== undefined;
  const arriveBy = req.arriveBy ?? req.departAfter;

  if (req.from.id === req.to.id) {
    const at = clampDeparture(hasDeadline ? addMin(arriveBy, -cfg.arrivalBufferMinutes) : req.departAfter, req.departAfter);
    return { recommended: SAME_PLACE, walking: SAME_PLACE, departure: at, arrival: at, slackMinutes: hasDeadline ? minutesBetween(at, arriveBy) : undefined, reason: "Same building.", consideredModes: [] };
  }

  const walking = await fetcher.walk(req.from, req.to);
  const consideredModes: TravelMode[] = ["WALK"];
  let transit: RouteOption | undefined;
  if (shouldConsiderTransit(Boolean(req.crossCampus), walking?.durationMinutes, cfg)) {
    consideredModes.push("TRANSIT");
    transit = await fetchTransit(req, fetcher, cfg);
  }
  const choice = chooseRoute({ departAfter: req.departAfter, arriveBy, hasDeadline, walking, transit }, cfg);
  // Say when transit was actually asked for and nothing came back: "only option" would read as "not looked".
  const reason = consideredModes.includes("TRANSIT") && !transit && choice.recommended?.mode === "WALK"
    ? "Walking: no transit itinerary was offered for this trip."
    : choice.reason;
  return { ...choice, reason, walking, transit, consideredModes };
}

/**
 * Transit is schedule-bound, so ask the provider the question the traveller has. With a
 * deadline: the itinerary that lands just before it, which is the latest useful departure.
 * If that bus would have to leave before the traveller is free, ask instead for the first
 * itinerary after they are. Without a deadline: the first itinerary after they are free.
 */
async function fetchTransit(req: RouteRequest, fetcher: RouteFetcher, cfg: PlannerConfig): Promise<RouteOption | undefined> {
  const earliest = addMin(req.departAfter, cfg.buildingExitMinutes);
  if (req.arriveBy === undefined) return fetcher.transit(req.from, req.to, { departureTime: earliest });

  const byArrival = await fetcher.transit(req.from, req.to, { arrivalTime: addMin(req.arriveBy, -cfg.arrivalBufferMinutes) });
  if (!byArrival) return undefined;
  if (byArrival.departureTime && byArrival.departureTime.getTime() >= earliest.getTime() - 60_000) return byArrival;
  return fetcher.transit(req.from, req.to, { departureTime: earliest });
}
