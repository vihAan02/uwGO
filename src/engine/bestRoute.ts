/**
 * The one place a trip is turned into a route. Every leg of the day, the go-home decision,
 * the timeline, the map and Trip Mode all get their answer from here, so a decision made
 * on one model of travel can never be displayed on another.
 */
import type { CampusDecision, CampusLocation, LatLng, RouteOption, TravelMode } from "@/domain/types";
import type { PlannerConfig } from "@/domain/config";
import type { TransitOptions } from "@/routing/RoutingProvider";
import { addMin, minutesBetween } from "@/time/toronto";
import { clampDeparture, recommendedDeparture } from "./departure";
import { chooseRoute, shouldConsiderTransit, type RouteChoice } from "./transitCompare";
import { campusWalk } from "./campusRoute";
import type { AccessNeeds } from "./indoorGraph";

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
  /** Segments students have reported shut, by canonical id. Routing over the campus network avoids them. */
  closedEdgeIds?: ReadonlySet<string>;
  /** What the traveller needs from doors, links and changes of floor. */
  access?: AccessNeeds;
  /** Also use campus data that is only experimental. Off in normal routing. */
  experimentalCampus?: boolean;
  /** False prices Google's walk exactly as it comes, without the campus knowledge. */
  campus?: boolean;
}

export interface BestRoute extends RouteChoice {
  /** Google's walk, as Google gave it. */
  walking?: RouteOption;
  transit?: RouteOption;
  /** The walk built from campus knowledge, when it corrected or beat Google's and is the walk to take. */
  campusWalk?: RouteOption;
  /** What the campus-aware walk decided, including when it kept Google's. */
  campus?: CampusDecision;
  /** Modes actually priced for this request. */
  consideredModes: TravelMode[];
}

export const SAME_PLACE: RouteOption = { mode: "WALK", durationMinutes: 0, distanceMeters: 0, provider: "same-building", computedAt: "", isEstimate: false };

/**
 * The fastest practical door-to-door option for one trip. Walking and transit are priced as
 * complete trips (transit includes its own walking legs and waits) and compared by
 * `chooseRoute`; nothing here fakes a duration. The walk compared is the campus-aware one
 * (`campusRoute.ts`): Google's, unless campus knowledge says it enters by a way in that may not be
 * used or a way through the campus is enough quicker.
 */
export async function resolveBestRoute(req: RouteRequest, fetcher: RouteFetcher, cfg: PlannerConfig): Promise<BestRoute> {
  const hasDeadline = req.arriveBy !== undefined;
  const arriveBy = req.arriveBy ?? req.departAfter;

  if (req.from.id === req.to.id) {
    const at = clampDeparture(hasDeadline ? addMin(arriveBy, -cfg.arrivalBufferMinutes) : req.departAfter, req.departAfter);
    return { recommended: SAME_PLACE, walking: SAME_PLACE, departure: at, arrival: at, slackMinutes: hasDeadline ? minutesBetween(at, arriveBy) : undefined, reason: "Same building.", consideredModes: [] };
  }

  const walking = await fetcher.walk(req.from, req.to);
  const campus = req.campus === false
    ? undefined
    : await campusWalk({ from: req.from, to: req.to, at: walkingAt(req, walking, cfg), closedEdgeIds: req.closedEdgeIds, access: req.access, experimental: req.experimentalCampus }, walking, fetcher, cfg);
  const walk = campus?.route ?? walking;
  const consideredModes: TravelMode[] = ["WALK"];
  let transit: RouteOption | undefined;
  // Whether a bus is worth asking for is judged on Google's own walk, so campus knowledge never
  // changes which itineraries are requested.
  if (shouldConsiderTransit(Boolean(req.crossCampus), walking?.durationMinutes, cfg)) {
    consideredModes.push("TRANSIT");
    transit = await fetchTransit(req, fetcher, cfg);
  }
  const choice = chooseRoute({ departAfter: req.departAfter, arriveBy, hasDeadline, walking: walk, transit }, cfg);
  // Say when transit was actually asked for and nothing came back: "only option" would read as "not looked".
  const reason = consideredModes.includes("TRANSIT") && !transit && choice.recommended?.mode === "WALK"
    ? "Walking: no transit itinerary was offered for this trip."
    : choice.reason;
  return {
    ...choice,
    reason: campus?.route && choice.recommended === campus.route ? `${campus.decision.summary} ${reason}` : reason,
    walking,
    transit,
    campusWalk: campus?.route,
    campus: campus?.decision,
    consideredModes,
  };
}

/**
 * When a walk for this trip is actually made: just in time for the deadline when there is one,
 * otherwise as soon as the traveller is free. The hours of buildings a walk passes through are
 * judged then. The earliest departure is the wrong moment for a trip with a deadline: from home
 * it is the start of the day.
 */
export function walkingAt(req: Pick<RouteRequest, "departAfter" | "arriveBy">, walking: RouteOption | undefined, cfg: PlannerConfig): Date {
  if (req.arriveBy === undefined || !walking) return req.departAfter;
  return clampDeparture(recommendedDeparture(req.arriveBy, walking.durationMinutes, cfg.arrivalBufferMinutes), req.departAfter);
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
