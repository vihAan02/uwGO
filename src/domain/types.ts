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
  provider: string;
  computedAt: string;
  /** True only for the straight-line fallback used when no routing API is configured. */
  isEstimate: boolean;
}

export type Feasibility = "COMFORTABLE" | "TIGHT" | "LIKELY_LATE" | "UNKNOWN";

export type TransitionKind = "HOME_TO_CLASS" | "CLASS_TO_CLASS" | "CLASS_TO_HOME";

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
  | { kind: "GAP"; from: Date; to: Date; minutes: number; homeReturn?: HomeReturnAnalysis }
  | { kind: "NOTE"; text: string };

export interface DayPlan {
  day: DayOfWeek;
  date: string;
  classes: ScheduledClass[];
  transitions: ClassTransition[];
  items: DayPlanItem[];
  warnings: string[];
}

export interface WeekPlan {
  generatedAt: string;
  weekStartDate: string;
  days: Partial<Record<DayOfWeek, DayPlan>>;
  skipped: { meeting: CourseMeeting; reason: string }[];
  usesEstimates: boolean;
}
