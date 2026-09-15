import type { CampusLocation, LatLng, RouteOption, RoutePreference } from "@/domain/types";
import { decode } from "@googlemaps/polyline-codec";
import { indoorPathLabel } from "@/engine/indoorRoute";
import { REROUTE_POLICY, pathMetrics, projectOntoPath, rerouteDecision, type RerouteState } from "./routeProgress";
import type { TripRoute } from "./tripRoute";

/**
 * When a trip that has wandered off its route gets a new one. Off-route detection runs on every
 * position update because it is only arithmetic; asking for a route is rationed, because that
 * costs a Routes API call and a rebuild of the indoor graph search.
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
  /** When the fix was taken; a stale one is ignored. */
  timestamp?: number;
  /** Which way the route runs at the nearest point, so moving away from it can be told from walking beside it. */
  routeBearing?: number;
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

/** A vertex of the new route this close to the old one is on it. */
const SAME_WAY_METERS = 12;

/**
 * Whether the new route is the old one rejoined: every point of it after the first sits on the
 * route the student was already following. A GPS that drifted a path's width and settled again
 * gets a route that starts from where it thinks the student is and immediately rejoins; that is
 * worth redrawing quietly, not announcing, because nothing about the way has changed.
 */
export function sameWay(previous: RouteOption, next: RouteOption): boolean {
  if (!previous.polyline || !next.polyline) return false;
  if (Boolean(previous.indoorPath) !== Boolean(next.indoorPath)) return false;
  const old = pathMetrics(decode(previous.polyline).map(([lat, lng]) => ({ lat, lng })));
  const fresh = decode(next.polyline).map(([lat, lng]) => ({ lat, lng }));
  if (fresh.length < 2 || old.path.length < 2) return false;
  let prev: { alongMeters: number } | undefined;
  for (let i = 1; i < fresh.length; i++) {
    const p = projectOntoPath(old, fresh[i], prev);
    if (!p || p.offRouteMeters > SAME_WAY_METERS) return false;
    prev = p;
  }
  return true;
}

/** What the student is told when the route under them changes, naming a change of kind. */
export function rerouteNote(previous: RouteOption, next: RouteOption): string | undefined {
  if (next.mode === "TRANSIT") return "There is a better way from here by bus.";
  if (sameWay(previous, next)) return undefined;
  // A way in the student could not have used from here is worth saying out loud.
  if (next.campus?.decision.outcome === "CORRECTED") return next.campus.summary;
  if (next.indoorPath && !previous.indoorPath) return `Indoor route from here: ${indoorPathLabel(next)}.`;
  if (previous.indoorPath && !next.indoorPath) return "You have left the indoor route, so this is the way from outside.";
  if (next.indoorPath && previous.indoorPath) return `Indoor route updated: ${indoorPathLabel(next)}.`;
  return "Route updated from where you are.";
}

/**
 * Holds the off-route evidence and the spacing of reroutes for one trip. One instance per
 * destination: the destination is fixed for the life of the trip, so a reroute can never
 * quietly send the student somewhere else.
 */
export class TripRerouter {
  private state: RerouteState = {};
  private busy = false;
  /** Reroutes actually asked for. Tests assert the provider is not spammed. */
  attempts = 0;
  private readonly policy: typeof REROUTE_POLICY;
  /** Told when a request starts and ends, so the trip can show that a new route is on its way. */
  private readonly onBusy?: (busy: boolean) => void;

  constructor(
    readonly to: CampusLocation,
    readonly preference: RoutePreference,
    private readonly select: RouteSelector,
    opts: { policy?: typeof REROUTE_POLICY; onBusy?: (busy: boolean) => void } = {},
  ) {
    this.policy = opts.policy ?? REROUTE_POLICY;
    this.onBusy = opts.onBusy;
  }

  /** Whether a route request is in flight right now. */
  get requesting(): boolean {
    return this.busy;
  }

  /**
   * Take one position update. Returns a replacement route only when the student has genuinely
   * left the route, the spacing allows it, and a real route came back; otherwise nothing at
   * all, and whatever the trip is showing stays on screen.
   *
   * `closedEdgeIds` is passed in per fix rather than held, so a closure confirmed mid-walk is
   * honoured on the next reroute without the caller having to rebuild the rerouter.
   */
  async consider(fix: RerouteFix, current: RouteOption, now: Date = new Date(), closedEdgeIds?: ReadonlySet<string>): Promise<TripRoute | undefined> {
    if (!canReroute(current)) return undefined;
    // A request is already in flight: the answer to it is the route these fixes should be judged against.
    if (this.busy) return undefined;

    const decision = rerouteDecision(
      this.state,
      { at: { lat: fix.at.latitude, lng: fix.at.longitude }, offRouteMeters: fix.offRouteMeters, accuracyMeters: fix.accuracyMeters, timestamp: fix.timestamp, routeBearing: fix.routeBearing },
      now.getTime(),
      this.policy,
    );
    this.state = decision.state;
    if (!decision.reroute) return undefined;

    this.busy = true;
    this.onBusy?.(true);
    this.attempts++;
    let route: RouteOption | undefined;
    try {
      route = await this.select(fix.at, this.to, this.preference, now, closedEdgeIds);
    } catch {
      route = undefined; // the spacing set above means the next try waits, and waits longer each time
    } finally {
      this.busy = false;
      this.onBusy?.(false);
    }
    if (!route) return undefined;
    return { route, status: "REROUTED", note: rerouteNote(current, route) };
  }
}
