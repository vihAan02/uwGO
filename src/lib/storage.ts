import type { CourseMeeting, TermInfo, UserHome } from "@/domain/types";
import { DEFAULT_PLANNER_CONFIG, type PlannerConfig } from "@/domain/config";

/** Everything the app persists. Versioned so a future shape change can migrate instead of crash. */
export interface AppState {
  schemaVersion: 1;
  schedule?: { meetings: CourseMeeting[]; term?: TermInfo; importedAt: string; source: "QUEST" | "MANUAL" | "MIXED" };
  home?: UserHome;
  config: PlannerConfig;
}

export const STORAGE_KEY = "uwgo.state.v1";

export function emptyState(): AppState {
  return { schemaVersion: 1, config: { ...DEFAULT_PLANNER_CONFIG } };
}

function migrate(raw: unknown): AppState {
  if (!raw || typeof raw !== "object") return emptyState();
  const obj = raw as Partial<AppState>;
  if (obj.schemaVersion !== 1) return emptyState();
  return { ...emptyState(), ...obj, config: { ...DEFAULT_PLANNER_CONFIG, ...(obj.config ?? {}) } };
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
