import { describe, expect, it } from "vitest";
import type { RouteOption } from "@/domain/types";
import { haversineMeters } from "@/routing/EstimateRoutingProvider";
import { advanceProgress, bearingBetween, formatRemaining, pathMetrics, pointAlong, projectOntoPath, remainingFrom, remainingPath, rerouteDecision, REROUTE_POLICY, type DeviationFix, type Point } from "./routeProgress";

/**
 * A route across campus, roughly STC → MC: east along one street, then north. Real routes
 * are denser, but the maths is the same.
 */
const ROUTE: Point[] = [
  { lat: 43.4710, lng: -80.5450 },
  { lat: 43.4710, lng: -80.5440 },
  { lat: 43.4710, lng: -80.5430 },
  { lat: 43.4720, lng: -80.5430 },
  { lat: 43.4730, lng: -80.5430 },
];
const m = pathMetrics(ROUTE);
const NOW = new Date("2026-09-11T14:00:00Z");
const walk: RouteOption = { mode: "WALK", durationMinutes: 6, distanceMeters: 400, provider: "google-routes", computedAt: NOW.toISOString(), isEstimate: false };

/** A point `north` metres north and `east` metres east of `p`. */
const shift = (p: Point, north: number, east: number): Point => ({ lat: p.lat + north / 111_320, lng: p.lng + east / (111_320 * Math.cos((p.lat * Math.PI) / 180)) });

describe("distance along the route", () => {
  it("adds up the polyline and never the straight line", () => {
    const straight = haversineMeters({ latitude: ROUTE[0].lat, longitude: ROUTE[0].lng }, { latitude: ROUTE[4].lat, longitude: ROUTE[4].lng });
    expect(m.total).toBeGreaterThan(straight * 1.3);
    expect(m.cum[0]).toBe(0);
    for (let i = 1; i < m.cum.length; i++) expect(m.cum[i]).toBeGreaterThan(m.cum[i - 1]);
  });

  it("projects a position onto the nearest part of the route, and says which way the route runs there", () => {
    // Slightly north of the middle of the first street.
    const p = projectOntoPath(m, { lat: 43.47102, lng: -80.5445 })!;
    expect(p.segment).toBe(0);
    expect(p.t).toBeCloseTo(0.5, 2);
    expect(p.offRouteMeters).toBeGreaterThan(1);
    expect(p.offRouteMeters).toBeLessThan(4);
    expect(p.alongMeters).toBeCloseTo(m.cum[1] / 2, 0);
    expect(Math.round(p.bearing)).toBe(90);
    expect(Math.round(projectOntoPath(m, { lat: 43.4725, lng: -80.5429 })!.bearing)).toBe(0);
  });

  it("clamps to the ends rather than extending the route", () => {
    const before = projectOntoPath(m, { lat: 43.4710, lng: -80.5460 })!;
    expect(before.alongMeters).toBe(0);
    const after = projectOntoPath(m, { lat: 43.4740, lng: -80.5430 })!;
    expect(after.alongMeters).toBeCloseTo(m.total, 5);
  });

  it("keeps progress moving forward where the route doubles back on itself", () => {
    // Out and back along the same street: two overlapping segments.
    const loop = pathMetrics([{ lat: 43.4710, lng: -80.5450 }, { lat: 43.4710, lng: -80.5430 }, { lat: 43.4710, lng: -80.5450 }]);
    const pos = { lat: 43.47101, lng: -80.5440 }; // equally near both legs
    const fresh = projectOntoPath(loop, pos)!;
    expect(fresh.segment).toBe(0);
    const later = projectOntoPath(loop, pos, { alongMeters: loop.cum[1] + 20 })!;
    expect(later.segment).toBe(1);
    expect(later.alongMeters).toBeGreaterThan(fresh.alongMeters);
  });

  it("searches only the route just ahead when it can, and gets the same answer as searching all of it", () => {
    // A long, dense route: 2 km of vertices every 5 m, north along one street.
    const dense: Point[] = Array.from({ length: 401 }, (_, i) => ({ lat: 43.4600 + (i * 5) / 111_320, lng: -80.5430 }));
    const dm = pathMetrics(dense);
    for (const along of [0, 250, 1000, 1990]) {
      const pos = shift(pointAlong(dm, along), 0, 6);
      const windowed = projectOntoPath(dm, pos, { alongMeters: along - 10 })!;
      const full = projectOntoPath(dm, pos)!;
      expect(windowed.alongMeters).toBeCloseTo(full.alongMeters, 3);
      expect(windowed.offRouteMeters).toBeCloseTo(full.offRouteMeters, 3);
    }
    // Far from anything near the last projection, the whole route is searched after all.
    const wayAhead = shift(pointAlong(dm, 1500), 0, 4);
    expect(projectOntoPath(dm, wayAhead, { alongMeters: 100 })!.alongMeters).toBeCloseTo(1500, 0);
  });

  it("knows the bearing between two points", () => {
    const a = { lat: 43.47, lng: -80.54 };
    expect(Math.round(bearingBetween(a, { lat: 43.48, lng: -80.54 }))).toBe(0);
    expect(Math.round(bearingBetween(a, { lat: 43.47, lng: -80.53 }))).toBe(90);
    expect(Math.round(bearingBetween(a, { lat: 43.46, lng: -80.54 }))).toBe(180);
  });
});

describe("what the map draws", () => {
  it("draws the route from the point reached, leaving out the part already walked", () => {
    const whole = remainingPath(m, 0);
    expect(whole).toEqual(ROUTE);
    const half = remainingPath(m, m.cum[1] + (m.cum[2] - m.cum[1]) / 2);
    expect(half.length).toBe(4);
    expect(half[0].lat).toBeCloseTo(43.4710, 6);
    expect(half[0].lng).toBeCloseTo(-80.5435, 5);
    expect(half.slice(1)).toEqual(ROUTE.slice(2));
    expect(remainingPath(m, m.total)).toEqual([ROUTE[4]]);
    expect(remainingPath(m, m.total + 50)).toEqual([ROUTE[4]]);
  });

  it("advances the drawn start as the student walks, never backwards, and not on a wild fix", () => {
    let along = 0;
    const walked = [10, 40, 80, 120, 160, 200];
    for (const w of walked) {
      along = advanceProgress(along, { alongMeters: w, offRouteMeters: 4 }, 10);
      expect(along).toBe(w);
    }
    // GPS wobble puts the projection 25 m back: the line does not grow back behind the student.
    expect(advanceProgress(along, { alongMeters: 175, offRouteMeters: 8 }, 10)).toBe(200);
    // A fix far off the route says nothing about how far along it the student is.
    expect(advanceProgress(along, { alongMeters: 380, offRouteMeters: 90 }, 10)).toBe(200);
    // A poor fix is believed only as far as its accuracy warrants.
    along = advanceProgress(along, { alongMeters: 240, offRouteMeters: 42 }, 45);
    expect(along).toBe(240);
    expect(advanceProgress(along, { alongMeters: 260, offRouteMeters: 42 }, 10)).toBe(240);
  });

  it("has consumed essentially the whole route by the time the student arrives", () => {
    let along = 0;
    let prev: ReturnType<typeof projectOntoPath>;
    for (let w = 0; w <= m.total; w += 7) {
      prev = projectOntoPath(m, shift(pointAlong(m, w), 2, 0), prev);
      along = advanceProgress(along, prev!, 8);
    }
    expect(m.total - along).toBeLessThan(7);
    const left = remainingPath(m, along);
    expect(left.length).toBeLessThanOrEqual(2);
    expect(haversineMeters({ latitude: left[0].lat, longitude: left[0].lng }, { latitude: ROUTE[4].lat, longitude: ROUTE[4].lng })).toBeLessThan(7);
  });

  it("starts over on a new route: progress against the old one carries nothing across", () => {
    // What TripMode does when the route changes: the watermark goes back to zero and the new line is whole.
    const other = pathMetrics([{ lat: 43.4712, lng: -80.5441 }, { lat: 43.4730, lng: -80.5430 }]);
    const along = 0;
    expect(remainingPath(other, along)).toEqual(other.path);
    const p = projectOntoPath(other, other.path[0])!;
    expect(advanceProgress(along, p, 8)).toBe(0);
  });
});

describe("what is left of the trip", () => {
  it("counts down along the route as the student walks it, and reaches zero at the end", () => {
    const along = [-80.5450, -80.5445, -80.5440, -80.5432].map((lng) => ({ lat: 43.4710, lng }))
      .concat([43.4715, 43.4722, 43.4730].map((lat) => ({ lat, lng: -80.5430 })));
    let prev: ReturnType<typeof remainingFrom> | undefined;
    let last: ReturnType<typeof projectOntoPath>;
    for (const pos of along) {
      last = projectOntoPath(m, pos, last);
      const r = remainingFrom(walk, m, last!, NOW);
      if (prev) {
        expect(r.meters).toBeLessThan(prev.meters);
        expect(r.minutes).toBeLessThan(prev.minutes);
      }
      prev = r;
    }
    expect(prev!.meters).toBe(0);
    expect(prev!.minutes).toBe(0);
  });

  it("starts from Google's own distance and duration, scaled by the route still ahead", () => {
    const start = remainingFrom(walk, m, { alongMeters: 0 }, NOW);
    expect(start.meters).toBe(400);
    expect(start.minutes).toBe(6);
    const half = remainingFrom(walk, m, { alongMeters: m.total / 2 }, NOW);
    expect(half.meters).toBe(200);
    expect(half.minutes).toBe(3);
  });

  it("on transit the remaining time is the time until Google's arrival", () => {
    const bus: RouteOption = { ...walk, mode: "TRANSIT", durationMinutes: 19, arrivalTime: new Date(NOW.getTime() + 11 * 60_000), departureTime: new Date(NOW.getTime() - 8 * 60_000) };
    expect(remainingFrom(bus, m, { alongMeters: 0 }, NOW).minutes).toBe(11);
    expect(remainingFrom(bus, m, { alongMeters: 0 }, new Date(NOW.getTime() + 30 * 60_000)).minutes).toBe(0);
  });

  it("formats as minutes and rounded metres", () => {
    expect(formatRemaining({ meters: 523, minutes: 6.2, fraction: 0.5 })).toEqual({ time: "7 min", distance: "520 m" });
    expect(formatRemaining({ meters: 1480, minutes: 75, fraction: 0.9 })).toEqual({ time: "1 hr 15 min", distance: "1.5 km" });
    expect(formatRemaining({ meters: 0, minutes: 0, fraction: 0 })).toEqual({ time: "0 min", distance: "0 m" });
    // A metre or two from the end rounds to nothing left, and the minutes agree with that.
    expect(formatRemaining({ meters: 0, minutes: 0.04, fraction: 0.01 })).toEqual({ time: "0 min", distance: "0 m" });
  });
});

describe("deciding to reroute", () => {
  const t0 = 1_000_000;
  /** The student `north` metres north of the first street, `along` metres along it, on a fix `accuracy` metres good. */
  const fix = (along: number, north: number, accuracy = 10): DeviationFix => {
    const at = shift(pointAlong(m, along), north, 0);
    const p = projectOntoPath(m, at)!;
    return { at, offRouteMeters: p.offRouteMeters, accuracyMeters: accuracy, routeBearing: p.bearing };
  };
  /** Feed fixes one a second and return the second of the first reroute, or undefined. */
  const firstReroute = (fixes: DeviationFix[], from = 0) => {
    let s = rerouteDecision({}, fixes[0], t0);
    for (let i = 1; i < fixes.length; i++) {
      s = rerouteDecision(s.state, fixes[i], t0 + i * 1000);
      if (s.reroute && i >= from) return i;
    }
    return undefined;
  };

  it("never reroutes a student walking the route, GPS wobble and all", () => {
    // 200 s along the street at 1.4 m/s, the fix wandering up to 19 m either side.
    const fixes = Array.from({ length: 200 }, (_, s) => fix(Math.min(m.cum[2], s * 1.4), Math.sin(s / 3) * 19));
    expect(firstReroute(fixes)).toBeUndefined();
  });

  it("forgets a brief wander: a jump of 10–20 m for a few fixes, then back", () => {
    const fixes = [fix(50, 2), fix(51, 3), fix(52, 18), fix(53, 16), fix(54, 19), fix(55, 3), fix(56, 2), fix(57, 3)];
    expect(firstReroute(fixes)).toBeUndefined();
  });

  it("ignores a single wild fix far from the route", () => {
    const fixes = [fix(50, 2), fix(51, 3), fix(52, 400), fix(53, 2), fix(54, 3), fix(55, 2), fix(56, 3), fix(57, 2)];
    expect(firstReroute(fixes)).toBeUndefined();
  });

  it("does not reroute a phone that sits a little off the path for a long time", () => {
    // 25 m out for five minutes, walking the right way: between buildings this is normal.
    const fixes = Array.from({ length: 300 }, (_, s) => fix(Math.min(m.cum[2], s * 1.4), 25));
    expect(firstReroute(fixes)).toBeUndefined();
  });

  it("reroutes within seconds of a student turning off the route", () => {
    // Along the street, then a right-angle turn north at walking pace: the moment of the turn is second 20.
    const fixes = Array.from({ length: 60 }, (_, s) => (s < 20 ? fix(s * 1.4, 1) : fix(20 * 1.4, 1 + (s - 20) * 1.4)));
    const at = firstReroute(fixes);
    expect(at).toBeDefined();
    expect(at! - 20).toBeLessThanOrEqual(16);
    expect(at! - 20).toBeGreaterThanOrEqual(4);
    // Still only 15–25 m from the route when it fires: caught by the direction of travel, not by distance alone.
    expect(fixes[at!].offRouteMeters).toBeLessThan(30);
  });

  it("reroutes a student who is clearly off the route within a few seconds, without needing to see them move", () => {
    const fixes = Array.from({ length: 20 }, () => fix(60, 75));
    const at = firstReroute(fixes);
    expect(at).toBeDefined();
    expect(at).toBeLessThanOrEqual(5);
    expect(at).toBeGreaterThanOrEqual(REROUTE_POLICY.offRouteForMs / 1000);
  });

  it("reroutes a student walking a parallel path, but takes longer over it", () => {
    // 35 m north of the street, walking the same way: another path, not a wrong turn, but not this route either.
    const fixes = Array.from({ length: 40 }, (_, s) => fix(Math.min(m.cum[2], s * 1.4), 35));
    const at = firstReroute(fixes);
    expect(at).toBeDefined();
    expect(at).toBeGreaterThanOrEqual(5);
    expect(at).toBeLessThanOrEqual(8);
  });

  it("believes a poor fix less than a sharp one", () => {
    const sharp = Array.from({ length: 40 }, (_, s) => fix(Math.min(m.cum[2], s * 1.4), 35, 10));
    const poor = Array.from({ length: 40 }, (_, s) => fix(Math.min(m.cum[2], s * 1.4), 35, 50));
    expect(firstReroute(poor)!).toBeGreaterThan(firstReroute(sharp)!);
    expect(firstReroute(poor)!).toBeLessThanOrEqual(13);
  });

  it("ignores fixes too inaccurate to say anything, and fixes too old to be a position", () => {
    const off = { ...fix(60, 300), accuracyMeters: 200 };
    const s = rerouteDecision({ offSince: t0 - 60_000, evidence: 2 }, off, t0);
    expect(s.reroute).toBe(false);
    expect(s.state.offSince).toBe(t0 - 60_000);
    const stale = { ...fix(60, 300), timestamp: t0 - REROUTE_POLICY.maxFixAgeMs - 1 };
    expect(rerouteDecision({}, stale, t0).state).toEqual({});
    const fresh = { ...fix(60, 300), timestamp: t0 - 2000 };
    expect(rerouteDecision({}, fresh, t0).state.evidence).toBe(2);
  });

  it("spaces reroutes out, but lets a student who is a long way off have another one sooner", () => {
    const off = fix(60, 40);
    const far = fix(60, 150);
    let s = rerouteDecision({ lastRerouteAt: t0, streak: 1 }, off, t0 + 1000);
    // Ordinary deviation again straight after a reroute: evidence builds, but it waits for the gap.
    for (let t = 2000; t <= 8000; t += 1000) s = rerouteDecision(s.state, off, t0 + t);
    expect(s.reroute).toBe(false);
    for (let t = 9000; t <= 12_000; t += 1000) s = rerouteDecision(s.state, off, t0 + t);
    expect(s.reroute).toBe(true);
    // A major deviation is not made to wait the full gap.
    let f = rerouteDecision({ lastRerouteAt: t0, streak: 1 }, far, t0 + 1000);
    for (let t = 2000; t <= REROUTE_POLICY.majorGapMs; t += 1000) f = rerouteDecision(f.state, far, t0 + t);
    expect(f.reroute).toBe(true);
  });

  it("waits longer after each reroute that did not bring the student back onto a route", () => {
    const far = fix(60, 150);
    let s = rerouteDecision({}, far, t0);
    const reroutedAt: number[] = [];
    for (let t = 1000; t <= 300_000; t += 1000) {
      s = rerouteDecision(s.state, far, t0 + t);
      if (s.reroute) reroutedAt.push(t / 1000);
    }
    const gaps = reroutedAt.slice(1).map((t, i) => t - reroutedAt[i]);
    expect(reroutedAt.length).toBeLessThanOrEqual(9);
    for (let i = 1; i < gaps.length; i++) expect(gaps[i]).toBeGreaterThanOrEqual(Math.min(gaps[i - 1] * 2, REROUTE_POLICY.maxGapMs / 1000));
    // Back on a route, the slate is clean.
    const on = rerouteDecision(s.state, fix(60, 2), t0 + 301_000);
    expect(on.state.streak).toBe(0);
    expect(on.state.evidence).toBeLessThan(s.state.evidence ?? 0);
  });
});
