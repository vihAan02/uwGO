import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CampusLocation, ClassTransition, DayOfWeek, DayPlan, RouteOption, ScheduledClass } from "@/domain/types";
import type { NextUp } from "@/lib/nextClass";
import { legFocus, type PlanFocus } from "@/lib/planFocus";
import { PEEK_BLOCK, TripSummary, leaveParts, warningFor } from "./TripSummary";

/** September in Waterloo is UTC-4; the 15th is a Tuesday. */
const TUE = "2026-09-15";
const at = (hhmm: string, date = TUE) => new Date(`${date}T${hhmm}:00-04:00`);
const place = (code: string): CampusLocation => ({ id: code, name: `${code} building`, latitude: 43.47, longitude: -80.54, kind: "BUILDING", buildingCode: code });
const walk = (minutes: number, over: Partial<RouteOption> = {}): RouteOption => ({ mode: "WALK", durationMinutes: minutes, polyline: `walk-${minutes}`, provider: "google-routes", computedAt: "", isEstimate: false, ...over });

function scheduled(id: string, code: string, building: string, start: string, end: string, day: DayOfWeek = "T"): ScheduledClass {
  return {
    id, day, date: TUE, start: at(start), end: at(end), location: place(building),
    meeting: { id, university: "UW", courseCode: code, component: "LEC", days: [day], start: 0, end: 0, location: { kind: "ROOM", buildingCode: building, roomNumber: "1001" }, source: "QUEST", includeInPlan: true },
    room: { raw: `${building} 1001`, buildingCode: building, roomNumber: "1001", floor: "unknown", resolved: true },
  };
}

const math = scheduled("math:T", "MATH 137", "MC", "10:30", "11:20");
const cs = scheduled("cs:T", "CS 135", "DC", "13:00", "14:20");
const toCs: ClassTransition = {
  id: "math->cs", kind: "CLASS_TO_CLASS", from: math.location, to: cs.location, departAfter: at("11:20"), arriveBy: at("13:00"), hasDeadline: true, availableMinutes: 100,
  walkingRoute: walk(8), indoorRoute: walk(11, { polyline: "tunnel", indoorPath: ["MC", "DC"] }), recommendedRoute: walk(8), recommendedDeparture: at("12:42"), expectedArrival: at("12:50"),
  feasibility: "COMFORTABLE", crossCampus: false,
};
const tuesday: DayPlan = {
  day: "T", date: TUE, classes: [math, cs], transitions: [toCs], warnings: [], gym: [],
  items: [{ kind: "CLASS", scheduledClass: math }, { kind: "LEAVE", at: at("12:42"), from: math.location, transition: toCs }, { kind: "CLASS", scheduledClass: cs }],
};
const wednesday: DayPlan = { day: "W", date: "2026-09-16", classes: [], transitions: [], warnings: [], gym: [], items: [] };
const upcoming: NextUp = { status: "UPCOMING", scheduledClass: cs, transition: toCs, day: tuesday };

const dayFocus: PlanFocus = { source: "DAY", choices: [], selection: { kind: "DAY", label: "Tuesday", stops: [] } };
const render = (over: Partial<Parameters<typeof TripSummary>[0]>) => renderToStaticMarkup(createElement(TripSummary, {
  focus: dayFocus, next: { status: "NONE" }, day: tuesday, now: at("09:00"), loading: false, onChoose: () => {}, onShowDay: () => {}, ...over,
}));

describe("the summary at the top of the planner sheet", () => {
  it("reserves the same peek block for every kind of summary, so neither the peek line nor the map above it moves with the focus", () => {
    const kinds = [
      render({ loading: true }),
      render({}),
      render({ focus: legFocus(toCs, "best", 10, "NEXT")!, next: upcoming, onStart: () => {} }),
      render({ focus: { id: "class:cs:T", source: "PICKED", scheduledClass: cs, choices: [], selection: { kind: "PLACE", label: "CS 135", at: cs.location } }, onClear: () => {} }),
      render({ focus: { id: "quick-home", source: "PICKED", choices: [], selection: { kind: "LEG", label: "", from: math.location, to: place("V1"), route: walk(12) } }, onClear: () => {} }),
    ];
    for (const html of kinds) {
      const blocks = html.match(/<div[^>]*data-sheet-peek[^>]*>/g) ?? [];
      expect(blocks).toHaveLength(1);
      expect(blocks[0]).toContain(PEEK_BLOCK);
    }
  });

  it("shows how long the trip takes inside the peek, with the ways to go below it", () => {
    const html = render({ focus: legFocus(toCs, "best", 10, "NEXT")!, next: upcoming, onStart: () => {} });
    const tail = html.indexOf("data-sheet-tail");
    const travel = html.indexOf("8 min walk · arrive 12:50 PM");
    expect(travel).toBeGreaterThan(-1);
    expect(travel).toBeLessThan(tail);
    expect(html.indexOf('data-slot="segmented-control"')).toBeGreaterThan(tail);
    // The mode icon beside the words is decoration.
    expect(html).not.toMatch(/aria-label="(Walk|Indoors|Bus)"/);
  });

  it("while in class, points at the class after it: never at the class in progress, never 'last class' with one to come", () => {
    const inMath: NextUp = { status: "IN_CLASS", scheduledClass: math, day: tuesday, upNext: { scheduledClass: cs, day: tuesday } };
    const today = render({ next: inMath, now: at("11:00") });
    expect(today).toContain("then CS 135 at 1:00 PM");
    expect(today).not.toContain("your last class today");
    const browsing = render({ next: inMath, day: wednesday, now: at("11:00") });
    expect(browsing).toContain("Next class: CS 135");
    expect(browsing).not.toContain("Next class: MATH 137");
  });

  it("says Leave now once the leave time has gone, and what leaving now costs", () => {
    expect(leaveParts(at("12:42"), at("12:30"))).toMatchObject({ lead: "Leave in", tone: "ink" });
    expect(leaveParts(at("12:42"), at("12:50"))).toEqual({ value: "Leave now", tone: "warn" });
    const focus = legFocus(toCs, "best", 10, "NEXT")!;
    expect(warningFor(focus, at("12:55"))).toEqual({ text: "Leaving now, you'd arrive about 3 min late", tone: "bad" });
    expect(warningFor(focus, at("12:45"))).toBeUndefined();
  });
});
