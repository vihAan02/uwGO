import { describe, expect, it } from "vitest";
import { indoorIsReasonable, indoorRouteBetween, shortestIndoorPath } from "./indoorRoute";
import { INDOOR_CONNECTIONS } from "@/data/indoor/connections";
import { buildingLocation, findBuilding } from "@/data/buildings";
import { DEFAULT_PLANNER_CONFIG } from "@/domain/config";
import type { RouteOption } from "@/domain/types";

const loc = (code: string) => buildingLocation(findBuilding("UW", code)!)!;
const walk = (min: number): RouteOption => ({ mode: "WALK", durationMinutes: min, provider: "test", computedAt: "", isEstimate: false });

describe("verified indoor connections", () => {
  it("every edge names two known UW buildings with coordinates and cites its source page", () => {
    for (const e of INDOOR_CONNECTIONS) {
      for (const code of [e.a, e.b]) {
        const b = findBuilding("UW", code);
        expect(b, `${code} in ${e.a}-${e.b}`).toBeDefined();
        expect(b!.latitude, code).toBeTypeOf("number");
      }
      expect(e.source).toMatch(/^uwaterloo\.ca\/accessibility\/getting-around\/building-accessibility\//);
    }
  });

  it("MC → M3 goes through DC (the page states DC-MC and DC-M3 overpasses, no direct MC-M3 link)", () => {
    expect(shortestIndoorPath("MC", "M3")?.codes).toEqual(["MC", "DC", "M3"]);
  });

  it("QNC → STC stays inside via B2", () => {
    expect(shortestIndoorPath("QNC", "STC")?.codes).toEqual(["QNC", "B2", "STC"]);
  });

  it("MC → PAC is MC → SLC → PAC", () => {
    expect(shortestIndoorPath("MC", "PAC")?.codes).toEqual(["MC", "SLC", "PAC"]);
  });

  it("no path is invented between buildings that the source does not connect", () => {
    expect(shortestIndoorPath("MC", "E6")).toBeUndefined(); // E5-E6 is not stated on the pages
    expect(shortestIndoorPath("MC", "UWP")).toBeUndefined();
  });
});

describe("indoor route option", () => {
  it("Scenario E — a route between two connected buildings with a duration, path and map line", () => {
    const r = indoorRouteBetween(loc("MC"), loc("DC"))!;
    expect(r.mode).toBe("WALK");
    expect(r.indoorPath).toEqual(["MC", "DC"]);
    expect(r.durationMinutes).toBeGreaterThan(0);
    expect(r.durationMinutes).toBeLessThan(10);
    expect(r.polyline).toBeTruthy();
    expect(r.isEstimate).toBe(true);
    expect(r.provider).toMatch(/uw-indoor/);
  });

  it("is undefined for homes, cross-campus trips and unconnected buildings", () => {
    expect(indoorRouteBetween({ id: "home", name: "Home", latitude: 43.47, longitude: -80.54, kind: "HOME" }, loc("MC"))).toBeUndefined();
    expect(indoorRouteBetween(loc("MC"), loc("UWP"))).toBeUndefined();
  });

  it("indoors-when-possible takes a slightly slower indoor route but not an unreasonable one", () => {
    const cfg = DEFAULT_PLANNER_CONFIG;
    expect(indoorIsReasonable(walk(9), walk(7), cfg)).toBe(true); // +2 min, +29%
    expect(indoorIsReasonable(walk(16), walk(7), cfg)).toBe(false); // +9 min
    expect(indoorIsReasonable(walk(7), walk(4), cfg)).toBe(true); // +3 min, +75%
    expect(indoorIsReasonable(walk(8), walk(4), cfg)).toBe(false); // +4 min but doubles the walk
  });
});

describe("route preference through the planner", () => {
  it("Scenario E — with 'indoors when possible', a QNC → STC leg takes the QNC → B2 → STC way and still keeps Google's walk as the fastest alternative", async () => {
    const { buildWeekPlan } = await import("./planner");
    const { pairKey } = await import("@/routing/RoutingProvider");
    const QNC = loc("QNC");
    const STC = loc("STC");
    const provider = {
      id: "walk-only",
      async getWalkingRoute(from: { latitude: number; longitude: number }, to: { latitude: number; longitude: number }) { return walk(pairKey(from, to) === pairKey(QNC, STC) ? 3 : 6); },
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
