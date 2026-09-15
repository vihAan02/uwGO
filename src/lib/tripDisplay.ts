import type { RouteOption } from "@/domain/types";
import { formatClock, formatDuration } from "@/time/toronto";
import { ARRIVED_METERS, formatRemaining, remainingFrom, type PathMetrics, type Projection } from "./routeProgress";

/**
 * What the trip screen says about the rest of the trip. Pure, so the numbers a student steers
 * by are tested without a map: the time left, the distance left, the clock time they arrive,
 * and whether they are there. Everything is a string that only changes when a shown number does,
 * which is what lets the screen re-render on a change of digit rather than on every GPS fix.
 */
export interface TripHeadline {
  /** "7 min", or the whole trip's duration before there is a position. */
  time: string;
  /** "520 m" left along the route, or the whole distance before there is a position. */
  distance?: string;
  /** "2:41 PM": when the student gets there at this pace. */
  arrival?: string;
  arrived: boolean;
}

/** How a trip moves, for the top of the screen. */
export function modeLabel(r: RouteOption): string {
  if (r.indoorPath) return "Indoors";
  if (r.mode === "WALK") return "Walking";
  const first = r.steps?.find((s) => s.mode === "TRANSIT")?.transit;
  const vehicle = (first?.vehicle ?? "").toLowerCase();
  if (vehicle.includes("light rail") || vehicle.includes("tram")) return "ION light rail";
  return vehicle.includes("bus") ? "Bus" : "Transit";
}

/** Route distance as shown: whole metres under a kilometre, otherwise one decimal. */
export function distanceLabel(meters: number | undefined): string | undefined {
  if (meters === undefined) return undefined;
  return meters < 1000 ? `${meters} m` : `${(meters / 1000).toFixed(1)} km`;
}

/** The numbers before any position is known: the trip as planned. */
export function plannedHeadline(route: RouteOption, now: Date = new Date()): TripHeadline {
  const arrival = route.mode === "TRANSIT" && route.arrivalTime
    ? route.arrivalTime
    : new Date(now.getTime() + route.durationMinutes * 60_000);
  return { time: formatDuration(route.durationMinutes), distance: distanceLabel(route.distanceMeters), arrival: formatClock(arrival), arrived: false };
}

/** The numbers from a live projection onto the route. */
export function liveHeadline(route: RouteOption, m: PathMetrics, proj: Pick<Projection, "alongMeters" | "offRouteMeters">, now: Date = new Date()): TripHeadline {
  const r = remainingFrom(route, m, proj, now);
  const f = formatRemaining(r);
  const arrived = m.total - proj.alongMeters <= ARRIVED_METERS && proj.offRouteMeters <= ARRIVED_METERS * 2;
  const arrival = route.mode === "TRANSIT" && route.arrivalTime ? route.arrivalTime : new Date(now.getTime() + r.minutes * 60_000);
  return { time: f.time, distance: f.distance, arrival: formatClock(arrival), arrived };
}

export function sameHeadline(a: TripHeadline | undefined, b: TripHeadline): boolean {
  return a !== undefined && a.time === b.time && a.distance === b.distance && a.arrival === b.arrival && a.arrived === b.arrived;
}
