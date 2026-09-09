import { describe, it, expect, vi } from "vitest";
import { EstimateRoutingProvider, haversineMeters } from "./EstimateRoutingProvider";
import { CachedRoutingProvider, MemoryRouteCacheStore, WALK_CACHE_TTL_MS } from "./CachedRoutingProvider";
import { GoogleRoutingProvider } from "./GoogleRoutingProvider";
import { deserializeRoute, serializeRoute } from "./serialize";
import { isInWaterlooRegion, pairKey } from "./RoutingProvider";
import type { LatLng, RouteOption } from "@/domain/types";

const MC: LatLng = { latitude: 43.4720751, longitude: -80.5439474 };
const DC: LatLng = { latitude: 43.472761, longitude: -80.542164 };
const LH: LatLng = { latitude: 43.4750921, longitude: -80.529488 };

describe("estimate provider", () => {
  it("MC -> DC is a short walk, MC -> Lazaridis Hall is a long one, and results are flagged as estimates", async () => {
    const p = new EstimateRoutingProvider();
    const short = await p.getWalkingRoute(MC, DC);
    const long = await p.getWalkingRoute(MC, LH);
    expect(short.isEstimate).toBe(true);
    expect(short.durationMinutes).toBeGreaterThanOrEqual(2);
    expect(short.durationMinutes).toBeLessThanOrEqual(4);
    expect(long.durationMinutes).toBeGreaterThanOrEqual(15);
    expect(long.durationMinutes).toBeLessThanOrEqual(25);
    expect(await p.getTransitRoute(MC, LH, { departureTime: new Date() })).toBeUndefined();
    expect(haversineMeters(MC, MC)).toBe(0);
    expect((await p.getWalkingRoute(MC, MC)).durationMinutes).toBe(0);
  });
});

describe("cached provider", () => {
  const fake = (): { calls: number; provider: import("./RoutingProvider").RoutingProvider } => {
    const state = { calls: 0 };
    return {
      get calls() { return state.calls; },
      provider: {
        id: "fake",
        async getWalkingRoute(): Promise<RouteOption> { state.calls++; return { mode: "WALK", durationMinutes: 3, provider: "fake", computedAt: "x", isEstimate: false }; },
        async getTransitRoute(): Promise<RouteOption> { state.calls++; return { mode: "TRANSIT", durationMinutes: 9, provider: "fake", computedAt: "x", isEstimate: false }; },
      },
    };
  };

  it("de-duplicates identical building pairs and expires after 30 days", async () => {
    let now = 1_000_000;
    const f = fake();
    const store = new MemoryRouteCacheStore();
    const c = new CachedRoutingProvider(f.provider, store, () => now);
    await c.getWalkingRoute(MC, DC);
    await c.getWalkingRoute(MC, DC);
    await c.getWalkingRoute({ latitude: 43.4720751, longitude: -80.5439474 }, DC);
    expect(f.calls).toBe(1);
    await c.getWalkingRoute(DC, MC); // reverse direction is a different pair
    expect(f.calls).toBe(2);
    now += WALK_CACHE_TTL_MS + 1;
    await c.getWalkingRoute(MC, DC);
    expect(f.calls).toBe(3);
  });

  it("collapses concurrent requests for the same pair into one call", async () => {
    const f = fake();
    const c = new CachedRoutingProvider(f.provider);
    await Promise.all([c.getWalkingRoute(MC, DC), c.getWalkingRoute(MC, DC), c.getWalkingRoute(MC, DC)]);
    expect(f.calls).toBe(1);
  });

  it("keys transit by requested minute and keeps it briefly", async () => {
    let now = 5_000_000;
    const f = fake();
    const c = new CachedRoutingProvider(f.provider, new MemoryRouteCacheStore(), () => now);
    const dep = new Date("2026-09-14T18:20:00Z");
    await c.getTransitRoute(MC, LH, { departureTime: dep });
    await c.getTransitRoute(MC, LH, { departureTime: new Date(dep.getTime() + 30_000) }); // same minute
    expect(f.calls).toBe(1);
    await c.getTransitRoute(MC, LH, { departureTime: new Date(dep.getTime() + 120_000) });
    expect(f.calls).toBe(2);
    now += 11 * 60 * 1000;
    await c.getTransitRoute(MC, LH, { departureTime: dep });
    expect(f.calls).toBe(3);
  });

  it("does not cache failures", async () => {
    let calls = 0;
    const c = new CachedRoutingProvider({ id: "f", async getWalkingRoute() { calls++; return undefined; }, async getTransitRoute() { return undefined; } });
    await c.getWalkingRoute(MC, DC);
    await c.getWalkingRoute(MC, DC);
    expect(calls).toBe(2);
  });

  it("pairKey rounds to 5 decimals", () => {
    expect(pairKey(MC, DC)).toBe("43.47208,-80.54395->43.47276,-80.54216");
  });
});

describe("Google provider mapping", () => {
  const walkResponse = { routes: [{ duration: "610s", staticDuration: "605s", distanceMeters: 812, polyline: { encodedPolyline: "abc" }, legs: [{ steps: [{ travelMode: "WALK", staticDuration: "605s", distanceMeters: 812, navigationInstruction: { instructions: "Head north" } }] }] }] };
  const transitResponse = {
    routes: [{
      duration: "1080s", distanceMeters: 2400, polyline: { encodedPolyline: "xyz" },
      legs: [{
        startTime: "2026-09-14T18:24:00Z", endTime: "2026-09-14T18:41:00Z",
        steps: [
          { travelMode: "WALK", staticDuration: "240s", distanceMeters: 300 },
          { travelMode: "TRANSIT", staticDuration: "240s", distanceMeters: 1800, transitDetails: { stopDetails: { departureStop: { name: "University Ave. / University of Waterloo" }, departureTime: "2026-09-14T18:29:00Z", arrivalStop: { name: "University Ave. / Wilfrid Laurier University" }, arrivalTime: "2026-09-14T18:33:00Z" }, headsign: "Conestoga Station", stopCount: 1, transitLine: { name: "iXpress University", nameShort: "202", color: "#0055aa", vehicle: { type: "BUS", name: { text: "Bus" } } } } },
          { travelMode: "WALK", staticDuration: "480s", distanceMeters: 300 },
        ],
      }],
    }],
  };
  const fetchFor = (payload: unknown, status = 200) => {
    const calls: { url: string; init: RequestInit }[] = [];
    const impl = vi.fn(async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response(JSON.stringify(payload), { status }); });
    return { impl, calls };
  };

  it("maps a WALK route and sends the field mask + key headers", async () => {
    const { impl, calls } = fetchFor(walkResponse);
    const p = new GoogleRoutingProvider("k", impl, () => new Date("2026-09-14T00:00:00Z"));
    const r = (await p.getWalkingRoute(MC, DC))!;
    expect(r).toMatchObject({ mode: "WALK", durationMinutes: 11, distanceMeters: 812, polyline: "abc", provider: "google-routes", isEstimate: false });
    expect(r.steps![0].instruction).toBe("Head north");
    const h = calls[0].init.headers as Record<string, string>;
    expect(h["X-Goog-Api-Key"]).toBe("k");
    expect(h["X-Goog-FieldMask"]).toContain("routes.legs.steps.transitDetails");
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.travelMode).toBe("WALK");
    expect(body.origin.location.latLng).toEqual(MC);
    expect(body.departureTime).toBeUndefined();
  });

  it("maps a TRANSIT route with line, stops, times, transfers, and walking segments", async () => {
    const { impl, calls } = fetchFor(transitResponse);
    const p = new GoogleRoutingProvider("k", impl);
    const dep = new Date("2026-09-14T18:20:00Z");
    const r = (await p.getTransitRoute(MC, LH, { departureTime: dep }))!;
    expect(r.mode).toBe("TRANSIT");
    expect(r.departureTime!.toISOString()).toBe("2026-09-14T18:24:00.000Z");
    expect(r.arrivalTime!.toISOString()).toBe("2026-09-14T18:41:00.000Z");
    expect(r.durationMinutes).toBe(17);
    expect(r.transferCount).toBe(0);
    expect(r.steps!.map((s) => s.mode)).toEqual(["WALK", "TRANSIT", "WALK"]);
    expect(r.steps![1].transit).toMatchObject({ line: "iXpress University", lineShort: "202", vehicle: "Bus", headsign: "Conestoga Station", stopCount: 1, departureStop: "University Ave. / University of Waterloo" });
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.travelMode).toBe("TRANSIT");
    expect(body.departureTime).toBe(dep.toISOString());
    expect(body.transitPreferences.allowedTravelModes).toContain("LIGHT_RAIL");
  });

  it("uses arrivalTime when asked and treats a walking-only itinerary as no transit option", async () => {
    const { impl, calls } = fetchFor({ routes: [{ duration: "600s", legs: [{ startTime: "2026-09-14T18:20:00Z", endTime: "2026-09-14T18:30:00Z", steps: [{ travelMode: "WALK", staticDuration: "600s" }] }] }] });
    const p = new GoogleRoutingProvider("k", impl);
    const r = await p.getTransitRoute(MC, DC, { arrivalTime: new Date("2026-09-14T18:50:00Z") });
    expect(r).toBeUndefined();
    expect(JSON.parse(String(calls[0].init.body)).arrivalTime).toBe("2026-09-14T18:50:00.000Z");
  });

  it("surfaces API errors instead of fabricating a route", async () => {
    const { impl } = fetchFor({ error: { message: "API key not valid", status: "INVALID_ARGUMENT" } }, 400);
    const p = new GoogleRoutingProvider("k", impl);
    await expect(p.getWalkingRoute(MC, DC)).rejects.toThrow(/400/);
  });
});

describe("serialize", () => {
  it("round-trips dates", () => {
    const r: RouteOption = { mode: "TRANSIT", durationMinutes: 5, departureTime: new Date("2026-09-14T18:20:00Z"), arrivalTime: new Date("2026-09-14T18:25:00Z"), steps: [{ mode: "TRANSIT", durationMinutes: 5, transit: { line: "301", vehicle: "Tram", departureStop: "A", arrivalStop: "B", departureTime: new Date("2026-09-14T18:20:00Z"), arrivalTime: new Date("2026-09-14T18:25:00Z") } }], provider: "t", computedAt: "x", isEstimate: false };
    const back = deserializeRoute(JSON.parse(JSON.stringify(serializeRoute(r))));
    expect(back.departureTime!.getTime()).toBe(r.departureTime!.getTime());
    expect(back.steps![0].transit!.arrivalTime.getTime()).toBe(r.steps![0].transit!.arrivalTime.getTime());
  });
  it("region guard", () => {
    expect(isInWaterlooRegion(MC)).toBe(true);
    expect(isInWaterlooRegion({ latitude: 43.65, longitude: -79.38 })).toBe(false); // Toronto
  });
});
