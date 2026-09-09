import type { RouteOption } from "@/domain/types";
import type { PlannerConfig } from "@/domain/config";
import { addMin, minutesBetween } from "@/time/toronto";
import { clampDeparture, expectedArrival, recommendedDeparture } from "./departure";

export interface RouteChoice {
  recommended?: RouteOption;
  departure?: Date;
  arrival?: Date;
  /** Minutes of slack before the class starts at the recommended option's arrival (negative = late). */
  slackMinutes?: number;
  reason: string;
}

/** Whether a transit alternative should be requested at all. */
export function shouldConsiderTransit(crossCampus: boolean, walkingMinutes: number | undefined, cfg: PlannerConfig): boolean {
  if (crossCampus) return true;
  return walkingMinutes !== undefined && walkingMinutes >= cfg.transitConsiderWalkMinutes;
}

/**
 * Pick walking vs transit by expected arrival time.
 * Walking is evaluated at the latest safe departure (never before `departAfter`).
 * Transit is evaluated at the itinerary Google returned for the same window.
 * If both arrive on time, transit has to earn the switch on one number: the door-to-door
 * time it saves, minus any time it forces the student to set off earlier than they would
 * have walked. Catching a bus 30 min early to save 6 min of travel is a loss, so that
 * subtraction matters. Ties go to walking, which has no wait and no bus to miss.
 */
export function chooseRoute(
  args: { departAfter: Date; arriveBy: Date; hasDeadline: boolean; walking?: RouteOption; transit?: RouteOption },
  cfg: PlannerConfig,
  minTransitSavingMinutes = 5,
): RouteChoice {
  const { departAfter, arriveBy, hasDeadline, walking, transit } = args;
  const latestOk = addMin(arriveBy, -cfg.arrivalBufferMinutes);

  const walkPlan = walking
    ? (() => {
        const plannedDep = hasDeadline ? recommendedDeparture(arriveBy, walking.durationMinutes, cfg.arrivalBufferMinutes) : departAfter;
        const departure = clampDeparture(plannedDep, departAfter);
        const arrival = expectedArrival(departure, walking.durationMinutes);
        return { route: walking, departure, arrival, onTime: !hasDeadline || arrival.getTime() <= latestOk.getTime() };
      })()
    : undefined;

  const transitPlan = transit && transit.departureTime && transit.arrivalTime && transit.departureTime.getTime() >= departAfter.getTime() - 60_000
    ? { route: transit, departure: transit.departureTime, arrival: transit.arrivalTime, onTime: !hasDeadline || transit.arrivalTime.getTime() <= latestOk.getTime() }
    : undefined;

  const finish = (p: { route: RouteOption; departure: Date; arrival: Date }, reason: string): RouteChoice => ({
    recommended: p.route,
    departure: p.departure,
    arrival: p.arrival,
    slackMinutes: hasDeadline ? minutesBetween(p.arrival, arriveBy) : undefined,
    reason,
  });

  if (!walkPlan && !transitPlan) return { reason: "No route available." };
  if (walkPlan && !transitPlan) return finish(walkPlan, "Walking is the only option.");
  if (!walkPlan && transitPlan) return finish(transitPlan, "Transit is the only option.");

  const w = walkPlan!;
  const t = transitPlan!;
  if (w.onTime && !t.onTime) return finish(w, "Walking arrives on time; transit does not.");
  if (!w.onTime && t.onTime) return finish(t, "Transit arrives on time; walking would be late.");
  if (w.onTime && t.onTime) {
    const transitMinutes = minutesBetween(t.departure, t.arrival);
    const travelSaving = w.route.durationMinutes - transitMinutes;
    const leaveEarlier = Math.max(0, minutesBetween(t.departure, w.departure)); // time given up at the origin
    const net = travelSaving - leaveEarlier;
    if (net >= minTransitSavingMinutes) return finish(t, `Transit saves ${net} min door to door.`);
    return finish(w, "Walking is as good as transit here, and has no wait.");
  }
  // Neither on time: least late wins; ties go to walking.
  return t.arrival.getTime() < w.arrival.getTime()
    ? finish(t, "Both options are late; transit is less late.")
    : finish(w, "Both options are late; walking is less late.");
}
