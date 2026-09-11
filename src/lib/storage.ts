import type { CourseMeeting, EndOfDayDestination, GymPreferences, RoutePreference, TermInfo, UserHome } from "@/domain/types";
import type { GapChoices } from "@/domain/gapChoices";
import { migrateGapChoices } from "./gapChoices";
import { todayISO } from "@/time/toronto";
import { GYM_DURATIONS } from "@/domain/types";
import { DEFAULT_PLANNER_CONFIG, USER_CONFIG_KEYS, type PlannerConfig } from "@/domain/config";

/** Everything the app persists. Versioned so a future shape change can migrate instead of crash. */
export interface AppState {
  schemaVersion: 1;
  schedule?: { meetings: CourseMeeting[]; term?: TermInfo; importedAt: string; source: "QUEST" | "MANUAL" | "MIXED" };
  home?: UserHome;
  config: PlannerConfig;
  /** Undefined until the student has answered "do you work out?". */
  gym?: GymPreferences;
  routePreference?: RoutePreference;
  /** Where the day ends after the last class. Undefined means HOME (the default). */
  endOfDay?: EndOfDayDestination;
  /**
   * What to do with each gap. Per device on purpose: this is a day-to-day decision about one
   * afternoon, not a preference, so it is never saved to the account.
   */
  gapChoices?: GapChoices;
  /** Which account this device's copy belongs to, and whether it has changes the account has not confirmed. */
  sync?: SyncMeta;
}

/**
 * Bookkeeping for the account copy in Supabase (src/lib/userStateSync.ts). `ownerId` stops one
 * student's schedule being shown to, or uploaded by, the next student on a shared device.
 * `dirtySince` is when the first unconfirmed change was made, so a device that edited offline
 * can tell whether its copy is newer than the account's.
 */
export interface SyncMeta {
  ownerId?: string;
  dirtySince?: string;
}

export const DEFAULT_GYM: GymPreferences = { enabled: false, durationMinutes: 60, preferredTime: "NONE" };

const GYM_TIMES = new Set<GymPreferences["preferredTime"]>(["MORNING", "AFTERNOON", "EVENING", "LEAST_BUSY", "NONE"]);

export function migrateGym(raw: unknown): GymPreferences | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const g = raw as Partial<GymPreferences>;
  return {
    enabled: g.enabled === true,
    durationMinutes: (GYM_DURATIONS as readonly number[]).includes(g.durationMinutes as number) ? (g.durationMinutes as GymPreferences["durationMinutes"]) : 60,
    preferredTime: GYM_TIMES.has(g.preferredTime as GymPreferences["preferredTime"]) ? (g.preferredTime as GymPreferences["preferredTime"]) : "NONE",
  };
}

const END_OF_DAY = new Set<EndOfDayDestination>(["HOME", "GYM", "LIBRARY"]);

export function migrateEndOfDay(raw: unknown): EndOfDayDestination | undefined {
  return END_OF_DAY.has(raw as EndOfDayDestination) ? (raw as EndOfDayDestination) : undefined;
}

function migrateSync(raw: unknown): SyncMeta | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const s = raw as Partial<SyncMeta>;
  const ownerId = typeof s.ownerId === "string" && s.ownerId.length > 0 && s.ownerId.length <= 64 ? s.ownerId : undefined;
  const dirtySince = typeof s.dirtySince === "string" && !Number.isNaN(Date.parse(s.dirtySince)) ? s.dirtySince : undefined;
  return ownerId || dirtySince ? { ownerId, dirtySince } : undefined;
}

export const STORAGE_KEY = "uwgo.state.v1";

export function emptyState(): AppState {
  return { schemaVersion: 1, config: { ...DEFAULT_PLANNER_CONFIG } };
}

function migrate(raw: unknown): AppState {
  if (!raw || typeof raw !== "object") return emptyState();
  const obj = raw as Partial<AppState>;
  if (obj.schemaVersion !== 1) return emptyState();
  // Only the student's own choices survive a reload; engine thresholds always come from the
  // current defaults, otherwise a retuned engine would keep running on numbers saved months ago.
  const config: PlannerConfig = { ...DEFAULT_PLANNER_CONFIG };
  for (const k of USER_CONFIG_KEYS) {
    const v = obj.config?.[k];
    if (typeof v === "number" && Number.isFinite(v)) config[k] = v;
  }
  const routePreference: RoutePreference | undefined = obj.routePreference === "INDOORS" ? "INDOORS" : obj.routePreference === "FASTEST" ? "FASTEST" : undefined;
  // Everything below has to come AFTER the spread: `...obj` is raw parsed JSON, so a field
  // that is not explicitly overridden here arrives unvalidated.
  return { ...emptyState(), ...obj, config, gym: migrateGym(obj.gym), routePreference, endOfDay: migrateEndOfDay(obj.endOfDay), gapChoices: migrateGapChoices(obj.gapChoices, todayISO()), sync: migrateSync(obj.sync) };
}

export function loadState(storage: Pick<Storage, "getItem"> | undefined = typeof window !== "undefined" ? window.localStorage : undefined): AppState {
  if (!storage) return emptyState();
  try {
    const raw = storage.getItem(STORAGE_KEY);
    return raw ? migrate(JSON.parse(raw)) : emptyState();
  } catch {
    return emptyState();
  }
}

export function saveState(state: AppState, storage: Pick<Storage, "setItem"> | undefined = typeof window !== "undefined" ? window.localStorage : undefined): boolean {
  if (!storage) return false;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false; // private mode / quota: the app keeps working from memory
  }
}

export function clearState(storage: Pick<Storage, "removeItem"> | undefined = typeof window !== "undefined" ? window.localStorage : undefined): void {
  try { storage?.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}
