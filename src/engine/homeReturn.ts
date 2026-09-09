import type { HomeReturnAnalysis, RouteOption } from "@/domain/types";
import type { PlannerConfig } from "@/domain/config";
import { addMin, minutesBetween } from "@/time/toronto";

/** A route with the door times it was resolved for. */
export interface ResolvedLeg {
  route: RouteOption;
  departure: Date;
  arrival: Date;
}

export interface HomeReturnInput {
  /** When the previous class ends. */
  gapStart: Date;
  /** When the next class starts. */
  nextClassStart: Date;
  /** Best route from the previous class to home, leaving at the gap start. */
  routeHome: ResolvedLeg;
  /** Best route from home to the next class, arriving before the buffer. */
  routeBack: ResolvedLeg;
}

/**
 * previous class ends -> best route home -> usable time -> best route back -> buffer -> next class.
 * Usable time is read straight off the two resolved legs (arrive home -> leave home), so a bus
 * that only runs at :05 and :35 costs exactly what it costs. Deterministic; thresholds from config.
 */
export function analyzeHomeReturn(input: HomeReturnInput, cfg: PlannerConfig): HomeReturnAnalysis {
  const { gapStart, nextClassStart, routeHome, routeBack } = input;
  const gapMinutes = minutesBetween(gapStart, nextClassStart);
  const travelHomeMinutes = minutesBetween(routeHome.departure, routeHome.arrival);
  const travelBackMinutes = minutesBetween(routeBack.departure, routeBack.arrival);
  const usableHomeMinutes = minutesBetween(routeHome.arrival, routeBack.departure);
  const backOnTime = routeBack.arrival.getTime() <= addMin(nextClassStart, -cfg.arrivalBufferMinutes).getTime();
  const possible = usableHomeMinutes > 0 && backOnTime;
  const recommendation = possible && usableHomeMinutes >= cfg.minUsefulHomeMinutes
    ? "WORTH_IT"
    : possible && usableHomeMinutes >= cfg.minPossibleHomeMinutes
      ? "POSSIBLE"
      : "NOT_RECOMMENDED";

  return {
    possible,
    recommendation,
    gapMinutes,
    travelHomeMinutes,
    usableHomeMinutes: Math.max(0, usableHomeMinutes),
    travelBackMinutes,
    leaveForHomeAt: possible ? routeHome.departure : undefined,
    arriveHomeAt: possible ? routeHome.arrival : undefined,
    leaveHomeAt: possible ? routeBack.departure : undefined,
    nextClassStart,
    routeHome: routeHome.route,
    routeBack: routeBack.route,
  };
}
