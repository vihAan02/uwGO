import type { ClassTransition, DayPlan, RoutePreference, ScheduledClass } from "@/domain/types";
import type { NextUp } from "./nextClass";
import type { MapSelection } from "./mapSelection";
import { routeChoices, type RouteChoice, type RouteChoiceKey } from "./routeChoices";

/**
 * What the planner is about right now: the one thing the sheet's summary describes and the map
 * draws. A student's pick wins; with nothing picked it is the next trip when that trip is on the day
 * being looked at, and otherwise the whole day.
 *
 * A pick names a leg by its transition id and a way to go, never by the route it drew. The week is
 * rebuilt whenever a closure is confirmed, a gap is answered or the PAC reading moves, and a pick
 * that held on to the old route would keep drawing a line the plan no longer takes.
 */

export type PlanPick =
  | { kind: "LEG"; transitionId: string; choice: RouteChoiceKey }
  | { kind: "CLASS"; classId: string }
  /** Something not in the day's plan, such as a quick route from where the student is. */
  | { kind: "PLACE"; id: string; selection: MapSelection };

export interface PlanFocus {
  /** The timeline row or quick route this is, for highlighting. Absent for the whole day. */
  id?: string;
  source: "PICKED" | "NEXT" | "DAY";
  selection: MapSelection;
  transition?: ClassTransition;
  /** Every way to make the leg, the plan's pick first. Empty unless the focus is a routed leg. */
  choices: RouteChoice[];
  /** The way on the map. */
  choice?: RouteChoice;
  scheduledClass?: ScheduledClass;
}

export const legRowId = (transitionId: string) => `leg:${transitionId}`;
export const classRowId = (classId: string) => `class:${classId}`;

export function pickId(pick: PlanPick): string {
  switch (pick.kind) {
    case "LEG": return legRowId(pick.transitionId);
    case "CLASS": return classRowId(pick.classId);
    case "PLACE": return pick.id;
  }
}

function roomLabel(c: ScheduledClass): string {
  const loc = c.meeting.location;
  return loc.kind === "ROOM" ? `${c.meeting.courseCode} · ${loc.buildingCode} ${loc.roomNumber}` : c.meeting.courseCode;
}

/** A leg as the focus, drawn the way the student chose, or the plan's own way when that choice has gone. */
export function legFocus(t: ClassTransition, choice: RouteChoiceKey, bufferMinutes: number, source: PlanFocus["source"]): PlanFocus | undefined {
  const choices = routeChoices(t, bufferMinutes);
  const chosen = choices.find((c) => c.key === choice) ?? choices[0];
  if (!chosen) return undefined;
  return {
    id: legRowId(t.id),
    source,
    transition: t,
    choices,
    choice: chosen,
    selection: { kind: "LEG", label: `${t.from.name} → ${t.to.name}`, from: t.from, to: t.to, route: chosen.route, walkFallback: t.campusWalk ?? t.walkingRoute },
  };
}

/** The trip that matters next: the one to the next class, or while in class, the one after it. */
export function nextTrip(next: NextUp): { transition: ClassTransition; day: DayPlan } | undefined {
  if (next.status === "IN_CLASS") {
    const after = next.upNext;
    return after?.transition ? { transition: after.transition, day: after.day } : undefined;
  }
  if ((next.status === "UPCOMING" || next.status === "PREVIEW") && next.transition && next.day) return { transition: next.transition, day: next.day };
  return undefined;
}

/**
 * The rule a trip started from this focus reroutes by. A student who tapped Indoors is rerouted
 * indoors and one who tapped Outdoors or Walk is not, whatever the standing preference in Settings
 * says; the plan's own pick keeps the standing preference.
 */
export function tripPreference(focus: PlanFocus, standing: RoutePreference): RoutePreference {
  switch (focus.choice?.key) {
    case "indoors": return "INDOORS";
    case "outdoors":
    case "walk": return "FASTEST";
    default: return standing;
  }
}

export function resolveFocus({ pick, day, next, overview, bufferMinutes }: {
  pick: PlanPick | undefined;
  day: DayPlan | undefined;
  next: NextUp;
  overview: MapSelection;
  bufferMinutes: number;
}): PlanFocus {
  if (pick?.kind === "PLACE") return { id: pick.id, source: "PICKED", selection: pick.selection, choices: [] };
  const trip = nextTrip(next);
  if (pick?.kind === "LEG" && day) {
    const t = day.transitions.find((x) => x.id === pick.transitionId);
    // Picking the next trip, or another way to make it, is still the next trip, not a detour from it.
    const isNext = Boolean(trip && trip.day.date === day.date && trip.transition.id === pick.transitionId);
    const focus = t && legFocus(t, pick.choice, bufferMinutes, isNext ? "NEXT" : "PICKED");
    if (focus) return focus;
  }
  if (pick?.kind === "CLASS" && day) {
    const c = day.classes.find((x) => x.id === pick.classId);
    if (c) return { id: classRowId(c.id), source: "PICKED", scheduledClass: c, choices: [], selection: { kind: "PLACE", label: roomLabel(c), at: c.location } };
  }
  // Nothing picked, or the pick is gone from the rebuilt plan.
  if (day && trip && trip.day.date === day.date) {
    const current = day.transitions.find((x) => x.id === trip.transition.id) ?? trip.transition;
    const focus = legFocus(current, "best", bufferMinutes, "NEXT");
    if (focus) return focus;
  }
  return { source: "DAY", selection: overview, choices: [] };
}
