import { ARRIVAL_BUFFER_CHOICES, DEFAULT_PLANNER_CONFIG } from "@/domain/config";
import type { Component, CourseMeeting, DayOfWeek, EndOfDayDestination, GymPreferences, RawLocation, RoutePreference, TermInfo, University, UserHome } from "@/domain/types";
import { DAYS_IN_ORDER } from "@/domain/types";
import { forgetMissingClasses } from "./gapChoices";
import { migrateEndOfDay, migrateGym, type AppState } from "./storage";

/**
 * The signed-in student's saved app state in Supabase: one `public.user_state` row per account
 * (supabase/migrations/20260911000000_user_state.sql).
 *
 * The row holds the parsed schedule and the preferences needed to rebuild the app, as JSON in
 * the shapes the app already uses. It holds nothing derived (routes, plans, map state), nothing
 * per device (gap answers, reminders, crowd samples), and nothing secret. Everything read back
 * is untrusted: it is validated field by field, and whatever does not fit is dropped rather than
 * trusted or allowed to throw.
 */

export const USER_STATE_TABLE = "user_state";
export const USER_STATE_COLUMNS = "user_id, schedule, preferences, onboarding_complete, schema_version, updated_at";
export const USER_STATE_SCHEMA_VERSION = 1;

export type SavedSchedule = NonNullable<AppState["schedule"]>;

export interface SavedPreferences {
  home?: UserHome;
  arrivalBufferMinutes: number;
  gym?: GymPreferences;
  routePreference?: RoutePreference;
  endOfDay?: EndOfDayDestination;
}

/** What the app writes. `created_at` and `updated_at` are set by the database. */
export interface UserStateWrite {
  user_id: string;
  schedule: SavedSchedule | null;
  preferences: SavedPreferences;
  onboarding_complete: boolean;
  schema_version: number;
}

/** A row after validation. */
export interface SavedAccountState {
  schedule?: SavedSchedule;
  preferences: SavedPreferences;
  /** True only when the row says so and a usable schedule survived validation. */
  onboardingComplete: boolean;
  updatedAt?: string;
  /** Something in the row failed validation and was dropped. */
  malformed: boolean;
}

const DEFAULT_BUFFER = DEFAULT_PLANNER_CONFIG.arrivalBufferMinutes;
const MAX_MEETINGS = 300;
/** Enough for a co-taught section; a cap so the row cannot be used as free storage. */
const MAX_INSTRUCTORS = 12;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const UNIVERSITIES = new Set<University>(["UW", "WLU"]);
const COMPONENTS = new Set<Component>(["LEC", "TUT", "LAB", "SEM", "PRJ", "PRA", "DIS", "TST", "STU", "FLD", "CLN", "OTHER"]);
const DAYS = new Set<DayOfWeek>(DAYS_IN_ORDER);
const SEASONS = new Set<TermInfo["season"]>(["Fall", "Winter", "Spring"]);
const SOURCES = new Set<SavedSchedule["source"]>(["QUEST", "MANUAL", "MIXED"]);

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const absent = (v: unknown) => v === undefined || v === null;
const text = (v: unknown, max: number): string | undefined => (typeof v === "string" && v.length > 0 && v.length <= max ? v : undefined);
const int = (v: unknown, min: number, max: number): number | undefined =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : undefined;
const isoInstant = (v: unknown): string | undefined => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? v : undefined);

export function sanitizeLocation(raw: unknown): RawLocation | undefined {
  if (!isObj(raw)) return undefined;
  if (raw.kind === "ONLINE" || raw.kind === "TBA") return { kind: raw.kind };
  if (raw.kind !== "ROOM") return undefined;
  const buildingCode = text(raw.buildingCode, 20);
  const roomNumber = text(raw.roomNumber, 20);
  return buildingCode && roomNumber ? { kind: "ROOM", buildingCode, roomNumber } : undefined;
}

/**
 * One class meeting, or undefined. An optional field that is present but invalid rejects the
 * whole meeting: dropping only a bad `startDate`, say, would silently put the class in every week.
 */
export function sanitizeMeeting(raw: unknown): CourseMeeting | undefined {
  if (!isObj(raw)) return undefined;
  const id = text(raw.id, 64);
  const courseCode = text(raw.courseCode, 40);
  const university = UNIVERSITIES.has(raw.university as University) ? (raw.university as University) : undefined;
  const component = COMPONENTS.has(raw.component as Component) ? (raw.component as Component) : undefined;
  const location = sanitizeLocation(raw.location);
  const start = int(raw.start, 0, 1439);
  const end = int(raw.end, 0, 1439);
  if (!id || !courseCode || !university || !component || !location || start === undefined || end === undefined) return undefined;
  if (!Array.isArray(raw.days) || !raw.days.every((d) => DAYS.has(d as DayOfWeek))) return undefined;
  if (raw.source !== "QUEST" && raw.source !== "MANUAL") return undefined;
  if (typeof raw.includeInPlan !== "boolean") return undefined;

  const meeting: CourseMeeting = {
    id, university, courseCode, component,
    days: [...new Set(raw.days as DayOfWeek[])],
    start, end, location,
    source: raw.source,
    includeInPlan: raw.includeInPlan,
  };
  if (!absent(raw.courseTitle)) { const v = text(raw.courseTitle, 300); if (!v) return undefined; meeting.courseTitle = v; }
  if (!absent(raw.classNumber)) { const v = int(raw.classNumber, 0, 99_999_999); if (v === undefined) return undefined; meeting.classNumber = v; }
  if (!absent(raw.section)) { const v = text(raw.section, 20); if (!v) return undefined; meeting.section = v; }
  for (const key of ["startDate", "endDate"] as const) {
    if (absent(raw[key])) continue;
    if (typeof raw[key] !== "string" || !ISO_DATE.test(raw[key] as string)) return undefined;
    meeting[key] = raw[key] as string;
  }
  if (!absent(raw.unscheduled)) { if (typeof raw.unscheduled !== "boolean") return undefined; if (raw.unscheduled) meeting.unscheduled = true; }
  if (!absent(raw.laurierCode)) { const v = text(raw.laurierCode, 20); if (!v) return undefined; meeting.laurierCode = v; }
  if (!absent(raw.instructors)) {
    if (!Array.isArray(raw.instructors)) return undefined;
    const list = raw.instructors.slice(0, MAX_INSTRUCTORS).map((x) => text(x, 120));
    if (list.some((x) => x === undefined)) return undefined;
    if (list.length) meeting.instructors = list as string[];
  }
  return meeting;
}

function sanitizeTerm(raw: unknown): TermInfo | undefined {
  if (!isObj(raw)) return undefined;
  const season = SEASONS.has(raw.season as TermInfo["season"]) ? (raw.season as TermInfo["season"]) : undefined;
  const year = int(raw.year, 2000, 2100);
  const termId = int(raw.termId, 0, 9999);
  if (!season || year === undefined || termId === undefined) return undefined;
  const term: TermInfo = { season, year, termId };
  if (!absent(raw.level)) { const v = text(raw.level, 100); if (!v) return undefined; term.level = v; }
  if (!absent(raw.institution)) { const v = text(raw.institution, 200); if (!v) return undefined; term.institution = v; }
  return term;
}

export function sanitizeSchedule(raw: unknown): { schedule?: SavedSchedule; dropped: number } {
  if (absent(raw)) return { dropped: 0 };
  if (!isObj(raw) || !Array.isArray(raw.meetings)) return { dropped: 1 };
  const list = raw.meetings as unknown[];
  let dropped = Math.max(0, list.length - MAX_MEETINGS);
  const meetings: CourseMeeting[] = [];
  const seen = new Set<string>();
  for (const item of list.slice(0, MAX_MEETINGS)) {
    const m = sanitizeMeeting(item);
    if (!m || seen.has(m.id)) { dropped++; continue; }
    seen.add(m.id);
    meetings.push(m);
  }
  if (meetings.length === 0) return { dropped };

  const term = absent(raw.term) ? undefined : sanitizeTerm(raw.term);
  if (!absent(raw.term) && !term) dropped++;
  const importedAt = isoInstant(raw.importedAt);
  if (!importedAt) dropped++;
  const source = SOURCES.has(raw.source as SavedSchedule["source"]) ? (raw.source as SavedSchedule["source"]) : undefined;
  if (!source) dropped++;
  const schedule: SavedSchedule = { meetings, importedAt: importedAt ?? new Date(0).toISOString(), source: source ?? "MIXED" };
  if (term) schedule.term = term;
  return { schedule, dropped };
}

export function sanitizeHome(raw: unknown): UserHome | undefined {
  if (!isObj(raw)) return undefined;
  const name = text(raw.name, 200);
  const { latitude, longitude } = raw;
  if (!name || typeof latitude !== "number" || typeof longitude !== "number") return undefined;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return undefined;
  const home: UserHome = { name, latitude, longitude };
  if (!absent(raw.address)) { const v = text(raw.address, 300); if (!v) return undefined; home.address = v; }
  if (!absent(raw.preset)) {
    const p = raw.preset;
    if (!isObj(p) || !UNIVERSITIES.has(p.university as University)) return undefined;
    const buildingCode = text(p.buildingCode, 20);
    if (!buildingCode) return undefined;
    home.preset = { university: p.university as University, buildingCode };
  }
  return home;
}

export function sanitizePreferences(raw: unknown): { preferences: SavedPreferences; dropped: number } {
  const preferences: SavedPreferences = { arrivalBufferMinutes: DEFAULT_BUFFER };
  if (absent(raw)) return { preferences, dropped: 0 };
  if (!isObj(raw)) return { preferences, dropped: 1 };
  let dropped = 0;
  if (!absent(raw.home)) { const home = sanitizeHome(raw.home); if (home) preferences.home = home; else dropped++; }
  if (!absent(raw.arrivalBufferMinutes)) {
    if ((ARRIVAL_BUFFER_CHOICES as readonly number[]).includes(raw.arrivalBufferMinutes as number)) preferences.arrivalBufferMinutes = raw.arrivalBufferMinutes as number;
    else dropped++;
  }
  if (!absent(raw.gym)) { const gym = isObj(raw.gym) ? migrateGym(raw.gym) : undefined; if (gym) preferences.gym = gym; else dropped++; }
  if (!absent(raw.routePreference)) {
    if (raw.routePreference === "FASTEST" || raw.routePreference === "INDOORS") preferences.routePreference = raw.routePreference;
    else dropped++;
  }
  if (!absent(raw.endOfDay)) {
    const e = migrateEndOfDay(raw.endOfDay);
    if (e) preferences.endOfDay = e;
    else dropped++;
  }
  return { preferences, dropped };
}

/** Validate a row read from Supabase. Never throws; anything unusable is dropped and flagged. */
export function parseUserStateRow(raw: unknown): SavedAccountState {
  if (!isObj(raw)) return { preferences: { arrivalBufferMinutes: DEFAULT_BUFFER }, onboardingComplete: false, malformed: true };
  const s = sanitizeSchedule(raw.schedule);
  const p = sanitizePreferences(raw.preferences);
  const updatedAt = raw.updated_at instanceof Date ? raw.updated_at.toISOString() : isoInstant(raw.updated_at);
  return {
    schedule: s.schedule,
    preferences: p.preferences,
    onboardingComplete: raw.onboarding_complete === true && Boolean(s.schedule),
    updatedAt,
    malformed: s.dropped + p.dropped > 0 || typeof raw.onboarding_complete !== "boolean",
  };
}

/**
 * The part of the app state that belongs to the account. Instructors travel with it: the
 * Courses tab shows them, and for a Laurier-hosted course the professor is exactly the
 * information Quest does not carry and a LORIS import was used to fill in.
 */
export function persistedFrom(state: AppState): { schedule?: SavedSchedule; preferences: SavedPreferences } {
  const schedule = state.schedule && state.schedule.meetings.length > 0 ? state.schedule : undefined;
  return {
    schedule,
    preferences: {
      home: state.home,
      arrivalBufferMinutes: state.config.arrivalBufferMinutes,
      gym: state.gym,
      routePreference: state.routePreference,
      endOfDay: state.endOfDay,
    },
  };
}

export function toUserStateWrite(userId: string, state: AppState): UserStateWrite {
  const { schedule, preferences } = persistedFrom(state);
  return {
    user_id: userId,
    schedule: schedule ?? null,
    preferences,
    onboarding_complete: Boolean(schedule && preferences.home),
    schema_version: USER_STATE_SCHEMA_VERSION,
  };
}

/** JSON with sorted keys and undefined dropped, so equal content always gives an equal string. */
export function stableStringify(value: unknown): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (isObj(v)) {
      const out: Obj = {};
      for (const k of Object.keys(v).sort()) if (v[k] !== undefined) out[k] = sort(v[k]);
      return out;
    }
    return v;
  };
  return JSON.stringify(sort(value));
}

/** Changes to this key are the "meaningful" changes worth saving; gap answers and UI state are not in it. */
export function persistedKey(state: AppState): string {
  return stableStringify(persistedFrom(state));
}

const hasSchedule = (state: AppState) => (state.schedule?.meetings.length ?? 0) > 0;
const hasUserData = (state: AppState) => hasSchedule(state) || Boolean(state.home);
const hasPreferences = (a: SavedAccountState) =>
  Boolean(a.preferences.home || a.preferences.gym || a.preferences.routePreference) || a.preferences.arrivalBufferMinutes !== DEFAULT_BUFFER;

export type LoadDecision =
  /** Take the account's copy. */
  | "HYDRATE"
  /** The device's copy is newer or more complete: upload it. */
  | "UPLOAD"
  /** Nothing to take and nothing worth uploading (a new student, or an unusable row). */
  | "KEEP";

/**
 * What to do once the account's row (or its absence) is known. `local` must already belong to
 * this account or to nobody; another account's copy is discarded before this is asked.
 */
export function decideOnLoad(local: AppState, account: SavedAccountState | undefined): LoadDecision {
  const dirtySince = local.sync?.dirtySince;
  const localNewer = Boolean(dirtySince) && hasUserData(local)
    && (!account?.updatedAt || Date.parse(dirtySince!) > Date.parse(account.updatedAt));
  if (localNewer) return "UPLOAD";
  if (account?.schedule) return "HYDRATE";
  if (hasSchedule(local)) return "UPLOAD";
  if (account && hasPreferences(account)) return "HYDRATE";
  return "KEEP";
}

/** The local state with the account's copy applied. Gap answers stay, minus classes that no longer exist. */
export function applyAccount(local: AppState, account: SavedAccountState, userId: string): AppState {
  return {
    ...local,
    schedule: account.schedule,
    home: account.preferences.home,
    config: { ...local.config, arrivalBufferMinutes: account.preferences.arrivalBufferMinutes },
    gym: account.preferences.gym,
    routePreference: account.preferences.routePreference,
    endOfDay: account.preferences.endOfDay,
    gapChoices: local.gapChoices && forgetMissingClasses(local.gapChoices, account.schedule?.meetings.map((m) => m.id) ?? []),
    sync: { ownerId: userId },
  };
}

/** Save without waiting when onboarding completes, the schedule is replaced or cleared, or nothing is confirmed yet. */
export function isMilestone(previous: UserStateWrite | undefined, next: UserStateWrite): boolean {
  if (!previous) return true;
  if (previous.onboarding_complete !== next.onboarding_complete) return true;
  return (previous.schedule?.importedAt ?? null) !== (next.schedule?.importedAt ?? null);
}
