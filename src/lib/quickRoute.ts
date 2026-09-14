import type { CampusLocation, LatLng, RouteOption, UserHome } from "@/domain/types";
import { buildingLocation, findBuilding } from "@/data/buildings";
import { pacHoursOn } from "@/data/pac/hours";
import { resolveStudySpots, type ResolvedStudySpot } from "@/data/study";
import { studyHoursOn } from "@/data/study/hours";
import { homeLocation } from "@/engine/planner";
import { livePosition } from "@/engine/selectRoute";
import { haversineMeters } from "@/routing/EstimateRoutingProvider";
import { formatMinutesOfDay, minutesOfDay, todayISO } from "@/time/toronto";

/**
 * Quick routes: from wherever the student is standing to home, the gym or the nearest open library, at any
 * time and whatever the day's plan says. The route is chosen by the caller the way a reroute in Trip Mode is,
 * so it is an ordinary route the map can draw and Trip Mode can start.
 */

export type QuickDestination = "HOME" | "GYM" | "LIBRARY";

export const QUICK_DESTINATIONS: readonly QuickDestination[] = ["HOME", "GYM", "LIBRARY"];
export const QUICK_LABELS: Record<QuickDestination, string> = { HOME: "Home", GYM: "Gym", LIBRARY: "Library" };

/** This close to a place's map point, the student is already there and there is nothing to route. */
export const ALREADY_THERE_METRES = 60;

export interface QuickRouteDeps {
  home: UserHome | undefined;
  /** Where the student is now. Rejects with the geolocation error (anything with a `code`) when it cannot say. */
  position(): Promise<LatLng>;
  /** The route from a point to a place, leaving now; undefined when there is none. */
  route(at: LatLng, to: CampusLocation, now: Date): Promise<RouteOption | undefined>;
  now?: () => Date;
}

export type QuickRouteResult =
  | { kind: "ROUTE"; from: CampusLocation; to: CampusLocation; route: RouteOption; note?: string }
  | { kind: "THERE"; to: CampusLocation; message: string }
  | { kind: "PROBLEM"; message: string; action?: "SET_HOME" };

/** Why no position could be had, in words for the student. Codes are the Geolocation API's. */
export function positionProblem(error: { code?: number } | undefined): string {
  switch (error?.code) {
    case 1: return "Allow location access to route from where you are.";
    case 3: return "Finding where you are took too long. Try again.";
    default: return "Your location isn't available right now.";
  }
}

type Hours = { open: number; close: number } | undefined;

/**
 * Whether a place is open at `now`, from its hours for each date. A window can run past midnight (the PAC closes
 * at 12:30 am), so the night before's hours count too.
 */
export function openNow(hoursOn: (dateISO: string) => Hours, now: Date): boolean {
  const minutes = minutesOfDay(now);
  const today = hoursOn(todayISO(now));
  if (today && minutes >= today.open && minutes < today.close) return true;
  const lastNight = hoursOn(todayISO(new Date(now.getTime() - 86_400_000)));
  return Boolean(lastNight && lastNight.close > 24 * 60 && minutes < lastNight.close - 24 * 60);
}

/** The libraries open at `now`. */
export function openLibraries(now: Date): ResolvedStudySpot[] {
  return resolveStudySpots("UW").filter((s) => openNow((dateISO) => studyHoursOn(s.spot.id, dateISO), now));
}

/** What to tell a student heading to the PAC while it is shut; nothing while it is open. */
export function pacClosedNote(now: Date): string | undefined {
  if (openNow(pacHoursOn, now)) return undefined;
  const hours = pacHoursOn(todayISO(now));
  if (hours && minutesOfDay(now) < hours.open) return `The PAC opens at ${formatMinutesOfDay(hours.open)}.`;
  return hours ? "The PAC is closed for the rest of today." : "The PAC is closed today.";
}

/**
 * The quick route to one destination: home, PAC, or whichever library open now is nearest in a straight line.
 * Asks for the student's position only once there is somewhere to go, and never routes a walk to the place the
 * student is already at.
 */
export async function planQuickRoute(dest: QuickDestination, deps: QuickRouteDeps): Promise<QuickRouteResult> {
  const now = deps.now?.() ?? new Date();
  if (dest === "HOME" && !deps.home) return { kind: "PROBLEM", message: "Set where you live to route home.", action: "SET_HOME" };
  const libraries = dest === "LIBRARY" ? openLibraries(now) : [];
  if (dest === "LIBRARY" && !libraries.length) return { kind: "PROBLEM", message: "No library is open right now." };
  const pac = dest === "GYM" ? findBuilding("UW", "PAC") : undefined;
  const pacAt = pac && buildingLocation(pac);
  if (dest === "GYM" && !pacAt) return { kind: "PROBLEM", message: "The PAC isn't on the map." };

  let at: LatLng;
  try {
    at = await deps.position();
  } catch (error) {
    return { kind: "PROBLEM", message: positionProblem(error as { code?: number }) };
  }

  const nearest = libraries.map((s) => ({ s, metres: haversineMeters(at, s.at) })).sort((a, b) => a.metres - b.metres)[0]?.s;
  const to: CampusLocation = dest === "HOME" ? homeLocation(deps.home!) : dest === "GYM" ? pacAt! : { ...nearest!.at, name: nearest!.spot.name };
  if (haversineMeters(at, to) <= ALREADY_THERE_METRES) return { kind: "THERE", to, message: `You're already at ${to.name}.` };

  const route = await deps.route(at, to, now).catch(() => undefined);
  if (!route) return { kind: "PROBLEM", message: `No route to ${to.name} could be found from here right now.` };
  const note = dest === "GYM" ? pacClosedNote(now) : undefined;
  return { kind: "ROUTE", from: livePosition(at), to, route, ...(note ? { note } : {}) };
}
