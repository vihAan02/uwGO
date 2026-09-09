import type { Feasibility } from "@/domain/types";
import type { PlannerConfig } from "@/domain/config";

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
