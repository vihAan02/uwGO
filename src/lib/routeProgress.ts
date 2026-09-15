import type { RouteOption } from "@/domain/types";
import { haversineMeters } from "@/routing/EstimateRoutingProvider";
import { headingDelta, normalizeDegrees } from "./deviceHeading";

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
  /** Each vertex in a flat metre frame, computed once so a fix costs no trigonometry per vertex. */
  xs: number[];
  ys: number[];
  /** Compass bearing of each segment, `bearings[i]` from vertex i to i + 1. */
  bearings: number[];
  mPerDegLat: number;
  mPerDegLng: number;
}

/** Local flat frame around a latitude: metres east and north per degree. */
function frame(lat: number) {
  const mPerDegLat = 111_320;
  const mPerDegLng = mPerDegLat * Math.cos((lat * Math.PI) / 180);
  return { mPerDegLat, mPerDegLng };
}

/** Compass bearing in degrees from one point to another. */
export function bearingBetween(a: Point, b: Point): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const φ1 = toRad(a.lat);
  const φ2 = toRad(b.lat);
  const Δλ = toRad(b.lng - a.lng);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return normalizeDegrees((Math.atan2(y, x) * 180) / Math.PI);
}

export function pathMetrics(path: Point[]): PathMetrics {
  const cum: number[] = [0];
  for (let i = 1; i < path.length; i++) {
    cum.push(cum[i - 1] + haversineMeters({ latitude: path[i - 1].lat, longitude: path[i - 1].lng }, { latitude: path[i].lat, longitude: path[i].lng }));
  }
  // One frame for the whole route: campus routes span a few kilometres at most, over which the
  // metres-per-degree of longitude change by well under a tenth of a percent.
  const mid = path.length ? path.reduce((s, p) => s + p.lat, 0) / path.length : 0;
  const f = frame(mid);
  const xs = path.map((p) => p.lng * f.mPerDegLng);
  const ys = path.map((p) => p.lat * f.mPerDegLat);
  const bearings: number[] = [];
  for (let i = 0; i < path.length - 1; i++) bearings.push(bearingBetween(path[i], path[i + 1]));
  return { path, cum, total: cum[cum.length - 1] ?? 0, xs, ys, bearings, mPerDegLat: f.mPerDegLat, mPerDegLng: f.mPerDegLng };
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
  /** Which way the route runs at that point. */
  bearing: number;
}

/** How far back along the route a fix may land before it is treated as a fresh search. */
const BACKTRACK_METERS = 30;
/** A candidate ahead of the last fix wins over the global nearest unless it is this much further away. */
const AHEAD_TOLERANCE_METERS = 15;
/** With a previous projection, only this much route ahead of it is searched first. */
const SEARCH_AHEAD_METERS = 200;
/** A match inside that window is trusted, and the rest of the route left unsearched, when it is at most this far off. */
const WINDOW_TRUST_METERS = 40;

/** The first segment whose far end is at or past `along`, by binary search over the cumulative distances. */
function segmentAt(cum: number[], along: number): number {
  let lo = 0;
  let hi = cum.length - 2;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cum[mid + 1] < along) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function project(m: PathMetrics, px: number, py: number, i: number): Projection {
  const ax = m.xs[i], ay = m.ys[i], bx = m.xs[i + 1], by = m.ys[i + 1];
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / len2));
  const qx = ax + t * dx, qy = ay + t * dy;
  return {
    segment: i,
    t,
    point: { lat: qy / m.mPerDegLat, lng: qx / m.mPerDegLng },
    offRouteMeters: Math.hypot(px - qx, py - qy),
    alongMeters: m.cum[i] + t * (m.cum[i + 1] - m.cum[i]),
    bearing: m.bearings[i],
  };
}

/**
 * The nearest point on the route to a position. With a previous projection, a point at or
 * ahead of it is preferred when it is about as close, so a route that doubles back on
 * itself does not throw progress backwards; and only the stretch of route just behind and
 * a couple of hundred metres ahead of it is searched, unless nothing there is close, so a
 * fix costs a handful of segments however long the route is. Without one (or when the
 * walker has genuinely left the route) it is a plain nearest-point search.
 */
export function projectOntoPath(m: PathMetrics, pos: Point, prev?: Pick<Projection, "alongMeters">): Projection | undefined {
  const { path, cum } = m;
  if (path.length === 0) return undefined;
  if (path.length === 1) {
    const d = haversineMeters({ latitude: pos.lat, longitude: pos.lng }, { latitude: path[0].lat, longitude: path[0].lng });
    return { segment: 0, t: 0, point: path[0], offRouteMeters: d, alongMeters: 0, bearing: 0 };
  }
  const px = pos.lng * m.mPerDegLng;
  const py = pos.lat * m.mPerDegLat;
  const floor = prev ? prev.alongMeters - BACKTRACK_METERS : -Infinity;

  if (prev) {
    const first = segmentAt(cum, Math.max(0, floor));
    const last = segmentAt(cum, Math.min(m.total, prev.alongMeters + SEARCH_AHEAD_METERS));
    let near: Projection | undefined;
    for (let i = first; i <= last; i++) {
      const cand = project(m, px, py, i);
      if (cand.alongMeters >= floor && (!near || cand.offRouteMeters < near.offRouteMeters)) near = cand;
    }
    if (near && near.offRouteMeters <= WINDOW_TRUST_METERS) return near;
  }

  let best: Projection | undefined;
  let bestAhead: Projection | undefined;
  for (let i = 0; i < path.length - 1; i++) {
    const cand = project(m, px, py, i);
    if (!best || cand.offRouteMeters < best.offRouteMeters) best = cand;
    if (cand.alongMeters >= floor && (!bestAhead || cand.offRouteMeters < bestAhead.offRouteMeters)) bestAhead = cand;
  }
  if (bestAhead && best && bestAhead.offRouteMeters <= best.offRouteMeters + AHEAD_TOLERANCE_METERS) return bestAhead;
  return best;
}

/** The point `along` metres into the route, clamped to its ends. */
export function pointAlong(m: PathMetrics, along: number): Point {
  const { path, cum } = m;
  if (path.length === 1 || along <= 0) return path[0];
  if (along >= m.total) return path[path.length - 1];
  const i = segmentAt(cum, along);
  const span = cum[i + 1] - cum[i];
  const t = span === 0 ? 0 : (along - cum[i]) / span;
  return { lat: path[i].lat + (path[i + 1].lat - path[i].lat) * t, lng: path[i].lng + (path[i + 1].lng - path[i].lng) * t };
}

/**
 * The route still ahead of a point `along` metres into it: what the map draws, so the part
 * already walked disappears behind the student. The full polyline is untouched; this is a view.
 */
export function remainingPath(m: PathMetrics, along: number): Point[] {
  const { path, cum } = m;
  if (path.length < 2) return path.slice();
  if (along <= 0) return path.slice();
  if (along >= m.total) return [path[path.length - 1]];
  const i = segmentAt(cum, along);
  return [pointAlong(m, along), ...path.slice(i + 1)];
}

/**
 * How far along the route the drawn line starts. Only ever moves forward, and only on a fix that
 * believably sits on the route, so GPS wobble cannot make the line grow back behind the student
 * and a wild fix cannot eat a stretch of route that has not been walked. A new route starts over.
 */
export const CONSUME_MAX_OFF_METERS = 30;
export function advanceProgress(prev: number, proj: Pick<Projection, "offRouteMeters" | "alongMeters">, accuracyMeters?: number): number {
  const allowed = Math.max(CONSUME_MAX_OFF_METERS, Math.min(accuracyMeters ?? 0, 50));
  if (proj.offRouteMeters > allowed) return prev;
  return Math.max(prev, proj.alongMeters);
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

/**
 * When a trip that has wandered believes it. One number from the route is not enough: a phone
 * between tall buildings on campus is routinely 15–30 m out, and the paths either side of a green
 * run 20–40 m apart. So evidence is gathered fix by fix, weighted by how sure each fix is, and
 * a fix that is moving away from the route counts for much more than one merely sitting beside it.
 */
export const REROUTE_POLICY = {
  /** Nearer than this is on the route; GPS beside a campus path sits within it. Evidence drains here. */
  onRouteMeters: 20,
  /** Off by this much starts to count. Between here and `onRouteMeters` nothing changes: the hysteresis band. */
  offRouteMeters: 30,
  /** This far off the fix speaks for itself, moving away or not. */
  clearlyOffMeters: 60,
  /** Nearer than this, a fix counts only when the student is clearly moving away from the route. */
  divergingFromMeters: 15,
  /**
   * Evidence needed to reroute. A fix clearly off gives 2; off, 1.5 when moving away and 0.5 when
   * merely beside; in the hysteresis band, 1 when moving away and nothing otherwise; nearer still
   * but moving away, 0.5; on the route takes 1 back.
   */
  evidenceNeeded: 3,
  /** Gathered over at least this long, so a burst of fixes in one second cannot do it alone. */
  offRouteForMs: 4_000,
  /** Never two reroutes closer together than this... */
  minGapMs: 12_000,
  /** ...except that a student this far off the route already may have one this soon. */
  majorDeviationMeters: 100,
  majorGapMs: 5_000,
  /** Each reroute that did not bring the student back onto a route doubles the wait for the next, up to this. */
  maxGapMs: 60_000,
  /** A fix this uncertain says nothing about whether the student left the route. */
  maxAccuracyMeters: 50,
  /** A fix this old is a memory, not a position. */
  maxFixAgeMs: 10_000,
  /** Moving away: the direction of travel this far from the route's own, or most of the movement being away from it. */
  divergingDegrees: 55,
  divergingShare: 0.6,
  /**
   * The direction of travel is read over at least this much movement: at walking pace fixes come
   * a metre or two apart, which is jitter, so each reading is against the last fix this far back.
   */
  minMoveMeters: 3,
  /** More than this between readings is a jump, not a step, and no direction is read from it. */
  maxStepMeters: 25,
  /** A reading older than this with no movement since means the student has stopped, and is no longer moving away. */
  directionMaxAgeMs: 5_000,
};

export interface DeviationFix {
  at: Point;
  /** Distance from the active route's polyline, from `projectOntoPath`. */
  offRouteMeters: number;
  accuracyMeters?: number;
  /** When the fix was taken (`GeolocationPosition.timestamp`); missing means just now. */
  timestamp?: number;
  /** Which way the route runs at the nearest point, from the projection. */
  routeBearing?: number;
}

export interface RerouteState {
  /** How sure the student has left the route, in fixes' worth. */
  evidence?: number;
  /** When the current run of off-route fixes began. */
  offSince?: number;
  lastRerouteAt?: number;
  /** Reroutes since the student was last seen on a route: each one that did not help waits longer. */
  streak?: number;
  /** The fix the direction of travel is measured from; replaced once the student has moved a few metres. */
  last?: { at: Point; off: number; time: number };
  /** What the last direction reading said: moving away from the route, or not. */
  diverging?: boolean;
}

/** How much a fix's word is worth: a sharp fix fully, one at the accuracy limit half. */
function fixWeight(accuracy: number | undefined, policy: typeof REROUTE_POLICY): number {
  if (accuracy === undefined) return 1;
  const span = policy.maxAccuracyMeters - 15;
  return Math.min(1, Math.max(0.5, 1 - ((accuracy - 15) / span) * 0.5));
}

/**
 * Whether it is time to ask for a new route. Leaving the route is only believed once the fixes
 * have built up enough evidence, over a few seconds at least; a wobble beside the route drains
 * it again. Reroutes are spaced out, less so for a student who is a long way off, and more so
 * for every reroute that left them still off it. Anything that resolves to `reroute: false` is
 * free: no route is computed, nothing is fetched.
 */
export function rerouteDecision(state: RerouteState, fix: DeviationFix, now: number, policy = REROUTE_POLICY): { state: RerouteState; reroute: boolean } {
  const usable = (fix.accuracyMeters === undefined || fix.accuracyMeters <= policy.maxAccuracyMeters)
    && (fix.timestamp === undefined || now - fix.timestamp <= policy.maxFixAgeMs);
  if (!usable) return { state, reroute: false };

  const off = fix.offRouteMeters;
  // Direction of travel, read each time the student has moved a few metres from the last reading.
  let anchor = state.last;
  let diverging = state.diverging ?? false;
  const here = { at: fix.at, off, time: now };
  if (!anchor) {
    anchor = here;
  } else {
    const moved = haversineMeters({ latitude: anchor.at.lat, longitude: anchor.at.lng }, { latitude: fix.at.lat, longitude: fix.at.lng });
    if (moved > policy.maxStepMeters) {
      anchor = here;
      diverging = false;
    } else if (moved >= policy.minMoveMeters) {
      // Heading away counts only while the distance is not shrinking: a student cutting a corner
      // towards the next stretch of route is heading across it, not away from it.
      const awayByHeading = fix.routeBearing !== undefined && off >= anchor.off - 1
        && Math.abs(headingDelta(fix.routeBearing, bearingBetween(anchor.at, fix.at))) > policy.divergingDegrees;
      const awayByDistance = off - anchor.off >= policy.divergingShare * moved;
      diverging = awayByHeading || awayByDistance;
      anchor = here;
    } else if (now - anchor.time >= policy.directionMaxAgeMs) {
      anchor = here;
      diverging = false;
    }
  }

  let evidence = state.evidence ?? 0;
  let offSince = state.offSince;
  let streak = state.streak ?? 0;
  // Not far off yet but walking away is caught while the distance is still small; sitting in the
  // hysteresis band changes nothing; anything nearer, unless walking away, is the route.
  let gain: number;
  if (off >= policy.clearlyOffMeters) gain = 2;
  else if (off >= policy.offRouteMeters) gain = diverging ? 1.5 : 0.5;
  else if (off > policy.onRouteMeters) gain = diverging ? 1 : 0;
  else if (off >= policy.divergingFromMeters && diverging) gain = 0.5;
  else gain = -1;
  if (gain > 0) {
    evidence += gain * fixWeight(fix.accuracyMeters, policy);
    offSince ??= now;
  } else if (gain < 0) {
    evidence = Math.max(0, evidence - 1);
    offSince = undefined;
    streak = 0;
  }
  const next: RerouteState = { evidence, offSince, lastRerouteAt: state.lastRerouteAt, streak, last: anchor, diverging };

  const enough = evidence >= policy.evidenceNeeded && offSince !== undefined && now - offSince >= policy.offRouteForMs;
  if (!enough) return { state: next, reroute: false };
  const base = off >= policy.majorDeviationMeters ? policy.majorGapMs : policy.minGapMs;
  const gap = Math.min(policy.maxGapMs, base * 2 ** Math.max(0, streak - 1));
  const spaced = state.lastRerouteAt === undefined || now - state.lastRerouteAt >= gap;
  if (!spaced) return { state: next, reroute: false };
  return { state: { lastRerouteAt: now, streak: streak + 1, last: anchor, diverging }, reroute: true };
}
