import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { CampusLocation, RouteOption } from "@/domain/types";
import { bearing, resolveTripRoute } from "./tripRoute";

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
