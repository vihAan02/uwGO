/** Tunable thresholds for the planning engines. Every number here is a product decision, not a constant of nature. */
export interface PlannerConfig {
  /** Minutes before class start the student should be at the door. */
  arrivalBufferMinutes: number;
  /** Time at home below which we say "not worth it". */
  minUsefulHomeMinutes: number;
  /** Time at home below which we say "not enough"; between this and useful we say "possible". */
  minPossibleHomeMinutes: number;
  /** Extra slack (beyond travel + buffer) required to call a transition COMFORTABLE. */
  comfortMarginMinutes: number;
  /** Walking duration at or above which a transit alternative is requested even within one campus. */
  transitConsiderWalkMinutes: number;
  /** Minutes to get out of the building after class ends (0 for MVP). */
  buildingExitMinutes: number;
  /** Gaps shorter than this are never analysed for going home. */
  minGapForHomeAnalysisMinutes: number;
}

export const DEFAULT_PLANNER_CONFIG: PlannerConfig = {
  arrivalBufferMinutes: 10,
  minUsefulHomeMinutes: 30,
  minPossibleHomeMinutes: 10,
  comfortMarginMinutes: 5,
  transitConsiderWalkMinutes: 18,
  buildingExitMinutes: 0,
  minGapForHomeAnalysisMinutes: 20,
};

export const ARRIVAL_BUFFER_CHOICES = [5, 10, 15] as const;
