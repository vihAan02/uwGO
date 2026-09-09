import { describe, it, expect } from "vitest";
import { buildWeekPlan } from "./planner";
import { DEFAULT_PLANNER_CONFIG as CFG } from "@/domain/config";
import type { CourseMeeting, LatLng, RouteOption, UserHome } from "@/domain/types";
import type { RoutingProvider, TransitOptions } from "@/routing/RoutingProvider";
import { pairKey } from "@/routing/RoutingProvider";
import { findBuilding } from "@/data/buildings";
import { formatClock, addMin } from "@/time/toronto";

const MONDAY = "2026-09-14";
const coord = (u: "UW" | "WLU", code: string): LatLng => {
  const b = findBuilding(u, code)!;
  return { latitude: b.latitude!, longitude: b.longitude! };
};
const UWP = coord("UW", "UWP");
const MC = coord("UW", "MC");
const DC = coord("UW", "DC");
const LH = coord("WLU", "LH");
const home: UserHome = { name: "UW Place", ...UWP, preset: { university: "UW", buildingCode: "UWP" } };

/** Test-only provider: a table of walking minutes per pair, and canned transit itineraries. */
class FixtureProvider implements RoutingProvider {
  readonly id = "fixture";
  calls = { walk: 0, transit: 0 };
  constructor(private readonly walks: Record<string, number>, private readonly transit?: (opts: TransitOptions) => RouteOption | undefined) {}
  async getWalkingRoute(from: LatLng, to: LatLng): Promise<RouteOption | undefined> {
    this.calls.walk++;
    const min = this.walks[pairKey(from, to)];
    if (min === undefined) return undefined;
    return { mode: "WALK", durationMinutes: min, distanceMeters: min * 80, provider: "fixture", computedAt: "x", isEstimate: false };
  }
  async getTransitRoute(_f: LatLng, _t: LatLng, opts: TransitOptions): Promise<RouteOption | undefined> {
    this.calls.transit++;
    return this.transit?.(opts);
  }
}

let n = 0;
const meeting = (over: Partial<CourseMeeting>): CourseMeeting => ({
  id: `m${++n}`, university: "UW", courseCode: `CS ${100 + n}`, component: "LEC", days: ["M"], start: 9 * 60, end: 9 * 60 + 50,
  location: { kind: "ROOM", buildingCode: "MC", roomNumber: "2065" }, source: "MANUAL", includeInPlan: true, ...over,
});

const walks = {
  [pairKey(UWP, MC)]: 13, [pairKey(MC, UWP)]: 13,
  [pairKey(UWP, DC)]: 12, [pairKey(DC, UWP)]: 12,
  [pairKey(MC, DC)]: 4, [pairKey(DC, MC)]: 4,
  [pairKey(DC, LH)]: 24, [pairKey(LH, DC)]: 24,
  [pairKey(LH, UWP)]: 20, [pairKey(UWP, LH)]: 20,
  [pairKey(MC, LH)]: 26,
};

describe("planner", () => {
  it("first class from residence, class -> class, back home; departure times to the minute", async () => {
    const provider = new FixtureProvider(walks);
    const plan = await buildWeekPlan({
      meetings: [
        meeting({ courseCode: "MATH 135", start: 9 * 60, end: 9 * 60 + 50 }),
        meeting({ courseCode: "CS 135", start: 10 * 60 + 30, end: 11 * 60 + 20, location: { kind: "ROOM", buildingCode: "DC", roomNumber: "1350" } }),
      ],
      home, mondayISO: MONDAY, config: CFG, days: ["M"],
    }, provider);
    const day = plan.days.M!;
    expect(day.transitions.map((t) => t.kind)).toEqual(["HOME_TO_CLASS", "CLASS_TO_CLASS", "CLASS_TO_HOME"]);
    const [toFirst, between, toHome] = day.transitions;
    expect(formatClock(toFirst.recommendedDeparture!)).toBe("8:37 AM"); // 9:00 - 13 - 10
    expect(formatClock(toFirst.expectedArrival!)).toBe("8:50 AM");
    expect(toFirst.feasibility).toBe("COMFORTABLE");
    expect(formatClock(between.recommendedDeparture!)).toBe("10:16 AM"); // 10:30 - 4 - 10
    expect(between.availableMinutes).toBe(40);
    expect(between.feasibility).toBe("COMFORTABLE");
    expect(toHome.hasDeadline).toBe(false);
    expect(formatClock(toHome.recommendedDeparture!)).toBe("11:20 AM");
    expect(formatClock(toHome.expectedArrival!)).toBe("11:32 AM");
    const kinds = day.items.map((i) => i.kind);
    expect(kinds).toEqual(["LEAVE", "ARRIVE", "CLASS", "GAP", "LEAVE", "ARRIVE", "CLASS", "LEAVE", "ARRIVE"]);
    expect(plan.usesEstimates).toBe(false);
    expect(plan.skipped).toEqual([]);
  });

  it("tight and impossible transitions are flagged", async () => {
    const provider = new FixtureProvider({ ...walks, [pairKey(MC, DC)]: 9 });
    const tight = await buildWeekPlan({ meetings: [meeting({ start: 10 * 60, end: 10 * 60 + 20 }), meeting({ start: 10 * 60 + 30, end: 11 * 60 + 20, location: { kind: "ROOM", buildingCode: "DC", roomNumber: "1350" } })], mondayISO: MONDAY, config: CFG, days: ["M"] }, provider);
    expect(tight.days.M!.transitions[0].feasibility).toBe("TIGHT");
    const late = await buildWeekPlan({ meetings: [meeting({ start: 10 * 60, end: 10 * 60 + 20 }), meeting({ start: 10 * 60 + 30, end: 11 * 60 + 20, location: { kind: "ROOM", buildingCode: "DC", roomNumber: "1350" } })], mondayISO: MONDAY, config: CFG, days: ["M"] }, new FixtureProvider({ ...walks, [pairKey(MC, DC)]: 17 }));
    expect(late.days.M!.transitions[0].feasibility).toBe("LIKELY_LATE");
    expect(late.days.M!.warnings[0]).toMatch(/likely be late/);
  });

  it("UW -> Laurier asks for transit with the class end as departure and picks by arrival", async () => {
    const provider = new FixtureProvider(walks, (opts) => {
      const dep = addMin(opts.departureTime!, 4);
      const arr = addMin(dep, 12);
      return { mode: "TRANSIT", durationMinutes: 12, departureTime: dep, arrivalTime: arr, transferCount: 0, provider: "fixture", computedAt: "x", isEstimate: false, steps: [{ mode: "WALK", durationMinutes: 4 }, { mode: "TRANSIT", durationMinutes: 4, transit: { line: "202", vehicle: "Bus", departureStop: "Univ/UW", arrivalStop: "Univ/WLU", departureTime: addMin(dep, 4), arrivalTime: addMin(dep, 8), stopCount: 1 } }, { mode: "WALK", durationMinutes: 4 }] };
    });
    const plan = await buildWeekPlan({
      meetings: [
        meeting({ start: 13 * 60 + 30, end: 14 * 60 + 20, location: { kind: "ROOM", buildingCode: "DC", roomNumber: "1350" } }),
        meeting({ university: "WLU", courseCode: "BU 111", start: 15 * 60, end: 16 * 60 + 20, location: { kind: "ROOM", buildingCode: "LH", roomNumber: "1001" } }),
      ],
      mondayISO: MONDAY, config: CFG, days: ["M"],
    }, provider);
    const t = plan.days.M!.transitions[0];
    expect(t.crossCampus).toBe(true);
    expect(provider.calls.transit).toBe(1);
    expect(t.walkingRoute!.durationMinutes).toBe(24);
    expect(t.transitRoute!.mode).toBe("TRANSIT");
    expect(t.recommendedRoute!.mode).toBe("TRANSIT"); // arrives 14:36 vs walking 14:44
    expect(formatClock(t.recommendedDeparture!)).toBe("2:24 PM");
    expect(formatClock(t.expectedArrival!)).toBe("2:36 PM");
    expect(t.feasibility).toBe("COMFORTABLE");
  });

  it("Laurier -> UW without transit falls back to walking; home -> class uses arrivalTime", async () => {
    const seen: TransitOptions[] = [];
    const provider = new FixtureProvider(walks, (opts) => { seen.push(opts); return undefined; });
    const plan = await buildWeekPlan({
      meetings: [
        meeting({ university: "WLU", courseCode: "BU 111", start: 8 * 60 + 30, end: 9 * 60 + 50, location: { kind: "ROOM", buildingCode: "LH", roomNumber: "1001" } }),
        meeting({ start: 10 * 60 + 30, end: 11 * 60 + 20, location: { kind: "ROOM", buildingCode: "DC", roomNumber: "1350" } }),
      ],
      home, mondayISO: MONDAY, config: CFG, days: ["M"],
    }, provider);
    const [toFirst, cross] = plan.days.M!.transitions;
    expect(toFirst.crossCampus).toBe(true);
    expect(seen[0].arrivalTime).toBeDefined();
    expect(formatClock(seen[0].arrivalTime!)).toBe("8:20 AM");
    expect(cross.recommendedRoute!.mode).toBe("WALK");
    expect(formatClock(cross.recommendedDeparture!)).toBe("9:56 AM");
    expect(cross.feasibility).toBe("COMFORTABLE");
  });

  it("gap between classes gets a home-return analysis and same-building transitions cost no route calls", async () => {
    const provider = new FixtureProvider(walks);
    const plan = await buildWeekPlan({
      meetings: [
        meeting({ start: 10 * 60 + 30, end: 11 * 60 + 20, location: { kind: "ROOM", buildingCode: "DC", roomNumber: "1350" } }),
        meeting({ start: 13 * 60, end: 13 * 60 + 50, location: { kind: "ROOM", buildingCode: "DC", roomNumber: "2585" } }),
        meeting({ start: 14 * 60, end: 14 * 60 + 50, location: { kind: "ROOM", buildingCode: "DC", roomNumber: "1351" } }),
      ],
      home, mondayISO: MONDAY, config: CFG, days: ["M"],
    }, provider);
    const day = plan.days.M!;
    const gap = day.items.find((i) => i.kind === "GAP")!;
    expect(gap.kind === "GAP" && gap.minutes).toBe(100);
    const hr = gap.kind === "GAP" ? gap.homeReturn! : undefined!;
    expect(hr.recommendation).toBe("WORTH_IT");
    expect(hr.usableHomeMinutes).toBe(100 - 12 - 12 - 10);
    expect(formatClock(hr.arriveHomeAt!)).toBe("11:32 AM");
    expect(formatClock(hr.leaveHomeAt!)).toBe("12:38 PM");
    const same = day.transitions.find((t) => t.kind === "CLASS_TO_CLASS" && t.from.id === t.to.id)!;
    expect(same.recommendedRoute!.durationMinutes).toBe(0);
    expect(same.reason).toBe("Same building.");
    // walking pairs used: UWP->DC, DC->UWP (home routes reuse), DC->UWP for last leg is the same pair -> 2 calls total
    expect(provider.calls.walk).toBe(2);
  });

  it("missing routes produce warnings, never invented durations; estimates are surfaced", async () => {
    const plan = await buildWeekPlan({ meetings: [meeting({}), meeting({ start: 11 * 60, end: 12 * 60, location: { kind: "ROOM", buildingCode: "DC", roomNumber: "1350" } })], mondayISO: MONDAY, config: CFG, days: ["M"] }, new FixtureProvider({}));
    expect(plan.days.M!.transitions[0].feasibility).toBe("UNKNOWN");
    expect(plan.days.M!.warnings[0]).toMatch(/No route found/);
    const est: RoutingProvider = { id: "e", async getWalkingRoute() { return { mode: "WALK", durationMinutes: 5, provider: "e", computedAt: "", isEstimate: true }; }, async getTransitRoute() { return undefined; } };
    const p2 = await buildWeekPlan({ meetings: [meeting({}), meeting({ start: 11 * 60, end: 12 * 60, location: { kind: "ROOM", buildingCode: "DC", roomNumber: "1350" } })], mondayISO: MONDAY, config: CFG, days: ["M"] }, est);
    expect(p2.usesEstimates).toBe(true);
  });
});
