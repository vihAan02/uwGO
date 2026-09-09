import type { LatLng, RouteOption } from "@/domain/types";

export interface TransitOptions {
  /** Leave no earlier than this. Mutually exclusive with arrivalTime. */
  departureTime?: Date;
  /** Arrive no later than this. Mutually exclusive with departureTime. */
  arrivalTime?: Date;
}

/** The only routing contract the rest of the app knows about. Google never leaks past its implementation. */
export interface RoutingProvider {
  readonly id: string;
  getWalkingRoute(from: LatLng, to: LatLng): Promise<RouteOption | undefined>;
  getTransitRoute(from: LatLng, to: LatLng, opts: TransitOptions): Promise<RouteOption | undefined>;
}

/** Rounded coordinate key: 5 decimals is roughly 1 m, more than enough for building centroids. */
export function pairKey(from: LatLng, to: LatLng): string {
  const f = (n: number) => n.toFixed(5);
  return `${f(from.latitude)},${f(from.longitude)}->${f(to.latitude)},${f(to.longitude)}`;
}

/** Waterloo Region bounding box. Anything outside is refused by the server handler. */
export const WATERLOO_REGION_BOUNDS = { minLat: 43.25, maxLat: 43.7, minLng: -80.85, maxLng: -80.2 };

export function isInWaterlooRegion(p: LatLng): boolean {
  const b = WATERLOO_REGION_BOUNDS;
  return p.latitude >= b.minLat && p.latitude <= b.maxLat && p.longitude >= b.minLng && p.longitude <= b.maxLng;
}
