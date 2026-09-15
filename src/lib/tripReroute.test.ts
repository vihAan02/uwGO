import { describe, expect, it, vi } from "vitest";
import type { CampusLocation, LatLng, RouteOption } from "@/domain/types";
import { decode, encode } from "@googlemaps/polyline-codec";
import { formatRemaining, pathMetrics, pointAlong, projectOntoPath, remainingFrom, REROUTE_POLICY, type Point } from "./routeProgress";
import { TripRerouter, canReroute, rerouteNote, sameWay, type RerouteFix, type RouteSelector } from "./tripReroute";

/**
 * Rerouting is driven by simulated movement: a route, a walker, and a clock. Nothing here
 * needs a real GPS, and every case is one a student can actually produce on campus.
 */

const DC: CampusLocation = { id: "UW:DC", name: "Davis Centre", university: "UW", latitude: 43.472921, longitude: -80.542139, kind: "BUILDING", buildingCode: "DC" };
const MC: CampusLocation = { id: "UW:MC", name: "Mathematics & Computer", university: "UW", latitude: 43.471991, longitude: -80.544326, kind: "BUILDING", buildingCode: "MC" };

/** MC to DC the outdoor way: east along the path, then north. */
const ROUTE: Point[] = [
  { lat: 43.47199, lng: -80.54433 },
  { lat: 43.47199, lng: -80.54320 },
  { lat: 43.47250, lng: -80.54260 },
  { lat: 43.47292, lng: -80.54214 },
];
const metrics = pathMetrics(ROUTE);

const route = (over: Partial<RouteOption> = {}): RouteOption => ({
  mode: "WALK", durationMinutes: 4, distanceMeters: 300, polyline: encode(ROUTE.map((p) => [p.lat, p.lng])),
  provider: "google-routes", computedAt: "2026-01-20T15:00:00Z", isEstimate: false, ...over,
});
const OUTDOOR = route();
const WINTER = route({ indoorPath: ["MC", "C2", "DC"], provider: "uw-indoor-tunnel", isEstimate: true });
/** Another way to the same door: north first, then east. */
const OTHER_WAY: Point[] = [{ lat: 43.47199, lng: -80.54433 }, { lat: 43.47292, lng: -80.54433 }, { lat: 43.47292, lng: -80.54214 }];
const DIFFERENT = route({ polyline: encode(OTHER_WAY.map((p) => [p.lat, p.lng])) });

const T0 = new Date("2026-01-20T15:00:00Z");
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);

/** A walker who is `offset` metres north of the route at each step, with a plausible fix accuracy. */
function fixAt(alongFraction: number, offsetMetres: number, accuracyMeters = 8): RerouteFix {
  const on = pointAlong(metrics, metrics.total * alongFraction);
  const pos = { lat: on.lat + offsetMetres / 111_320, lng: on.lng };
  const proj = projectOntoPath(metrics, pos)!;
  return { at: { latitude: pos.lat, longitude: pos.lng } as LatLng, offRouteMeters: proj.offRouteMeters, accuracyMeters, routeBearing: proj.bearing };
}

/** Selector that always answers with a fresh outdoor walk, and records what it was asked. */
function selector(answer: RouteOption | undefined = route({ durationMinutes: 3, distanceMeters: 220 })) {
  const fn = vi.fn<RouteSelector>(async () => answer);
  return fn;
}

/** Walk the simulated student past the rerouter, one fix a second, and collect what came back. */
async function walkFor(r: TripRerouter, current: RouteOption, seconds: number, fix: (s: number) => RerouteFix) {
  const got = [];
  for (let s = 0; s <= seconds; s++) {
    const out = await r.consider(fix(s), current, at(s));
    if (out) got.push({ second: s, ...out });
  }
  return got;
}

describe("staying on the route", () => {
  it("never reroutes a student who is walking the route", async () => {
    const select = selector();
    const r = new TripRerouter(DC, "FASTEST", select);
    const got = await walkFor(r, OUTDOOR, 300, (s) => fixAt(Math.min(1, s / 300), 3));
    expect(got).toEqual([]);
    expect(select).not.toHaveBeenCalled();
  });

  it("ignores ordinary GPS drift beside the route", async () => {
    const select = selector();
    const r = new TripRerouter(DC, "FASTEST", select);
    // Wandering up to 19 m either side as they walk, which on campus is a phone between buildings, not a wrong turn.
    const got = await walkFor(r, OUTDOOR, 300, (s) => fixAt(Math.min(1, s / 300), Math.sin(s / 4) * 19));
    expect(got).toEqual([]);
    expect(select).not.toHaveBeenCalled();
  });

  it("ignores a fix that jumps 10–20 m for a few seconds and then settles", async () => {
    const select = selector();
    const r = new TripRerouter(DC, "FASTEST", select);
    const got = await walkFor(r, OUTDOOR, 120, (s) => fixAt(Math.min(1, s / 300), s >= 40 && s < 46 ? 18 : 4));
    expect(got).toEqual([]);
    expect(select).not.toHaveBeenCalled();
  });

  it("ignores a single wild fix far from the route", async () => {
    const select = selector();
    const r = new TripRerouter(DC, "FASTEST", select);
    const got = await walkFor(r, OUTDOOR, 120, (s) => fixAt(Math.min(1, s / 300), s === 30 ? 400 : 5));
    expect(got).toEqual([]);
    expect(select).not.toHaveBeenCalled();
  });

  it("says nothing about a fix too inaccurate to place the student at all", async () => {
    const select = selector();
    const r = new TripRerouter(DC, "FASTEST", select);
    const got = await walkFor(r, OUTDOOR, 120, () => fixAt(0.3, 300, 250));
    expect(got).toEqual([]);
    expect(select).not.toHaveBeenCalled();
  });

  it("ignores fixes that are too old to say where the student is now", async () => {
    const select = selector();
    const r = new TripRerouter(DC, "FASTEST", select);
    // A phone in a tunnel keeps handing back the fix it had at the door, for a minute.
    const stale = { ...fixAt(0.3, 300), timestamp: T0.getTime() - 30_000 };
    const got = await walkFor(r, OUTDOOR, 60, () => stale);
    expect(got).toEqual([]);
    expect(select).not.toHaveBeenCalled();
  });
});

describe("leaving the route", () => {
  it("reroutes within seconds of the student being clearly off the route", async () => {
    const select = selector();
    const r = new TripRerouter(DC, "FASTEST", select);
    const got = await walkFor(r, OUTDOOR, 40, () => fixAt(0.4, 150));
    expect(got.length).toBeGreaterThanOrEqual(1);
    expect(got[0].status).toBe("REROUTED");
    expect(got[0].second).toBeGreaterThanOrEqual(REROUTE_POLICY.offRouteForMs / 1000);
    expect(got[0].second).toBeLessThanOrEqual(6);
    expect(got[0].route.durationMinutes).toBe(3);
  });

  it("notices a turn off the route by the direction of travel, before the distance alone would tell", async () => {
    const select = selector();
    const r = new TripRerouter(DC, "FASTEST", select);
    // Walking the route at 1.4 m/s, then a right-angle turn north at second 30.
    const turnAt = 0.15;
    const fix = (s: number) => (s < 30 ? fixAt((s / 30) * turnAt, 1) : fixAt(turnAt, 1 + (s - 30) * 1.4));
    const got = await walkFor(r, OUTDOOR, 90, fix);
    expect(got.length).toBeGreaterThanOrEqual(1);
    expect(got[0].second - 30).toBeLessThanOrEqual(16);
    expect(fix(got[0].second).offRouteMeters).toBeLessThan(REROUTE_POLICY.offRouteMeters);
  });

  it("keeps the same destination, and asks from where the student now is", async () => {
    const select = selector();
    const r = new TripRerouter(DC, "INDOORS", select);
    const wandered = fixAt(0.4, 150);
    await walkFor(r, OUTDOOR, 40, () => wandered);
    const [askedAt, askedTo, askedPref] = select.mock.calls[0];
    expect(askedTo).toBe(DC);
    expect(askedTo).not.toBe(MC);
    expect(askedPref).toBe("INDOORS");
    expect(askedAt.latitude).toBeCloseTo(wandered.at.latitude, 6);
  });

  it("asks once when the new route puts the student back on a route", async () => {
    // The reroute runs from where they are, so once the trip switches to it they are on it.
    const wandered = fixAt(0.4, 150);
    const fresh = route({ polyline: encode([[wandered.at.latitude, wandered.at.longitude], [ROUTE[3].lat, ROUTE[3].lng]]) });
    const freshMetrics = pathMetrics(decode(fresh.polyline!).map(([lat, lng]) => ({ lat, lng })));
    const select = selector(fresh);
    const r = new TripRerouter(DC, "FASTEST", select);
    let current = OUTDOOR;
    for (let s = 0; s <= 300; s++) {
      const m = current === fresh ? freshMetrics : metrics;
      const proj = projectOntoPath(m, { lat: wandered.at.latitude, lng: wandered.at.longitude })!;
      const out = await r.consider({ ...wandered, offRouteMeters: proj.offRouteMeters, routeBearing: proj.bearing }, current, at(s));
      if (out) current = out.route;
    }
    expect(current).toBe(fresh);
    expect(select).toHaveBeenCalledTimes(1);
  });

  it("does not ask the provider on every fix even when no reroute brings the student back", async () => {
    const select = selector();
    const r = new TripRerouter(DC, "FASTEST", select);
    // Five minutes off the route, a fix every second, the route on screen never changing: 300 chances to spam the API.
    await walkFor(r, OUTDOOR, 300, () => fixAt(0.4, 150));
    expect(select.mock.calls.length).toBeLessThanOrEqual(10);
    expect(select.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it("does not make a student who is a long way off wait out the full spacing", async () => {
    const select = selector();
    const r = new TripRerouter(DC, "FASTEST", select);
    const got = await walkFor(r, OUTDOOR, 30, () => fixAt(0.4, 300));
    expect(got.length).toBeGreaterThanOrEqual(2);
    const gap = got[1].second - got[0].second;
    expect(gap).toBeGreaterThanOrEqual(REROUTE_POLICY.majorGapMs / 1000);
    expect(gap).toBeLessThan(REROUTE_POLICY.minGapMs / 1000);
  });

  it("leaves a bus alone: a bus off its usual road is still the bus", async () => {
    const select = selector();
    const bus = route({ mode: "TRANSIT", indoorPath: undefined });
    const r = new TripRerouter(DC, "FASTEST", select);
    const got = await walkFor(r, bus, 300, () => fixAt(0.4, 400));
    expect(got).toEqual([]);
    expect(select).not.toHaveBeenCalled();
    expect(canReroute(bus)).toBe(false);
    expect(canReroute(OUTDOOR)).toBe(true);
    expect(canReroute(WINTER)).toBe(true);
  });
});

describe("when a reroute cannot be had", () => {
  it("keeps the route already on screen when the provider gives nothing", async () => {
    const select = vi.fn<RouteSelector>(async () => undefined);
    const r = new TripRerouter(DC, "FASTEST", select);
    const got = await walkFor(r, OUTDOOR, 40, () => fixAt(0.4, 150));
    expect(select).toHaveBeenCalled();
    expect(got).toEqual([]);
  });

  it("keeps the route on screen when the provider throws, and tries again with growing patience", async () => {
    const select = vi.fn<RouteSelector>(async () => { throw new Error("network down"); });
    const r = new TripRerouter(DC, "FASTEST", select);
    const got = await walkFor(r, OUTDOOR, 200, () => fixAt(0.4, 150));
    expect(got).toEqual([]);
    expect(select.mock.calls.length).toBeGreaterThan(1); // it did try again
    expect(select.mock.calls.length).toBeLessThanOrEqual(8); // but not on every fix, and less and less often
  });

  it("never has two requests in flight at once, and says when one is", async () => {
    let inflight = 0;
    let peak = 0;
    const select = vi.fn<RouteSelector>(async () => {
      inflight++; peak = Math.max(peak, inflight);
      await new Promise((res) => setTimeout(res, 5));
      inflight--;
      return route();
    });
    const busy: boolean[] = [];
    const r = new TripRerouter(DC, "FASTEST", select, { onBusy: (b) => busy.push(b) });
    const fix = fixAt(0.4, 150);
    // Off the route from the start, so by the burst the evidence has long since been gathered.
    await r.consider(fix, OUTDOOR, at(0));
    // Fire the same off-route fix from many updates at once, as a burst of GPS events would.
    await Promise.all(Array.from({ length: 20 }, (_, i) => r.consider(fix, OUTDOOR, at(30 + i))));
    expect(peak).toBe(1);
    expect(select).toHaveBeenCalledTimes(1);
    expect(busy).toEqual([true, false]);
    expect(r.requesting).toBe(false);
  });
});

describe("what the trip shows once it has rerouted", () => {
  it("counts down the new route, not the one the student walked away from", async () => {
    // A shorter way to the same door, found from where they are standing.
    const shorter: Point[] = [{ lat: 43.47240, lng: -80.54330 }, { lat: 43.47292, lng: -80.54214 }];
    const select = selector(route({ durationMinutes: 2, distanceMeters: 140, polyline: encode(shorter.map((p) => [p.lat, p.lng])) }));
    const r = new TripRerouter(DC, "FASTEST", select);
    const got = await walkFor(r, OUTDOOR, 40, () => fixAt(0.4, 150));

    const next = got[0].route;
    const nextMetrics = pathMetrics(decode(next.polyline!).map(([lat, lng]) => ({ lat, lng })));
    const start = projectOntoPath(nextMetrics, { lat: shorter[0].lat, lng: shorter[0].lng })!;
    const remaining = remainingFrom(next, nextMetrics, start);
    // The whole of the new route is ahead, and it is shorter than what the old one claimed.
    expect(formatRemaining(remaining)).toEqual({ time: "2 min", distance: "140 m" });
    expect(remaining.meters).toBeLessThan(OUTDOOR.distanceMeters!);
  });
});

describe("telling the student what changed", () => {
  it("names a switch into the indoor network, and out of it", () => {
    expect(rerouteNote(OUTDOOR, WINTER)).toBe("Indoor route from here: MC → C2 → DC.");
    expect(rerouteNote(WINTER, OUTDOOR)).toMatch(/left the indoor route/);
    expect(rerouteNote(OUTDOOR, DIFFERENT)).toBe("Route updated from where you are.");
    expect(rerouteNote(WINTER, route({ indoorPath: ["MC", "DC"], polyline: DIFFERENT.polyline }))).toBe("Indoor route updated: MC → DC.");
    expect(rerouteNote(OUTDOOR, route({ mode: "TRANSIT" }))).toMatch(/by bus/);
  });

  it("says nothing when the new route is the old one rejoined a few metres on", () => {
    // From a fix beside the path, back onto the path and along it as before.
    const beside = { lat: ROUTE[1].lat + 25 / 111_320, lng: ROUTE[1].lng - 0.0002 };
    const rejoined = route({ polyline: encode([[beside.lat, beside.lng], [ROUTE[1].lat, ROUTE[1].lng], [ROUTE[2].lat, ROUTE[2].lng], [ROUTE[3].lat, ROUTE[3].lng]]) });
    expect(sameWay(OUTDOOR, rejoined)).toBe(true);
    expect(rerouteNote(OUTDOOR, rejoined)).toBeUndefined();
    expect(sameWay(OUTDOOR, DIFFERENT)).toBe(false);
    expect(sameWay(OUTDOOR, WINTER)).toBe(false);
  });
});
