import { describe, expect, it } from "vitest";
import type { CampusLocation, CourseMeeting, CrowdEstimate, GymPreferences, LatLng, RouteOption } from "@/domain/types";
import { DEFAULT_PLANNER_CONFIG } from "@/domain/config";
import { buildingLocation, findBuilding } from "@/data/buildings";
import { estimateFromPct } from "@/data/pac/crowd";
import { buildWeekPlan } from "./planner";
import { findGymWindows } from "./gym";
import type { RoutingProvider } from "@/routing/RoutingProvider";
import { pairKey } from "@/routing/RoutingProvider";
import { formatClock, torontoDate } from "@/time/toronto";
import { normalizeWeek } from "./normalize";

const loc = (code: string): CampusLocation => buildingLocation(findBuilding("UW", code)!)!;
const MC = loc("MC");
const DC = loc("DC");
const PAC = loc("PAC");
const UWP = loc("UWP");
const walk = (min: number): RouteOption => ({ mode: "WALK", durationMinutes: min, provider: "test", computedAt: "", isEstimate: false });

class WalkOnly implements RoutingProvider {
  readonly id = "walk-only";
  constructor(private readonly walks: Record<string, number>, private readonly fallback = 6) {}
  async getWalkingRoute(from: LatLng, to: LatLng) { return walk(this.walks[pairKey(from, to)] ?? this.fallback); }
  async getTransitRoute(): Promise<RouteOption | undefined> { return undefined; }
}

const h = (hh: number, mm = 0) => hh * 60 + mm;
let n = 0;
const meeting = (start: number, end: number, building: string, days: CourseMeeting["days"] = ["W"]): CourseMeeting => ({
  id: `m${++n}`, university: "UW", courseCode: `CS ${100 + n}`, component: "LEC", days, start, end,
  location: { kind: "ROOM", buildingCode: building, roomNumber: "1001" }, source: "MANUAL", includeInPlan: true,
});
const MONDAY = "2026-09-14";
const gymPrefs = (over: Partial<GymPreferences> = {}): GymPreferences => ({ enabled: true, durationMinutes: 60, preferredTime: "NONE", ...over });

describe("Scenario C — a 60-minute workout has to fit after travel, not just inside the gap", () => {
  it("class ends 10:00 at MC, next at 11:30 in DC: 6 min to PAC, 8 min back, 10 min buffer -> 66 usable, 60 fits", async () => {
    const provider = new WalkOnly({ [pairKey(MC, PAC)]: 6, [pairKey(PAC, DC)]: 8, [pairKey(MC, DC)]: 5 });
    const plan = await buildWeekPlan({ meetings: [meeting(h(9), h(10), "MC"), meeting(h(11, 30), h(12, 20), "DC")], mondayISO: MONDAY, config: DEFAULT_PLANNER_CONFIG, days: ["W"], gym: gymPrefs() }, provider);
    const day = plan.days.W!;
    const between = day.gym.find((w) => w.slot === "BETWEEN")!;
    expect(between).toBeDefined();
    expect(between.usableMinutes).toBe(90 - 6 - 8 - 10);
    expect(formatClock(between.arrivePacAt)).toBe("10:06 AM");
    expect(formatClock(between.start)).toBe("10:06 AM");
    expect(formatClock(between.end)).toBe("11:06 AM");
    expect(formatClock(between.leavePacBy)).toBe("11:12 AM"); // 11:30 - 10 buffer - 8 walk
    const gap = day.items.find((i) => i.kind === "GAP");
    expect(gap?.kind === "GAP" && gap.gym?.id).toBe(between.id);
  });

  it("the same gap does not fit a 90-minute workout, and a 60-minute gap never fits a 60-minute workout", async () => {
    const provider = new WalkOnly({ [pairKey(MC, PAC)]: 6, [pairKey(PAC, DC)]: 8 });
    const long = await buildWeekPlan({ meetings: [meeting(h(9), h(10), "MC"), meeting(h(11, 30), h(12, 20), "DC")], mondayISO: MONDAY, config: DEFAULT_PLANNER_CONFIG, days: ["W"], gym: gymPrefs({ durationMinutes: 90 }) }, provider);
    expect(long.days.W!.gym.some((w) => w.slot === "BETWEEN")).toBe(false);
    const tight = await buildWeekPlan({ meetings: [meeting(h(9), h(10), "MC"), meeting(h(11), h(11, 50), "DC")], mondayISO: MONDAY, config: DEFAULT_PLANNER_CONFIG, days: ["W"], gym: gymPrefs() }, provider);
    expect(tight.days.W!.gym.some((w) => w.slot === "BETWEEN")).toBe(false);
  });

  it("nothing is searched when the student does not work out", async () => {
    const plan = await buildWeekPlan({ meetings: [meeting(h(9), h(10), "MC"), meeting(h(13), h(14), "DC")], mondayISO: MONDAY, config: DEFAULT_PLANNER_CONFIG, days: ["W"], gym: gymPrefs({ enabled: false }) }, new WalkOnly({}));
    expect(plan.days.W!.gym).toEqual([]);
    expect(plan.days.W!.items.some((i) => i.kind === "GYM")).toBe(false);
  });
});

describe("after the last class and before the first", () => {
  it("an after-class window ends before PAC closes and prices the trip home", async () => {
    const provider = new WalkOnly({ [pairKey(MC, PAC)]: 6, [pairKey(PAC, UWP)]: 14, [pairKey(UWP, MC)]: 20, [pairKey(MC, UWP)]: 20 });
    const home = { name: "UWP", latitude: UWP.latitude, longitude: UWP.longitude, preset: { university: "UW" as const, buildingCode: "UWP" } };
    const plan = await buildWeekPlan({ meetings: [meeting(h(14, 30), h(15, 20), "MC")], home, mondayISO: MONDAY, config: DEFAULT_PLANNER_CONFIG, days: ["W"], gym: gymPrefs() }, provider);
    const day = plan.days.W!;
    const after = day.gym.find((w) => w.slot === "AFTER_LAST")!;
    expect(formatClock(after.start)).toBe("3:26 PM");
    expect(formatClock(after.end)).toBe("4:26 PM");
    expect(after.toLabel).toBe("home");
    expect(after.routeOut.durationMinutes).toBe(14);
    expect(day.items.some((i) => i.kind === "GYM")).toBe(true);
  });

  it("no window on a day PAC is closed", async () => {
    const provider = new WalkOnly({});
    const plan = await buildWeekPlan({ meetings: [meeting(h(14, 30), h(15, 20), "MC", ["M"])], mondayISO: "2026-10-12", config: DEFAULT_PLANNER_CONFIG, days: ["M"], gym: gymPrefs() }, provider);
    expect(plan.days.M!.gym).toEqual([]);
  });
});

describe("Scenario D — ranking is about this student's day, not just the quietest hour", () => {
  const classes = normalizeWeek([meeting(h(9), h(10), "MC"), meeting(h(11, 30), h(12, 20), "DC")], MONDAY).byDay.W;
  const dateISO = "2026-09-16";
  const home: CampusLocation = { id: "home", name: "Home", latitude: 43.48, longitude: -80.56, kind: "HOME" };
  const resolve = async (from: CampusLocation, to: CampusLocation, departAfter: Date, arriveBy?: Date) => {
    const min = from.kind === "HOME" || to.kind === "HOME" ? 25 : 7;
    const departure = arriveBy ? new Date(arriveBy.getTime() - (min + 10) * 60_000) : departAfter;
    return { route: walk(min), departure, arrival: new Date(departure.getTime() + min * 60_000) };
  };
  const crowdAt = (at: Date): CrowdEstimate => {
    const hour = at.getHours() + at.getMinutes() / 60; // TZDate: Toronto wall clock
    return estimateFromPct(hour < 9 ? 5 : 45, "TYPICAL"); // dawn is empty, mid-morning is bearable
  };

  it("a convenient, bearable slot between classes beats an extremely quiet slot that needs a separate trip from home", async () => {
    const windows = await findGymWindows({ classes, home, pac: PAC, dateISO, prefs: gymPrefs(), cfg: DEFAULT_PLANNER_CONFIG, resolve, crowdAt });
    const slots = windows.map((w) => w.slot);
    expect(slots).toContain("BETWEEN");
    expect(slots).toContain("BEFORE_FIRST");
    expect(windows[0].slot).toBe("BETWEEN");
    expect(windows[0].crowd.level).toBe("BEARABLE");
    expect(windows.find((w) => w.slot === "BEFORE_FIRST")!.crowd.level).toBe("QUIET");
  });

  it("but a student who asks for the least busy time gets the quiet dawn slot ranked first", async () => {
    const windows = await findGymWindows({ classes, home, pac: PAC, dateISO, prefs: gymPrefs({ preferredTime: "LEAST_BUSY" }), cfg: DEFAULT_PLANNER_CONFIG, resolve, crowdAt });
    expect(windows[0].slot).toBe("BEFORE_FIRST");
  });

  it("a morning preference is a tie-breaker, never a way to list a workout that does not fit", async () => {
    const windows = await findGymWindows({ classes, home, pac: PAC, dateISO, prefs: gymPrefs({ preferredTime: "MORNING", durationMinutes: 90 }), cfg: DEFAULT_PLANNER_CONFIG, resolve, crowdAt });
    expect(windows.every((w) => w.usableMinutes >= 90)).toBe(true);
    expect(windows.some((w) => w.slot === "BETWEEN")).toBe(false);
    expect(torontoDate(dateISO, 6 * 60).getTime()).toBeLessThanOrEqual(windows.find((w) => w.slot === "BEFORE_FIRST")!.start.getTime());
  });
});
