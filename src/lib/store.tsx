"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { CourseMeeting, EndOfDayDestination, GapChoice, GymPreferences, RoutePreference, TermInfo, UserHome } from "@/domain/types";
import type { PlannerConfig } from "@/domain/config";
import { type AppState, emptyState, loadState, saveState, clearState } from "./storage";
import { forgetMissingClasses, setGapChoice } from "./gapChoices";

interface StoreApi {
  state: AppState;
  hydrated: boolean;
  setSchedule(meetings: CourseMeeting[], term: TermInfo | undefined, source: "QUEST" | "MANUAL"): void;
  addMeeting(meeting: CourseMeeting): void;
  removeMeeting(id: string): void;
  setIncludeInPlan(id: string, include: boolean): void;
  setHome(home: UserHome | undefined): void;
  setConfig(patch: Partial<PlannerConfig>): void;
  setGym(gym: GymPreferences | undefined): void;
  setRoutePreference(pref: RoutePreference): void;
  /** Where the day ends after the last class (HOME clears it back to the default). */
  setEndOfDay(dest: EndOfDayDestination): void;
  /** Answer one gap. `everyWeek` makes it the standing answer for that class; undefined clears both. */
  setGapChoice(dateISO: string, classId: string, choice: GapChoice | undefined, everyWeek: boolean): void;
  /** Replace the whole state at once, e.g. with the copy saved to the student's account. */
  replaceState(next: AppState): void;
  reset(): void;
}

const Ctx = createContext<StoreApi | undefined>(undefined);

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AppState>(emptyState);
  const [hydrated, setHydrated] = useState(false);
  const skipSave = useRef(true);

  useEffect(() => {
    // Read localStorage after mount (never during SSR); apply in a callback so React sees one hydration update.
    const loaded = loadState();
    const id = setTimeout(() => { setState(loaded); setHydrated(true); }, 0);
    return () => clearTimeout(id);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    if (skipSave.current) { skipSave.current = false; return; }
    saveState(state);
  }, [state, hydrated]);

  const update = useCallback((fn: (s: AppState) => AppState) => setState((s) => fn(s)), []);

  const api = useMemo<StoreApi>(() => ({
    state,
    hydrated,
    setSchedule: (meetings, term, source) => update((s) => {
      const manual = s.schedule?.meetings.filter((m) => m.source === "MANUAL") ?? [];
      const merged = source === "QUEST" ? [...meetings, ...manual] : meetings;
      return { ...s, schedule: { meetings: merged, term: term ?? s.schedule?.term, importedAt: new Date().toISOString(), source: manual.length && source === "QUEST" ? "MIXED" : source } };
    }),
    addMeeting: (meeting) => update((s) => {
      const existing = s.schedule?.meetings ?? [];
      if (existing.some((m) => m.id === meeting.id)) return s;
      return { ...s, schedule: { meetings: [...existing, meeting], term: s.schedule?.term, importedAt: s.schedule?.importedAt ?? new Date().toISOString(), source: s.schedule ? "MIXED" : "MANUAL" } };
    }),
    removeMeeting: (id) => update((s) => {
      if (!s.schedule) return s;
      const meetings = s.schedule.meetings.filter((m) => m.id !== id);
      // A dropped course should stop haunting the plan with last term's answers.
      return { ...s, schedule: { ...s.schedule, meetings }, gapChoices: forgetMissingClasses(s.gapChoices, meetings.map((m) => m.id)) };
    }),
    setIncludeInPlan: (id, include) => update((s) => s.schedule ? { ...s, schedule: { ...s.schedule, meetings: s.schedule.meetings.map((m) => (m.id === id ? { ...m, includeInPlan: include } : m)) } } : s),
    setHome: (home) => update((s) => ({ ...s, home })),
    setConfig: (patch) => update((s) => ({ ...s, config: { ...s.config, ...patch } })),
    setGym: (gym) => update((s) => ({ ...s, gym })),
    setRoutePreference: (routePreference) => update((s) => ({ ...s, routePreference })),
    setEndOfDay: (endOfDay) => update((s) => ({ ...s, endOfDay: endOfDay === "HOME" ? undefined : endOfDay })),
    setGapChoice: (dateISO, classId, choice, everyWeek) =>
      update((s) => ({ ...s, gapChoices: setGapChoice(s.gapChoices, dateISO, classId, choice, everyWeek) })),
    replaceState: (next) => update(() => next),
    reset: () => { clearState(); setState(emptyState()); },
  }), [state, hydrated, update]);

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useStore(): StoreApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("useStore must be used inside StoreProvider");
  return v;
}
