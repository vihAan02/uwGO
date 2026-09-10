/**
 * A gap holds an ordered list of stops, and the chain that follows from it.
 *
 * These pin the structural contract `buildItinerary` owes the planner: N stops give N+1 legs,
 * every leg sets off where the last one landed, the dwell owed at a stop rides on the leg that
 * *leaves* it, and leg ids stay stable so a reminder survives a rebuild.
 */
import { describe, expect, it } from "vitest";
import type { CampusLocation, CourseMeeting, GapStop, ScheduledClass } from "@/domain/types";
import { buildingLocation, findBuilding } from "@/data/buildings";
import { buildItinerary, buildTransitions, findContinuityBreaks } from "./transitions";
import { normalizeWeek } from "./normalize";

const loc = (code: string): CampusLocation => buildingLocation(findBuilding("UW", code)!)!;
const PAC = loc("PAC");
const LIB = loc("LIB");
const HOME: CampusLocation = { id: "home", name: "UW Place", latitude: 43.5303, longitude: -80.5372, kind: "HOME" };

const h = (hh: number, mm = 0) => hh * 60 + mm;
const MONDAY = "2026-09-14";
const WED = "2026-09-16";

let n = 0;
const meeting = (start: number, end: number, building: string): CourseMeeting => ({
  id: `m${++n}`, university: "UW", courseCode: `CS ${100 + n}`, component: "LEC", days: ["W"], start, end,
  location: { kind: "ROOM", buildingCode: building, roomNumber: "1001" }, source: "MANUAL", includeInPlan: true,
});

/** Two classes on the Wednesday with a long gap between them: 10:00 at MC, 2:00 at DC. */
const twoClasses = (): ScheduledClass[] =>
  normalizeWeek([meeting(h(9), h(10), "MC"), meeting(h(14), h(15), "DC")], MONDAY).byDay.W;

const stop = (purpose: GapStop["purpose"], at: CampusLocation, label: string, minDwellMinutes?: number): GapStop =>
  ({ purpose, at, label, minDwellMinutes });

const places = (legs: { from: CampusLocation; to: CampusLocation }[]) => {
  const out = legs.map((l) => l.from.buildingCode ?? l.from.name);
  const last = legs[legs.length - 1];
  if (last) out.push(last.to.buildingCode ?? last.to.name);
  return out;
};

describe("N stops give N+1 legs, and the chain never breaks", () => {
  it("no stops: one leg straight to the next class", () => {
    const classes = twoClasses();
    const legs = buildItinerary(classes, undefined, new Map(), WED);
    expect(places(legs)).toEqual(["MC", "DC"]);
    expect(legs).toHaveLength(1);
    expect(findContinuityBreaks(legs)).toEqual([]);
    // Even a gap nobody stops in is tagged, so the emitter can find its leg by gap alone.
    expect(legs[0].gapIndex).toBe(0);
    expect(legs[0].gapLeg).toBe(0);
  });

  it("one stop: two legs, out and back", () => {
    const classes = twoClasses();
    const legs = buildItinerary(classes, undefined, new Map([[0, [stop("STUDY", LIB, "Dana Porter")]]]), WED);
    expect(places(legs)).toEqual(["MC", "LIB", "DC"]);
    expect(legs).toHaveLength(2);
    expect(findContinuityBreaks(legs)).toEqual([]);
    expect(legs.map((l) => l.gapLeg)).toEqual([0, 1]);
  });

  it("two stops: three legs, PAC then home to shower, then class", () => {
    const classes = twoClasses();
    const legs = buildItinerary(classes, HOME, new Map([[0, [stop("GYM", PAC, "PAC", 60), stop("REZ", HOME, "home")]]]), WED);
    // The day still opens and closes at home, so the gap legs sit in the middle.
    expect(places(legs)).toEqual(["UW Place", "MC", "PAC", "UW Place", "DC", "UW Place"]);
    expect(findContinuityBreaks(legs)).toEqual([]);
    const gap = legs.filter((l) => l.gapIndex === 0);
    expect(gap).toHaveLength(3);
    expect(gap.map((l) => l.gapLeg)).toEqual([0, 1, 2]);
    expect(gap.map((l) => l.kind)).toEqual(["CLASS_TO_STOP", "STOP_TO_STOP", "STOP_TO_CLASS"]);
  });
});

describe("the dwell owed at a stop rides on the leg that leaves it", () => {
  it("a 60-minute workout is owed by the leg departing PAC, not the one arriving", () => {
    const classes = twoClasses();
    const legs = buildItinerary(classes, undefined, new Map([[0, [stop("GYM", PAC, "PAC", 60)]]]), WED);
    const [toPac, fromPac] = legs;
    expect(toPac.to.buildingCode).toBe("PAC");
    expect(toPac.dwellMinutes).toBeUndefined();
    expect(fromPac.from.buildingCode).toBe("PAC");
    expect(fromPac.dwellMinutes).toBe(60);
  });

  it("a stop with no dwell owes nothing", () => {
    const classes = twoClasses();
    const legs = buildItinerary(classes, undefined, new Map([[0, [stop("STUDY", LIB, "Dana Porter")]]]), WED);
    expect(legs.map((l) => l.dwellMinutes)).toEqual([undefined, undefined]);
  });

  it("with two stops the workout is owed by the PAC->home leg and nothing is owed leaving home", () => {
    const classes = twoClasses();
    const legs = buildItinerary(classes, HOME, new Map([[0, [stop("GYM", PAC, "PAC", 60), stop("REZ", HOME, "home")]]]), WED);
    const gap = legs.filter((l) => l.gapIndex === 0);
    expect(gap.map((l) => l.dwellMinutes)).toEqual([undefined, 60, undefined]);
  });
});

describe("leg ids name what the leg joins, so a reminder survives a rebuild", () => {
  it("ids are derived from the stops, not from an ordinal", () => {
    const classes = twoClasses();
    const legs = buildItinerary(classes, undefined, new Map([[0, [stop("GYM", PAC, "PAC", 60), stop("STUDY", LIB, "Dana Porter")]]]), WED);
    expect(legs.map((l) => l.id)).toEqual([
      `${classes[0].id}->${PAC.id}`,
      `${PAC.id}->${LIB.id}`,
      `${LIB.id}->${classes[1].id}`,
    ]);
  });

  it("two identical builds produce identical ids", () => {
    const classes = twoClasses();
    const stops = new Map([[0, [stop("GYM", PAC, "PAC", 60), stop("REZ", HOME, "home")]]]);
    const a = buildItinerary(classes, HOME, stops, WED).map((l) => l.id);
    const b = buildItinerary(classes, HOME, stops, WED).map((l) => l.id);
    expect(a).toEqual(b);
  });

  it("changing the first stop leaves the last leg's id alone", () => {
    const classes = twoClasses();
    const viaPac = buildItinerary(classes, undefined, new Map([[0, [stop("GYM", PAC, "PAC", 60), stop("STUDY", LIB, "x")]]]), WED);
    const viaHome = buildItinerary(classes, HOME, new Map([[0, [stop("REZ", HOME, "home"), stop("STUDY", LIB, "x")]]]), WED);
    const lastOf = (legs: { id: string; gapIndex?: number; gapLeg?: number }[]) =>
      legs.find((l) => l.gapIndex === 0 && l.gapLeg === 2)!.id;
    expect(lastOf(viaPac)).toBe(lastOf(viaHome));
  });
});

describe("the day's bookends are not gap legs", () => {
  it("home->first and last->home carry no gap index", () => {
    const classes = twoClasses();
    const legs = buildItinerary(classes, HOME, new Map(), WED);
    expect(legs[0].kind).toBe("HOME_TO_CLASS");
    expect(legs[0].gapIndex).toBeUndefined();
    const last = legs[legs.length - 1];
    expect(last.kind).toBe("CLASS_TO_HOME");
    expect(last.gapIndex).toBeUndefined();
  });

  it("buildTransitions is still the plain academic chain", () => {
    const classes = twoClasses();
    const ts = buildTransitions(classes, HOME, WED);
    expect(ts.map((t) => t.kind)).toEqual(["HOME_TO_CLASS", "CLASS_TO_CLASS", "CLASS_TO_HOME"]);
  });
});
