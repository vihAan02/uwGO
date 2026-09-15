"use client";
import { useLayoutEffect, useRef, type ReactNode } from "react";
import { AlertTriangle, ArrowRight, Navigation, X } from "lucide-react";
import { animate } from "animejs";
import type { CampusLocation, ClassTransition, DayOfWeek, DayPlan, RouteOption, ScheduledClass } from "@/domain/types";
import type { NextUp } from "@/lib/nextClass";
import { countdownLabel, minutesUntil } from "@/lib/nextClass";
import type { PlanFocus } from "@/lib/planFocus";
import { transitLabel, type RouteChoiceKey } from "@/lib/routeChoices";
import { DURATION, EASE_OUT, prefersReducedMotion } from "@/lib/motion";
import { formatClock, formatDuration, todayISO } from "@/time/toronto";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ModeIcon } from "./ModeIcon";
import { RouteChoices } from "./RouteChoices";
import { floorLabel } from "./DayTimeline";

export const DAY_NAMES: Record<DayOfWeek, string> = { M: "Monday", T: "Tuesday", W: "Wednesday", Th: "Thursday", F: "Friday", S: "Saturday", Su: "Sunday" };

/**
 * The summary's first block, which the peek detent shows. Every kind of summary reserves the same height
 * (a heading, the loud line and one line more), so the peek line, and the map that ends at it, stay where
 * they are when the day or the focus changes (DESIGN.md §2).
 */
export const PEEK_BLOCK = "min-h-32";
/**
 * Everything under the peek block. Resting at peek it would be cut in half by the bottom of the screen, so
 * it fades out there and back in as soon as the sheet is dragged or settles higher.
 */
const TAIL = "transition-opacity duration-150 ease-standard max-lg:[[data-detent=peek]:not([data-dragging=true])_&]:opacity-0";

const classInto = (day: DayPlan | undefined, t: ClassTransition) =>
  day?.classes.find((c) => c.start.getTime() === t.arriveBy.getTime() && c.location.id === t.to.id);

function roomOf(c: ScheduledClass): string {
  const loc = c.meeting.location;
  return loc.kind === "ROOM" ? `${loc.buildingCode} ${loc.roomNumber}` : loc.kind === "ONLINE" ? "Online" : "Room TBA";
}

const placeName = (l: CampusLocation) => (l.kind === "HOME" ? "Home" : l.name);

function whereLabel(c: ScheduledClass): string {
  return `${c.room.buildingName ?? c.location.name}${c.room.floor === "unknown" ? "" : ` · ${floorLabel(c.room)}`}`;
}

/** "8 min walk", "11 min indoors", "Bus 201 · 14 min · board 10:05". */
function travelLine(route: RouteOption): string {
  if (route.mode === "TRANSIT") {
    const first = route.steps?.find((s) => s.mode === "TRANSIT")?.transit;
    return `${transitLabel(route)} · ${formatDuration(route.durationMinutes)}${first ? ` · board ${formatClock(first.departureTime)}` : ""}`;
  }
  if (route.durationMinutes === 0) return "Same building";
  // An indoor route is timed over the surveyed network; only its short joins to a door can be estimated.
  return `${formatDuration(route.durationMinutes)} ${route.indoorPath ? "indoors" : "walk"}${route.isEstimate && !route.indoorPath ? " (est.)" : ""}`;
}

/**
 * When to leave, as the one loud number: a countdown inside the hour, a clock time beyond it or on
 * another day, "Leave now" once it is time. A leave time that has gone by on the day itself is still
 * "Leave now": a past clock time reads as a plan, not as a prompt.
 */
export function leaveParts(leaveAt: Date | undefined, now: Date): { lead?: string; value: string; tone: "ink" | "warn" } | undefined {
  if (!leaveAt) return undefined;
  const minutes = minutesUntil(leaveAt, now);
  const today = todayISO(leaveAt) === todayISO(now);
  if (today && minutes <= 0) return { value: "Leave now", tone: "warn" };
  if (today && minutes <= 60) return { lead: "Leave in", value: countdownLabel(minutes), tone: minutes <= 5 ? "warn" : "ink" };
  return { lead: "Leave", value: formatClock(leaveAt), tone: "ink" };
}

/** The one thing worth knowing about the way on the map, if anything. */
export function warningFor(focus: PlanFocus, now: Date): { text: string; tone: "warn" | "bad" } | undefined {
  const t = focus.transition;
  const choice = focus.choice;
  if (!t || !choice) return undefined;
  const r = choice.route;
  // Past the leave time, what leaving now costs. A bus keeps its own timetable, so this is for ways on foot.
  if (t.hasDeadline && choice.leaveAt && r.mode !== "TRANSIT" && todayISO(choice.leaveAt) === todayISO(now) && now.getTime() > choice.leaveAt.getTime()) {
    const late = Math.ceil((now.getTime() + r.durationMinutes * 60_000 - t.arriveBy.getTime()) / 60_000);
    if (late > 0) return { text: `Leaving now, you'd arrive about ${late} min late`, tone: "bad" };
  }
  if (t.hasDeadline && choice.arriveAt && choice.arriveAt.getTime() > t.arriveBy.getTime()) {
    return { text: `This way arrives ${Math.round((choice.arriveAt.getTime() - t.arriveBy.getTime()) / 60_000)} min after class starts`, tone: "bad" };
  }
  if (choice.recommended && t.feasibility === "LIKELY_LATE") return { text: `Likely late: only ${t.availableMinutes} min between classes`, tone: "bad" };
  if (r.blockedBy?.length) return { text: "This way uses a path reported closed", tone: "bad" };
  if (t.campus?.outcome === "NO_USABLE_ROUTE" && t.campus.warnings[0]) return { text: t.campus.warnings[0], tone: "warn" };
  if (r.avoidedClosures?.length) return { text: "Route changed to avoid a reported closure", tone: "warn" };
  if (choice.recommended && t.feasibility === "TIGHT" && choice.arriveAt) {
    const spare = Math.max(0, Math.round((t.arriveBy.getTime() - choice.arriveAt.getTime()) / 60_000));
    return { text: `Tight: ${spare} min to spare`, tone: "warn" };
  }
  if (r.isEstimate && !r.indoorPath) return { text: "Estimated time: walking routes are unavailable right now", tone: "warn" };
  return undefined;
}

interface Props {
  focus: PlanFocus;
  next: NextUp;
  day: DayPlan | undefined;
  now: Date;
  loading: boolean;
  onStart?: () => void;
  onChoose: (key: RouteChoiceKey) => void;
  onClear?: () => void;
  onShowDay: (day: DayOfWeek) => void;
  onRouteHere?: () => void;
}

/**
 * The top of the planner sheet, and the answer to "where am I going next, when do I leave, how long
 * will it take" (DESIGN.md §3). It is the sheet's own surface, not a card inside it: its first block is
 * what the peek detent shows. What it describes is whatever the planner is focused on, so picking a leg,
 * a class or a quick route changes it, and the map with it.
 */
export function TripSummary(props: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  // A new subject fades in; a new route choice or a ticking countdown does not, so numbers never flash.
  const subject = props.loading ? "loading" : `${props.focus.source}|${props.focus.id ?? props.day?.date ?? ""}`;
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el || prefersReducedMotion()) return;
    // Arrived, the summary gives its inline transform back: left in place it would lift the whole summary
    // over the sheet handle's hit area.
    const clear = () => {
      el.style.opacity = "";
      el.style.transform = "";
    };
    const anim = animate(el, { opacity: [0, 1], translateY: [4, 0], duration: DURATION.base, ease: EASE_OUT, onComplete: clear });
    return () => {
      anim.cancel();
      clear();
    };
  }, [subject]);

  return (
    <div ref={rootRef} className="px-4 pb-4 sm:px-5 lg:rounded-2xl lg:border lg:border-line lg:bg-surface lg:px-5 lg:py-4">
      {props.loading ? <Loading /> : <Content {...props} />}
    </div>
  );
}

function Loading() {
  return (
    <div data-sheet-peek role="status" aria-label="Loading your plan" className={cn(PEEK_BLOCK, "pt-1")}>
      <Skeleton className="h-3.5 w-28" />
      <Skeleton className="mt-2.5 h-5 w-44" />
      <Skeleton className="mt-3 h-7 w-36" />
    </div>
  );
}

function Content(props: Props) {
  if (props.focus.transition && props.focus.choice) return <LegSummary {...props} />;
  if (props.focus.selection.kind === "LEG") return <QuickSummary {...props} />;
  if (props.focus.scheduledClass) return <ClassSummary {...props} />;
  return <DaySummary {...props} />;
}

function Heading({ context, title, detail, onClear }: { context: string; title: string; detail?: string; onClear?: () => void }) {
  return (
    <>
      <div className="flex min-h-[18px] items-center justify-between gap-2">
        <p className="min-w-0 truncate text-[13px] leading-[18px] text-ink-muted">{context}</p>
        {onClear && (
          // Its 44px reaches past the 18px line without growing it, and sits above the handle's hit area.
          <Button variant="ghost" size="icon-touch" className="relative z-20 -my-[13px] -mr-3 rounded-full text-ink-muted" aria-label="Back to your next class" onClick={onClear}>
            <X className="size-[18px]" />
          </Button>
        )}
      </div>
      {/* Held to its line: the mono room code baseline-aligned beside the title would otherwise add 2px, and move the peek line between summaries. */}
      <h2 className="mt-0.5 flex h-[26px] min-w-0 items-baseline gap-2 text-[20px] font-semibold leading-[26px] tracking-[-0.01em]">
        <span className="min-w-0 truncate">{title}</span>
        {detail && <span className="shrink-0 font-mono text-[15px] font-medium tracking-normal text-ink-muted">{detail}</span>}
      </h2>
    </>
  );
}

function Loud({ lead, value, tone = "ink", action }: { lead?: string; value: string; tone?: "ink" | "warn"; action?: ReactNode }) {
  return (
    <div className="mt-1 flex items-center justify-between gap-3">
      <p className="flex min-w-0 items-baseline gap-1.5">
        {lead && <span className="shrink-0 text-[15px] leading-[22px] text-ink-muted">{lead}</span>}
        <span className={cn("truncate text-[28px] font-semibold leading-8 tracking-[-0.02em] tabular-nums", tone === "warn" && "text-warn")}>{value}</span>
      </p>
      {action}
    </div>
  );
}

function StartButton({ onStart }: { onStart: () => void }) {
  return (
    <Button size="primary" className="shrink-0 rounded-full px-5" onClick={onStart}>
      <Navigation className="size-[18px]" /> Start
    </Button>
  );
}

function Warning({ text, tone }: { text: string; tone: "warn" | "bad" }) {
  return (
    <p role="status" className={cn("mt-3 flex items-start gap-2 text-[14px] leading-5", tone === "bad" ? "text-bad" : "text-warn")}>
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span>{text}</span>
    </p>
  );
}

function TravelLine({ route, arriveAt }: { route: RouteOption; arriveAt?: Date }) {
  return (
    <p className="mt-2 flex min-w-0 items-center gap-1.5 text-[15px] leading-[22px]">
      <ModeIcon route={route} className="text-ink-muted" />
      <span className="min-w-0 truncate">{travelLine(route)}{arriveAt ? ` · arrive ${formatClock(arriveAt)}` : ""}</span>
    </p>
  );
}

function LegSummary({ focus, next, day, now, onStart, onChoose, onClear }: Props) {
  const t = focus.transition!;
  const choice = focus.choice!;
  const route = choice.route;
  const cls = classInto(day, t);
  const onAnotherDay = day && day.date !== todayISO(now) ? DAY_NAMES[day.day] : undefined;
  const at = cls ? ` · ${formatClock(cls.start)}` : "";
  const context = focus.source === "NEXT"
    ? next.status === "IN_CLASS" && next.scheduledClass
      ? `After ${next.scheduledClass.meeting.courseCode}${cls ? ` · class at ${formatClock(cls.start)}` : ""}`
      : `${next.status === "PREVIEW" ? "First class" : "Next class"}${onAnotherDay ? ` · ${onAnotherDay}` : ""}${at}`
    : cls
      ? `${onAnotherDay ? `${onAnotherDay} · ` : ""}Class at ${formatClock(cls.start)}`
      : `From ${t.from.kind === "HOME" ? "home" : t.from.buildingCode ?? t.from.name}`;
  const leave = leaveParts(choice.leaveAt, now);
  const warning = warningFor(focus, now);
  return (
    <>
      <div data-sheet-peek className={PEEK_BLOCK}>
        <Heading context={context} title={cls ? cls.meeting.courseCode : placeName(t.to)} detail={cls ? roomOf(cls) : undefined} onClear={onClear} />
        <Loud lead={leave?.lead} value={leave?.value ?? formatDuration(route.durationMinutes)} tone={leave?.tone} action={onStart && <StartButton onStart={onStart} />} />
        <TravelLine route={route} arriveAt={choice.arriveAt} />
      </div>
      <div data-sheet-tail className={TAIL}>
        {cls && <p className="mt-0.5 truncate text-[13px] leading-[18px] text-ink-muted">{whereLabel(cls)}</p>}
        <RouteChoices choices={focus.choices} selected={choice.key} onChoose={onChoose} className="mt-3" />
        {warning && <Warning {...warning} />}
      </div>
    </>
  );
}

function QuickSummary({ focus, now, onStart, onClear }: Props) {
  if (focus.selection.kind !== "LEG") return null;
  const { to, route } = focus.selection;
  const arrive = route && (route.mode === "TRANSIT" && route.arrivalTime ? route.arrivalTime : new Date(now.getTime() + route.durationMinutes * 60_000));
  return (
    <div data-sheet-peek className={PEEK_BLOCK}>
      <Heading context="From where you are" title={placeName(to)} onClear={onClear} />
      <Loud value={route ? formatDuration(route.durationMinutes) : "No route"} action={onStart && <StartButton onStart={onStart} />} />
      {route && <TravelLine route={route} arriveAt={arrive} />}
    </div>
  );
}

function ClassSummary({ focus, onClear, onRouteHere }: Props) {
  const c = focus.scheduledClass!;
  return (
    <div data-sheet-peek className={PEEK_BLOCK}>
      <Heading context={`${formatClock(c.start)} – ${formatClock(c.end)}`} title={c.meeting.courseCode} detail={roomOf(c)} onClear={onClear} />
      <div className="mt-2 flex items-center justify-between gap-3">
        <p className="min-w-0 truncate text-[15px] leading-[22px] text-ink-muted">{whereLabel(c)}</p>
        {onRouteHere && <Button variant="outline" size="touch" className="shrink-0 rounded-full" onClick={onRouteHere}>Route here</Button>}
      </div>
      {c.meeting.courseTitle && <p className="mt-1 truncate text-[13px] leading-[18px] text-ink-muted">{c.meeting.courseTitle}</p>}
    </div>
  );
}

function DaySummary({ next, day, now, onShowDay }: Props) {
  const classes = day?.classes ?? [];
  const first = classes[0];
  const sittingIn = next.status === "IN_CLASS" && next.day?.date === day?.date ? next.scheduledClass : undefined;
  // The class to go to next: the one coming up, or while a class is on, the one after it.
  const coming = next.status === "UPCOMING" && next.day && next.scheduledClass
    ? { day: next.day, scheduledClass: next.scheduledClass }
    : next.status === "IN_CLASS" ? next.upNext : undefined;
  const elsewhere = coming && coming.day.date !== day?.date ? coming : undefined;
  const context = day ? `${DAY_NAMES[day.day]}${day.date === todayISO(now) ? " · Today" : ""}` : "This week";
  let title: string;
  let meta: string | undefined;
  if (sittingIn) {
    const later = next.upNext && next.upNext.day.date === next.day?.date ? next.upNext.scheduledClass : undefined;
    title = `In ${sittingIn.meeting.courseCode}`;
    meta = `Until ${formatClock(sittingIn.end)} · ${roomOf(sittingIn)} · ${later ? `then ${later.meeting.courseCode} at ${formatClock(later.start)}` : "your last class today"}`;
  } else if (first) {
    title = `${classes.length} class${classes.length === 1 ? "" : "es"}`;
    meta = `First: ${first.meeting.courseCode} at ${formatClock(first.start)} · ${roomOf(first)}`;
  } else {
    title = next.status === "NONE" ? "Nothing left this week" : "No classes";
  }
  return (
    <div data-sheet-peek className={PEEK_BLOCK}>
      <Heading context={context} title={title} />
      {meta && <p className="mt-1 truncate text-[15px] leading-[22px] text-ink-muted">{meta}</p>}
      {elsewhere && (
        <Button variant="outline" size="touch" className="mt-3 w-full justify-between rounded-xl" onClick={() => onShowDay(elsewhere.day.day)}>
          <span className="min-w-0 truncate">Next class: {elsewhere.scheduledClass.meeting.courseCode} · {DAY_NAMES[elsewhere.day.day]} {formatClock(elsewhere.scheduledClass.start)}</span>
          <ArrowRight className="size-4" />
        </Button>
      )}
    </div>
  );
}
