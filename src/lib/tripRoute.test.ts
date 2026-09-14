import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { CampusLocation, RouteOption } from "@/domain/types";
import { bearing, rerouteFrom, resolveTripRoute } from "./tripRoute";
import { CAMPUS_LOOKUPS } from "@/engine/campusRoute";
import { nearestEntrances } from "@/engine/indoorGraph";
import { networkBuildingLocation } from "@/engine/indoorRoute";
import { haversineMeters } from "@/routing/EstimateRoutingProvider";
import { encode } from "@googlemaps/polyline-codec";
import type { LatLng } from "@/domain/types";

const from: CampusLocation = { id: "a", name: "Columbia Lake Village", latitude: 43.4788, longitude: -80.5495, kind: "BUILDING" };
const to: CampusLocation = { id: "b", name: "Lazaridis Hall", latitude: 43.4751045, longitude: -80.5295034, kind: "BUILDING" };

const NOW = new Date("2026-09-09T17:00:00Z");
const at = (mins: number) => new Date(NOW.getTime() + mins * 60_000);

// Long enough that a 19 min bus leaving in a few minutes is worth waiting for.
const walk: RouteOption = { mode: "WALK", durationMinutes: 45, distanceMeters: 2100, provider: "google-routes", computedAt: NOW.toISOString(), isEstimate: false };
const transit = (depOffset: number, computedOffset = 0): RouteOption => ({
  mode: "TRANSIT", durationMinutes: 19,
  departureTime: at(depOffset), arrivalTime: at(depOffset + 19),
  provider: "google-routes", computedAt: at(computedOffset).toISOString(), isEstimate: false,
});

/** Stubs the network call the module makes through HttpRoutingProvider. */
function stubFetch(route: RouteOption | null) {
  const body = route
    ? { route: { ...route, departureTime: route.departureTime?.toISOString(), arrivalTime: route.arrivalTime?.toISOString() } }
    : { route: null };
  return vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
}

beforeEach(() => { vi.stubGlobal("fetch", stubFetch(null)); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("resolveTripRoute", () => {
  it("keeps a walking route untouched and never calls the network", async () => {
    const spy = stubFetch(null);
    vi.stubGlobal("fetch", spy);
    const r = await resolveTripRoute(walk, undefined, from, to, NOW);
    expect(r.status).toBe("PLANNED");
    expect(r.route).toBe(walk);
    expect(spy).not.toHaveBeenCalled();
  });

  it("keeps a transit option that is imminent and freshly computed", async () => {
    const soon = transit(8);
    const r = await resolveTripRoute(soon, walk, from, to, NOW);
    expect(r.status).toBe("PLANNED");
    expect(r.route).toBe(soon);
  });

  it("refetches a departure that has already gone and says so", async () => {
    const next = transit(12);
    vi.stubGlobal("fetch", stubFetch(next));
    const r = await resolveTripRoute(transit(-20), walk, from, to, NOW);
    expect(r.status).toBe("REFRESHED");
    expect(r.route.departureTime!.getTime()).toBe(next.departureTime!.getTime());
    expect(r.note).toMatch(/has gone/);
  });

  it("refetches a departure belonging to another day rather than showing tomorrow's bus", async () => {
    const next = transit(10);
    vi.stubGlobal("fetch", stubFetch(next));
    const tomorrow = transit(20 * 60);
    const r = await resolveTripRoute(tomorrow, walk, from, to, NOW);
    expect(r.status).toBe("REFRESHED");
    expect(r.note).toMatch(/leaving now/);
  });

  it("keeps walking when the next bus would not get there any sooner", async () => {
    // Bus in 12 min, 19 min ride: door to door in 31, the same as a 31 min walk. Walking has no bus to miss.
    const evenWalk: RouteOption = { ...walk, durationMinutes: 31 };
    vi.stubGlobal("fetch", stubFetch(transit(12)));
    const r = await resolveTripRoute(transit(-5), evenWalk, from, to, NOW);
    expect(r.status).toBe("FELL_BACK_TO_WALKING");
    expect(r.route).toBe(evenWalk);
    expect(r.note).toMatch(/as soon as the next bus/);
  });

  it("falls back to walking, with an explanation, when no transit comes back", async () => {
    vi.stubGlobal("fetch", stubFetch(null));
    const r = await resolveTripRoute(transit(-5), walk, from, to, NOW);
    expect(r.status).toBe("FELL_BACK_TO_WALKING");
    expect(r.route).toBe(walk);
    expect(r.note).toMatch(/No useful transit option/);
  });

  it("falls back to walking when the routing call fails outright", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));
    const r = await resolveTripRoute(transit(-5), walk, from, to, NOW);
    expect(r.status).toBe("FELL_BACK_TO_WALKING");
  });

  it("never returns a departure in the past", async () => {
    vi.stubGlobal("fetch", stubFetch(transit(-30)));
    const r = await resolveTripRoute(transit(-40), walk, from, to, NOW);
    expect(r.status).toBe("FELL_BACK_TO_WALKING");
    expect(r.route.mode).toBe("WALK");
  });
});

describe("bearing", () => {
  it("points north, east and south-west correctly", () => {
    expect(Math.round(bearing({ latitude: 43.47, longitude: -80.54 }, { latitude: 43.48, longitude: -80.54 }))).toBe(0);
    expect(Math.round(bearing({ latitude: 43.47, longitude: -80.54 }, { latitude: 43.47, longitude: -80.53 }))).toBe(90);
    expect(Math.round(bearing({ latitude: 43.47, longitude: -80.54 }, { latitude: 43.46, longitude: -80.54 }))).toBe(180);
  });
});

/**
 * Rerouting from a live position. These go through the real HTTP provider and the real
 * `/api/routes` request shape, so what is asserted is what the server would actually be sent.
 */
describe("rerouteFrom", () => {
  const MC = networkBuildingLocation("MC")!;
  const STC = networkBuildingLocation("STC")!;
  const DC = networkBuildingLocation("DC")!;
  const door = nearestEntrances(MC, 1)[0].node;
  /** Sixty metres north of a Mathematics & Computer door: outdoors, near a way in. */
  const outside: LatLng = { latitude: door.lat + 60 / 111_320, longitude: door.lng };
  const away = (metres: number): LatLng => ({ latitude: outside.latitude + metres / 111_320, longitude: outside.longitude });

  /** Answers every /api/routes call with a Google-shaped walk between the points asked about. */
  function stubWalks() {
    const calls: { mode: string; from: LatLng; to: LatLng }[] = [];
    const spy = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as { mode: string; from: LatLng; to: LatLng };
      calls.push(body);
      const m = haversineMeters(body.from, body.to) * 1.25;
      const route = {
        mode: "WALK", durationMinutes: Math.max(1, Math.round(m / 80)), distanceMeters: Math.round(m),
        polyline: encode([[body.from.latitude, body.from.longitude], [body.to.latitude, body.to.longitude]]),
        provider: "google-routes", computedAt: NOW.toISOString(), isEstimate: false,
      };
      return new Response(JSON.stringify({ route }), { status: 200 });
    });
    vi.stubGlobal("fetch", spy);
    return calls;
  }

  it("asks for a route from where the student is to the same destination, and moves neither", async () => {
    const calls = stubWalks();
    const r = await rerouteFrom(outside, DC, "FASTEST", NOW);
    expect(r!.mode).toBe("WALK");
    // The outdoor walk first, then only the few door walks the campus-aware walk considers; no winter route to price under FASTEST.
    expect(calls[0].mode).toBe("WALK");
    expect(calls[0].to.latitude).toBeCloseTo(DC.latitude, 6);
    expect(calls[0].to.longitude).toBeCloseTo(DC.longitude, 6);
    expect(calls.length).toBeLessThanOrEqual(1 + CAMPUS_LOOKUPS.entries + 2 * CAMPUS_LOOKUPS.through);
    for (const c of calls) {
      expect(c.mode).toBe("WALK");
      expect(c.from.latitude).toBeCloseTo(outside.latitude, 6);
      expect(c.from.longitude).toBeCloseTo(outside.longitude, 6);
    }
  });

  it("with indoors preferred, joins the live position to the network and carries on through it", async () => {
    stubWalks();
    const r = await rerouteFrom(outside, STC, "INDOORS", NOW);
    expect(r!.indoorPath).toEqual(["MC", "QNC", "B2", "STC"]);
    expect(r!.steps![0].instruction).toMatch(/^Walk to the [A-Z0-9]+ entrance$/);
    expect(r!.polyline).toBeTruthy();
  });

  it("gives nothing rather than a straight line when the server can only estimate", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      route: { mode: "WALK", durationMinutes: 4, distanceMeters: 300, provider: "estimate", computedAt: NOW.toISOString(), isEstimate: true },
    }), { status: 200 })));
    expect(await rerouteFrom(away(10), DC, "FASTEST", NOW)).toBeUndefined();
  });

  it("gives nothing when routing is down, so the trip keeps the route it already has", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));
    expect(await rerouteFrom(away(20), DC, "FASTEST", NOW)).toBeUndefined();
    expect(await rerouteFrom(away(30), STC, "INDOORS", NOW)).toBeUndefined();
  });
});
