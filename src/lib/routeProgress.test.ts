import { describe, expect, it } from "vitest";
import type { RouteOption } from "@/domain/types";
import { haversineMeters } from "@/routing/EstimateRoutingProvider";
import { formatRemaining, pathMetrics, projectOntoPath, remainingFrom, rerouteDecision, REROUTE_POLICY, type Point } from "./routeProgress";

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

describe("distance along the route", () => {
  it("adds up the polyline and never the straight line", () => {
    const straight = haversineMeters({ latitude: ROUTE[0].lat, longitude: ROUTE[0].lng }, { latitude: ROUTE[4].lat, longitude: ROUTE[4].lng });
    expect(m.total).toBeGreaterThan(straight * 1.3);
    expect(m.cum[0]).toBe(0);
    for (let i = 1; i < m.cum.length; i++) expect(m.cum[i]).toBeGreaterThan(m.cum[i - 1]);
  });

  it("projects a position onto the nearest part of the route", () => {
    // Slightly north of the middle of the first street.
    const p = projectOntoPath(m, { lat: 43.47102, lng: -80.5445 })!;
    expect(p.segment).toBe(0);
    expect(p.t).toBeCloseTo(0.5, 2);
    expect(p.offRouteMeters).toBeGreaterThan(1);
    expect(p.offRouteMeters).toBeLessThan(4);
    expect(p.alongMeters).toBeCloseTo(m.cum[1] / 2, 0);
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
  const on = { offRouteMeters: 5, accuracyMeters: 10 };
  const off = { offRouteMeters: 120, accuracyMeters: 10 };

  it("never reroutes while on the route, and forgets a brief wander", () => {
    let s = rerouteDecision({}, on, t0);
    expect(s.reroute).toBe(false);
    s = rerouteDecision(s.state, off, t0 + 1000);
    expect(s.reroute).toBe(false);
    expect(s.state.offSince).toBe(t0 + 1000);
    s = rerouteDecision(s.state, on, t0 + 5000);
    expect(s.state.offSince).toBeUndefined();
  });

  it("reroutes once after being off the route for long enough, then waits before doing it again", () => {
    let s = rerouteDecision({}, off, t0);
    let reroutes = 0;
    // Off the route for two minutes, one fix a second: a fresh route is asked for twice at most.
    for (let t = t0 + 1000; t <= t0 + 120_000; t += 1000) {
      s = rerouteDecision(s.state, off, t);
      if (s.reroute) reroutes++;
    }
    expect(reroutes).toBe(2);
    expect(s.state.lastRerouteAt).toBeGreaterThanOrEqual(t0 + REROUTE_POLICY.offRouteForMs + REROUTE_POLICY.minGapMs);
  });

  it("needs a run of fixes to agree, not just two of them a long way apart", () => {
    // Two off-route readings half a minute apart: long enough on the clock, but a phone that
    // reported twice in thirty seconds has not established anything.
    let s = rerouteDecision({}, off, t0);
    s = rerouteDecision(s.state, off, t0 + 30_000);
    expect(s.reroute).toBe(false);
    expect(s.state.offFixes).toBe(2);
    s = rerouteDecision(s.state, off, t0 + 31_000);
    expect(s.reroute).toBe(true);
  });

  it("starts the run again the moment one fix lands back on the route", () => {
    let s = rerouteDecision({}, off, t0);
    s = rerouteDecision(s.state, off, t0 + 1000);
    s = rerouteDecision(s.state, on, t0 + 2000);
    expect(s.state.offFixes).toBe(0);
    s = rerouteDecision(s.state, off, t0 + 3000);
    s = rerouteDecision(s.state, off, t0 + 25_000);
    expect(s.reroute).toBe(false); // two fixes into the new run, however long it has been
  });

  it("ignores fixes too inaccurate to say anything", () => {
    const s = rerouteDecision({ offSince: t0 - 60_000 }, { offRouteMeters: 300, accuracyMeters: 200 }, t0);
    expect(s.reroute).toBe(false);
    expect(s.state.offSince).toBe(t0 - 60_000);
  });
});
