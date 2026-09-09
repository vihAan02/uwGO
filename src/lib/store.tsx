"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { CourseMeeting, TermInfo, UserHome } from "@/domain/types";
import type { PlannerConfig } from "@/domain/config";
import { type AppState, emptyState, loadState, saveState, clearState } from "./storage";

interface StoreApi {
  state: AppState;
  hydrated: boolean;
  setSchedule(meetings: CourseMeeting[], term: TermInfo | undefined, source: "QUEST" | "MANUAL"): void;
  addMeeting(meeting: CourseMeeting): void;
  removeMeeting(id: string): void;
  setIncludeInPlan(id: string, include: boolean): void;
  setHome(home: UserHome | undefined): void;
  setConfig(patch: Partial<PlannerConfig>): void;
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
    removeMeeting: (id) => update((s) => s.schedule ? { ...s, schedule: { ...s.schedule, meetings: s.schedule.meetings.filter((m) => m.id !== id) } } : s),
    setIncludeInPlan: (id, include) => update((s) => s.schedule ? { ...s, schedule: { ...s.schedule, meetings: s.schedule.meetings.map((m) => (m.id === id ? { ...m, includeInPlan: include } : m)) } } : s),
    setHome: (home) => update((s) => ({ ...s, home })),
    setConfig: (patch) => update((s) => ({ ...s, config: { ...s.config, ...patch } })),
    reset: () => { clearState(); setState(emptyState()); },
  }), [state, hydrated, update]);

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useStore(): StoreApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("useStore must be used inside StoreProvider");
  return v;
}
