"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { addDays } from "date-fns";
import type { DayOfWeek } from "@/domain/types";
import { DAY_LABELS, DAYS_IN_ORDER } from "@/domain/types";
import { useStore } from "@/lib/store";
import { defaultWeekStart, usePlan } from "@/lib/usePlan";
import { MAPS_AVAILABLE } from "@/lib/mapsLinks";
import { formatISODate, mondayOfWeek, todayISO, torontoDate, weekdayOf } from "@/time/toronto";
import { DayTimeline } from "./DayTimeline";
import { SettingsSheet } from "./SettingsSheet";

export function WeekView() {
  const router = useRouter();
  const { state, hydrated } = useStore();
  const meetings = state.schedule?.meetings;
  const [weekOverride, setWeekStart] = useState<string | undefined>();
  const [day, setDay] = useState<DayOfWeek>(() => { const d = weekdayOf(todayISO()); return d === "S" || d === "Su" ? "M" : d; });
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    if (hydrated && !meetings?.length) router.replace("/");
  }, [hydrated, meetings, router]);

  const monday = useMemo(() => weekOverride ?? (meetings ? defaultWeekStart(meetings) : mondayOfWeek(todayISO())), [weekOverride, meetings]);
  const { plan, loading, error } = usePlan(hydrated ? meetings : undefined, state.home, state.config, monday);
  const visibleDays = useMemo(() => DAYS_IN_ORDER.filter((d) => ["M", "T", "W", "Th", "F"].includes(d) || (plan?.days[d]?.classes.length ?? 0) > 0), [plan]);
  const dayPlan = plan?.days[day];
  const isThisWeek = monday === mondayOfWeek(todayISO());

  return (
    <main className="mx-auto w-full max-w-xl pb-16">
      <header className="sticky top-0 z-10 border-b border-line bg-canvas/95 backdrop-blur">
        <div className="flex items-center justify-between px-4 pt-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-brand">UW GO</p>
            <div className="flex items-center gap-2 text-sm text-ink-muted">
              <button aria-label="Previous week" className="rounded-lg px-2 py-1 hover:bg-line" onClick={() => setWeekStart(formatISODate(addDays(torontoDate(monday, 12), -7)))}>‹</button>
              <span>Week of {monday}{isThisWeek ? " · this week" : ""}</span>
              <button aria-label="Next week" className="rounded-lg px-2 py-1 hover:bg-line" onClick={() => setWeekStart(formatISODate(addDays(torontoDate(monday, 12), 7)))}>›</button>
            </div>
          </div>
          <button className="btn btn-secondary px-3 py-2 min-h-0 text-sm" onClick={() => setSettingsOpen(true)}>Settings</button>
        </div>
        <nav className="mt-3 flex gap-1 overflow-x-auto px-4 pb-3">
          {visibleDays.map((d) => {
            const count = plan?.days[d]?.classes.length ?? 0;
            const active = d === day;
            return (
              <button key={d} onClick={() => setDay(d)} className={`flex min-w-16 flex-1 flex-col items-center rounded-xl px-2 py-2 ${active ? "bg-ink text-white" : "bg-surface text-ink border border-line"}`}>
                <span className="text-sm font-semibold">{DAY_LABELS[d]}</span>
                <span className={`text-xs ${active ? "text-white/70" : "text-ink-muted"}`}>{count ? `${count} class${count > 1 ? "es" : ""}` : "free"}</span>
              </button>
            );
          })}
        </nav>
      </header>

      <section className="px-4 pt-4">
        {plan?.usesEstimates && (
          <div className="mb-3 rounded-xl bg-warn-soft p-3 text-sm text-warn">Travel times are straight-line estimates: no routing API key is configured on this server. Transit options are unavailable in this mode.</div>
        )}
        {plan && !MAPS_AVAILABLE && (
          <div className="mb-3 rounded-xl bg-canvas p-3 text-sm text-ink-muted">Map previews are off: no browser map key is configured. Each leg still has an “Open in Google Maps” link.</div>
        )}
        {error && <div className="mb-3 rounded-xl bg-bad-soft p-3 text-sm text-bad">{error}</div>}
        {loading && !dayPlan && <p className="py-10 text-center text-ink-muted">Building your routes…</p>}
        {dayPlan && <DayTimeline plan={dayPlan} home={state.home} config={state.config} busy={loading} />}
        {plan && plan.skipped.length > 0 && (
          <details className="mt-6 text-sm text-ink-muted">
            <summary className="cursor-pointer">{plan.skipped.length} meeting{plan.skipped.length > 1 ? "s" : ""} not on the map</summary>
            <ul className="mt-2 space-y-1">
              {plan.skipped.map((s) => <li key={s.meeting.id}>{s.meeting.courseCode} {s.meeting.component}: {s.reason}</li>)}
            </ul>
          </details>
        )}
      </section>

      {settingsOpen && <SettingsSheet onClose={() => setSettingsOpen(false)} />}
    </main>
  );
}
