import { describe, expect, it } from "vitest";
import type { CampusLocation, ClassTransition, DayPlan, RouteOption, ScheduledClass } from "@/domain/types";
import type { NextUp } from "./nextClass";
import type { MapSelection } from "./mapSelection";
import { classRowId, legRowId, pickId, resolveFocus, tripPreference, type PlanPick } from "./planFocus";

const at = (hhmm: string, date = "2026-09-15") => new Date(`${date}T${hhmm}:00-04:00`);
const place = (code: string, kind: CampusLocation["kind"] = "BUILDING"): CampusLocation => ({ id: code, name: code, latitude: 43.47, longitude: -80.54, kind, buildingCode: kind === "BUILDING" ? code : undefined });
const walk = (minutes: number, over: Partial<RouteOption> = {}): RouteOption => ({ mode: "WALK", durationMinutes: minutes, polyline: `walk-${minutes}`, provider: "google-routes", computedAt: "", isEstimate: false, ...over });

function scheduled(id: string, code: string, building: string, room: string, start: string, end: string, date = "2026-09-15"): ScheduledClass {
  return {
    id, day: "T", date, start: at(start, date), end: at(end, date), location: place(building),
    meeting: { id, university: "UW", courseCode: code, component: "LEC", days: ["T"], start: 0, end: 0, location: { kind: "ROOM", buildingCode: building, roomNumber: room }, source: "QUEST", includeInPlan: true },
    room: { raw: `${building} ${room}`, buildingCode: building, roomNumber: room, floor: 4, resolved: true },
  };
}

function leg(id: string, from: CampusLocation, to: CampusLocation, over: Partial<ClassTransition> = {}): ClassTransition {
  const outdoor = walk(8);
  return {
    id, kind: "CLASS_TO_CLASS", from, to, departAfter: at("09:50"), arriveBy: at("10:30"), hasDeadline: true, availableMinutes: 40,
    walkingRoute: outdoor, indoorRoute: walk(10, { polyline: "tunnel", indoorPath: ["MC", "DC"] }), recommendedRoute: outdoor,
    recommendedDeparture: at("10:12"), expectedArrival: at("10:20"), feasibility: "COMFORTABLE", crossCampus: false, ...over,
  };
}

const math = scheduled("math:T", "MATH 137", "MC", "2066", "08:30", "09:50");
const cs = scheduled("cs:T", "CS 135", "DC", "1350", "10:30", "11:20");
const toCs = leg("math:T->cs:T", math.location, cs.location);

function day(transitions: ClassTransition[], date = "2026-09-15", classes = [math, cs]): DayPlan {
  return { day: "T", date, classes, transitions, items: [], warnings: [], gym: [] };
}

const overview: MapSelection = { kind: "DAY", label: "Tue · 2 places", stops: [{ at: math.location, label: "MATH 137" }, { at: cs.location, label: "CS 135" }] };
const BUFFER = 10;

describe("what the planner is about", () => {
  const tuesday = day([toCs]);
  const upcoming: NextUp = { status: "UPCOMING", scheduledClass: cs, transition: toCs, day: tuesday };

  it("is the next trip, the plan's own way, when nothing is picked and that trip is on the day shown", () => {
    const f = resolveFocus({ pick: undefined, day: tuesday, next: upcoming, overview, bufferMinutes: BUFFER });
    expect(f.source).toBe("NEXT");
    expect(f.id).toBe(legRowId(toCs.id));
    expect(f.choice?.key).toBe("best");
    expect(f.choices.map((c) => c.key)).toEqual(["best", "indoors"]);
    expect(f.selection).toMatchObject({ kind: "LEG", from: math.location, to: cs.location, route: toCs.recommendedRoute, walkFallback: toCs.walkingRoute });
  });

  it("draws the rebuilt plan's route for a picked way, never the route it drew before the rebuild", () => {
    const pick: PlanPick = { kind: "LEG", transitionId: toCs.id, choice: "indoors" };
    const before = resolveFocus({ pick, day: tuesday, next: upcoming, overview, bufferMinutes: BUFFER });
    expect(before.selection.kind === "LEG" && before.selection.route).toBe(toCs.indoorRoute);

    // A tunnel closure confirmed while the app is open: same leg, a new indoor way round.
    const detour = walk(13, { polyline: "tunnel-detour", indoorPath: ["MC", "M3", "DC"] });
    const rebuilt = day([{ ...toCs, indoorRoute: detour }]);
    const after = resolveFocus({ pick, day: rebuilt, next: upcoming, overview, bufferMinutes: BUFFER });
    // Another way to make the next trip is still the next trip.
    expect(after.source).toBe("NEXT");
    expect(after.selection.kind === "LEG" && after.selection.route).toBe(detour);
    expect(after.choice?.leaveAt?.getTime()).toBe(at("10:07").getTime());
  });

  it("falls back to the plan's own way when the picked way is no longer offered", () => {
    const pick: PlanPick = { kind: "LEG", transitionId: toCs.id, choice: "indoors" };
    const noTunnel = day([{ ...toCs, indoorRoute: undefined }]);
    const f = resolveFocus({ pick, day: noTunnel, next: upcoming, overview, bufferMinutes: BUFFER });
    expect(f.choice?.key).toBe("best");
    expect(f.selection.kind === "LEG" && f.selection.route).toBe(toCs.recommendedRoute);
  });

  it("calls a picked leg that is not the next trip a pick, so the summary can offer the way back", () => {
    const lab = scheduled("lab:T", "CS 136L", "MC", "3003", "12:30", "14:20");
    const toLab = leg("cs:T->lab:T", cs.location, lab.location, { departAfter: at("11:20"), arriveBy: at("12:30") });
    const full = day([toCs, toLab], "2026-09-15", [math, cs, lab]);
    const f = resolveFocus({ pick: { kind: "LEG", transitionId: toLab.id, choice: "best" }, day: full, next: upcoming, overview, bufferMinutes: BUFFER });
    expect(f.source).toBe("PICKED");
    expect(f.id).toBe(legRowId(toLab.id));
  });

  it("falls back to the next trip when the picked leg is gone from the rebuilt plan", () => {
    const toGym = leg("math:T->pac", math.location, place("PAC"));
    const pick: PlanPick = { kind: "LEG", transitionId: toGym.id, choice: "best" };
    const f = resolveFocus({ pick, day: tuesday, next: upcoming, overview, bufferMinutes: BUFFER });
    expect(f.source).toBe("NEXT");
    expect(f.id).toBe(legRowId(toCs.id));
  });

  it("puts a picked class on the map as a place, named by its room", () => {
    const f = resolveFocus({ pick: { kind: "CLASS", classId: cs.id }, day: tuesday, next: upcoming, overview, bufferMinutes: BUFFER });
    expect(f).toMatchObject({ id: classRowId(cs.id), source: "PICKED", scheduledClass: cs, choices: [] });
    expect(f.selection).toEqual({ kind: "PLACE", label: "CS 135 · DC 1350", at: cs.location });
  });

  it("keeps a quick route exactly as it was drawn", () => {
    const quick: MapSelection = { kind: "LEG", label: "Your location → Home", from: place("here"), to: place("home", "HOME"), route: walk(12) };
    const f = resolveFocus({ pick: { kind: "PLACE", id: "quick-home", selection: quick }, day: tuesday, next: upcoming, overview, bufferMinutes: BUFFER });
    expect(f).toEqual({ id: "quick-home", source: "PICKED", selection: quick, choices: [] });
  });

  it("is the whole day when the next trip is on another day", () => {
    const thursday = day([], "2026-09-17", []);
    const f = resolveFocus({ pick: undefined, day: thursday, next: upcoming, overview, bufferMinutes: BUFFER });
    expect(f).toEqual({ source: "DAY", selection: overview, choices: [] });
  });

  it("is the trip after the class a student is sitting in", () => {
    const lab = scheduled("lab:T", "CS 136L", "MC", "3003", "12:30", "14:20");
    const toLab = leg("cs:T->lab:T", cs.location, lab.location, { departAfter: at("11:20"), arriveBy: at("12:30") });
    const full = day([toCs, toLab], "2026-09-15", [math, cs, lab]);
    const inClass: NextUp = { status: "IN_CLASS", scheduledClass: cs, transition: toCs, day: full, upNext: { scheduledClass: lab, transition: toLab, day: full } };
    const f = resolveFocus({ pick: undefined, day: full, next: inClass, overview, bufferMinutes: BUFFER });
    expect(f.id).toBe(legRowId(toLab.id));
    expect(f.transition).toBe(toLab);
  });

  it("starts a trip that reroutes by the way the student chose, not only by Settings", () => {
    const focusOn = (choice: PlanPick & { kind: "LEG" }) => resolveFocus({ pick: choice, day: tuesday, next: upcoming, overview, bufferMinutes: BUFFER });
    expect(tripPreference(focusOn({ kind: "LEG", transitionId: toCs.id, choice: "indoors" }), "FASTEST")).toBe("INDOORS");
    expect(tripPreference(focusOn({ kind: "LEG", transitionId: toCs.id, choice: "best" }), "INDOORS")).toBe("INDOORS");
    expect(tripPreference(focusOn({ kind: "LEG", transitionId: toCs.id, choice: "best" }), "FASTEST")).toBe("FASTEST");
    const winterPlan = day([{ ...toCs, recommendedRoute: toCs.indoorRoute }]);
    const outdoors = resolveFocus({ pick: { kind: "LEG", transitionId: toCs.id, choice: "outdoors" }, day: winterPlan, next: upcoming, overview, bufferMinutes: BUFFER });
    expect(outdoors.choice?.key).toBe("outdoors");
    expect(tripPreference(outdoors, "INDOORS")).toBe("FASTEST");
  });

  it("names picks the way the timeline names its rows", () => {
    expect(pickId({ kind: "LEG", transitionId: "a->b", choice: "walk" })).toBe("leg:a->b");
    expect(pickId({ kind: "CLASS", classId: "cs:T" })).toBe("class:cs:T");
    expect(pickId({ kind: "PLACE", id: "quick-gym", selection: overview })).toBe("quick-gym");
  });
});
