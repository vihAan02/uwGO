import { describe, expect, it, vi } from "vitest";
import { decode, encode } from "@googlemaps/polyline-codec";
import { CONNECTOR_MAX_METRES, MIN_INDOOR_SHARE, indoorIsReasonable, indoorRouteBetween, networkBuildingLocation } from "./indoorRoute";
import { nearestEntrances } from "./indoorGraph";
import { haversineMeters } from "@/routing/EstimateRoutingProvider";
import { findBuilding } from "@/data/buildings";
import { DEFAULT_PLANNER_CONFIG } from "@/domain/config";
import type { CampusLocation, LatLng, RouteOption } from "@/domain/types";

const loc = (code: string) => networkBuildingLocation(code)!;
const walk = (min: number): RouteOption => ({ mode: "WALK", durationMinutes: min, provider: "test", computedAt: "", isEstimate: false });
const uwp = findBuilding("UW", "UWP")!;
const HOME: CampusLocation = { id: "home", name: "UW Place", latitude: uwp.latitude!, longitude: uwp.longitude!, kind: "HOME", university: "UW", buildingCode: "UWP" };

/** A Google-shaped walk between two points: a real polyline, a duration from the distance. */
function googleWalk(from: LatLng, to: LatLng): RouteOption {
  const m = haversineMeters(from, to) * 1.2;
  return { mode: "WALK", durationMinutes: Math.max(1, Math.round(m / 80)), distanceMeters: Math.round(m), polyline: encode([[from.latitude, from.longitude], [to.latitude, to.longitude]]), provider: "google-routes", computedAt: "", isEstimate: false };
}
const fetcher = () => ({ walk: vi.fn(async (from: LatLng, to: LatLng) => googleWalk(from, to)) });
/** Within polyline precision (5 decimals, about a metre) of a place. */
const near = ([lat, lng]: number[], p: LatLng) => haversineMeters({ latitude: lat, longitude: lng }, p) < 2;

describe("the winter route between two network buildings", () => {
  it("MC → DC: a route with a duration, a path of buildings, and a map line that starts and ends at the buildings", async () => {
    const r = (await indoorRouteBetween(loc("MC"), loc("DC")))!;
    expect(r.mode).toBe("WALK");
    expect(r.indoorPath).toEqual(["MC", "C2", "DC"]);
    expect(r.indoorShare).toBe(1);
    expect(r.durationMinutes).toBeGreaterThan(2);
    expect(r.durationMinutes).toBeLessThan(8);
    expect(r.distanceMeters).toBeGreaterThan(150);
    expect(r.isEstimate).toBe(true);
    expect(r.provider).toMatch(/uw-indoor/);
    const line = decode(r.polyline!);
    expect(line.length).toBeGreaterThan(5);
    // The line begins at MC's map point and ends at DC's: the whole journey, not just the tunnel.
    expect(near(line[0], loc("MC"))).toBe(true);
    expect(near(line[line.length - 1], loc("DC"))).toBe(true);
    // Consecutive points are close together: no jump from a building to a tunnel far away.
    for (let i = 1; i < line.length; i++) {
      expect(haversineMeters({ latitude: line[i - 1][0], longitude: line[i - 1][1] }, { latitude: line[i][0], longitude: line[i][1] })).toBeLessThan(120);
    }
    expect(r.steps!.map((s) => s.instruction)).toEqual(["MC → C2: tunnel", "C2 → DC: bridge"]);
  });

  it("STC → MC keeps the way the timeline has always shown: STC → B2 → QNC → MC", async () => {
    const r = (await indoorRouteBetween(loc("STC"), loc("MC")))!;
    expect(r.indoorPath).toEqual(["STC", "B2", "QNC", "MC"]);
    expect(r.indoorShare).toBe(1);
  });

  it("MC → M3 is not a winter route: the survey has no bridge, so the way is mostly outside", async () => {
    expect(await indoorRouteBetween(loc("MC"), loc("M3"))).toBeUndefined();
  });

  it("MC → HH is offered even though it crosses one short walkway, because it is mostly under cover", async () => {
    const r = (await indoorRouteBetween(loc("MC"), loc("HH")))!;
    expect(r.indoorShare).toBeGreaterThan(MIN_INDOOR_SHARE);
    expect(r.indoorShare).toBeLessThan(1);
    expect(r.indoorPath![0]).toBe("MC");
    expect(r.indoorPath!.at(-1)).toBe("HH");
    expect(r.steps!.some((s) => s.instruction?.includes("outside"))).toBe(true);
  });

  it("is the same journey in reverse", async () => {
    const f = (await indoorRouteBetween(loc("DC"), loc("PSE")))!;
    const b = (await indoorRouteBetween(loc("PSE"), loc("DC")))!;
    expect(b.indoorPath).toEqual([...f.indoorPath!].reverse());
    expect(b.durationMinutes).toBe(f.durationMinutes);
    expect(Math.abs(b.distanceMeters! - f.distanceMeters!)).toBeLessThanOrEqual(1);
  });

  it("is undefined for the same building, and for a pair the network does not join without a way to join them", async () => {
    expect(await indoorRouteBetween(loc("MC"), loc("MC"))).toBeUndefined();
    expect(await indoorRouteBetween(loc("MC"), loc("UWP"))).toBeUndefined(); // no fetcher: nothing can join UWP
    expect(await indoorRouteBetween(HOME, loc("MC"))).toBeUndefined();
  });
});

describe("joining a place that is not on the network", () => {
  it("a residence reaches the network by a Google walk to the nearest door, and the line is Google's, not a straight guess", async () => {
    const f = fetcher();
    const r = (await indoorRouteBetween(HOME, loc("MC"), f))!;
    expect(f.walk).toHaveBeenCalled();
    expect(f.walk.mock.calls.length).toBeLessThanOrEqual(2);
    // Every walk asked for goes from home to a door of a network building.
    const doors = nearestEntrances(HOME, 2);
    for (const [from, to] of f.walk.mock.calls) {
      expect(from).toBe(HOME);
      expect(doors.some((d) => d.node.lat === to.latitude && d.node.lng === to.longitude)).toBe(true);
    }
    expect(r.indoorPath!.at(-1)).toBe("MC");
    expect(r.steps![0].instruction).toMatch(/^Walk to the [A-Z0-9]+ entrance$/);
    expect(r.indoorShare).toBeGreaterThanOrEqual(MIN_INDOOR_SHARE);
    const line = decode(r.polyline!);
    expect(near(line[0], HOME)).toBe(true);
    expect(near(line[line.length - 1], loc("MC"))).toBe(true);
  });

  it("refuses a connector that is only a straight-line estimate", async () => {
    const f = { walk: vi.fn(async (from: LatLng, to: LatLng) => ({ ...googleWalk(from, to), isEstimate: true, polyline: undefined })) };
    expect(await indoorRouteBetween(HOME, loc("MC"), f)).toBeUndefined();
  });

  it("gives nothing for a place too far from any door", async () => {
    const far: CampusLocation = { id: "far", name: "Far", latitude: 43.50, longitude: -80.60, kind: "HOME" };
    const f = fetcher();
    expect(await indoorRouteBetween(far, loc("MC"), f)).toBeUndefined();
    expect(f.walk).not.toHaveBeenCalled();
    expect(nearestEntrances(far, 1)[0].metres).toBeGreaterThan(CONNECTOR_MAX_METRES);
  });

  it("a failed walk lookup means no winter route, not a made-up one", async () => {
    const f = { walk: vi.fn(async () => undefined) };
    expect(await indoorRouteBetween(HOME, loc("MC"), f)).toBeUndefined();
  });
});

describe("taking the winter route", () => {
  it("indoors-when-possible takes a slightly slower indoor route but not an unreasonable one", () => {
    const cfg = DEFAULT_PLANNER_CONFIG;
    expect(indoorIsReasonable(walk(9), walk(7), cfg)).toBe(true); // +2 min, +29%
    expect(indoorIsReasonable(walk(16), walk(7), cfg)).toBe(false); // +9 min
    expect(indoorIsReasonable(walk(7), walk(4), cfg)).toBe(true); // +3 min, +75%
    expect(indoorIsReasonable(walk(8), walk(4), cfg)).toBe(false); // +4 min but doubles the walk
  });

  it("with 'indoors when possible', a QNC → STC leg takes the QNC → B2 → STC way and still keeps Google's walk as the fastest alternative", async () => {
    const { buildWeekPlan } = await import("./planner");
    const { pairKey } = await import("@/routing/RoutingProvider");
    const QNC = loc("QNC");
    const STC = loc("STC");
    const provider = {
      id: "walk-only",
      async getWalkingRoute(from: LatLng, to: LatLng) { return walk(pairKey(from, to) === pairKey(QNC, STC) ? 3 : 6); },
      async getTransitRoute() { return undefined; },
    };
    const meetings = [
      { id: "a", university: "UW" as const, courseCode: "MATH 135", component: "LEC" as const, days: ["W" as const], start: 14 * 60 + 30, end: 15 * 60 + 20, location: { kind: "ROOM" as const, buildingCode: "QNC", roomNumber: "2502" }, source: "MANUAL" as const, includeInPlan: true },
      { id: "b", university: "UW" as const, courseCode: "MATH 135", component: "TUT" as const, days: ["W" as const], start: 16 * 60, end: 17 * 60 + 20, location: { kind: "ROOM" as const, buildingCode: "STC", roomNumber: "0050" }, source: "MANUAL" as const, includeInPlan: true },
    ];
    const indoors = await buildWeekPlan({ meetings, mondayISO: "2026-09-14", config: DEFAULT_PLANNER_CONFIG, days: ["W"], routePreference: "INDOORS" }, provider);
    const leg = indoors.days.W!.transitions[0];
    expect(leg.recommendedRoute?.indoorPath).toEqual(["QNC", "B2", "STC"]);
    expect(leg.walkingRoute?.durationMinutes).toBe(3);
    expect(leg.indoorRoute).toBe(leg.recommendedRoute);
    expect(leg.expectedArrival!.getTime()).toBeLessThanOrEqual(leg.arriveBy.getTime() - DEFAULT_PLANNER_CONFIG.arrivalBufferMinutes * 60_000);

    const fastest = await buildWeekPlan({ meetings, mondayISO: "2026-09-14", config: DEFAULT_PLANNER_CONFIG, days: ["W"] }, provider);
    const leg2 = fastest.days.W!.transitions[0];
    expect(leg2.recommendedRoute?.indoorPath).toBeUndefined();
    expect(leg2.indoorRoute?.indoorPath).toEqual(["QNC", "B2", "STC"]); // still offered as the winter alternative
  });
});
