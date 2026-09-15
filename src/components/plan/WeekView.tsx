"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { addDays } from "date-fns";
import { AlertTriangle, Bell, ChevronDown, Crosshair, Dumbbell, Loader2, LocateFixed, RotateCw } from "lucide-react";
import type { CampusLocation, DayOfWeek } from "@/domain/types";
import { DAY_LABELS, DAYS_IN_ORDER } from "@/domain/types";
import { useStore } from "@/lib/store";
import { useAuth } from "@/lib/auth/AuthProvider";
import { useUserState } from "@/lib/UserStateProvider";
import { AccountLoadError, AccountLoading, AccountSyncNotice } from "@/components/account/AccountGate";
import { defaultWeekStart, usePlan } from "@/lib/usePlan";
import { dayTabFor, openingDay } from "@/lib/openingDay";
import { useMinuteClock, useNextUp } from "@/lib/useNextUp";
import { usePacLive } from "@/lib/usePacLive";
import { useClosures } from "@/lib/ClosuresProvider";
import { RemindersProvider, useReminders } from "@/lib/useReminders";
import { positionProblem } from "@/lib/quickRoute";
import { resolveFocus, tripPreference, type PlanPick } from "@/lib/planFocus";
import type { RouteChoiceKey } from "@/lib/routeChoices";
import { initialHeaderScroll, nextHeaderScroll } from "@/lib/headerScroll";
import type { Detent } from "@/lib/sheetDetents";
import { NO_INSET, type MapInset } from "@/lib/mapFraming";
import type { MapSelection } from "@/lib/mapSelection";
import { PHONE_LAYOUT, useMediaQuery } from "@/lib/useMediaQuery";
import { CROWD_LABELS, estimateFromPct, waitLabel } from "@/data/pac/crowd";
import { formatISODate, mondayOfWeek, todayISO, torontoDate } from "@/time/toronto";
import { campusGraphGeoJSON } from "@/engine/campusDebug";
import { explainCampusDecision } from "@/engine/campusRoute";
import { PROVENANCE_WORDS, describeProvenance, provenanceKinds, segmentProvenance } from "@/engine/campusProvenance";
import { campusGraph } from "@/engine/indoorGraph";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { DayTimeline } from "./DayTimeline";
import { DayStrip } from "./DayStrip";
import { PlanHeader } from "./PlanHeader";
import { PlanSheet } from "./PlanSheet";
import { QuickRoute } from "./QuickRoute";
import { SettingsSheet } from "./SettingsSheet";
import { TripSummary } from "./TripSummary";
import type { Trip } from "../map/TripMode";
import type { YouAreHere } from "../map/MapPanel";

const MapPanel = dynamic(() => import("../map/MapPanel").then((m) => m.MapPanel), {
  ssr: false,
  loading: () => <div className="h-full w-full bg-map-ground" />,
});
const TripMode = dynamic(() => import("../map/TripMode").then((m) => m.TripMode), { ssr: false });

export function WeekView() {
  const router = useRouter();
  const { state, hydrated, setGapChoice } = useStore();
  const account = useUserState();
  const auth = useAuth();
  // The device's copy is only trusted once the account has answered (or there is no account).
  const accountSettled = account.status === "ready" || account.status === "local" || account.status === "offline";
  const meetings = state.schedule?.meetings;
  const [weekOverride, setWeekStart] = useState<string | undefined>();
  const [dayChoice, setDayChoice] = useState<DayOfWeek | undefined>();
  const [openedAt] = useState(() => new Date());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pick, setPickState] = useState<PlanPick | undefined>();
  const pickVersion = useRef(0);
  const [trip, setTrip] = useState<Trip | undefined>();
  const phone = useMediaQuery(PHONE_LAYOUT, true);
  const shellRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (hydrated && accountSettled && !meetings?.length) router.replace("/setup");
  }, [hydrated, accountSettled, meetings, router]);

  const now = useMinuteClock();
  const monday = useMemo(() => weekOverride ?? (meetings ? defaultWeekStart(meetings) : mondayOfWeek(todayISO(openedAt))), [weekOverride, meetings, openedAt]);
  const pac = usePacLive(Boolean(hydrated && state.gym?.enabled));
  const closures = useClosures();
  const { plan, loading, error, retry } = usePlan(hydrated && account.status !== "loading" ? meetings : undefined, state.home, state.config, monday, { gym: state.gym, routePreference: state.routePreference, gapChoices: state.gapChoices, closedEdgeIds: closures.closed, pacLive: pac.reading, pacSamples: pac.samples });

  // Developer inspection of campus routing, from the browser console: the graph as GeoJSON, each
  // planned leg's reasoning with what activated it and what it rests on, and where any segment's
  // facts come from. Never in a production build.
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    (window as unknown as { uwgoCampus?: unknown }).uwgoCampus = {
      geojson: campusGraphGeoJSON,
      explain: explainCampusDecision,
      legs: () => Object.values(plan?.days ?? {}).flatMap((d) => d?.transitions ?? []).filter((t) => t.campus).map((t) => {
        const decision = t.campus!;
        const used = [...decision.activatedBy, ...(decision.chosen?.provenance ?? [])];
        return {
          from: t.from.name,
          to: t.to.name,
          outcome: decision.outcome,
          evidenceFrom: provenanceKinds(used).map((k) => PROVENANCE_WORDS[k]),
          activatedBy: decision.activatedBy.map(describeProvenance),
          restingOn: (decision.chosen?.provenance ?? []).map(describeProvenance),
          reasoning: explainCampusDecision(decision),
        };
      }),
      provenance: (edgeId: string) => {
        const g = campusGraph();
        const index = g.indexById.get(edgeId);
        return index === undefined ? undefined : segmentProvenance(g, index);
      },
    };
  }, [plan]);

  const pacNow = pac.reading ? estimateFromPct(pac.reading.occupancyPct, "LIVE") : undefined;
  const isThisWeek = monday === mondayOfWeek(todayISO(now));
  const day = dayChoice ?? openingDay(plan, openedAt, isThisWeek);
  const visibleDays = useMemo(() => DAYS_IN_ORDER.filter((d) => ["M", "T", "W", "Th", "F"].includes(d) || (plan?.days[d]?.classes.length ?? 0) > 0), [plan]);
  const dayPlan = plan?.days[day];
  const next = useNextUp(plan, dayPlan, now);

  /** Everywhere the student has to be on the selected day, home included. */
  const overview = useMemo<MapSelection>(() => {
    const stops: { at: CampusLocation; label: string }[] = [];
    if (state.home) stops.push({ at: { id: "home", name: state.home.name, latitude: state.home.latitude, longitude: state.home.longitude, kind: "HOME" }, label: "Home" });
    for (const c of dayPlan?.classes ?? []) stops.push({ at: c.location, label: c.meeting.courseCode });
    return { kind: "DAY", label: `${DAY_LABELS[day]} · ${stops.length} place${stops.length === 1 ? "" : "s"}`, stops };
  }, [dayPlan, state.home, day]);

  const buffer = state.config.arrivalBufferMinutes;
  const focus = useMemo(() => resolveFocus({ pick, day: dayPlan, next, overview, bufferMinutes: buffer }), [pick, dayPlan, next, overview, buffer]);
  const alternatives = useMemo(() => focus.choices.filter((c) => c.key !== focus.choice?.key).map((c) => c.route), [focus]);
  const startable = focus.selection.kind === "LEG" && focus.selection.route && focus.selection.route.durationMinutes > 0 ? focus.selection : undefined;

  // Every pick bumps a version, so a slow quick route cannot replace something picked after it was asked for.
  const setPick = useCallback((p: PlanPick | undefined) => { pickVersion.current += 1; setPickState(p); }, []);
  const pickLeg = useCallback((transitionId: string) => setPick({ kind: "LEG", transitionId, choice: "best" }), [setPick]);
  const pickClass = useCallback((classId: string) => setPick({ kind: "CLASS", classId }), [setPick]);
  const beginQuickRoute = useCallback(() => { pickVersion.current += 1; return pickVersion.current; }, []);
  const quickRouted = useCallback((request: number, id: string, selection: MapSelection) => {
    if (request === pickVersion.current) setPick({ kind: "PLACE", id, selection });
  }, [setPick]);
  const transitionId = focus.transition?.id;
  const choose = useCallback((key: RouteChoiceKey) => { if (transitionId) setPick({ kind: "LEG", transitionId, choice: key }); }, [transitionId, setPick]);
  const classIntoFocus = focus.scheduledClass && dayPlan?.transitions.find((t) => t.arriveBy.getTime() === focus.scheduledClass!.start.getTime() && t.to.id === focus.scheduledClass!.location.id && t.recommendedRoute);

  const changeWeek = (days: number) => { setWeekStart(formatISODate(addDays(torontoDate(monday, 12), days))); setPick(undefined); };
  const goToday = () => {
    setWeekStart(mondayOfWeek(todayISO(now)));
    setDayChoice(dayTabFor(plan, todayISO(now)));
    setPick(undefined);
  };

  // The sheet, the header and the map's framing.
  const detentRef = useRef<Detent>("mid");
  const movingRef = useRef(false);
  const headerRun = useRef(initialHeaderScroll());
  const [headerHidden, setHeaderHidden] = useState(false);
  const [headerHeight, setHeaderHeight] = useState(60);
  const [sheetHeight, setSheetHeight] = useState(0);
  const [peekHeight, setPeekHeight] = useState<number | undefined>();
  const onDetentChange = useCallback((d: Detent, visible: number) => {
    detentRef.current = d;
    setSheetHeight(visible);
    // DESIGN.md §13: the header only steps away while the student reads the expanded day.
    if (d !== "expanded") {
      headerRun.current = initialHeaderScroll();
      setHeaderHidden(false);
    }
  }, []);
  const onSheetMoving = useCallback((m: boolean) => { movingRef.current = m; }, []);
  const onSheetScroll = useCallback((top: number, max: number) => {
    if (detentRef.current !== "expanded" || movingRef.current) {
      headerRun.current = initialHeaderScroll(top);
      return;
    }
    const run = nextHeaderScroll(headerRun.current, top, max);
    if (run === headerRun.current) return;
    headerRun.current = run;
    setHeaderHidden(!run.visible);
  }, []);
  const inset = useMemo<MapInset>(
    () => (phone ? { top: headerHeight, right: 0, bottom: Math.max(0, sheetHeight - (peekHeight ?? 0)), left: 0 } : NO_INSET),
    [phone, headerHeight, sheetHeight, peekHeight],
  );

  // "Where am I": asked for only when the student taps, never on load.
  const [you, setYou] = useState<YouAreHere | undefined>();
  const [locate, setLocate] = useState(0);
  const [locating, setLocating] = useState(false);
  const [locateNote, setLocateNote] = useState<string | undefined>();
  const [recenter, setRecenter] = useState(0);
  const [mapTaken, setMapTaken] = useState(false);
  const locateMe = useCallback(() => {
    if (!("geolocation" in navigator)) { setLocateNote("Location isn't available on this device."); return; }
    setLocating(true);
    setLocateNote(undefined);
    navigator.geolocation.getCurrentPosition(
      (p) => { setYou({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }); setLocate((n) => n + 1); setLocating(false); },
      (err) => { setLocating(false); setLocateNote(positionProblem(err)); },
      { enableHighAccuracy: true, maximumAge: 15_000, timeout: 15_000 },
    );
  }, []);
  useEffect(() => {
    if (!locateNote) return;
    const id = setTimeout(() => setLocateNote(undefined), 4_000);
    return () => clearTimeout(id);
  }, [locateNote]);

  // Trip Mode takes focus when it opens (its heading); when it ends, focus goes back to what started it.
  const tripOpener = useRef<HTMLElement | null>(null);
  const startTrip = useCallback(() => {
    const s = focus.selection;
    if (s.kind !== "LEG" || !s.route || s.route.durationMinutes <= 0) return;
    tripOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setTrip({ label: s.label, from: s.from, to: s.to, route: s.route, walkFallback: s.walkFallback, preference: tripPreference(focus, state.routePreference ?? "FASTEST") });
  }, [focus, state.routePreference]);
  const endTrip = useCallback(() => { setTrip(undefined); setHeaderHidden(false); }, []);
  useEffect(() => {
    if (trip) return;
    const opener = tripOpener.current;
    tripOpener.current = null;
    // Effects run after the planner stops being inert, so the control can take focus again.
    if (opener?.isConnected) opener.focus({ preventScroll: true });
  }, [trip]);

  if (account.status === "loading") return <AccountLoading />;
  if (account.status === "error" && !meetings?.length) return <AccountLoadError />;

  const controls = (
    <div className="flex flex-col items-end gap-2">
      {locateNote && <p role="status" className="max-w-[16rem] rounded-2xl bg-surface px-3 py-2 text-[13px] leading-[18px] shadow-float">{locateNote}</p>}
      {mapTaken && (
        <Button variant="float" size="icon-touch" className="rounded-full" aria-label="Show the whole route again" onClick={() => setRecenter((n) => n + 1)}>
          <Crosshair className="size-5" />
        </Button>
      )}
      <Button variant="float" size="icon-touch" className="rounded-full" aria-label="Show where I am" aria-busy={locating} onClick={locateMe}>
        {locating ? <Loader2 className="size-5 motion-safe:animate-spin" /> : <LocateFixed className={you ? "size-5 text-brand" : "size-5"} />}
      </Button>
    </div>
  );

  return (
    <RemindersProvider plan={plan} bufferMinutes={buffer}>
    <Tabs value={day} onValueChange={(d) => { setDayChoice(d as DayOfWeek); if (pick && pick.kind !== "PLACE") setPick(undefined); }} asChild>
    <main
      ref={shellRef}
      data-plan-shell
      className="app fixed inset-0 overflow-hidden bg-map-ground lg:static lg:mx-auto lg:grid lg:min-h-dvh lg:w-full lg:max-w-6xl lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:grid-rows-[auto_1fr] lg:content-start lg:gap-x-8 lg:overflow-visible lg:bg-canvas lg:px-6"
    >
      <h1 className="sr-only">Your plan</h1>
      <ReminderBanner />
      <div className="contents" inert={trip ? true : undefined}>
        <PlanHeader className="lg:col-span-2 lg:-mx-6" hidden={headerHidden} onHeight={setHeaderHeight} onOpenSettings={() => setSettingsOpen(true)} initial={auth.user?.email?.[0]} />

        {/*
          One map instance, mounted for the life of the page. A second, CSS-hidden copy would double the
          Dynamic Maps billing and frame itself in a zero-size box. On a phone it fills the screen down to
          the peek line, so Google's logo and terms stay visible above the sheet at rest.
        */}
        <div
          className="absolute inset-x-0 top-0 lg:sticky lg:top-24 lg:col-start-2 lg:row-start-2 lg:mt-6 lg:h-[calc(100dvh-8rem)] lg:overflow-hidden lg:rounded-2xl lg:border lg:border-line"
          style={phone ? { bottom: peekHeight ?? "18dvh" } : undefined}
        >
          <MapPanel selection={focus.selection} alternatives={alternatives} inset={inset} recenter={recenter} you={you} locate={locate} onCameraTaken={setMapTaken} zoomControl={!phone} />
        </div>

        <PlanSheet
          shellRef={shellRef}
          label="Trip planner"
          // The page's bottom padding belongs to this column, so the map's sticky row runs to the end of the page.
          className="lg:col-start-1 lg:row-start-2 lg:mt-6 lg:pb-16"
          onDetentChange={onDetentChange}
          onPeekHeight={setPeekHeight}
          onScrollTop={onSheetScroll}
          onMoving={onSheetMoving}
          accessory={controls}
          summary={
            <TripSummary
              focus={focus}
              next={next}
              day={dayPlan}
              now={now}
              loading={!plan}
              onStart={startable ? startTrip : undefined}
              onChoose={choose}
              onClear={focus.source === "PICKED" ? () => setPick(undefined) : undefined}
              onShowDay={(d) => { setDayChoice(d); setPick(undefined); }}
              onRouteHere={classIntoFocus ? () => pickLeg(classIntoFocus.id) : undefined}
            />
          }
        >
          <div className="px-4 pt-3 empty:hidden sm:px-5 lg:px-0"><AccountSyncNotice /></div>
          <DayStrip
            days={visibleDays}
            plan={plan}
            monday={monday}
            today={todayISO(now)}
            isThisWeek={isThisWeek}
            onPrevWeek={() => changeWeek(-7)}
            onNextWeek={() => changeWeek(7)}
            onToday={goToday}
          />

          <TabsContent value={day} className="mt-3 min-w-0">
            {plan?.usesEstimates && (
              <p className="mx-4 mb-3 flex gap-2 rounded-xl bg-warn-soft/70 px-3 py-2.5 text-[13px] leading-[18px] text-warn sm:mx-5 lg:mx-0">
                <AlertTriangle className="mt-px size-4 shrink-0" aria-hidden="true" />
                <span>
                  Travel times are estimates right now.
                  {process.env.NODE_ENV !== "production" && <> No <code className="font-mono">GOOGLE_MAPS_SERVER_KEY</code> is configured.</>}
                </span>
              </p>
            )}
            {error && (
              <div role="alert" className="mx-4 mb-3 flex items-center justify-between gap-3 rounded-xl bg-bad-soft px-3 py-2 text-[14px] text-bad sm:mx-5 lg:mx-0">
                <span className="min-w-0">Couldn&rsquo;t build your routes.</span>
                <Button variant="outline" size="touch" className="shrink-0 bg-surface" onClick={retry}><RotateCw /> Retry</Button>
              </div>
            )}
            {dayPlan
              ? <DayTimeline plan={dayPlan} home={state.home} busy={loading} focusId={focus.id} focusChoice={focus.choice} onPickLeg={pickLeg} onPickClass={pickClass} onChooseGap={setGapChoice} />
              : !plan && !error && <TimelineSkeleton />}
          </TabsContent>

          {hydrated && (
            <div className="mt-6 px-4 sm:px-5 lg:px-0">
              {pacNow && state.gym?.enabled && (
                <p className="mb-2 flex items-center justify-between gap-3 text-[13px] leading-[18px] text-ink-muted">
                  <span className="flex items-center gap-1.5"><Dumbbell className="size-4" aria-hidden="true" /><span className="font-medium text-ink">PAC now</span> {CROWD_LABELS[pacNow.level]} · {pacNow.occupancyPct}% full</span>
                  <span>Wait {waitLabel(pacNow)}</span>
                </p>
              )}
              <QuickRoute home={state.home} preference={state.routePreference ?? "FASTEST"} closedEdgeIds={closures.closed} selectedId={focus.id} beginRequest={beginQuickRoute} onRoute={quickRouted} onSetHome={() => setSettingsOpen(true)} />
            </div>
          )}

          {plan && plan.skipped.length > 0 && (
            <details className="group mt-4 px-4 text-[14px] text-ink-muted sm:px-5 lg:px-0">
              <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 [&::-webkit-details-marker]:hidden">
                <ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden="true" />
                {plan.skipped.length} meeting{plan.skipped.length > 1 ? "s" : ""} not on the map
              </summary>
              <ul className="mt-1 space-y-1 pl-6">
                {plan.skipped.map((sk) => <li key={sk.meeting.id}>{sk.meeting.courseCode} {sk.meeting.component}: {sk.reason}</li>)}
              </ul>
            </details>
          )}
        </PlanSheet>
      </div>

      <SettingsSheet open={settingsOpen} onOpenChange={setSettingsOpen} />
      {trip && <TripMode trip={trip} onEnd={endTrip} />}
    </main>
    </Tabs>
    </RemindersProvider>
  );
}

function TimelineSkeleton() {
  return (
    <div role="status" aria-label="Building your routes" className="space-y-5 border-y border-line px-4 py-4 sm:px-5 lg:rounded-2xl lg:border lg:bg-surface">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex gap-3">
          <Skeleton className="h-4 w-14" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-3/5" />
            <Skeleton className="h-3.5 w-2/5" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Shown when a reminder is due but no system notification could be shown (permission denied or unsupported).
 * Portalled to the body: inside the phone planner's fixed shell it would stack under an open Settings sheet.
 */
function ReminderBanner() {
  const rem = useReminders();
  if (!rem.banner) return null;
  return createPortal(
    <div role="alert" className="pointer-events-auto fixed inset-x-0 top-0 z-[60] flex items-start justify-between gap-3 bg-ink px-4 pb-3 pt-[calc(env(safe-area-inset-top)+0.75rem)] text-white shadow-lg">
      <div className="flex min-w-0 gap-2.5">
        <Bell className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <div className="min-w-0">
          <div className="font-semibold">{rem.banner.title}</div>
          <div className="text-sm text-white/80">{rem.banner.body}</div>
        </div>
      </div>
      <Button variant="inverse-soft" size="touch" onClick={rem.dismissBanner}>OK</Button>
    </div>,
    document.body,
  );
}
