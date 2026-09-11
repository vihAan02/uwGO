import type { CampusLocation, RouteOption } from "@/domain/types";
import { DEFAULT_PLANNER_CONFIG } from "@/domain/config";
import { chooseRoute } from "@/engine/transitCompare";
import { HttpRoutingProvider } from "@/routing/HttpRoutingProvider";

/** A transit result computed longer ago than this is refetched before a trip starts. */
export const TRANSIT_STALE_MINUTES = 3;
/** Starting a trip means leaving now, so a departure further off than this is not "now". */
export const TRANSIT_USABLE_WINDOW_MINUTES = 45;

/** Bypasses the route cache on purpose: a trip starting now needs a bus that has not left. */
const live = new HttpRoutingProvider();

export type TripRouteStatus = "PLANNED" | "REFRESHED" | "FELL_BACK_TO_WALKING" | "NO_TRANSIT" | "REROUTED";

export interface TripRoute {
  route: RouteOption;
  status: TripRouteStatus;
  /** Shown to the student when the planned option no longer applies. */
  note?: string;
}

/**
 * Whether the planned transit option still describes a trip starting right now.
 * The weekly plan works out departures for the whole week, so a perfectly valid plan
 * can name a bus that left this morning or one that does not run until tomorrow.
 * Either way it is not the bus to catch now.
 */
function isStale(route: RouteOption, now: Date): boolean {
  if (route.mode !== "TRANSIT") return false;
  const dep = route.departureTime?.getTime();
  if (dep === undefined) return true;
  if (dep <= now.getTime()) return true; // already gone
  if (dep - now.getTime() > TRANSIT_USABLE_WINDOW_MINUTES * 60_000) return true; // a different trip
  const computed = Date.parse(route.computedAt);
  return Number.isFinite(computed) && now.getTime() - computed > TRANSIT_STALE_MINUTES * 60_000;
}

/**
 * The route to actually travel, as opposed to the one the weekly plan worked out.
 * Walking never changes. A transit option whose bus has gone (or that was computed a
 * while ago) is recomputed for right now and put through the same walk-vs-transit choice
 * the planner uses, so the trip only stays on the bus if the bus still wins from here.
 * If nothing useful comes back the student is told and given the walk instead.
 */
export async function resolveTripRoute(
  planned: RouteOption,
  fallbackWalk: RouteOption | undefined,
  from: CampusLocation,
  to: CampusLocation,
  now: Date = new Date(),
): Promise<TripRoute> {
  if (!isStale(planned, now)) return { route: planned, status: "PLANNED" };

  const missed = Boolean(planned.departureTime && planned.departureTime.getTime() <= now.getTime());
  let fresh: RouteOption | undefined;
  try {
    fresh = await live.getTransitRoute(from, to, { departureTime: now });
  } catch {
    // Fall through to walking rather than showing a departure that has passed.
  }

  // No deadline is known here, so the comparison is simply who gets there first from now.
  const choice = chooseRoute({ departAfter: now, arriveBy: now, hasDeadline: false, walking: fallbackWalk, transit: fresh }, DEFAULT_PLANNER_CONFIG);
  if (choice.recommended?.mode === "TRANSIT") {
    return {
      route: choice.recommended,
      status: "REFRESHED",
      note: missed ? "That departure has gone. This is the next one." : "Updated for leaving now.",
    };
  }
  if (fallbackWalk) {
    return {
      route: fallbackWalk,
      status: "FELL_BACK_TO_WALKING",
      note: fresh?.departureTime && fresh.departureTime.getTime() > now.getTime() - 60_000
        ? "Walking gets you there as soon as the next bus would, so this is the walking route."
        : "No useful transit option right now, so this is the walking route.",
    };
  }
  return { route: planned, status: "NO_TRANSIT", note: "No transit option right now, and no walking route is available." };
}

/** Compass bearing in degrees from one point to another, for aiming the trip camera. */
export function bearing(from: { latitude: number; longitude: number }, to: { latitude: number; longitude: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const φ1 = toRad(from.latitude);
  const φ2 = toRad(to.latitude);
  const Δλ = toRad(to.longitude - from.longitude);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (Math.atan2(y, x) * 180) / Math.PI;
}

/**
 * A fresh walking route from wherever the student actually is, for when they have left the
 * planned route. Same provider and same server handler as every other route; the caller
 * decides how rarely to ask (see `rerouteDecision`).
 */
export async function rerouteWalk(from: { latitude: number; longitude: number }, to: CampusLocation): Promise<TripRoute | undefined> {
  const route = await live.getWalkingRoute(from, to);
  return route ? { route, status: "REROUTED", note: "Route updated from where you are." } : undefined;
}
