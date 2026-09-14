import { describe, expect, it, vi } from "vitest";
import type { CampusLocation, LatLng, RouteOption } from "@/domain/types";
import { DEFAULT_PLANNER_CONFIG as CFG } from "@/domain/config";
import { haversineMeters } from "@/routing/EstimateRoutingProvider";
import { encode } from "@googlemaps/polyline-codec";
import { CAMPUS_LOOKUPS } from "./campusRoute";
import { nearestEntrances } from "./indoorGraph";
import { networkBuildingLocation } from "./indoorRoute";
import { fetcherDeps, livePosition, selectRoute } from "./selectRoute";

/**
 * One selection path for every kind of route. These are the cases a live reroute has to get
 * right: the student is somewhere Google can route from, and the answer may be an outdoor walk,
 * a way through the tunnels, or an outdoor walk into the tunnels and on.
 */

const loc = (code: string) => networkBuildingLocation(code)!;
const MC = loc("MC");
const DC = loc("DC");
const M3 = loc("M3");
const HH = loc("HH");
const STC = loc("STC");
const NOW = new Date("2026-01-20T15:00:00Z");

/** A point `metres` north of `p`: somewhere outdoors that is not any building's centroid. */
function north(p: LatLng, metres: number): LatLng {
  return { latitude: p.latitude + metres / 111_320, longitude: p.longitude };
}

/** A Google-shaped walk: a real line and a duration from the distance, unless the table says otherwise. */
function makeFetcher(minutes: Record<string, number> = {}) {
  const walk = vi.fn(async (from: LatLng, to: LatLng): Promise<RouteOption | undefined> => {
    const key = `${from.latitude.toFixed(4)},${from.longitude.toFixed(4)}->${to.latitude.toFixed(4)},${to.longitude.toFixed(4)}`;
    const m = haversineMeters(from, to) * 1.25;
    return {
      mode: "WALK",
      durationMinutes: minutes[key] ?? Math.max(1, Math.round(m / 80)),
      distanceMeters: Math.round(m),
      polyline: encode([[from.latitude, from.longitude], [to.latitude, to.longitude]]),
      provider: "google-routes", computedAt: NOW.toISOString(), isEstimate: false,
    };
  });
  const transit = vi.fn(async () => undefined);
  return { walk, transit };
}
const key = (from: LatLng, to: LatLng) => `${from.latitude.toFixed(4)},${from.longitude.toFixed(4)}->${to.latitude.toFixed(4)},${to.longitude.toFixed(4)}`;

const select = (from: CampusLocation, to: CampusLocation, preference: "FASTEST" | "INDOORS", f = makeFetcher(), opts: { indoorAlternative?: boolean } = {}) =>
  selectRoute({ from, to, departAfter: NOW, preference, ...opts }, fetcherDeps(f, CFG), CFG, NOW);

describe("choosing between the outdoor walk and the winter route", () => {
  it("FASTEST walks outside, and still offers the winter route as the alternative", async () => {
    const s = await select(MC, DC, "FASTEST", makeFetcher({ [key(MC, DC)]: 1 }));
    expect(s.recommended!.indoorPath).toBeUndefined();
    expect(s.recommended).toBe(s.walking);
    expect(s.indoor!.indoorPath).toEqual(["MC", "C2", "DC"]);
  });

  it("INDOORS takes the winter route when staying inside does not cost unreasonably more", async () => {
    const s = await select(MC, DC, "INDOORS");
    expect(s.recommended!.indoorPath).toEqual(["MC", "C2", "DC"]);
    expect(s.recommended).toBe(s.indoor);
    expect(s.arrival!.getTime()).toBeGreaterThan(s.departure!.getTime());
  });

  it("INDOORS still walks outside where the network has no way at all", async () => {
    const s = await select(MC, M3, "INDOORS");
    expect(s.indoor).toBeUndefined();
    expect(s.recommended!.indoorPath).toBeUndefined();
    expect(s.recommended!.mode).toBe("WALK");
  });

  it("INDOORS refuses a winter route that is far slower than simply walking", async () => {
    // MC to HH is about eleven minutes under cover; against a two-minute walk that is no trade.
    const f = makeFetcher({ [key(MC, HH)]: 2 });
    const s = await select(MC, HH, "INDOORS", f);
    expect(s.indoor).toBeDefined();
    expect(s.recommended!.indoorPath).toBeUndefined();
    expect(s.recommended!.durationMinutes).toBe(2);
  });
});

describe("routing from where the student actually is", () => {
  // Sixty metres north of a Mathematics & Computer door: outdoors, on no building's doorstep.
  const door = nearestEntrances(MC, 1)[0].node;
  const outside = livePosition(north({ latitude: door.lat, longitude: door.lng }, 60));

  it("builds a mixed route: an outdoor walk to a door, then the network on to the destination", async () => {
    const f = makeFetcher();
    const s = await select(outside, STC, "INDOORS", f);
    const r = s.recommended!;
    // Outside → MC → QNC → B2 → STC: part outdoors, the rest under cover.
    expect(r.indoorPath).toEqual(["MC", "QNC", "B2", "STC"]);
    expect(r.steps![0].instruction).toMatch(/^Walk to the [A-Z0-9]+ entrance$/);
    expect(r.indoorShare!).toBeGreaterThan(0.5);
    expect(r.indoorShare!).toBeLessThan(1); // genuinely mixed, not an all-indoor claim
    // Every walk asked for starts where the student is; the destination is never moved.
    for (const [from] of f.walk.mock.calls) expect(from.latitude).toBeCloseTo(outside.latitude, 6);
  });

  it("does not force the student indoors when the destination is simply across the way", async () => {
    // From here Davis Centre is about 130 m on foot. The tunnel round by C2 is six minutes.
    const s = await select(outside, DC, "INDOORS");
    expect(s.indoor!.indoorPath).toEqual(["MC", "C2", "DC"]);
    expect(s.recommended!.indoorPath).toBeUndefined();
    expect(s.recommended!.durationMinutes).toBeLessThan(s.indoor!.durationMinutes);
  });

  it("walks outside from the same spot when that is what the student prefers", async () => {
    const s = await select(outside, STC, "FASTEST");
    expect(s.recommended!.indoorPath).toBeUndefined();
  });

  it("prices no winter route at all when it could not be recommended anyway", async () => {
    const f = makeFetcher();
    const s = await select(outside, DC, "FASTEST", f, { indoorAlternative: false });
    // The outdoor walk, and the few door walks the campus-aware walk itself considers; no joins for a winter route that could not be recommended.
    expect(s.indoor).toBeUndefined();
    expect(f.walk.mock.calls.length).toBeLessThanOrEqual(1 + CAMPUS_LOOKUPS.entries + 2 * CAMPUS_LOOKUPS.through);
    const withWinter = makeFetcher();
    await select(outside, DC, "FASTEST", withWinter, { indoorAlternative: true });
    expect(withWinter.walk.mock.calls.length).toBeGreaterThanOrEqual(f.walk.mock.calls.length);
    expect(f.transit).not.toHaveBeenCalled();
  });

  it("gives nothing rather than a straight line when the routing provider is down", async () => {
    const dead = { walk: vi.fn(async () => undefined), transit: vi.fn(async () => undefined) };
    const s = await select(outside, DC, "INDOORS", dead);
    expect(s.recommended).toBeUndefined();
    expect(s.indoor).toBeUndefined();
  });
});
