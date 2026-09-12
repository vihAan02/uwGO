"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { addDays, format } from "date-fns";
import { AlertTriangle, Bell, ChevronDown, ChevronLeft, ChevronRight, Dumbbell, Navigation, SlidersHorizontal } from "lucide-react";
import type { CampusLocation, DayOfWeek } from "@/domain/types";
import { DAY_LABELS, DAYS_IN_ORDER } from "@/domain/types";
import { useStore } from "@/lib/store";
import { useUserState } from "@/lib/UserStateProvider";
import { AccountLoadError, AccountLoading, AccountSyncNotice } from "@/components/account/AccountGate";
import { defaultWeekStart, usePlan } from "@/lib/usePlan";
import { findNextUp } from "@/lib/nextClass";
import { usePacLive } from "@/lib/usePacLive";
import { useClosures } from "@/lib/ClosuresProvider";
import { RemindersProvider, useReminders } from "@/lib/useReminders";
import { CROWD_LABELS, estimateFromPct, waitLabel } from "@/data/pac/crowd";
import { formatISODate, mondayOfWeek, todayISO, torontoDate, weekdayOf } from "@/time/toronto";
import { Button } from "@/components/ui/button";
import { Reveal } from "@/components/ui/reveal";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Wordmark } from "@/components/ui/wordmark";
import { AppTabs } from "@/components/nav/AppTabs";
import { DayTimeline } from "./DayTimeline";
import { NextClassCard } from "./NextClassCard";
import { SettingsSheet } from "./SettingsSheet";
import type { MapSelection } from "../map/MapPanel";
import type { Trip } from "../map/TripMode";

const MapPanel = dynamic(() => import("../map/MapPanel").then((m) => m.MapPanel), {
  ssr: false,
  loading: () => <div className="h-64 animate-pulse rounded-2xl bg-line/70 lg:h-[70vh]" />,
});
const TripMode = dynamic(() => import("../map/TripMode").then((m) => m.TripMode), { ssr: false });

export function WeekView() {
  const router = useRouter();
  const { state, hydrated, setGapChoice, setEndOfDay } = useStore();
  const account = useUserState();
  // The device's copy is only trusted once the account has answered (or there is no account).
  const accountSettled = account.status === "ready" || account.status === "local" || account.status === "offline";
  const meetings = state.schedule?.meetings;
  const [weekOverride, setWeekStart] = useState<string | undefined>();
  const [day, setDay] = useState<DayOfWeek>(() => { const d = weekdayOf(todayISO()); return d === "S" || d === "Su" ? "M" : d; });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [picked, setPicked] = useState<{ id: string; selection: MapSelection } | undefined>();
  const [trip, setTrip] = useState<Trip | undefined>();

  useEffect(() => {
    if (hydrated && accountSettled && !meetings?.length) router.replace("/setup");
  }, [hydrated, accountSettled, meetings, router]);

  const monday = useMemo(() => weekOverride ?? (meetings ? defaultWeekStart(meetings) : mondayOfWeek(todayISO())), [weekOverride, meetings]);
  const pac = usePacLive(Boolean(hydrated && state.gym?.enabled));
  const closures = useClosures();
  const { plan, loading, error } = usePlan(hydrated && account.status !== "loading" ? meetings : undefined, state.home, state.config, monday, { gym: state.gym, routePreference: state.routePreference, gapChoices: state.gapChoices, endOfDay: state.endOfDay, closedEdgeIds: closures.closed, pacLive: pac.reading, pacSamples: pac.samples });
  const pacNow = pac.reading ? estimateFromPct(pac.reading.occupancyPct, "LIVE") : undefined;
  const visibleDays = useMemo(() => DAYS_IN_ORDER.filter((d) => ["M", "T", "W", "Th", "F"].includes(d) || (plan?.days[d]?.classes.length ?? 0) > 0), [plan]);
  const dayPlan = plan?.days[day];
  const isThisWeek = monday === mondayOfWeek(todayISO());
  const weekLabel = format(torontoDate(monday, 12), "MMM d");
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

  const goToday = () => { setWeekStart(mondayOfWeek(todayISO())); const d = weekdayOf(todayISO()); setDay(d === "S" || d === "Su" ? "M" : d); setPicked(undefined); };

  const mapBlock = (
    <div className="space-y-2">
      {hasStops && <MapPanel selection={selection} heightClass="h-64 lg:h-[calc(100vh-13rem)]" />}
      <div className="flex min-h-8 items-center justify-between gap-2 text-sm">
        <span className="min-w-0 truncate font-medium">{selection.label}</span>
        {picked && <Button variant="link" size="xs" onClick={() => setPicked(undefined)}>Show whole day</Button>}
      </div>
      {startable && (
        <Button
          size="lg"
          className="w-full"
          onClick={() => setTrip({ label: startable.label, from: startable.from, to: startable.to, route: startable.route!, walkFallback: startable.walkFallback, preference: state.routePreference ?? "FASTEST" })}
        >
          <Navigation /> Start trip to {destinationLabel}
        </Button>
      )}
    </div>
  );

  if (account.status === "loading") return <AccountLoading />;
  if (account.status === "error" && !meetings?.length) return <AccountLoadError />;

  return (
    <RemindersProvider plan={plan}>
    <Tabs value={day} onValueChange={(d) => { setDay(d as DayOfWeek); setPicked(undefined); }} asChild>
    <main className="app mx-auto w-full max-w-6xl pb-16">
      <ReminderBanner />
      <header className="sticky top-0 z-10 border-b border-line bg-canvas/90 backdrop-blur">
        <div className="flex h-14 items-center justify-between gap-2 px-4 sm:px-6">
          <Wordmark />
          <div className="flex min-w-0 items-center gap-0.5 text-sm">
            <Button variant="ghost" size="icon-sm" aria-label="Previous week" onClick={() => setWeekStart(formatISODate(addDays(torontoDate(monday, 12), -7)))}><ChevronLeft /></Button>
            <span className="min-w-0 truncate px-1 font-medium tabular-nums">
              Week of {weekLabel}
              {isThisWeek && <span className="hidden font-normal text-ink-muted sm:inline"> · this week</span>}
            </span>
            {!isThisWeek && <Button variant="ghost" size="xs" className="text-brand" onClick={goToday}>Today</Button>}
            <Button variant="ghost" size="icon-sm" aria-label="Next week" onClick={() => setWeekStart(formatISODate(addDays(torontoDate(monday, 12), 7)))}><ChevronRight /></Button>
          </div>
          <Button variant="outline" size="icon-sm" aria-label="Settings" onClick={() => setSettingsOpen(true)}><SlidersHorizontal /></Button>
        </div>
        <div className="px-4 pb-2 sm:px-6"><AppTabs /></div>
        <TabsList className="px-4 pb-3 sm:px-6" aria-label="Day of the week">
          {visibleDays.map((d) => {
            const count = plan?.days[d]?.classes.length ?? 0;
            return (
              <TabsTrigger key={d} value={d}>
                <span>{DAY_LABELS[d]}</span>
                <span className="text-[11px] font-normal opacity-70">
                  <span className="sm:hidden">{count || "–"}</span>
                  <span className="hidden sm:inline">{count ? `${count} class${count > 1 ? "es" : ""}` : "free"}</span>
                </span>
              </TabsTrigger>
            );
          })}
        </TabsList>
      </header>

      <div className="px-4 pt-4 empty:hidden sm:px-6"><AccountSyncNotice /></div>

      {/*
        One map instance only. A second, CSS-hidden copy would double the Dynamic Maps
        billing and, worse, compute its zoom from a zero-size box: fitBounds on a hidden
        map leaves the pins off screen when it later becomes visible on a phone.
        So the map is placed by grid position, not duplicated.
      */}
      <div className="px-4 pt-4 sm:px-6 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-start lg:gap-8">
        <Reveal key={plan ? "ready" : "loading"} className="lg:col-start-1 lg:row-start-1" step={80}>
          {pacNow && state.gym?.enabled && (
            <div className="mb-3 flex items-center justify-between gap-3 px-1 text-sm">
              <span className="flex items-center gap-1.5"><Dumbbell className="size-4 text-ink-muted" aria-hidden="true" /><span className="font-medium">PAC now</span><span className="text-ink-muted">{CROWD_LABELS[pacNow.level]} · {pacNow.occupancyPct}% full</span></span>
              <span className="text-ink-muted">Wait {waitLabel(pacNow)}</span>
            </div>
          )}
          {plan && <div data-reveal><NextClassCard next={next} onSelect={() => {
            const t = next.transition;
            if (t?.recommendedRoute) setPicked({ id: "next", selection: { kind: "LEG", label: `Next: ${t.from.name} → ${t.to.name}`, from: t.from, to: t.to, route: t.recommendedRoute, walkFallback: t.walkingRoute } });
            else if (next.scheduledClass) setPicked({ id: "next", selection: { kind: "PLACE", label: next.scheduledClass.meeting.courseCode, at: next.scheduledClass.location } });
          }} /></div>}
        </Reveal>

        <div className="mt-3 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:mt-0 lg:sticky lg:top-32">{mapBlock}</div>

        <TabsContent value={day} className="mt-4 min-w-0 space-y-3 lg:col-start-1 lg:row-start-2 lg:mt-6">
          {plan?.usesEstimates && (
            <div className="flex gap-2.5 rounded-xl border border-warn/25 bg-warn-soft/60 p-3 text-sm text-warn">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>Travel times are straight-line estimates: no <code className="font-mono text-xs">GOOGLE_MAPS_SERVER_KEY</code> is configured. Transit options are unavailable in this mode.</span>
            </div>
          )}
          {error && <div className="rounded-xl bg-bad-soft p-3 text-sm text-bad">{error}</div>}
          {loading && !dayPlan && <p className="py-12 text-center text-ink-muted">Building your routes&hellip;</p>}
          {dayPlan && <DayTimeline plan={dayPlan} home={state.home} busy={loading} sel={{ selectedId: picked?.id, onSelect: (id, sl) => setPicked({ id, selection: sl }) }} focusClassId={focusClassId} onChooseGap={setGapChoice} endOfDay={state.endOfDay ?? "HOME"} onChooseEndOfDay={setEndOfDay} />}
          {plan && plan.skipped.length > 0 && (
            <details className="group px-1 pt-2 text-sm text-ink-muted">
              <summary className="flex min-h-9 cursor-pointer list-none items-center gap-1.5 [&::-webkit-details-marker]:hidden">
                <ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden="true" />
                {plan.skipped.length} meeting{plan.skipped.length > 1 ? "s" : ""} not on the map
              </summary>
              <ul className="mt-2 space-y-1 pl-6">
                {plan.skipped.map((sk) => <li key={sk.meeting.id}>{sk.meeting.courseCode} {sk.meeting.component}: {sk.reason}</li>)}
              </ul>
            </details>
          )}
        </TabsContent>
      </div>

      <SettingsSheet open={settingsOpen} onOpenChange={setSettingsOpen} />
      {trip && <TripMode trip={trip} onEnd={() => setTrip(undefined)} />}
    </main>
    </Tabs>
    </RemindersProvider>
  );
}

/** Shown when a reminder is due but no system notification could be shown (permission denied or unsupported). */
function ReminderBanner() {
  const rem = useReminders();
  if (!rem.banner) return null;
  return (
    <div role="alert" className="fixed inset-x-0 top-0 z-30 flex items-start justify-between gap-3 bg-ink px-4 py-3 text-white shadow-lg">
      <div className="flex min-w-0 gap-2.5">
        <Bell className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <div className="min-w-0">
          <div className="font-semibold">{rem.banner.title}</div>
          <div className="text-sm text-white/80">{rem.banner.body}</div>
        </div>
      </div>
      <Button variant="inverse-soft" size="sm" onClick={rem.dismissBanner}>OK</Button>
    </div>
  );
}
