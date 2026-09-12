import type { CampusLocation, LatLng, RouteOption, RoutePreference } from "@/domain/types";
import { indoorPathLabel } from "@/engine/indoorRoute";
import { REROUTE_POLICY, rerouteDecision, type RerouteState } from "./routeProgress";
import type { TripRoute } from "./tripRoute";

/**
 * When a trip that has wandered off its route gets a new one. Off-route detection runs on every
 * position update because it is only arithmetic; asking for a route is rationed hard, because
 * that costs a Routes API call and a rebuild of the indoor graph search.
 *
 * Kept out of the component on purpose: the rules here are what the tests exercise with
 * simulated movement, and React only has to hand it fixes and take a route back.
 */

/** What one live position says about the student's place on the active route. */
export interface RerouteFix {
  at: LatLng;
  /** Distance from the active route's polyline, from `projectOntoPath`. */
  offRouteMeters: number;
  accuracyMeters?: number;
}

/** Picks the best route to `to` from where the student is now. `rerouteFrom` in production. */
export type RouteSelector = (at: LatLng, to: CampusLocation, preference: RoutePreference, now: Date, closedEdgeIds?: ReadonlySet<string>) => Promise<RouteOption | undefined>;

/**
 * Whether leaving this route is something a reroute can answer. Walking routes are, whether
 * they go outside, through the tunnels, or both. A bus is not: a bus off its usual road is
 * still the bus, and the student cannot walk a new one anyway.
 */
export function canReroute(route: RouteOption): boolean {
  return route.mode === "WALK";
}

/** What the student is told when the route under them changes, naming a change of kind. */
export function rerouteNote(previous: RouteOption, next: RouteOption): string {
  if (next.mode === "TRANSIT") return "There is a better way from here by bus.";
  if (next.indoorPath && !previous.indoorPath) return `Indoor route from here: ${indoorPathLabel(next)}.`;
  if (previous.indoorPath && !next.indoorPath) return "You have left the indoor route, so this is the way from outside.";
  if (next.indoorPath && previous.indoorPath) return `Indoor route updated: ${indoorPathLabel(next)}.`;
  return "Route updated from where you are.";
}

/**
 * Holds the off-route timer and the cooldown for one trip. One instance per destination: the
 * destination is fixed for the life of the trip, so a reroute can never quietly send the
 * student somewhere else.
 */
export class TripRerouter {
  private state: RerouteState = {};
  private busy = false;
  /** Reroutes actually asked for. Tests assert the provider is not spammed. */
  attempts = 0;

  constructor(
    readonly to: CampusLocation,
    readonly preference: RoutePreference,
    private readonly select: RouteSelector,
    private readonly policy = REROUTE_POLICY,
  ) {}

  /**
   * Take one position update. Returns a replacement route only when the student has genuinely
   * left the route, the cooldown has passed, and a real route came back; otherwise nothing at
   * all, and whatever the trip is showing stays on screen.
   *
   * `closedEdgeIds` is passed in per fix rather than held, so a closure confirmed mid-walk is
   * honoured on the next reroute without the caller having to rebuild the rerouter.
   */
  async consider(fix: RerouteFix, current: RouteOption, now: Date = new Date(), closedEdgeIds?: ReadonlySet<string>): Promise<TripRoute | undefined> {
    if (!canReroute(current)) return undefined;
    // A request is already in flight: leave the timer alone rather than starting a second one.
    if (this.busy) return undefined;

    const decision = rerouteDecision(this.state, fix, now.getTime(), this.policy);
    this.state = decision.state;
    if (!decision.reroute) return undefined;

    this.busy = true;
    this.attempts++;
    let route: RouteOption | undefined;
    try {
      route = await this.select(fix.at, this.to, this.preference, now, closedEdgeIds);
    } catch {
      route = undefined; // the cooldown set above means the next try is a minute away
    } finally {
      this.busy = false;
    }
    if (!route) return undefined;
    return { route, status: "REROUTED", note: rerouteNote(current, route) };
  }
}
