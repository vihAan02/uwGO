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

/**
 * Whether a transit alternative should be requested at all. Cross-campus always; otherwise
 * only when the walk is long enough that a bus could beat it by the configured saving.
 * With no walking route there is nothing to compare against, so transit is the only hope.
 */
export function shouldConsiderTransit(crossCampus: boolean, walkingMinutes: number | undefined, cfg: PlannerConfig): boolean {
  if (crossCampus) return true;
  if (walkingMinutes === undefined) return true;
  return walkingMinutes >= cfg.transitConsiderWalkMinutes;
}

/**
 * Pick walking vs transit as two answers to the same door-to-door problem.
 *
 * Walking is evaluated at the latest safe departure (never before `departAfter`). Transit is
 * the complete itinerary the provider returned for the same window: walk to the stop, ride,
 * transfers, walk from the stop, with `departureTime`/`arrivalTime` at the doors.
 *
 * With a deadline, both on time: transit has to earn the switch on one number, the door-to-door
 * time it saves minus any time it forces the student to set off earlier than they would have
 * walked, minus a small cost per transfer. Catching a bus 30 min early to save 6 min of travel
 * is a loss, so that subtraction matters.
 *
 * Without a deadline (going home), nothing is gained by leaving late, so the only question is
 * which option gets there first counting any wait for the bus.
 *
 * Ties, and anything under `minTransitSavingMinutes`, go to walking: no wait and no bus to miss.
 */
export function chooseRoute(
  args: { departAfter: Date; arriveBy: Date; hasDeadline: boolean; walking?: RouteOption; transit?: RouteOption },
  cfg: PlannerConfig,
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
  if (walkPlan && !transitPlan) return finish(walkPlan, transit ? "Walking: the transit option would leave before you can." : "Walking is the only option.");
  if (!walkPlan && transitPlan) return finish(transitPlan, "Transit is the only option.");

  const w = walkPlan!;
  const t = transitPlan!;
  if (w.onTime && !t.onTime) return finish(w, "Walking arrives on time; transit does not.");
  if (!w.onTime && t.onTime) return finish(t, "Transit arrives on time; walking would be late.");
  if (w.onTime && t.onTime) {
    // The provider's door-to-door duration, which is also the number the student is shown.
    const transitMinutes = t.route.durationMinutes;
    const transfers = t.route.transferCount ?? 0;
    const penalty = transfers * cfg.transitTransferPenaltyMinutes;
    let net: number;
    if (hasDeadline) {
      const travelSaving = w.route.durationMinutes - transitMinutes;
      const leaveEarlier = Math.max(0, minutesBetween(t.departure, w.departure)); // time given up at the origin
      net = travelSaving - leaveEarlier - penalty;
    } else {
      net = minutesBetween(t.arrival, w.arrival) - penalty; // who is home first
    }
    const detail = `walk ${w.route.durationMinutes} min vs transit ${transitMinutes} min door to door${transfers ? `, ${transfers} transfer${transfers > 1 ? "s" : ""}` : ""}`;
    if (net >= cfg.minTransitSavingMinutes) return finish(t, `Transit saves ${net} min (${detail}).`);
    return finish(w, net > 0 ? `Walking: transit only saves ${net} min (${detail}), not worth the wait.` : `Walking is faster door to door (${detail}).`);
  }
  // Neither lands before the buffer. If both still land before class starts, the buffer is
  // what is being traded and walking keeps its threshold. Once class has started, every
  // minute counts and the less late option wins; ties go to walking.
  const penalty = (t.route.transferCount ?? 0) * cfg.transitTransferPenaltyMinutes;
  const transitAhead = minutesBetween(t.arrival, w.arrival) - penalty;
  const bothBeforeStart = w.arrival.getTime() <= arriveBy.getTime() && t.arrival.getTime() <= arriveBy.getTime();
  if (bothBeforeStart) {
    return transitAhead >= cfg.minTransitSavingMinutes
      ? finish(t, `Both land inside the buffer; transit gets there ${transitAhead} min sooner.`)
      : finish(w, "Both land inside the buffer; walking is as quick and has no bus to miss.");
  }
  return transitAhead > 0
    ? finish(t, "Both options are late; transit is less late.")
    : finish(w, "Both options are late; walking is less late.");
}
