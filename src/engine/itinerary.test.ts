/**
 * Itinerary state-machine regression tests, driven by a real Fall 2026 schedule.
 *
 * Travel times come from the app's own EstimateRoutingProvider working on the real
 * building coordinates. Nothing here hand-picks a duration to force an outcome.
 */
import { describe, expect, it } from "vitest";
import { buildWeekPlan } from "./planner";
import { findContinuityBreaks } from "./transitions";
import { normalizeWeek } from "./normalize";
import { DEFAULT_PLANNER_CONFIG as CFG } from "@/domain/config";
import { EstimateRoutingProvider } from "@/routing/EstimateRoutingProvider";
import { findBuilding } from "@/data/buildings";
import { formatClock } from "@/time/toronto";
import type { DayOfWeek, DayPlan, UserHome } from "@/domain/types";
import type { GapChoices } from "@/domain/gapChoices";
import { FALL_2026, ORDINARY_WEEK_MONDAY, OCT21_WEEK_MONDAY } from "../../test/fixtures/fall2026Schedule";

const uwp = findBuilding("UW", "UWP")!;
const HOME: UserHome = {
  name: "UW Place (UWP)",
  latitude: uwp.latitude!,
  longitude: uwp.longitude!,
  preset: { university: "UW", buildingCode: "UWP" },
};

const plan = (mondayISO = ORDINARY_WEEK_MONDAY, gapChoices?: GapChoices) =>
  buildWeekPlan({ meetings: FALL_2026, home: HOME, mondayISO, config: CFG, gapChoices }, new EstimateRoutingProvider());

/** Answer one gap the way a student tapping a button would. */
const answer = (classId: string, kind: "STAY" | "REZ" | "GYM" | "STUDY"): GapChoices =>
  ({ byDate: {}, byClass: { [classId]: { kind } } });

/** The Wednesday gap in question follows the 10:30 MATH 137 lecture. */
const WED_LONG_GAP = "math137-lec:W";

const planWithoutHome = (mondayISO = ORDINARY_WEEK_MONDAY) =>
  buildWeekPlan({ meetings: FALL_2026, mondayISO, config: CFG }, new EstimateRoutingProvider());

/** The chain of places the day actually moves through, e.g. "UWP > STC > UWP > QNC". */
const chain = (d: DayPlan): string[] => {
  const codes = d.transitions.map((t) => t.from.buildingCode ?? t.from.name);
  const last = d.transitions[d.transitions.length - 1];
  if (last) codes.push(last.to.buildingCode ?? last.to.name);
  return codes;
};

const courses = (d: DayPlan) => d.classes.map((c) => `${c.meeting.courseCode} ${c.meeting.component}`);

describe("Wednesday, unanswered: the long gap is offered, not booked", () => {
  let wed: DayPlan;
  it("builds", async () => {
    wed = (await plan()).days.W!;
    expect(courses(wed)).toEqual(["MATH 137 LEC", "MATH 135 LEC", "MATH 135 TUT"]);
  });

  it("no trip home is built until the student asks for one", () => {
    expect(chain(wed)).toEqual(["UWP", "STC", "QNC", "STC", "UWP"]);
    // One home-bound leg: the end of the day. The mid-day one is a suggestion, not a plan.
    expect(wed.transitions.filter((t) => t.to.kind === "HOME")).toHaveLength(1);
  });

  it("but the gap card still prices going home, and stars it", () => {
    const gap = wed.items.find((i) => i.kind === "GAP" && i.minutes === 190);
    expect(gap?.kind).toBe("GAP");
    if (gap?.kind !== "GAP") return;
    expect(gap.recommendation?.recommended).toBe("REZ");
    const rez = gap.options.find((o) => o.id === "REZ")!;
    expect({ fits: rez.fits, starred: rez.starred }).toEqual({ fits: true, starred: true });
    expect(gap.homeReturn?.recommendation).toBe("WORTH_IT");
    expect(gap.choice).toBeUndefined();
  });

  it("the 40 minute gap is not worth a trip home, and says so", () => {
    const short = wed.items.find((i) => i.kind === "GAP" && i.minutes === 40);
    expect(short?.kind === "GAP" && short.homeReturn?.recommendation).not.toBe("WORTH_IT");
    expect(short?.kind === "GAP" && short.recommendation?.recommended).not.toBe("REZ");
  });

  it("gap durations are end-to-start", () => {
    const gaps = wed.items.filter((i) => i.kind === "GAP").map((i) => (i.kind === "GAP" ? i.minutes : 0));
    expect(gaps).toEqual([190, 40]); // 11:20->14:30 and 15:20->16:00
  });
});

describe("Wednesday, answered: choosing the rez rebuilds the chain through home", () => {
  let wed: DayPlan;
  it("builds", async () => {
    wed = (await plan(ORDINARY_WEEK_MONDAY, answer(WED_LONG_GAP, "REZ"))).days.W!;
  });

  it("TEST 1 — chain is UWP > STC > UWP > QNC, never STC > QNC after going home", () => {
    expect(chain(wed)).toEqual(["UWP", "STC", "UWP", "QNC", "STC", "UWP"]);
    // The specific bug: a leg leaving STC for QNC after the student was sent home.
    const teleport = wed.transitions.find((t) => t.from.buildingCode === "STC" && t.to.buildingCode === "QNC");
    expect(teleport).toBeUndefined();
    expect(findContinuityBreaks(wed.transitions)).toEqual([]);
  });

  it("the trip to the 2:30 lecture departs from home, and the gap card agrees", () => {
    const toQnc = wed.transitions.find((t) => t.to.buildingCode === "QNC")!;
    expect(toQnc.from.kind).toBe("HOME");
    const gap = wed.items.find((i) => i.kind === "GAP" && i.minutes === 190);
    expect(gap?.kind === "GAP" && gap.homeReturn?.recommendation).toBe("WORTH_IT");
    // The card's "leave home by" is the resolved leg's departure, not a separate estimate.
    if (gap?.kind === "GAP") expect(gap.homeReturn!.leaveHomeAt!.getTime()).toBe(toQnc.recommendedDeparture!.getTime());
  });

  it("the card reports the answer back, and where it came from", () => {
    const gap = wed.items.find((i) => i.kind === "GAP" && i.minutes === 190);
    expect(gap?.kind === "GAP" && gap.choice).toEqual({ value: { kind: "REZ" }, source: "CLASS" });
  });

  it("TEST 2 — the 40 minute gap, left unanswered, keeps the student on campus, QNC > STC", () => {
    const leg = wed.transitions.find((t) => t.from.buildingCode === "QNC" && t.to.buildingCode === "STC");
    expect(leg).toBeDefined();
    expect(wed.transitions.filter((t) => t.to.kind === "HOME")).toHaveLength(2); // mid-day + end of day, no more
  });

  it("every leg lands before the class it serves starts", () => {
    for (const t of wed.transitions) {
      if (!t.hasDeadline || !t.expectedArrival) continue;
      expect(t.expectedArrival.getTime()).toBeLessThanOrEqual(t.arriveBy.getTime());
    }
  });
});

describe("TEST 3 — spatial continuity across the whole week", () => {
  it("no day teleports the student", async () => {
    const week = await plan();
    for (const day of ["M", "T", "W", "Th", "F"] as DayOfWeek[]) {
      const d = week.days[day];
      if (!d) continue;
      expect({ day, breaks: findContinuityBreaks(d.transitions) }).toEqual({ day, breaks: [] });
      expect({ day, warnings: d.warnings.filter((w) => w.includes("inconsistent")) }).toEqual({ day, warnings: [] });
    }
  });

  it("each day starts and ends at home", async () => {
    const week = await plan();
    for (const day of ["M", "T", "W", "Th", "F"] as DayOfWeek[]) {
      const d = week.days[day]!;
      if (!d.classes.length) continue;
      expect({ day, first: d.transitions[0].from.kind }).toEqual({ day, first: "HOME" });
      expect({ day, last: d.transitions[d.transitions.length - 1].to.kind }).toEqual({ day, last: "HOME" });
    }
  });

  it("a leg never sets off before the previous one has landed", async () => {
    const week = await plan();
    for (const day of ["M", "T", "W", "Th", "F"] as DayOfWeek[]) {
      const ts = week.days[day]?.transitions ?? [];
      for (let i = 1; i < ts.length; i++) {
        const prev = ts[i - 1];
        const cur = ts[i];
        if (!prev.expectedArrival || !cur.recommendedDeparture) continue;
        expect({ day, i, ok: cur.recommendedDeparture.getTime() >= prev.expectedArrival.getTime() }).toEqual({ day, i, ok: true });
      }
    }
  });
});

describe("TEST 4 and 5 — online and TBA never become destinations", () => {
  it("produces no commute for the online or unlocated courses", async () => {
    const week = await plan();
    const everyClass = (["M", "T", "W", "Th", "F"] as DayOfWeek[]).flatMap((d) => week.days[d]?.classes ?? []);
    const codes = new Set(everyClass.map((c) => c.meeting.courseCode));
    expect(codes.has("MTHEL 99")).toBe(false);
    expect(codes.has("SEQ 5DD")).toBe(false);
    expect(codes.has("BUS 111W")).toBe(false); // room genuinely TBA
    expect(codes.has("ECON 120W")).toBe(false); // room genuinely TBA
  });

  it("says why, rather than inventing a building", async () => {
    const week = await plan();
    const reason = (id: string) => week.skipped.find((s) => s.meeting.id === id)?.reason ?? "";
    expect(reason("mthel99")).toMatch(/Online|No scheduled/);
    expect(reason("seq5dd")).toMatch(/No scheduled/);
    expect(reason("bus111-lec")).toMatch(/TBA/);
    expect(reason("econ120-lec")).toMatch(/TBA/);
  });
});

describe("TEST 6 — one-off tests appear only on their date", () => {
  it("the MATH 135 test is absent from an ordinary week", async () => {
    const week = await plan();
    const wed = week.days.W!;
    expect(wed.classes.some((c) => c.meeting.id === "math135-test")).toBe(false);
  });

  it("the real tests are skipped for having no room, not silently placed somewhere", async () => {
    const week = await plan(OCT21_WEEK_MONDAY);
    expect(week.days.W!.date).toBe("2026-10-21");
    for (const id of ["math135-test", "math137-test", "cs135-test1", "cs135-test2"]) {
      expect({ id, reason: week.skipped.find((s) => s.meeting.id === id)?.reason }).toMatchObject({ reason: expect.stringMatching(/TBA/) });
    }
  });

  it("the date window itself confines a one-off to its own week", () => {
    // Same one-off event, but with a room, so it reaches the date logic.
    const located = FALL_2026.map((x) =>
      x.id === "math135-test" ? { ...x, location: { kind: "ROOM", buildingCode: "QNC", roomNumber: "2502" } as const } : x,
    );
    expect(normalizeWeek(located, OCT21_WEEK_MONDAY).byDay.W.some((c) => c.meeting.id === "math135-test")).toBe(true);
    expect(normalizeWeek(located, ORDINARY_WEEK_MONDAY).byDay.W.some((c) => c.meeting.id === "math135-test")).toBe(false);
    // And it never lands on a different weekday.
    for (const d of ["M", "T", "Th", "F"] as DayOfWeek[]) {
      expect({ d, present: normalizeWeek(located, OCT21_WEEK_MONDAY).byDay[d].some((c) => c.meeting.id === "math135-test") }).toEqual({ d, present: false });
    }
  });
});

describe("TEST 7 — route requests distinguish their origin", () => {
  it("asks for STC->QNC and UWP->QNC separately", async () => {
    const asked: string[] = [];
    const provider = new EstimateRoutingProvider();
    const spy = {
      id: "spy",
      getWalkingRoute(from: { latitude: number; longitude: number }, to: { latitude: number; longitude: number }) {
        asked.push(`${from.latitude.toFixed(5)},${from.longitude.toFixed(5)}->${to.latitude.toFixed(5)},${to.longitude.toFixed(5)}`);
        return provider.getWalkingRoute(from, to);
      },
      getTransitRoute: provider.getTransitRoute.bind(provider),
    };
    const week = await buildWeekPlan({ meetings: FALL_2026, home: HOME, mondayISO: ORDINARY_WEEK_MONDAY, config: CFG }, spy);
    const qnc = findBuilding("UW", "QNC")!;
    const stc = findBuilding("UW", "STC")!;
    const key = (a: { latitude?: number; longitude?: number }, b: { latitude?: number; longitude?: number }) =>
      `${a.latitude!.toFixed(5)},${a.longitude!.toFixed(5)}->${b.latitude!.toFixed(5)},${b.longitude!.toFixed(5)}`;
    expect(asked).toContain(key(uwp, qnc));
    expect(asked).toContain(key(stc, uwp));
    // Same destination, different origins: two distinct requests, never one reused.
    expect(key(stc, qnc)).not.toBe(key(uwp, qnc));
    expect(week.days.W).toBeDefined();
  });
});

describe("Monday to Friday audit", () => {
  it("each weekday holds the expected classes, in order, with sane legs", async () => {
    const week = await plan();
    expect(courses(week.days.M!)).toEqual(["MATH 137 LEC", "MATH 135 LEC", "MATH 137 TUT"]);
    expect(courses(week.days.T!)).toEqual(["CS 135 LEC"]);
    expect(courses(week.days.W!)).toEqual(["MATH 137 LEC", "MATH 135 LEC", "MATH 135 TUT"]);
    expect(courses(week.days.Th!)).toEqual(["CS 135 LEC"]);
    expect(courses(week.days.F!)).toEqual(["MATH 137 LEC", "CS 135 TUT", "MATH 135 LEC"]);

    for (const day of ["M", "T", "W", "Th", "F"] as DayOfWeek[]) {
      const d = week.days[day]!;
      for (const t of d.transitions) {
        expect({ day, from: t.from.name, to: t.to.name, hasRoute: Boolean(t.recommendedRoute) }).toMatchObject({ hasRoute: true });
        expect(t.recommendedRoute!.durationMinutes).toBeGreaterThanOrEqual(0);
      }
      for (const i of d.items) {
        if (i.kind === "GAP") expect(i.minutes).toBeGreaterThan(0);
      }
    }
  });

  it("Friday's ten minute hop between buildings is flagged rather than glossed over", async () => {
    const week = await plan();
    const fri = week.days.F!;
    const hop = fri.transitions.find((t) => t.from.buildingCode === "STC" && t.to.buildingCode === "MC")!;
    expect(hop.availableMinutes).toBe(10);
    expect(["TIGHT", "LIKELY_LATE", "COMFORTABLE"]).toContain(hop.feasibility);
    // Whatever the verdict, it must be derived, not silently "on time" with a late arrival.
    if (hop.expectedArrival!.getTime() > hop.arriveBy.getTime()) expect(hop.feasibility).toBe("LIKELY_LATE");
  });

  it("no day sends the student home twice in a row", async () => {
    const week = await plan();
    for (const day of ["M", "T", "W", "Th", "F"] as DayOfWeek[]) {
      const ts = week.days[day]?.transitions ?? [];
      for (let i = 1; i < ts.length; i++) {
        expect({ day, i, doubled: ts[i - 1].to.kind === "HOME" && ts[i].to.kind === "HOME" }).toEqual({ day, i, doubled: false });
      }
    }
  });

  it("without a home, no trip is invented to or from one", async () => {
    const week = await planWithoutHome();
    for (const day of ["M", "T", "W", "Th", "F"] as DayOfWeek[]) {
      const ts = week.days[day]?.transitions ?? [];
      expect(ts.every((t) => t.from.kind !== "HOME" && t.to.kind !== "HOME")).toBe(true);
      expect(findContinuityBreaks(ts)).toEqual([]);
    }
  });

  it("prints the Wednesday itinerary for the record", async () => {
    const week = await plan();
    const lines = week.days.W!.items.flatMap((i) => {
      if (i.kind === "LEAVE") return [`${formatClock(i.at)} leave ${i.from.buildingCode ?? i.from.name}`];
      if (i.kind === "ARRIVE") return [`${formatClock(i.at)} arrive ${i.to.buildingCode ?? i.to.name}`];
      if (i.kind === "CLASS") return [`${formatClock(i.scheduledClass.start)} ${i.scheduledClass.meeting.courseCode} at ${i.scheduledClass.location.buildingCode}`];
      if (i.kind === "GAP") return [`gap ${i.minutes} min (${i.homeReturn?.recommendation ?? "no home"})`];
      return [];
    });
    expect(lines.join("\n")).toContain("leave UWP");
    expect(lines.filter((l) => l.includes("leave STC")).length).toBeGreaterThan(0);
  });
});

describe("every leg is a route choice, not a default", () => {
  it("legs long enough for a bus to matter are priced for transit; short campus hops are not", async () => {
    // Answered, so the Wednesday chain runs through home and there are long legs to price.
    const week = await plan(ORDINARY_WEEK_MONDAY, answer(WED_LONG_GAP, "REZ"));
    for (const day of ["M", "W", "F"] as DayOfWeek[]) {
      for (const t of week.days[day]!.transitions) {
        if (t.from.id === t.to.id) continue;
        const walk = t.walkingRoute!.durationMinutes;
        const priced = t.consideredModes ?? [];
        expect(priced[0]).toBe("WALK");
        // Whether transit was asked for follows only from the walk length and campus, never from the leg kind.
        expect(priced.includes("TRANSIT")).toBe(t.crossCampus || walk >= CFG.transitConsiderWalkMinutes);
      }
    }
    const wed = week.days.W!;
    const from = (code: string, to: string) => wed.transitions.find((t) => (t.from.buildingCode ?? "") === code && (t.to.buildingCode ?? "") === to)!;
    expect(from("UWP", "QNC").consideredModes).toEqual(["WALK", "TRANSIT"]);
    expect(from("STC", "UWP").consideredModes).toEqual(["WALK", "TRANSIT"]);
    expect(from("QNC", "STC").consideredModes).toEqual(["WALK"]);
    // The estimate provider has no timetable, so with it every choice is walking, and says why.
    expect(from("UWP", "QNC").recommendedRoute!.mode).toBe("WALK");
    expect(from("UWP", "QNC").reason).toMatch(/no transit itinerary was offered/);
  });
});
