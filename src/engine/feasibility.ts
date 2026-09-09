import type { Feasibility, RouteOption } from "@/domain/types";
import type { PlannerConfig } from "@/domain/config";
import { minutesBetween } from "@/time/toronto";

/**
 * COMFORTABLE: enough time for travel + arrival buffer + a comfort margin.
 * TIGHT: enough time to physically arrive, but inside the buffer/margin.
 * LIKELY_LATE: travel alone takes longer than the gap.
 */
export function assessFeasibility(availableMinutes: number, travelMinutes: number, cfg: PlannerConfig): Feasibility {
  const travel = Math.ceil(travelMinutes);
  const needed = travel + cfg.arrivalBufferMinutes;
  if (availableMinutes >= needed + cfg.comfortMarginMinutes) return "COMFORTABLE";
  if (availableMinutes >= travel) return "TIGHT";
  return "LIKELY_LATE";
}

/**
 * Feasibility of a resolved leg. Walking is judged on its duration against the time available.
 * Transit is judged on the trip itself, not on the wait for it: an itinerary asked for by
 * arrival lands at the buffer on purpose, and the minutes spent at the origin before it are
 * free time, not travel. A bus that lands inside the buffer is TIGHT; after class start, late.
 */
export function assessResolvedFeasibility(
  leg: { availableMinutes: number; arriveBy: Date; route: RouteOption; arrival: Date },
  cfg: PlannerConfig,
): Feasibility {
  if (leg.route.mode === "WALK") return assessFeasibility(leg.availableMinutes, leg.route.durationMinutes, cfg);
  const slack = minutesBetween(leg.arrival, leg.arriveBy);
  if (slack < 0) return "LIKELY_LATE";
  if (slack < cfg.arrivalBufferMinutes) return "TIGHT";
  return assessFeasibility(leg.availableMinutes, leg.route.durationMinutes, cfg);
}
