import type { RouteOption } from "@/domain/types";
import { haversineMeters } from "@/routing/EstimateRoutingProvider";

/**
 * Progress along the route a trip is actually following. Everything here works on the
 * polyline Google returned for the chosen route, so "remaining" means the rest of that
 * route, never the straight line to the destination.
 */

export type Point = { lat: number; lng: number };

export interface PathMetrics {
  path: Point[];
  /** Metres along the route at each vertex; `cum[0]` is 0. */
  cum: number[];
  /** Whole route, in metres, measured along the polyline. */
  total: number;
}

export function pathMetrics(path: Point[]): PathMetrics {
  const cum: number[] = [0];
  for (let i = 1; i < path.length; i++) {
    cum.push(cum[i - 1] + haversineMeters({ latitude: path[i - 1].lat, longitude: path[i - 1].lng }, { latitude: path[i].lat, longitude: path[i].lng }));
  }
  return { path, cum, total: cum[cum.length - 1] ?? 0 };
}

export interface Projection {
  /** Index of the segment's first vertex. */
  segment: number;
  /** 0..1 along that segment. */
  t: number;
  /** Nearest point on the route. */
  point: Point;
  /** How far the position is from the route. */
  offRouteMeters: number;
  /** Route distance covered up to the nearest point. */
  alongMeters: number;
}

/** How far back along the route a fix may land before it is treated as a fresh search. */
const BACKTRACK_METERS = 30;
/** A candidate ahead of the last fix wins over the global nearest unless it is this much further away. */
const AHEAD_TOLERANCE_METERS = 15;

/** Local flat frame around a latitude: metres east and north per degree. */
function frame(lat: number) {
  const mPerDegLat = 111_320;
  const mPerDegLng = mPerDegLat * Math.cos((lat * Math.PI) / 180);
  return { x: (p: Point) => p.lng * mPerDegLng, y: (p: Point) => p.lat * mPerDegLat, mPerDegLat, mPerDegLng };
}

/**
 * The nearest point on the route to a position. With a previous projection, a point at or
 * ahead of it is preferred when it is about as close, so a route that doubles back on
 * itself does not throw progress backwards. Without one (or when the walker has genuinely
 * left the route) it is a plain nearest-point search.
 */
export function projectOntoPath(m: PathMetrics, pos: Point, prev?: Pick<Projection, "alongMeters">): Projection | undefined {
  const { path, cum } = m;
  if (path.length === 0) return undefined;
  if (path.length === 1) {
    const d = haversineMeters({ latitude: pos.lat, longitude: pos.lng }, { latitude: path[0].lat, longitude: path[0].lng });
    return { segment: 0, t: 0, point: path[0], offRouteMeters: d, alongMeters: 0 };
  }
  const f = frame(pos.lat);
  const px = f.x(pos);
  const py = f.y(pos);
  let best: Projection | undefined;
  let bestAhead: Projection | undefined;
  const floor = prev ? prev.alongMeters - BACKTRACK_METERS : -Infinity;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    const ax = f.x(a), ay = f.y(a), bx = f.x(b), by = f.y(b);
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / len2));
    const qx = ax + t * dx, qy = ay + t * dy;
    const off = Math.hypot(px - qx, py - qy);
    const along = cum[i] + t * (cum[i + 1] - cum[i]);
    const cand: Projection = { segment: i, t, point: { lat: qy / f.mPerDegLat, lng: qx / f.mPerDegLng }, offRouteMeters: off, alongMeters: along };
    if (!best || off < best.offRouteMeters) best = cand;
    if (along >= floor && (!bestAhead || off < bestAhead.offRouteMeters)) bestAhead = cand;
  }
  if (bestAhead && best && bestAhead.offRouteMeters <= best.offRouteMeters + AHEAD_TOLERANCE_METERS) return bestAhead;
  return best;
}

export interface Remaining {
  meters: number;
  minutes: number;
  /** 0..1 share of the route still to go. */
  fraction: number;
}

/**
 * What is left of the trip from a projection. Distance is Google's own route distance
 * scaled by the share of the polyline still ahead, so the number the student sees before
 * setting off is the number that counts down. Time on foot scales the same way; on transit
 * the arrival time Google gave is the better answer and simply counts down with the clock.
 */
export function remainingFrom(route: RouteOption, m: PathMetrics, proj: Pick<Projection, "alongMeters">, now: Date = new Date()): Remaining {
  const fraction = m.total > 0 ? Math.min(1, Math.max(0, (m.total - proj.alongMeters) / m.total)) : 0;
  const base = route.distanceMeters ?? m.total;
  const meters = Math.max(0, Math.round(base * fraction));
  let minutes: number;
  const arrival = route.mode === "TRANSIT" ? route.arrivalTime?.getTime() : undefined;
  if (arrival !== undefined && Number.isFinite(arrival)) minutes = Math.max(0, (arrival - now.getTime()) / 60_000);
  else minutes = route.durationMinutes * fraction;
  return { meters, minutes, fraction };
}

/**
 * "7 min · 520 m remaining". Distance is rounded so a GPS wobble does not make it flicker,
 * and a trip with no distance left never claims a minute is left.
 */
export function formatRemaining(r: Remaining): { time: string; distance: string } {
  const mins = r.meters === 0 ? 0 : Math.ceil(r.minutes - 1e-9);
  const time = mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)} hr ${mins % 60 ? `${mins % 60} min` : ""}`.trim();
  const distance = r.meters < 1000 ? `${Math.max(0, Math.round(r.meters / 10) * 10)} m` : `${(r.meters / 1000).toFixed(1)} km`;
  return { time, distance };
}

/** Close enough to the end of the route to count as there. */
export const ARRIVED_METERS = 15;

export const REROUTE_POLICY = {
  /** Further from the route than this counts as off it. */
  offRouteMeters: 60,
  /** Only after being off the route for this long, so one bad fix does not reroute. */
  offRouteForMs: 20_000,
  /** Never two reroutes closer together than this. */
  minGapMs: 60_000,
  /** A fix this uncertain says nothing about whether the student left the route. */
  maxAccuracyMeters: 50,
};

export interface RerouteState {
  offSince?: number;
  lastRerouteAt?: number;
}

/**
 * Whether it is time to ask for a new route. Leaving the route is only believed once a
 * run of accurate fixes has agreed on it for a while, and reroutes are spaced out, so the
 * routing API is asked rarely rather than on every position update.
 */
export function rerouteDecision(state: RerouteState, fix: { offRouteMeters: number; accuracyMeters?: number }, now: number, policy = REROUTE_POLICY): { state: RerouteState; reroute: boolean } {
  const usable = fix.accuracyMeters === undefined || fix.accuracyMeters <= policy.maxAccuracyMeters;
  if (!usable) return { state, reroute: false };
  if (fix.offRouteMeters <= policy.offRouteMeters) return { state: { ...state, offSince: undefined }, reroute: false };
  const offSince = state.offSince ?? now;
  const longEnough = now - offSince >= policy.offRouteForMs;
  const spaced = state.lastRerouteAt === undefined || now - state.lastRerouteAt >= policy.minGapMs;
  if (longEnough && spaced) return { state: { offSince: undefined, lastRerouteAt: now }, reroute: true };
  return { state: { ...state, offSince }, reroute: false };
}
