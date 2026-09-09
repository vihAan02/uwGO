import { describe, it, expect } from "vitest";
import { recommendedDeparture, expectedArrival, clampDeparture } from "./departure";
import { assessFeasibility } from "./feasibility";
import { analyzeHomeReturn } from "./homeReturn";
import { chooseRoute, shouldConsiderTransit } from "./transitCompare";
import { normalizeWeek } from "./normalize";
import { buildTransitions } from "./transitions";
import { DEFAULT_PLANNER_CONFIG as CFG } from "@/domain/config";
import { addMin, formatClock, torontoDate, minutesBetween } from "@/time/toronto";
import type { CourseMeeting, RouteOption, CampusLocation } from "@/domain/types";

const D = "2026-09-14"; // Monday
const t = (h: number, m = 0) => torontoDate(D, h * 60 + m);
const walk = (min: number): RouteOption => ({ mode: "WALK", durationMinutes: min, provider: "test", computedAt: "x", isEstimate: false });
const transit = (dep: Date, arr: Date): RouteOption => ({ mode: "TRANSIT", durationMinutes: minutesBetween(dep, arr), departureTime: dep, arrivalTime: arr, provider: "test", computedAt: "x", isEstimate: false });

describe("departure", () => {
  it("class 10:00, travel 15, buffer 10 -> 9:35", () => {
    expect(formatClock(recommendedDeparture(t(10), 15, 10))).toBe("9:35 AM");
  });
  it("no rounding drift with fractional durations (ceil)", () => {
    expect(formatClock(recommendedDeparture(t(10), 14.2, 10))).toBe("9:35 AM");
    expect(formatClock(expectedArrival(t(9, 35), 14.2))).toBe("9:50 AM");
  });
  it("clamps to departAfter", () => {
    expect(clampDeparture(t(9, 35), t(9, 40)).getTime()).toBe(t(9, 40).getTime());
    expect(clampDeparture(t(9, 45), t(9, 40)).getTime()).toBe(t(9, 45).getTime());
  });
});

describe("feasibility", () => {
  it("safe: ends 10:20, next 11:30, walk 11 -> COMFORTABLE", () => expect(assessFeasibility(70, 11, CFG)).toBe("COMFORTABLE"));
  it("tight: ends 10:20, next 10:30, walk 9 -> TIGHT", () => expect(assessFeasibility(10, 9, CFG)).toBe("TIGHT"));
  it("impossible: ends 10:20, next 10:30, travel 17 -> LIKELY_LATE", () => expect(assessFeasibility(10, 17, CFG)).toBe("LIKELY_LATE"));
  it("boundaries", () => {
    expect(assessFeasibility(25, 10, CFG)).toBe("COMFORTABLE"); // 10 + 10 + 5
    expect(assessFeasibility(24, 10, CFG)).toBe("TIGHT");
    expect(assessFeasibility(10, 10, CFG)).toBe("TIGHT");
    expect(assessFeasibility(9, 10, CFG)).toBe("LIKELY_LATE");
    expect(assessFeasibility(0, 0, CFG)).toBe("TIGHT"); // same building, back-to-back
  });
});

describe("home return", () => {
  const spec = { ...CFG, arrivalBufferMinutes: 5 };
  /** The two legs exactly as the resolver would settle them for walking: out at the gap start, back at the latest safe departure. */
  const walked = (gapStart: Date, next: Date, homeMin: number, backMin: number, cfg = CFG) => {
    const arriveHome = addMin(gapStart, homeMin);
    const planned = addMin(next, -(backMin + cfg.arrivalBufferMinutes));
    const leaveHome = planned.getTime() < arriveHome.getTime() ? arriveHome : planned;
    return {
      gapStart, nextClassStart: next,
      routeHome: { route: walk(homeMin), departure: gapStart, arrival: arriveHome },
      routeBack: { route: walk(backMin), departure: leaveHome, arrival: addMin(leaveHome, backMin) },
    };
  };
  it("matches the product example: ends 11:20, walk 12, next 13:00, buffer 5", () => {
    const a = analyzeHomeReturn(walked(t(11, 20), t(13), 12, 12, spec), spec);
    expect(a.recommendation).toBe("WORTH_IT");
    expect(a.possible).toBe(true);
    expect(formatClock(a.arriveHomeAt!)).toBe("11:32 AM");
    expect(formatClock(a.leaveHomeAt!)).toBe("12:43 PM");
    expect(a.usableHomeMinutes).toBe(71);
  });
  it("with the default 10 min buffer the same gap gives 66 minutes", () => {
    const a = analyzeHomeReturn(walked(t(11, 20), t(13), 12, 12), CFG);
    expect(a.usableHomeMinutes).toBe(66);
    expect(formatClock(a.leaveHomeAt!)).toBe("12:38 PM");
  });
  it("barely enough -> POSSIBLE", () => {
    // gap 60, 12+12+10 = 34 -> usable 26
    const a = analyzeHomeReturn(walked(t(11), t(12), 12, 12), CFG);
    expect(a.usableHomeMinutes).toBe(26);
    expect(a.recommendation).toBe("POSSIBLE");
    expect(a.possible).toBe(true);
  });
  it("not enough -> NOT_RECOMMENDED but still possible when usable > 0", () => {
    // gap 40 -> usable 6
    const a = analyzeHomeReturn(walked(t(11), t(11, 40), 12, 12), CFG);
    expect(a.usableHomeMinutes).toBe(6);
    expect(a.recommendation).toBe("NOT_RECOMMENDED");
    expect(a.possible).toBe(true);
  });
  it("back-to-back -> impossible, no times", () => {
    const a = analyzeHomeReturn(walked(t(11), t(11, 10), 12, 12), CFG);
    expect(a.usableHomeMinutes).toBe(0);
    expect(a.possible).toBe(false);
    expect(a.recommendation).toBe("NOT_RECOMMENDED");
    expect(a.leaveHomeAt).toBeUndefined();
  });
  it("exact thresholds: 30 -> WORTH_IT, 29 -> POSSIBLE, 10 -> POSSIBLE, 9 -> NOT_RECOMMENDED", () => {
    const at = (usable: number) => analyzeHomeReturn(walked(t(11), t(11, usable + 12 + 12 + 10), 12, 12), CFG);
    expect(at(30).recommendation).toBe("WORTH_IT");
    expect(at(29).recommendation).toBe("POSSIBLE");
    expect(at(10).recommendation).toBe("POSSIBLE");
    expect(at(9).recommendation).toBe("NOT_RECOMMENDED");
  });
  it("thresholds are configurable", () => {
    const a = analyzeHomeReturn(walked(t(11), t(12), 12, 12), { ...CFG, minUsefulHomeMinutes: 20 });
    expect(a.recommendation).toBe("WORTH_IT");
  });
  it("usable time is read off the resolved legs, so a bus schedule costs what it costs", () => {
    // Walking would give 66 min at home; the bus back only runs at 12:20, so it gives 48 and says so.
    const a = analyzeHomeReturn({
      gapStart: t(11, 20), nextClassStart: t(13),
      routeHome: { route: walk(12), departure: t(11, 20), arrival: t(11, 32) },
      routeBack: { route: transit(t(12, 20), t(12, 45)), departure: t(12, 20), arrival: t(12, 45) },
    }, CFG);
    expect(a.usableHomeMinutes).toBe(48);
    expect(a.travelBackMinutes).toBe(25);
    expect(formatClock(a.leaveHomeAt!)).toBe("12:20 PM");
    expect(a.routeBack!.mode).toBe("TRANSIT");
  });
  it("a route back that lands inside the buffer is not a way home", () => {
    const a = analyzeHomeReturn({
      gapStart: t(11, 20), nextClassStart: t(13),
      routeHome: { route: walk(12), departure: t(11, 20), arrival: t(11, 32) },
      routeBack: { route: transit(t(12, 30), t(12, 55)), departure: t(12, 30), arrival: t(12, 55) },
    }, CFG);
    expect(a.possible).toBe(false);
    expect(a.recommendation).toBe("NOT_RECOMMENDED");
  });
});

describe("transit comparison", () => {
  it("eligibility", () => {
    expect(shouldConsiderTransit(true, 5, CFG)).toBe(true);
    expect(shouldConsiderTransit(false, 25, CFG)).toBe(true);
    expect(shouldConsiderTransit(false, 12, CFG)).toBe(true); // a bus could still save 5 min on a 12 min walk
    expect(shouldConsiderTransit(false, 8, CFG)).toBe(false); // it cannot on an 8 min one
    expect(shouldConsiderTransit(false, undefined, CFG)).toBe(true); // nothing to walk on: transit is the only hope
  });
  it("UW -> Laurier: bus beats a 24 min walk when it arrives 12 min earlier", () => {
    // leave DC at 14:20, class at 15:00. Walk 24 -> arrive 14:44 if leaving now. Bus: dep 14:29 arr 14:41.
    // Walk leaves 14:26 and arrives 14:50; the bus leaves 14:29 and arrives 14:41.
    // Later departure and an earlier arrival: the bus is simply better.
    const c = chooseRoute({ departAfter: t(14, 20), arriveBy: t(15), hasDeadline: true, walking: walk(24), transit: transit(t(14, 29), t(14, 41)) }, CFG);
    expect(c.recommended!.mode).toBe("TRANSIT");

    // A bus that leaves earlier and is slower door to door is not worth catching.
    const early = chooseRoute({ departAfter: t(14, 20), arriveBy: t(15), hasDeadline: true, walking: walk(24), transit: transit(t(14, 20), t(14, 50)) }, CFG);
    expect(early.recommended!.mode).toBe("WALK");

    // Home -> class, where both are forced to leave at the same time by the class deadline:
    // the 19 min bus beats the 31 min walk instead of losing to it.
    const home = chooseRoute({ departAfter: torontoDate(D, 0), arriveBy: t(10), hasDeadline: true, walking: walk(31), transit: transit(t(9, 19), t(9, 38)) }, CFG);
    expect(home.recommended!.mode).toBe("TRANSIT");
    const c2 = chooseRoute({ departAfter: t(14, 20), arriveBy: t(15), hasDeadline: true, walking: walk(24), transit: transit(t(14, 24), t(14, 32)) }, CFG);
    expect(c2.recommended!.mode).toBe("TRANSIT");
    expect(formatClock(c2.departure!)).toBe("2:24 PM");
    expect(formatClock(c2.arrival!)).toBe("2:32 PM");
    expect(c2.slackMinutes).toBe(28);
  });
  it("Laurier -> UW: transit rescues a walk that would be late", () => {
    const c = chooseRoute({ departAfter: t(14, 20), arriveBy: t(14, 40), hasDeadline: true, walking: walk(24), transit: transit(t(14, 22), t(14, 29)) }, CFG);
    expect(c.recommended!.mode).toBe("TRANSIT");
  });
  it("walking recommended departure is the latest safe time, never before departAfter", () => {
    const c = chooseRoute({ departAfter: t(10, 20), arriveBy: t(11, 30), hasDeadline: true, walking: walk(11) }, CFG);
    expect(formatClock(c.departure!)).toBe("11:09 AM");
    expect(formatClock(c.arrival!)).toBe("11:20 AM");
    const tight = chooseRoute({ departAfter: t(10, 20), arriveBy: t(10, 30), hasDeadline: true, walking: walk(9) }, CFG);
    expect(formatClock(tight.departure!)).toBe("10:20 AM");
    expect(tight.slackMinutes).toBe(1);
  });
  it("both late: least late wins; no routes: no recommendation", () => {
    const c = chooseRoute({ departAfter: t(10, 20), arriveBy: t(10, 30), hasDeadline: true, walking: walk(17), transit: transit(t(10, 22), t(10, 34)) }, CFG);
    expect(c.recommended!.mode).toBe("TRANSIT");
    expect(c.slackMinutes).toBe(-4);
    expect(chooseRoute({ departAfter: t(10), arriveBy: t(11), hasDeadline: true }, CFG).recommended).toBeUndefined();
  });
  it("stale transit itinerary (departs before departAfter) is ignored", () => {
    const c = chooseRoute({ departAfter: t(14, 20), arriveBy: t(15), hasDeadline: true, walking: walk(24), transit: transit(t(14, 10), t(14, 20)) }, CFG);
    expect(c.recommended!.mode).toBe("WALK");
  });
});

const meeting = (over: Partial<CourseMeeting>): CourseMeeting => ({
  id: over.id ?? Math.random().toString(36).slice(2),
  university: "UW", courseCode: "X 1", component: "LEC", days: ["M"], start: 9 * 60, end: 9 * 60 + 50,
  location: { kind: "ROOM", buildingCode: "MC", roomNumber: "2065" }, source: "MANUAL", includeInPlan: true, ...over,
});

describe("normalizeWeek", () => {
  it("places classes on dates in the reference week with Toronto instants and resolved rooms", () => {
    const w = normalizeWeek([meeting({ id: "a", days: ["M", "W"], startDate: "2026-09-03", endDate: "2026-12-02" })], D);
    expect(w.byDay.M).toHaveLength(1);
    expect(w.byDay.W).toHaveLength(1);
    expect(w.byDay.T).toHaveLength(0);
    const c = w.byDay.M[0];
    expect(c.date).toBe("2026-09-14");
    expect(formatClock(c.start)).toBe("9:00 AM");
    expect(c.location.buildingCode).toBe("MC");
    expect(c.room.buildingName).toBe("Mathematics & Computer Building");
    expect(c.room.floor).toBe(2);
  });
  it("skips excluded, unscheduled, online, TBA, unknown, uncoordinated, and out-of-range meetings", () => {
    const w = normalizeWeek([
      meeting({ id: "tst", component: "TST", includeInPlan: false }),
      meeting({ id: "un", unscheduled: true, days: [] }),
      meeting({ id: "on", location: { kind: "ONLINE" } }),
      meeting({ id: "tba", location: { kind: "TBA" } }),
      meeting({ id: "zz", location: { kind: "ROOM", buildingCode: "ZZZ", roomNumber: "1" } }),
      meeting({ id: "wlu-p", university: "WLU", location: { kind: "ROOM", buildingCode: "M", roomNumber: "327" } }),
      meeting({ id: "past", startDate: "2026-01-05", endDate: "2026-04-03" }),
    ], D);
    expect(w.byDay.M).toHaveLength(0);
    expect(w.skipped.map((s) => s.meeting.id)).toEqual(["tst", "un", "on", "tba", "zz", "wlu-p"]);
    expect(w.skipped.find((s) => s.meeting.id === "wlu-p")!.reason).toMatch(/No coordinates/);
  });
  it("sorts by start time and resolves E7 -> PSE and WLU LH", () => {
    const w = normalizeWeek([
      meeting({ id: "b", start: 13 * 60, end: 14 * 60, location: { kind: "ROOM", buildingCode: "E7", roomNumber: "2317" } }),
      meeting({ id: "a", start: 10 * 60, end: 11 * 60, university: "WLU", location: { kind: "ROOM", buildingCode: "LH", roomNumber: "1001" } }),
    ], D);
    expect(w.byDay.M.map((c) => c.id)).toEqual(["a:M", "b:M"]);
    expect(w.byDay.M[1].location.buildingCode).toBe("PSE");
    expect(w.byDay.M[0].location.university).toBe("WLU");
  });
});

describe("buildTransitions", () => {
  const home: CampusLocation = { id: "home", name: "UWP", latitude: 43.47, longitude: -80.53, kind: "HOME", university: "UW" };
  it("home -> class -> class -> home, with cross-campus detection", () => {
    const w = normalizeWeek([
      meeting({ id: "a", start: 9 * 60, end: 9 * 60 + 50 }),
      meeting({ id: "b", start: 10 * 60 + 30, end: 11 * 60 + 20, location: { kind: "ROOM", buildingCode: "DC", roomNumber: "1350" } }),
      meeting({ id: "c", start: 13 * 60, end: 14 * 60 + 20, university: "WLU", location: { kind: "ROOM", buildingCode: "LH", roomNumber: "1001" } }),
    ], D);
    const ts = buildTransitions(w.byDay.M, home, D);
    expect(ts.map((x) => x.kind)).toEqual(["HOME_TO_CLASS", "CLASS_TO_CLASS", "CLASS_TO_CLASS", "CLASS_TO_HOME"]);
    expect(ts[1].availableMinutes).toBe(40);
    expect(ts[1].crossCampus).toBe(false);
    expect(ts[2].crossCampus).toBe(true);
    expect(ts[3].hasDeadline).toBe(false);
    expect(formatClock(ts[0].arriveBy)).toBe("9:00 AM");
  });
  it("no home -> only class-to-class; no classes -> nothing", () => {
    const w = normalizeWeek([meeting({ id: "a" }), meeting({ id: "b", start: 11 * 60, end: 12 * 60 })], D);
    expect(buildTransitions(w.byDay.M, undefined, D)).toHaveLength(1);
    expect(buildTransitions([], home, D)).toHaveLength(0);
  });
});
