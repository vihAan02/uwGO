/**
 * Pricing every way to spend a gap, and the ladder that stars one of them.
 *
 * Travel comes in through the injected `resolve`, exactly as the planner supplies it, so these
 * assert arithmetic rather than a routing provider. The fixture mirrors the real resolver: with
 * a deadline a leg departs as late as it safely can, otherwise as soon as the student is free.
 */
import { describe, expect, it } from "vitest";
import type { CampusLocation, CourseMeeting, GapOption, GymPreferences, ScheduledClass } from "@/domain/types";
import { DEFAULT_PLANNER_CONFIG as CFG } from "@/domain/config";
import { buildingLocation, findBuilding } from "@/data/buildings";
import { resolveStudySpots } from "@/data/study";
import { addMin, formatClock, minutesBetween } from "@/time/toronto";
import { normalizeWeek } from "./normalize";
import { priceGapOptions, recommendGapOption } from "./gapOptions";
import type { ResolvedLeg } from "./homeReturn";

const loc = (code: string): CampusLocation => buildingLocation(findBuilding("UW", code)!)!;
const PAC = loc("PAC");
const HOME: CampusLocation = { id: "home", name: "UW Place", latitude: 43.5303, longitude: -80.5372, kind: "HOME" };
const SPOTS = resolveStudySpots("UW");

const h = (hh: number, mm = 0) => hh * 60 + mm;
/** Sunday of the week whose library hours were actually read, so `known` is true. */
const WEEK = "2026-09-07";
const WED = "2026-09-09";

let n = 0;
const meeting = (start: number, end: number, building: string): CourseMeeting => ({
  id: `m${++n}`, university: "UW", courseCode: `CS ${100 + n}`, component: "LEC", days: ["W"], start, end,
  location: { kind: "ROOM", buildingCode: building, roomNumber: "1001" }, source: "MANUAL", includeInPlan: true,
});

const classesAt = (a: [number, number, string], b: [number, number, string], monday = WEEK): ScheduledClass[] =>
  normalizeWeek([meeting(...a), meeting(...b)], monday).byDay.W;

/** Walking minutes by "from->to" id. A missing pair is unroutable, like a provider that failed. */
type Table = Record<string, number>;

function fixture(table: Table) {
  const calls: string[] = [];
  const resolve = async (from: CampusLocation, to: CampusLocation, departAfter: Date, arriveBy?: Date): Promise<ResolvedLeg | undefined> => {
    calls.push(`${from.id}->${to.id}`);
    const minutes = from.id === to.id ? 0 : table[`${from.id}->${to.id}`];
    if (minutes === undefined) return undefined;
    const latest = arriveBy ? addMin(arriveBy, -(CFG.arrivalBufferMinutes + minutes)) : undefined;
    const departure = latest && latest.getTime() > departAfter.getTime() ? latest : departAfter;
    return {
      route: { mode: "WALK", durationMinutes: minutes, provider: "fixture", computedAt: "x", isEstimate: false },
      departure,
      arrival: addMin(departure, minutes),
    };
  };
  return { resolve, calls };
}

const gymPrefs = (over: Partial<GymPreferences> = {}): GymPreferences => ({ enabled: true, durationMinutes: 60, preferredTime: "NONE", ...over });
const byId = (options: GapOption[], id: GapOption["id"]) => options.find((o) => o.id === id);

/** MC 9:00-10:00, then MC 2:00-3:00 — a four-hour gap, room for anything. */
const longGap = () => classesAt([h(9), h(10), "MC"], [h(14), h(15), "MC"]);

const BASE = { home: HOME, pac: PAC, studySpots: SPOTS, dateISO: WED, cfg: CFG };
const TABLE: Table = {
  "UW:MC->home": 12, "home->UW:MC": 12,
  "UW:MC->UW:PAC": 6, "UW:PAC->UW:MC": 6,
  "UW:PAC->home": 15, "UW:PAC->UW:DC": 4, "UW:PAC->UW:LIB": 9,
  "UW:MC->UW:DC": 8, "UW:MC->UW:LIB": 3,
  "UW:DC->UW:MC": 8, "UW:LIB->UW:MC": 3,
};

describe("pricing a gap", () => {
  it("prices every option, and STAY is the whole gap with no travel", async () => {
    const [from, to] = longGap();
    const { resolve } = fixture(TABLE);
    const options = await priceGapOptions({ ...BASE, from, to, gym: gymPrefs(), resolve });
    expect(options.map((o) => o.id).sort()).toEqual(["GYM", "GYM_CLASS", "GYM_REZ", "GYM_STUDY", "REZ", "STAY", "STUDY"]);
    const stay = byId(options, "STAY")!;
    expect({ fits: stay.fits, usable: stay.usableMinutes, travel: stay.travelMinutes }).toEqual({ fits: true, usable: 240, travel: 0 });
  });

  it("going home is the gap minus travel both ways and the arrival buffer", async () => {
    const [from, to] = longGap();
    const { resolve } = fixture(TABLE);
    const options = await priceGapOptions({ ...BASE, from, to, gym: gymPrefs(), resolve });
    const rez = byId(options, "REZ")!;
    // 240 gap - 12 there - 12 back - 10 buffer.
    expect({ fits: rez.fits, usable: rez.usableMinutes, travel: rez.travelMinutes }).toEqual({ fits: true, usable: 206, travel: 24 });
    expect(formatClock(rez.leaveAt!)).toBe("10:00 AM");
    expect(rez.analysis?.recommendation).toBe("WORTH_IT");
  });

  it("the library option picks the nearest spot and clamps the stay to its hours", async () => {
    const [from, to] = longGap();
    const { resolve } = fixture(TABLE);
    const options = await priceGapOptions({ ...BASE, from, to, gym: gymPrefs(), resolve });
    const study = byId(options, "STUDY")!;
    // Dana Porter is 3 min from MC, Davis Centre 8: the nearer one wins.
    expect(study.stops[0].label).toBe("Dana Porter");
    expect({ fits: study.fits, usable: study.usableMinutes, travel: study.travelMinutes }).toEqual({ fits: true, usable: 224, travel: 6 });
  });
});

describe("the gym fork", () => {
  it("gym then class: the workout must fit the usable time at PAC, not the gap", async () => {
    const [from, to] = longGap();
    const { resolve } = fixture(TABLE);
    const options = await priceGapOptions({ ...BASE, from, to, gym: gymPrefs(), resolve });
    const g = byId(options, "GYM_CLASS")!;
    // 240 gap - 6 there - 6 back - 10 buffer = 218 usable, so a 60 min workout fits.
    expect({ fits: g.fits, usable: g.usableMinutes }).toEqual({ fits: true, usable: 218 });
    expect(g.stops[0].minDwellMinutes).toBe(60);
  });

  it("gym then rez measures the time at home from the END of the workout, not from arriving at PAC", async () => {
    const [from, to] = longGap();
    const { resolve } = fixture(TABLE);
    const options = await priceGapOptions({ ...BASE, from, to, gym: gymPrefs(), resolve });
    const g = byId(options, "GYM_REZ")!;
    // 10:00 leave MC, 10:06 at PAC, workout to 11:06, 15 min home = 11:21 there.
    // Must leave home by 2:00 - 10 buffer - 12 walk = 1:38. That is 137 minutes, not 197.
    expect(g.usableMinutes).toBe(137);
    expect(g.fits).toBe(true);
    expect(g.stops.map((s) => s.label)).toEqual(["PAC", "home"]);
    expect(g.stops[0].minDwellMinutes).toBe(60);
    expect(g.stops[1].minDwellMinutes).toBeUndefined();
    // The trip out still leaves when class ends; the workout is what pushes the rest along.
    expect(formatClock(g.leaveAt!)).toBe("10:00 AM");
  });

  it("gym then library picks the nearest spot to PAC, which is not the nearest to the class", async () => {
    const [from, to] = longGap();
    const { resolve } = fixture(TABLE);
    const options = await priceGapOptions({ ...BASE, from, to, gym: gymPrefs(), resolve });
    // Dana Porter is nearest MC (3 min); Davis Centre is nearest PAC (4 min vs 9).
    expect(byId(options, "STUDY")!.stops[0].label).toBe("Dana Porter");
    expect(byId(options, "GYM_STUDY")!.stops[1].label).toBe("Davis Centre");
  });

  it("the top-level Gym button commits nothing until the fork is answered", async () => {
    const [from, to] = longGap();
    const { resolve } = fixture(TABLE);
    const options = await priceGapOptions({ ...BASE, from, to, gym: gymPrefs(), resolve });
    const gym = byId(options, "GYM")!;
    expect(gym.stops).toEqual([]);
    expect(gym.fits).toBe(true);
  });

  it("no gym options and no PAC route calls when the student does not work out", async () => {
    const [from, to] = longGap();
    const { resolve, calls } = fixture(TABLE);
    const options = await priceGapOptions({ ...BASE, from, to, gym: { enabled: false, durationMinutes: 60, preferredTime: "NONE" }, resolve });
    expect(options.filter((o) => o.kind === "GYM")).toEqual([]);
    expect(calls.filter((c) => c.includes("PAC"))).toEqual([]);
  });
});

describe("what does not fit says so, with the numbers", () => {
  it("a workout that cannot fit is offered but marked, and names the shortfall", async () => {
    const [from, to] = classesAt([h(9), h(10), "MC"], [h(11), h(12), "MC"]);
    const { resolve } = fixture(TABLE);
    const options = await priceGapOptions({ ...BASE, from, to, gym: gymPrefs({ durationMinutes: 90 }), resolve });
    // 60 min gap cannot hold a 90 min workout plus the buffer: never priced, never offered.
    expect(options.filter((o) => o.kind === "GYM")).toEqual([]);
  });

  it("the impossibility filter spends no route calls on what cannot happen", async () => {
    const [from, to] = classesAt([h(9), h(10), "MC"], [h(11), h(12), "MC"]);
    const { resolve, calls } = fixture(TABLE);
    await priceGapOptions({ ...BASE, from, to, gym: gymPrefs({ durationMinutes: 90 }), resolve });
    expect(calls.filter((c) => c.includes("PAC"))).toEqual([]);
  });

  it("an option whose route could not be fetched is withheld rather than given a made-up duration", async () => {
    const [from, to] = longGap();
    // No route home at all — the provider failed, so there is nothing honest to show.
    const { resolve } = fixture({ ...TABLE, "UW:MC->home": undefined as unknown as number });
    const options = await priceGapOptions({ ...BASE, from, to, gym: gymPrefs(), resolve });
    expect(byId(options, "REZ")).toBeUndefined();
    // Everything still offered carries real arithmetic.
    expect(options.every((o) => Number.isFinite(o.travelMinutes) && Number.isFinite(o.usableMinutes))).toBe(true);
  });

  it("a stay too short to be worth it is still offered, marked, and explains itself", async () => {
    // 35 minutes: enough to be analysed, not enough to make going home worth the walk.
    const [from, to] = classesAt([h(9), h(10), "MC"], [h(10, 35), h(11, 30), "MC"]);
    const { resolve } = fixture(TABLE);
    const options = await priceGapOptions({ ...BASE, from, to, gym: gymPrefs(), resolve });
    const rez = byId(options, "REZ")!;
    expect(rez.usableMinutes).toBe(1); // 35 - 12 - 12 - 10
    expect(rez.fits).toBe(true);
    expect(rez.reason).toMatch(/1 min at home/);
    // Offered, but the ladder will not star it.
    expect(recommendGapOption(options, CFG).recommended).not.toBe("REZ");
  });

  it("a library closed all day is not offered", async () => {
    // Labour Day: both libraries closed.
    const [from, to] = classesAt([h(9), h(10), "MC"], [h(14), h(15), "MC"]);
    const { resolve } = fixture(TABLE);
    const options = await priceGapOptions({ ...BASE, from, to, dateISO: "2026-09-07", gym: gymPrefs(), resolve });
    expect(byId(options, "STUDY")).toBeUndefined();
    expect(byId(options, "GYM_STUDY")).toBeUndefined();
  });

  it("a gap that ends after the library shuts does not offer it", async () => {
    // Dana Porter closes at 9pm; a gap from 9pm to 11pm cannot use it.
    const [from, to] = classesAt([h(20), h(21), "MC"], [h(23), h(23, 50), "MC"]);
    const { resolve } = fixture(TABLE);
    const options = await priceGapOptions({ ...BASE, from, to, gym: gymPrefs(), resolve });
    // Davis Centre is open until midnight, so it is the one that survives.
    expect(byId(options, "STUDY")?.stops[0].label).toBe("Davis Centre");
  });
});

describe("the ladder", () => {
  const opt = (id: GapOption["id"], fits: boolean, usableMinutes: number): GapOption => ({
    id, kind: id.startsWith("GYM") ? "GYM" : (id as GapOption["kind"]),
    gymThen: id === "GYM_REZ" ? "REZ" : id === "GYM_STUDY" ? "STUDY" : id === "GYM_CLASS" ? "CLASS" : undefined,
    stops: [], fits, usableMinutes, travelMinutes: 0,
    label: id, detail: "", reason: `${id} reason`, isEstimate: false, starred: false,
  });

  it("gym then rez wins when the workout fits and there is real time at home after", () => {
    const options = [opt("STAY", true, 240), opt("REZ", true, 200), opt("GYM_CLASS", true, 180), opt("GYM_REZ", true, 60)];
    expect(recommendGapOption(options, CFG).recommended).toBe("GYM_REZ");
  });

  it("falls to gym then library when the rez is too short after the workout", () => {
    const options = [opt("STAY", true, 240), opt("GYM_REZ", true, 5), opt("GYM_STUDY", true, 40), opt("GYM_CLASS", true, 180)];
    const rec = recommendGapOption(options, CFG);
    expect(rec.recommended).toBe("GYM_STUDY");
    expect(rec.considered[0]).toMatchObject({ id: "GYM_REZ", met: false });
    expect(rec.considered[0].reason).toMatch(/Only 5 min at home/);
  });

  it("falls to gym then class when neither second stop is worth it", () => {
    const options = [opt("STAY", true, 240), opt("GYM_REZ", true, 5), opt("GYM_STUDY", true, 4), opt("GYM_CLASS", true, 90)];
    expect(recommendGapOption(options, CFG).recommended).toBe("GYM_CLASS");
  });

  it("with no gym, the rez is the first rung", () => {
    const options = [opt("STAY", true, 240), opt("REZ", true, 200), opt("STUDY", true, 100)];
    expect(recommendGapOption(options, CFG).recommended).toBe("REZ");
  });

  it("the library wins when the rez is not worth the trip", () => {
    const options = [opt("STAY", true, 90), opt("REZ", true, 12), opt("STUDY", true, 60)];
    const rec = recommendGapOption(options, CFG);
    expect(rec.recommended).toBe("STUDY");
    expect(rec.considered.find((c) => c.id === "REZ")).toMatchObject({ met: false });
  });

  it("minUsefulStudyMinutes is the only thing between the library and staying put", () => {
    const just = [opt("STAY", true, 40), opt("STUDY", true, CFG.minUsefulStudyMinutes)];
    const under = [opt("STAY", true, 40), opt("STUDY", true, CFG.minUsefulStudyMinutes - 1)];
    expect(recommendGapOption(just, CFG).recommended).toBe("STUDY");
    expect(recommendGapOption(under, CFG).recommended).toBe("STAY");
  });

  it("an option that does not fit is never recommended, whatever its usable minutes say", () => {
    const options = [opt("STAY", true, 90), opt("REZ", false, 200)];
    expect(recommendGapOption(options, CFG).recommended).toBe("STAY");
  });

  it("stars the winner, and the top-level Gym button wears its fork's star", () => {
    const options = [opt("STAY", true, 240), opt("GYM", true, 60), opt("GYM_REZ", true, 60), opt("REZ", true, 200)];
    recommendGapOption(options, CFG);
    expect(options.filter((o) => o.starred).map((o) => o.id).sort()).toEqual(["GYM", "GYM_REZ"]);
  });

  it("records every rung it passed over", () => {
    const options = [opt("STAY", true, 30), opt("REZ", true, 5), opt("STUDY", true, 4)];
    const rec = recommendGapOption(options, CFG);
    expect(rec.considered.map((c) => c.id)).toEqual(["REZ", "STUDY", "STAY"]);
    expect(rec.considered.map((c) => c.met)).toEqual([false, false, true]);
  });
});

describe("the card's numbers are the timeline's numbers", () => {
  it("the chosen option's legs use the clock the itinerary will carry", async () => {
    const [from, to] = longGap();
    const { resolve, calls } = fixture(TABLE);
    const options = await priceGapOptions({ ...BASE, from, to, gym: gymPrefs(), resolve });
    const rez = byId(options, "REZ")!;
    // The trip out sets off when class ends, which is exactly what buildItinerary gives the leg.
    expect(rez.leaveAt!.getTime()).toBe(from.end.getTime());
    // And the way back lands no later than the buffer before the next class.
    expect(minutesBetween(rez.arriveBackAt!, to.start)).toBeGreaterThanOrEqual(CFG.arrivalBufferMinutes);
    expect(calls.length).toBeGreaterThan(0);
  });
});
