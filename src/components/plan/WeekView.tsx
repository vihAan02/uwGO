"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { addDays } from "date-fns";
import type { CampusLocation, DayOfWeek } from "@/domain/types";
import { DAY_LABELS, DAYS_IN_ORDER } from "@/domain/types";
import { useStore } from "@/lib/store";
import { defaultWeekStart, usePlan } from "@/lib/usePlan";
import { findNextUp } from "@/lib/nextClass";
import { usePacLive } from "@/lib/usePacLive";
import { RemindersProvider, useReminders } from "@/lib/useReminders";
import { CROWD_LABELS, estimateFromPct, waitLabel } from "@/data/pac/crowd";
import { formatISODate, mondayOfWeek, todayISO, torontoDate, weekdayOf } from "@/time/toronto";
import { DayTimeline } from "./DayTimeline";
import { NextClassCard } from "./NextClassCard";
import { SettingsSheet } from "./SettingsSheet";
import type { MapSelection } from "../map/MapPanel";
import type { Trip } from "../map/TripMode";

const MapPanel = dynamic(() => import("../map/MapPanel").then((m) => m.MapPanel), {
  ssr: false,
  loading: () => <div className="h-64 animate-pulse rounded-xl bg-line lg:h-[70vh]" />,
});
const TripMode = dynamic(() => import("../map/TripMode").then((m) => m.TripMode), { ssr: false });

export function WeekView() {
  const router = useRouter();
  const { state, hydrated, setGapChoice } = useStore();
  const meetings = state.schedule?.meetings;
  const [weekOverride, setWeekStart] = useState<string | undefined>();
  const [day, setDay] = useState<DayOfWeek>(() => { const d = weekdayOf(todayISO()); return d === "S" || d === "Su" ? "M" : d; });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [picked, setPicked] = useState<{ id: string; selection: MapSelection } | undefined>();
  const [trip, setTrip] = useState<Trip | undefined>();

  useEffect(() => {
    if (hydrated && !meetings?.length) router.replace("/");
  }, [hydrated, meetings, router]);

  const monday = useMemo(() => weekOverride ?? (meetings ? defaultWeekStart(meetings) : mondayOfWeek(todayISO())), [weekOverride, meetings]);
  const pac = usePacLive(Boolean(hydrated && state.gym?.enabled));
  const { plan, loading, error } = usePlan(hydrated ? meetings : undefined, state.home, state.config, monday, { gym: state.gym, routePreference: state.routePreference, gapChoices: state.gapChoices, pacLive: pac.reading, pacSamples: pac.samples });
  const pacNow = pac.reading ? estimateFromPct(pac.reading.occupancyPct, "LIVE") : undefined;
  const visibleDays = useMemo(() => DAYS_IN_ORDER.filter((d) => ["M", "T", "W", "Th", "F"].includes(d) || (plan?.days[d]?.classes.length ?? 0) > 0), [plan]);
  const dayPlan = plan?.days[day];
  const isThisWeek = monday === mondayOfWeek(todayISO());
  const next = useMemo(() => findNextUp(plan, new Date(), dayPlan), [plan, dayPlan]);
  const focusClassId = dayPlan?.date === todayISO() && next.day?.date === dayPlan?.date ? next.scheduledClass?.id : undefined;

  /** Everywhere the student has to be on the selected day, home included. */
  const overview = useMemo<MapSelection>(() => {
    const stops: { at: CampusLocation; label: string }[] = [];
    if (state.home) stops.push({ at: { id: "home", name: state.home.name, latitude: state.home.latitude, longitude: state.home.longitude, kind: "HOME" }, label: "Home" });
    for (const c of dayPlan?.classes ?? []) stops.push({ at: c.location, label: c.meeting.courseCode });
    return { kind: "DAY", label: `${DAY_LABELS[day]} · ${stops.length} place${stops.length === 1 ? "" : "s"}`, stops };
  }, [dayPlan, state.home, day]);

  const selection = picked?.selection ?? overview;
  const hasStops = selection.kind !== "DAY" || selection.stops.length > 0;
  const startable = selection.kind === "LEG" && selection.route && selection.route.durationMinutes > 0 ? selection : undefined;
  // "Lazaridis Hall" fits on the button; "William G. Davis Computer Research Centre" does not.
  const destinationLabel = !startable ? "" : startable.to.name.length <= 18 ? startable.to.name : (startable.to.buildingCode ?? startable.to.name);

  const mapBlock = (
    <div className="space-y-2">
      {hasStops && <MapPanel selection={selection} heightClass="h-64 lg:h-[calc(100vh-13rem)]" />}
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="min-w-0 truncate font-medium text-ink">{selection.label}</span>
        {picked && <button className="shrink-0 text-brand" onClick={() => setPicked(undefined)}>Show whole day</button>}
      </div>
      {startable && (
        <button
          className="btn btn-primary w-full text-base"
          onClick={() => setTrip({ label: startable.label, from: startable.from, to: startable.to, route: startable.route!, walkFallback: startable.walkFallback })}
        >
          Start Trip to {destinationLabel}
        </button>
      )}
    </div>
  );

  return (
    <RemindersProvider plan={plan}>
    <main className="mx-auto w-full max-w-6xl pb-16">
      <ReminderBanner />
      <header className="sticky top-0 z-10 border-b border-line bg-canvas/95 backdrop-blur">
        <div className="flex items-center justify-between px-4 pt-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-brand">UW GO</p>
            <div className="flex items-center gap-1 text-sm text-ink-muted">
              <button aria-label="Previous week" className="-ml-2 flex min-h-11 min-w-11 items-center justify-center rounded-lg text-lg hover:bg-line" onClick={() => setWeekStart(formatISODate(addDays(torontoDate(monday, 12), -7)))}>&lsaquo;</button>
              <span>Week of {monday}{isThisWeek ? " · this week" : ""}</span>
              {!isThisWeek && (
                <button className="rounded-lg px-2 py-1 font-medium text-brand hover:bg-line" onClick={() => { setWeekStart(mondayOfWeek(todayISO())); const d = weekdayOf(todayISO()); setDay(d === "S" || d === "Su" ? "M" : d); setPicked(undefined); }}>Today</button>
              )}
              <button aria-label="Next week" className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-lg hover:bg-line" onClick={() => setWeekStart(formatISODate(addDays(torontoDate(monday, 12), 7)))}>&rsaquo;</button>
            </div>
          </div>
          <button className="btn btn-secondary px-3 py-2 min-h-0 text-sm" onClick={() => setSettingsOpen(true)}>Settings</button>
        </div>
        <nav className="mt-3 flex gap-1 overflow-x-auto px-4 pb-3">
          {visibleDays.map((d) => {
            const count = plan?.days[d]?.classes.length ?? 0;
            const active = d === day;
            return (
              <button key={d} onClick={() => { setDay(d); setPicked(undefined); }} className={`flex min-w-16 flex-1 flex-col items-center rounded-xl px-2 py-2 ${active ? "bg-ink text-white" : "bg-surface text-ink border border-line"}`}>
                <span className="text-sm font-semibold">{DAY_LABELS[d]}</span>
                <span className={`text-xs ${active ? "text-white/70" : "text-ink-muted"}`}>{count ? `${count} class${count > 1 ? "es" : ""}` : "free"}</span>
              </button>
            );
          })}
        </nav>
      </header>

      {/*
        One map instance only. A second, CSS-hidden copy would double the Dynamic Maps
        billing and, worse, compute its zoom from a zero-size box: fitBounds on a hidden
        map leaves the pins off screen when it later becomes visible on a phone.
        So the map is placed by grid position, not duplicated.
      */}
      <div className="px-4 pt-4 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-start lg:gap-6">
        <div className="lg:col-start-1 lg:row-start-1">
          {pacNow && state.gym?.enabled && (
            <div className="mb-3 flex items-center justify-between rounded-xl bg-surface px-3 py-2 text-sm">
              <span><span className="font-semibold">PAC now:</span> {CROWD_LABELS[pacNow.level]} ({pacNow.occupancyPct}% full)</span>
              <span className="text-ink-muted">Est. machine wait {waitLabel(pacNow)}</span>
            </div>
          )}
          {plan && <NextClassCard next={next} onSelect={() => {
            const t = next.transition;
            if (t?.recommendedRoute) setPicked({ id: "next", selection: { kind: "LEG", label: `Next: ${t.from.name} \u2192 ${t.to.name}`, from: t.from, to: t.to, route: t.recommendedRoute, walkFallback: t.walkingRoute } });
            else if (next.scheduledClass) setPicked({ id: "next", selection: { kind: "PLACE", label: next.scheduledClass.meeting.courseCode, at: next.scheduledClass.location } });
          }} />}
        </div>

        <div className="mt-3 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:mt-0 lg:sticky lg:top-32">{mapBlock}</div>

        <section className="mt-3 min-w-0 space-y-3 lg:col-start-1 lg:row-start-2 lg:mt-4">
          {plan?.usesEstimates && (
            <div className="rounded-xl bg-warn-soft p-3 text-sm text-warn">Travel times are straight-line estimates: no <code className="font-mono">GOOGLE_MAPS_SERVER_KEY</code> is configured. Transit options are unavailable in this mode.</div>
          )}
          {error && <div className="rounded-xl bg-bad-soft p-3 text-sm text-bad">{error}</div>}
          {loading && !dayPlan && <p className="py-10 text-center text-ink-muted">Building your routes&hellip;</p>}
          {dayPlan && <DayTimeline plan={dayPlan} home={state.home} busy={loading} sel={{ selectedId: picked?.id, onSelect: (id, sl) => setPicked({ id, selection: sl }) }} focusClassId={focusClassId} onChooseGap={setGapChoice} />}
          {plan && plan.skipped.length > 0 && (
            <details className="mt-6 text-sm text-ink-muted">
              <summary className="cursor-pointer">{plan.skipped.length} meeting{plan.skipped.length > 1 ? "s" : ""} not on the map</summary>
              <ul className="mt-2 space-y-1">
                {plan.skipped.map((sk) => <li key={sk.meeting.id}>{sk.meeting.courseCode} {sk.meeting.component}: {sk.reason}</li>)}
              </ul>
            </details>
          )}
        </section>
      </div>

      {settingsOpen && <SettingsSheet onClose={() => setSettingsOpen(false)} />}
      {trip && <TripMode trip={trip} onEnd={() => setTrip(undefined)} />}
    </main>
    </RemindersProvider>
  );
}

/** Shown when a reminder is due but no system notification could be shown (permission denied or unsupported). */
function ReminderBanner() {
  const rem = useReminders();
  if (!rem.banner) return null;
  return (
    <div role="alert" className="fixed inset-x-0 top-0 z-30 flex items-start justify-between gap-3 bg-ink px-4 py-3 text-white shadow-lg">
      <div>
        <div className="font-semibold">{"\u{1F514}"} {rem.banner.title}</div>
        <div className="text-sm text-white/80">{rem.banner.body}</div>
      </div>
      <button className="min-h-11 rounded-lg bg-white/15 px-3 text-sm font-semibold" onClick={rem.dismissBanner}>OK</button>
    </div>
  );
}
