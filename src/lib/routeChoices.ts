import type { ClassTransition, RouteOption } from "@/domain/types";
import { clampDeparture, expectedArrival, recommendedDeparture } from "@/engine/departure";

/**
 * The ways to make one leg, as a student picks between them on a phone: the plan's own pick first,
 * then only the alternatives that are really a different way to go. Everything is read off the leg
 * the planner resolved (the fastest walk, the indoor way, a priced bus), so a choice can never
 * disagree with the timeline, and a leg with one sensible way offers no choice at all.
 */

export type RouteChoiceKey = "best" | "indoors" | "outdoors" | "walk" | "transit";

export interface RouteChoice {
  key: RouteChoiceKey;
  /** Short enough for a segmented control on a 320px phone: "Best", "Indoors", "Walk", "Bus 201". */
  label: string;
  route: RouteOption;
  /** The plan's pick. */
  recommended: boolean;
  /** When to set off this way and when it lands: the plan's own numbers for its pick, the planner's arithmetic for the rest. */
  leaveAt?: Date;
  arriveAt?: Date;
}

/** The same way to go: the very option, or one with the same mode, time and line. */
export function sameWay(a: RouteOption | undefined, b: RouteOption | undefined): boolean {
  if (!a || !b) return false;
  return a === b || (a.mode === b.mode && a.durationMinutes === b.durationMinutes && a.polyline === b.polyline && Boolean(a.indoorPath) === Boolean(b.indoorPath));
}

/** "Bus 201", or "ION" for the light rail. */
export function transitLabel(route: RouteOption): string {
  const first = route.steps?.find((s) => s.mode === "TRANSIT")?.transit;
  const vehicle = (first?.vehicle ?? "").toLowerCase();
  if (vehicle.includes("light rail") || vehicle.includes("tram")) return "ION";
  return first?.lineShort ? `Bus ${first.lineShort}` : "Bus";
}

/** Leave and arrive for a way the plan did not pick, timed exactly as `selectRoute` times the ones it does. */
function timesFor(t: ClassTransition, route: RouteOption, bufferMinutes: number): Pick<RouteChoice, "leaveAt" | "arriveAt"> {
  if (route.mode === "TRANSIT") return { leaveAt: route.departureTime, arriveAt: route.arrivalTime };
  const leaveAt = t.hasDeadline
    ? clampDeparture(recommendedDeparture(t.arriveBy, route.durationMinutes, bufferMinutes), t.departAfter)
    : t.departAfter;
  return { leaveAt, arriveAt: expectedArrival(leaveAt, route.durationMinutes) };
}

export function routeChoices(t: ClassTransition, bufferMinutes: number): RouteChoice[] {
  const rec = t.recommendedRoute;
  if (!rec) return [];
  const choices: RouteChoice[] = [{ key: "best", label: "Best", route: rec, recommended: true, leaveAt: t.recommendedDeparture, arriveAt: t.expectedArrival }];
  // Two classes in one building have nothing to choose between.
  if (rec.durationMinutes <= 0) return choices;
  const offer = (key: RouteChoiceKey, label: string, route: RouteOption | undefined) => {
    if (!route || route.durationMinutes <= 0 || choices.some((c) => sameWay(c.route, route))) return;
    choices.push({ key, label, route, recommended: false, ...timesFor(t, route, bufferMinutes) });
  };
  // The fastest walk is the campus-aware one when the plan found one, otherwise Google's.
  const walk = t.campusWalk ?? t.walkingRoute;
  if (rec.mode === "TRANSIT") {
    offer("walk", "Walk", walk);
  } else {
    if (rec.indoorPath) offer("outdoors", "Outdoors", walk);
    else offer("indoors", "Indoors", t.indoorRoute);
    if (t.transitRoute) offer("transit", transitLabel(t.transitRoute), t.transitRoute);
  }
  return choices;
}

/** Which choice a route on the map is, falling back to the plan's pick. */
export function choiceShowing(choices: readonly RouteChoice[], shown: RouteOption | undefined): RouteChoiceKey {
  return choices.find((c) => sameWay(c.route, shown))?.key ?? "best";
}
