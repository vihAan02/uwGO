import type { HomeReturnAnalysis, RouteOption } from "@/domain/types";
import type { PlannerConfig } from "@/domain/config";
import { addMin, minutesBetween } from "@/time/toronto";

export interface HomeReturnInput {
  /** When the previous class ends. */
  gapStart: Date;
  /** When the next class starts. */
  nextClassStart: Date;
  routeHome: RouteOption;
  routeBack: RouteOption;
}

/**
 * previous class ends -> travel home -> usable time -> travel back -> arrival buffer -> next class.
 * usable = gap - travelHome - travelBack - buffer. Deterministic; thresholds come from config.
 */
export function analyzeHomeReturn(input: HomeReturnInput, cfg: PlannerConfig): HomeReturnAnalysis {
  const gapMinutes = minutesBetween(input.gapStart, input.nextClassStart);
  const travelHomeMinutes = Math.ceil(input.routeHome.durationMinutes);
  const travelBackMinutes = Math.ceil(input.routeBack.durationMinutes);
  const usableHomeMinutes = gapMinutes - travelHomeMinutes - travelBackMinutes - cfg.arrivalBufferMinutes - cfg.buildingExitMinutes;
  const possible = usableHomeMinutes > 0;
  const recommendation = usableHomeMinutes >= cfg.minUsefulHomeMinutes
    ? "WORTH_IT"
    : usableHomeMinutes >= cfg.minPossibleHomeMinutes
      ? "POSSIBLE"
      : "NOT_RECOMMENDED";

  const leaveForHomeAt = addMin(input.gapStart, cfg.buildingExitMinutes);
  const arriveHomeAt = addMin(leaveForHomeAt, travelHomeMinutes);
  const leaveHomeAt = addMin(input.nextClassStart, -(travelBackMinutes + cfg.arrivalBufferMinutes));

  return {
    possible,
    recommendation,
    gapMinutes,
    travelHomeMinutes,
    usableHomeMinutes,
    travelBackMinutes,
    leaveForHomeAt: possible ? leaveForHomeAt : undefined,
    arriveHomeAt: possible ? arriveHomeAt : undefined,
    leaveHomeAt: possible ? leaveHomeAt : undefined,
    nextClassStart: input.nextClassStart,
    routeHome: input.routeHome,
    routeBack: input.routeBack,
  };
}
