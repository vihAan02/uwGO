import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createElement, isValidElement, type ComponentProps, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CampusLocation, ClassTransition, DayPlan, RouteOption, ScheduledClass } from "@/domain/types";
import { RemindersProvider } from "@/lib/useReminders";
import { classRowId, legRowId } from "@/lib/planFocus";
import { routeChoices } from "@/lib/routeChoices";
import { ClassRow, DayTimeline, LeaveRow, legTitle } from "./DayTimeline";

type El = ReactElement<{ children?: ReactNode; onClick?: (e: unknown) => void; type?: string; "aria-label"?: string; "aria-current"?: string }>;

/** Expands hook-free components into host elements, so a handler can be called the way a click calls it. */
function expand(node: ReactNode): ReactNode {
  if (Array.isArray(node)) return node.map(expand);
  if (!isValidElement(node)) return node;
  const el = node as El;
  if (typeof el.type === "function") return expand((el.type as (p: unknown) => ReactNode)(el.props));
  return { ...el, props: { ...el.props, children: expand(el.props.children) } } as El;
}

function buttons(node: ReactNode): El[] {
  if (Array.isArray(node)) return node.flatMap(buttons);
  if (!isValidElement(node)) return [];
  const el = node as El;
  return [...(el.type === "button" ? [el] : []), ...buttons(el.props.children)];
}

const at = (hhmm: string) => new Date(`2026-09-15T${hhmm}:00-04:00`);
const place = (code: string, kind: CampusLocation["kind"] = "BUILDING"): CampusLocation => ({ id: code, name: kind === "HOME" ? "Village 1" : `${code} building`, latitude: 43.47, longitude: -80.54, kind, buildingCode: kind === "BUILDING" ? code : undefined });
const walk = (minutes: number): RouteOption => ({ mode: "WALK", durationMinutes: minutes, polyline: `walk-${minutes}`, provider: "google-routes", computedAt: "", isEstimate: false });

function scheduled(id: string, code: string, building: string, room: string, start: string, end: string, component: ScheduledClass["meeting"]["component"] = "LEC"): ScheduledClass {
  return {
    id, day: "T", date: "2026-09-15", start: at(start), end: at(end), location: place(building),
    meeting: { id, university: "UW", courseCode: code, component, days: ["T"], start: 0, end: 0, location: { kind: "ROOM", buildingCode: building, roomNumber: room }, source: "QUEST", includeInPlan: true },
    room: { raw: `${building} ${room}`, buildingCode: building, roomNumber: room, floor: "unknown", resolved: true },
  };
}

const home = place("home", "HOME");
const math = scheduled("math:T", "MATH 137", "STC", "0010", "10:30", "11:20");
const cs = scheduled("cs:T", "CS 135", "MC", "4020", "11:30", "12:20", "TUT");
const toMath: ClassTransition = {
  id: "home->math:T", kind: "HOME_TO_CLASS", from: home, to: math.location, departAfter: at("08:00"), arriveBy: at("10:30"), hasDeadline: true, availableMinutes: 150,
  walkingRoute: walk(12), recommendedRoute: walk(12), recommendedDeparture: at("10:08"), expectedArrival: at("10:20"), feasibility: "COMFORTABLE", crossCampus: false,
};
const toCs: ClassTransition = {
  id: "math:T->cs:T", kind: "CLASS_TO_CLASS", from: math.location, to: cs.location, departAfter: at("11:20"), arriveBy: at("11:30"), hasDeadline: true, availableMinutes: 10,
  walkingRoute: walk(8), recommendedRoute: walk(8), recommendedDeparture: at("11:20"), expectedArrival: at("11:28"), feasibility: "TIGHT", crossCampus: false,
};
const day: DayPlan = {
  day: "T", date: "2026-09-15", classes: [math, cs], transitions: [toMath, toCs], warnings: [], gym: [],
  items: [
    { kind: "LEAVE", at: toMath.recommendedDeparture!, from: home, transition: toMath },
    { kind: "ARRIVE", at: toMath.expectedArrival!, to: math.location, transition: toMath },
    { kind: "CLASS", scheduledClass: math },
    { kind: "LEAVE", at: toCs.recommendedDeparture!, from: math.location, transition: toCs },
    { kind: "ARRIVE", at: toCs.expectedArrival!, to: cs.location, transition: toCs },
    { kind: "CLASS", scheduledClass: cs },
  ],
};

// The provider's props type requires children, which createElement takes as its third argument.
const render = (focusId?: string) => renderToStaticMarkup(
  createElement(
    RemindersProvider,
    { plan: undefined } as ComponentProps<typeof RemindersProvider>,
    createElement(DayTimeline, { plan: day, home: undefined, busy: false, focusId, onPickLeg: () => {}, onPickClass: () => {} }),
  ),
);

// A reminder is only offered for a departure still ahead: run the day from before it starts.
beforeAll(() => { vi.useFakeTimers(); vi.setSystemTime(at("07:00")); });
afterAll(() => { vi.useRealTimers(); });

describe("the day's timeline", () => {
  it("says what each leg is in the student's words", () => {
    expect(legTitle(day, toMath, walk(12))).toBe("12 min walk to MATH 137");
    expect(legTitle(day, toCs, { ...walk(11), indoorPath: ["STC", "B2", "QNC", "MC"] })).toBe("11 min indoors to CS 135");
    const home2: ClassTransition = { ...toCs, id: "cs:T->home", kind: "CLASS_TO_HOME", to: home, hasDeadline: false, arriveBy: at("12:20") };
    expect(legTitle(day, home2, walk(9))).toBe("9 min walk home");
    expect(legTitle(day, toCs, walk(0))).toBe("CS 135 is in the same building");
  });

  it("renders one row per leg and class, folding each arrival and its real margin into the leg", () => {
    const html = render();
    expect(html.match(/<li/g)).toHaveLength(4);
    expect(html).toContain("arrive 10:20 AM · 10 min early");
    expect(html).not.toContain("Arrive ");
  });

  it("colours only the exceptions: nothing for an on-time leg, a worded warning for a tight one", () => {
    const html = render();
    expect(html).not.toContain("On time");
    expect(html).toContain("Tight: 2 min to spare");
  });

  it("shows route details under the leg in focus, and under no other row", () => {
    expect(render()).not.toContain("data-leg-details");
    const focused = render(legRowId(toCs.id));
    expect(focused.match(/data-leg-details/g)).toHaveLength(1);
    expect(focused).toContain("Google Maps");
    expect(focused).toContain("Remind me");
    expect(focused).toMatch(/aria-current="true"[^>]*aria-label="8 min walk to CS 135/);
    // A class in focus is highlighted but has no leg details of its own.
    expect(render(classRowId(math.id))).not.toContain("data-leg-details");
  });

  it("makes every row one real button, with nothing interactive nested inside another control", () => {
    const html = render(legRowId(toCs.id));
    expect(html.match(/<button type="button"[^>]*aria-label=/g)!.length).toBeGreaterThanOrEqual(4);
    expect(html).not.toMatch(/<button(?:(?!<\/button>)[\s\S])*<(button|a) /);
    expect(html).not.toContain('role="button"');
  });

  it("picks a leg by its transition id and a class by its class id", () => {
    const onPickLeg = vi.fn();
    const [leg] = buttons(expand(createElement(LeaveRow, { t: toCs, plan: day, selected: false, onPick: onPickLeg })));
    expect(leg.props["aria-label"]).toBe("8 min walk to CS 135, leave 11:20 AM. Tight: 2 min to spare");
    leg.props.onClick!({});
    expect(onPickLeg).toHaveBeenCalledWith(toCs.id);

    const onPickClass = vi.fn();
    const [row] = buttons(expand(createElement(ClassRow, { c: cs, selected: true, onPick: onPickClass })));
    expect(row.props["aria-current"]).toBe("true");
    row.props.onClick!({});
    expect(onPickClass).toHaveBeenCalledWith(cs.id);
  });

  it("describes the way the student chose on the row in focus, so the day never contradicts the summary", () => {
    const withIndoor: ClassTransition = { ...toCs, indoorRoute: { ...walk(11), polyline: "tunnel", indoorPath: ["STC", "MC"] } };
    const indoors = routeChoices(withIndoor, 10).find((c) => c.key === "indoors")!;
    const [row] = buttons(expand(createElement(LeaveRow, { t: withIndoor, plan: day, selected: false, choice: indoors, onPick: () => {} })));
    expect(row.props["aria-label"]).toBe("11 min indoors to CS 135, leave 11:20 AM. This way arrives 1 min after class starts");

    const html = renderToStaticMarkup(createElement(
      RemindersProvider,
      { plan: undefined } as ComponentProps<typeof RemindersProvider>,
      createElement(DayTimeline, { plan: day, home: undefined, busy: false, focusId: legRowId(toCs.id), focusChoice: indoors, onPickLeg: () => {}, onPickClass: () => {} }),
    ));
    expect(html).toMatch(/aria-current="true"[^>]*aria-label="11 min indoors to CS 135, leave 11:20 AM/);
    expect(html).toContain("Remind me");
    expect(html).not.toMatch(/aria-label="(Walk|Indoors|Bus)"/);
  });

  it("tags a class only when the tag says something: a tutorial, not a lecture", () => {
    const html = render();
    expect(html).toContain(">TUT<");
    expect(html).not.toContain(">LEC<");
  });
});
