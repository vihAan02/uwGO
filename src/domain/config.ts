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
  /**
   * Walking duration at or above which a transit itinerary is requested. A transit trip is
   * a walk to a stop, a ride and a walk from a stop, and it has to beat walking by
   * `minTransitSavingMinutes` door to door; under this walking length it cannot, so the
   * request is skipped rather than billed. Cross-campus legs always ask.
   */
  transitConsiderWalkMinutes: number;
  /** Transit must beat walking door to door by at least this much, or walking wins: no wait, no bus to miss. */
  minTransitSavingMinutes: number;
  /** Each transfer counts as this many extra minutes when transit is compared against walking. */
  transitTransferPenaltyMinutes: number;
  /** Minutes to get out of the building after class ends (0 for MVP). */
  buildingExitMinutes: number;
  /** Gaps shorter than this are never analysed for going home. */
  minGapForHomeAnalysisMinutes: number;
  /**
   * Time at a study spot below which the walk there is not worth it. Higher than the "possible"
   * home threshold on purpose: a library has a settling-in cost that your own room does not.
   */
  minUsefulStudyMinutes: number;
  /**
   * An indoor route may cost this many minutes more than Google's walk and still be preferred
   * when the student asks for "indoors when possible"; beyond it the fastest route wins.
   */
  indoorMaxExtraMinutes: number;
  /** ...and it may not be more than this fraction longer either (a 4 min walk should not become 12). */
  indoorMaxExtraRatio: number;
  /**
   * How much a campus route must save over Google's walk before it is taken, by how much it asks of
   * the student: `baseSeconds` covers the imprecision of comparing Google's timing with the survey's;
   * `shareOfGoogle` grows that with the length of the walk; `perBuildingSeconds` is added for every
   * building the route passes through, since each one is more doors and corridors to find, for at most
   * `buildingsCharged` of them: a longer chain already pays for every door and link it crosses in its
   * uncertainty charges. A nearer door of the destination on a five-minute walk therefore needs about
   * 16 s; a way through one building about 31 s, through three or more about 61 s. Never applies when
   * Google's walk relies on a way in or out that may not be used; then the allowed way is taken
   * whatever it costs.
   */
  campusShortcutMargin: { baseSeconds: number; shareOfGoogle: number; perBuildingSeconds: number; buildingsCharged: number };
}

export const DEFAULT_PLANNER_CONFIG: PlannerConfig = {
  arrivalBufferMinutes: 10,
  minUsefulHomeMinutes: 30,
  minPossibleHomeMinutes: 10,
  comfortMarginMinutes: 5,
  transitConsiderWalkMinutes: 10,
  minTransitSavingMinutes: 5,
  transitTransferPenaltyMinutes: 3,
  buildingExitMinutes: 0,
  minGapForHomeAnalysisMinutes: 20,
  minUsefulStudyMinutes: 20,
  indoorMaxExtraMinutes: 8,
  indoorMaxExtraRatio: 0.75,
  campusShortcutMargin: { baseSeconds: 10, shareOfGoogle: 0.02, perBuildingSeconds: 15, buildingsCharged: 3 },
};

/** The only setting the student chooses; everything else is engine tuning that follows the code. */
export const USER_CONFIG_KEYS = ["arrivalBufferMinutes"] as const satisfies readonly (keyof PlannerConfig)[];

export const ARRIVAL_BUFFER_CHOICES = [5, 10, 15] as const;
