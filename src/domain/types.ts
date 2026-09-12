/**
 * UW GO domain models. Pure data, no React, no Google types.
 * Times inside meetings are minutes-of-day on the America/Toronto wall clock;
 * they become instants only in the normalization step (see src/time/toronto.ts).
 */

export type University = "UW" | "WLU";

/** Quest / UW Open Data day codes, in week order. */
export type DayOfWeek = "M" | "T" | "W" | "Th" | "F" | "S" | "Su";
export const DAYS_IN_ORDER: readonly DayOfWeek[] = ["M", "T", "W", "Th", "F", "S", "Su"];
export const DAY_LABELS: Record<DayOfWeek, string> = {
  M: "Mon", T: "Tue", W: "Wed", Th: "Thu", F: "Fri", S: "Sat", Su: "Sun",
};

export type Component =
  | "LEC" | "TUT" | "LAB" | "SEM" | "PRJ" | "PRA" | "DIS" | "TST" | "STU" | "FLD" | "CLN" | "OTHER";

/** 0..1439, wall-clock minutes since midnight in America/Toronto. */
export type MinutesOfDay = number;

export type RawLocation =
  | { kind: "ROOM"; buildingCode: string; roomNumber: string }
  | { kind: "ONLINE" }
  | { kind: "TBA" };

export interface TermInfo {
  season: "Fall" | "Winter" | "Spring";
  year: number;
  /** Quest term id, e.g. 1259 = Fall 2025: (year - 1900) * 10 + {1 Winter, 5 Spring, 9 Fall}. */
  termId: number;
  level?: string;
  institution?: string;
}

/** One meeting pattern. A Quest section with two "Days & Times" rows produces two meetings. */
export interface CourseMeeting {
  id: string;
  university: University;
  courseCode: string;
  courseTitle?: string;
  /** For a Laurier-hosted course seen in Quest as "BUS 352W", its Laurier code "BU352". */
  laurierCode?: string;
  classNumber?: number;
  section?: string;
  component: Component;
  days: DayOfWeek[];
  start: MinutesOfDay;
  end: MinutesOfDay;
  /** ISO yyyy-mm-dd. Present when the paste's date order could be determined. */
  startDate?: string;
  endDate?: string;
  location: RawLocation;
  instructors?: string[];
  /** True when Quest shows no day/time for this meeting (blank or TBA). Never routed. */
  unscheduled?: boolean;
  source: "QUEST" | "MANUAL";
  includeInPlan: boolean;
}

export type DateOrder = "DMY" | "MDY" | "YMD" | "UNKNOWN";

export interface ParseWarning {
  code:
    | "NO_TERM_HEADER"
    | "WRONG_PAGE_HOMEPAGE_WIDGET"
    | "WRONG_PAGE_COURSE_SELECTION"
    | "NOT_REGISTERED"
    | "NO_COURSES"
    | "COURSE_BLOCK_UNPARSED"
    | "MEETING_UNPARSED"
    | "DATE_ORDER_AMBIGUOUS"
    | "DATE_ORDER_UNKNOWN"
    | "NO_TIME"
    | "UNKNOWN_DAY_TOKEN"
    | "DUPLICATE_DROPPED"
    | "UNKNOWN_CROSS_REGISTERED_SUBJECT"
    | "PARSER_NOT_IMPLEMENTED";
  message: string;
  courseCode?: string;
  line?: number;
}

export interface ParsedSchedule {
  term?: TermInfo;
  meetings: CourseMeeting[];
  warnings: ParseWarning[];
  dateOrder: DateOrder;
  /** True when the paste is recognisably a Quest List View schedule. */
  recognised: boolean;
}

export interface LatLng {
  latitude: number;
  longitude: number;
}

export type FloorRule =
  | { kind: "FIRST_DIGIT"; confidence: "verified" | "likely"; source: string }
  | { kind: "DASH_PREFIX"; confidence: "verified" | "likely"; source: string }
  | { kind: "LEADING_DIGIT_THEN_WING"; confidence: "verified" | "likely"; source: string }
  | { kind: "UNKNOWN" };

export type BuildingKind = "ACADEMIC" | "RESIDENCE" | "MIXED" | "OTHER";

export interface CampusBuilding {
  id: string;
  university: University;
  code: string;
  name: string;
  aliases: string[];
  latitude?: number;
  longitude?: number;
  coordinatesSource: "UW_ARCGIS" | "OSM" | "UNVERIFIED";
  address?: string;
  kind: BuildingKind;
  /** Parent complex code, e.g. SJ1 -> STJ. */
  parentCode?: string;
  floorRule: FloorRule;
  /** Present when this building can be chosen as a "where do you live" preset. */
  residenceLabel?: string;
}

export interface CampusLocation {
  id: string;
  name: string;
  university?: University;
  latitude: number;
  longitude: number;
  kind: "BUILDING" | "HOME";
  buildingCode?: string;
}

export interface UserHome {
  name: string;
  latitude: number;
  longitude: number;
  address?: string;
  preset?: { university: University; buildingCode: string };
}

export interface ParsedRoom {
  raw: string;
  buildingCode: string;
  buildingName?: string;
  roomNumber?: string;
  floor: number | "unknown";
  floorConfidence?: "verified" | "likely";
  university?: University;
  resolved: boolean;
}

export interface ScheduledClass {
  id: string;
  day: DayOfWeek;
  /** ISO date of this occurrence in the reference week. */
  date: string;
  start: Date;
  end: Date;
  meeting: CourseMeeting;
  location: CampusLocation;
  room: ParsedRoom;
}

export type TravelMode = "WALK" | "TRANSIT";

export interface TransitStepDetails {
  line: string;
  lineShort?: string;
  vehicle: string;
  headsign?: string;
  departureStop: string;
  arrivalStop: string;
  departureTime: Date;
  arrivalTime: Date;
  stopCount?: number;
  color?: string;
}

export interface RouteStep {
  mode: TravelMode;
  durationMinutes: number;
  distanceMeters?: number;
  instruction?: string;
  transit?: TransitStepDetails;
}

export interface RouteOption {
  mode: TravelMode;
  durationMinutes: number;
  distanceMeters?: number;
  departureTime?: Date;
  arrivalTime?: Date;
  steps?: RouteStep[];
  /** Google encoded polyline (whole route). */
  polyline?: string;
  transferCount?: number;
  /** Building codes walked through, for a route planned over UW's indoor connections. */
  indoorPath?: string[];
  /** 0..1 share of the trip spent inside buildings; set for indoor-graph routes. */
  indoorShare?: number;
  /**
   * Canonical ids of the campus-network segments this route travels, for routes computed over
   * the indoor graph. What a student's closure report targets, and how a changed route can name
   * the segment that closed.
   */
  indoorEdgeIds?: string[];
  /**
   * Canonical ids of segments this route had to go round because students reported them shut.
   * Present only when a closure actually changed the answer, so the UI can say what changed.
   */
  avoidedClosures?: string[];
  /**
   * Canonical ids of closed segments this route actually runs along. Only ever set on an outdoor
   * route from Google, which cannot be told to avoid a footpath: the honest answer is to say the
   * route uses something reported shut rather than pretend it does not.
   */
  blockedBy?: string[];
  provider: string;
  computedAt: string;
  /** True only for the straight-line fallback used when no routing API is configured. */
  isEstimate: boolean;
}

export type Feasibility = "COMFORTABLE" | "TIGHT" | "LIKELY_LATE" | "UNKNOWN";

export type TransitionKind =
  | "HOME_TO_CLASS"
  | "CLASS_TO_CLASS"
  /** Going home at the end of the day. A mid-day trip home is STOP-shaped, not this. */
  | "CLASS_TO_HOME"
  /** First hop of a gap the student chose to spend somewhere. */
  | "CLASS_TO_STOP"
  /** Between two stops in one gap: PAC, then the rez to shower. */
  | "STOP_TO_STOP"
  /** Last hop of such a gap, back to the next class. */
  | "STOP_TO_CLASS"
  /** End of the day to somewhere other than home (the gym or a library). */
  | "CLASS_TO_END";

/**
 * Somewhere a student can go and work during a gap. Coordinates are deliberately absent: they
 * come from the building registry via `findBuilding` -> `buildingLocation`, so there is one
 * source of truth for where a place is and a spot whose building has no coordinates is simply
 * never offered.
 */
export interface StudySpot {
  id: string;
  university: University;
  buildingCode: string;
  name: string;
  /** What the button says. */
  shortName: string;
  /** Where inside the building, when it is worth saying. Display only. */
  floorNote?: string;
}

/** What the student picked for a gap. STAY builds nothing. */
export type GapChoiceKind = "STAY" | "REZ" | "GYM" | "STUDY";

/** Where they go after the workout. CLASS means straight on, with no second stop. */
export type GymThen = "REZ" | "STUDY" | "CLASS";

export interface GapChoice {
  kind: GapChoiceKind;
  /** Only meaningful when kind is GYM. Absent means the fork has not been answered yet. */
  gymThen?: GymThen;
}

export type GapOptionId = "STAY" | "REZ" | "STUDY" | "GYM" | "GYM_CLASS" | "GYM_REZ" | "GYM_STUDY";

export interface GapOption {
  id: GapOptionId;
  kind: GapChoiceKind;
  /** Set on the three fork options. Absent on the four top-level ones. */
  gymThen?: GymThen;
  /** The stops this option would add to the day. Empty for STAY, and for the unanswered GYM fork. */
  stops: GapStop[];
  /** Every leg routed, the stay long enough to be worth making, and the last leg lands before the buffer. */
  fits: boolean;
  /** Minutes actually usable at the last place the student stays. */
  usableMinutes: number;
  travelMinutes: number;
  leaveAt?: Date;
  arriveBackAt?: Date;
  /** Button text. */
  label: string;
  /** One line under the button. */
  detail: string;
  /** Why it fits or does not, naming the numbers. */
  reason: string;
  /** True when any leg was priced by the straight-line estimator rather than real routing. */
  isEstimate: boolean;
  /** Set by `recommendGapOption`; the component renders the star, it does not decide it. */
  starred: boolean;
  /** REZ only. A two-stop chain measures something else, so it must never be exported here. */
  analysis?: HomeReturnAnalysis;
}

export interface GapRecommendation {
  recommended: GapOptionId;
  /** Plain language, naming the numbers that decided it. */
  reason: string;
  /** Every rung tried and why it was passed over. */
  considered: { id: GapOptionId; met: boolean; reason: string }[];
}

/** What a student goes somewhere for during a gap. */
export type GapStopPurpose = "REZ" | "GYM" | "STUDY";

/**
 * A place the student chose to stop at during a gap. The itinerary is built from an ordered
 * list of these, so a gap can hold a workout and then a shower at the rez.
 */
export interface GapStop {
  purpose: GapStopPurpose;
  at: CampusLocation;
  /** Short word for the timeline: "rez", "PAC", "Dana Porter". */
  label: string;
  /**
   * Minutes owed here before setting off again — the workout. Absent means "leave on arrival".
   * It cannot be derived later: `buildItinerary` runs before any route exists, so without it the
   * planner's running clock would let the next leg depart the moment the student arrives.
   */
  minDwellMinutes?: number;
}

export interface ClassTransition {
  id: string;
  kind: TransitionKind;
  from: CampusLocation;
  to: CampusLocation;
  /** Earliest the student can leave `from` (previous class end, or a chosen time for home->first). */
  departAfter: Date;
  /** The next class start (for CLASS_TO_HOME: no deadline, equals departAfter). */
  arriveBy: Date;
  /** False for CLASS_TO_HOME legs, which have no deadline. */
  hasDeadline: boolean;
  availableMinutes: number;
  walkingRoute?: RouteOption;
  transitRoute?: RouteOption;
  /** A route over UW's verified tunnels/bridges, when both ends are on that graph. */
  indoorRoute?: RouteOption;
  recommendedRoute?: RouteOption;
  recommendedDeparture?: Date;
  expectedArrival?: Date;
  feasibility: Feasibility;
  reason?: string;
  /** Which modes were actually priced for this leg, so "walking" can be read as a choice rather than a default. */
  consideredModes?: TravelMode[];
  crossCampus: boolean;
}

export type HomeRecommendation = "WORTH_IT" | "POSSIBLE" | "NOT_RECOMMENDED";

export interface HomeReturnAnalysis {
  possible: boolean;
  recommendation: HomeRecommendation;
  gapMinutes: number;
  travelHomeMinutes: number;
  usableHomeMinutes: number;
  travelBackMinutes: number;
  leaveForHomeAt?: Date;
  arriveHomeAt?: Date;
  leaveHomeAt?: Date;
  nextClassStart: Date;
  routeHome?: RouteOption;
  routeBack?: RouteOption;
}

export type DayPlanItem =
  | { kind: "LEAVE"; at: Date; from: CampusLocation; transition: ClassTransition }
  | { kind: "ARRIVE"; at: Date; to: CampusLocation; transition: ClassTransition }
  | { kind: "CLASS"; scheduledClass: ScheduledClass }
  | {
      kind: "GAP";
      from: Date; to: Date; minutes: number;
      /** Identity of the gap, so a picker can report a choice without working out which gap it is in. */
      dateISO: string; classId: string;
      /** Every way to spend it, priced, in display order. */
      options: GapOption[];
      /** Which one we would pick, and why. The star is already set on the option. */
      recommendation?: GapRecommendation;
      /** What the student actually picked, and whether it was for this day or every week. */
      choice?: { value: GapChoice; source: "DATE" | "CLASS" };
      homeReturn?: HomeReturnAnalysis;
      gym?: GymWindow;
    }
  | { kind: "GYM"; window: GymWindow }
  | { kind: "NOTE"; text: string };

export interface DayPlan {
  day: DayOfWeek;
  date: string;
  classes: ScheduledClass[];
  transitions: ClassTransition[];
  items: DayPlanItem[];
  warnings: string[];
  /** Every workout that fits this day, best first. Empty unless the student works out. */
  gym: GymWindow[];
}

export interface WeekPlan {
  generatedAt: string;
  weekStartDate: string;
  days: Partial<Record<DayOfWeek, DayPlan>>;
  skipped: { meeting: CourseMeeting; reason: string }[];
  usesEstimates: boolean;
}

// ---------------------------------------------------------------------------
// Preferences and the gym

export type GymTimePreference = "MORNING" | "AFTERNOON" | "EVENING" | "LEAST_BUSY" | "NONE";
export const GYM_DURATIONS = [45, 60, 90] as const;
export type GymDuration = (typeof GYM_DURATIONS)[number];

export interface GymPreferences {
  enabled: boolean;
  durationMinutes: GymDuration;
  preferredTime: GymTimePreference;
}

/** FASTEST: Google's route. INDOORS: prefer UW tunnels/bridges when the cost is reasonable. */
export type RoutePreference = "FASTEST" | "INDOORS";

/**
 * Where the day ends, after the last class. HOME (the default) keeps the existing behaviour;
 * GYM routes to the PAC and LIBRARY to the nearest study spot, using the same route resolver as
 * every other leg. It reuses the gap destinations REZ/GYM/STUDY, named for the end of the day.
 */
export type EndOfDayDestination = "HOME" | "GYM" | "LIBRARY";

export type CrowdLevel = "QUIET" | "BEARABLE" | "BUSY" | "VERY_BUSY";

export interface CrowdEstimate {
  level: CrowdLevel;
  /** Estimated fitness-centre occupancy, 0..100 (% of capacity). */
  occupancyPct: number;
  /** Estimated wait for a piece of equipment, derived from crowding: not a machine tracker. */
  estimatedMachineWaitMin: number;
  estimatedMachineWaitMax: number;
  /** LIVE: a fresh reading from the portal. TYPICAL: the time-of-day pattern. LIVE_ADJUSTED: pattern nudged by a recent reading. */
  source: "LIVE" | "LIVE_ADJUSTED" | "TYPICAL";
}

export type GymSlot = "BEFORE_FIRST" | "BETWEEN" | "AFTER_LAST";

export interface GymWindow {
  id: string;
  slot: GymSlot;
  /** Index of the class this window follows (BETWEEN, AFTER_LAST) or precedes (BEFORE_FIRST). */
  classIndex: number;
  /** Suggested workout, travel excluded. */
  start: Date;
  end: Date;
  workoutMinutes: number;
  /** Everything between arriving at PAC and having to leave it. */
  usableMinutes: number;
  from: CampusLocation;
  to: CampusLocation;
  fromLabel: string;
  toLabel: string;
  routeIn: RouteOption;
  routeOut: RouteOption;
  leaveAt: Date;
  arrivePacAt: Date;
  leavePacBy: Date;
  crowd: CrowdEstimate;
  score: number;
  reasons: string[];
}
