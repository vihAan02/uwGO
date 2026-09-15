"use client";
import { useLayoutEffect, useRef } from "react";
import { AlertTriangle, Check, ExternalLink, X } from "lucide-react";
import { animate } from "animejs";
import type { CampusLocation, ClassTransition, DayPlan, HomeReturnAnalysis, RouteOption, ScheduledClass, UserHome } from "@/domain/types";
import { formatClock, formatDuration, minutesBetween } from "@/time/toronto";
import { googleMapsDirectionsUrl, travelModeFor } from "@/lib/mapsLinks";
import { classRowId, legRowId } from "@/lib/planFocus";
import { transitLabel, type RouteChoice } from "@/lib/routeChoices";
import { DURATION, EASE_OUT, prefersReducedMotion } from "@/lib/motion";
import { indoorPathLabel } from "@/engine/indoorRoute";
import { findRoomPosition } from "@/data/floorplans";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Reveal } from "@/components/ui/reveal";
import { RemindButton } from "./RemindButton";
import { GymCard } from "./GymCard";
import { ModeIcon } from "./ModeIcon";
import { GapChoicePicker, type ChooseGap } from "./GapChoicePicker";
import { ReportClosure, RouteAdjustedNote } from "./ClosureControls";

/**
 * "Floor 2" from the V1 rule, or "Floor 2 · east side" when the room's position on the
 * floor plan is known. A floor of 0 is the lowest level in Waterloo's numbering.
 */
export function floorLabel(room: ScheduledClass["room"]): string {
  if (room.floor === "unknown") return "Floor unknown";
  const base = room.floor === 0 ? "Floor 0 (lowest level)" : `Floor ${room.floor}`;
  const pos = room.roomNumber ? findRoomPosition(room.buildingCode, room.roomNumber) : undefined;
  return pos?.description ? `${base} · ${pos.description}` : base;
}

/** Every row lines its text up after the time rail; details under a leg start at the same edge. */
const ROW_BUTTON = "flex w-full touch-manipulation gap-3 px-4 py-3 text-left outline-none transition-colors duration-150 hover:bg-fill/50 active:bg-fill focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand sm:gap-4 sm:px-5 lg:px-4";
const ROW_STATIC = "flex gap-3 px-4 py-3 sm:gap-4 sm:px-5 lg:px-4";
const INDENT = "pl-[92px] pr-4 sm:pl-[108px] sm:pr-5 lg:pl-[104px] lg:pr-4";
const SELECTED = "bg-brand/[0.045] shadow-[inset_3px_0_0_0_var(--color-brand)]";

/** The time rail on the left of every row. Inside a button, so phrasing content only. */
function Time({ at, end }: { at?: Date; end?: Date }) {
  return (
    <span aria-hidden={at ? undefined : true} className="w-16 shrink-0 pt-px text-right font-mono text-[13px] font-medium leading-5 tabular-nums sm:w-[4.5rem]">
      {at && <time className="block">{formatClock(at)}</time>}
      {end && <time className="block font-normal text-ink-muted">{formatClock(end)}</time>}
    </span>
  );
}

const classInto = (plan: DayPlan, t: ClassTransition) =>
  plan.classes.find((c) => c.start.getTime() === t.arriveBy.getTime() && c.location.id === t.to.id);

/** "10 min walk", "11 min indoors", "Bus 201". */
function how(route: RouteOption): string {
  if (route.mode === "TRANSIT") return transitLabel(route);
  // An indoor route is timed over the surveyed network; only its short joins to a door can be estimated.
  return `${formatDuration(route.durationMinutes)} ${route.indoorPath ? "indoors" : "walk"}${route.isEstimate && !route.indoorPath ? " (est.)" : ""}`;
}

/** What the leg is, in the words a student would say: "10 min walk to CS 135", "Bus 201 to Lazaridis Hall", "8 min walk home". */
export function legTitle(plan: DayPlan, t: ClassTransition, route: RouteOption): string {
  const cls = classInto(plan, t);
  const where = cls ? cls.meeting.courseCode : t.to.kind === "HOME" ? "home" : t.to.name;
  if (route.mode === "WALK" && route.durationMinutes === 0) return cls ? `${where} is in the same building` : `Already at ${where}`;
  return !cls && t.to.kind === "HOME" ? `${how(route)} home` : `${how(route)} to ${where}`;
}

/**
 * Only an exception is worth a colour: a tight or a likely-late leg, or a way the student chose that lands
 * after the class starts. An on-time one says nothing.
 */
function concernOf(t: ClassTransition, choice?: RouteChoice): { text: string; tone: "warn" | "bad" } | undefined {
  if (!t.hasDeadline) return undefined;
  // The plan's verdicts are about its own pick; another way is judged only by when it arrives.
  if (choice && !choice.recommended) {
    const late = choice.arriveAt ? minutesBetween(t.arriveBy, choice.arriveAt) : 0;
    return late > 0 ? { text: `This way arrives ${late} min after class starts`, tone: "bad" } : undefined;
  }
  if (t.feasibility === "LIKELY_LATE") return { text: `Likely late: only ${t.availableMinutes} min between classes`, tone: "bad" };
  if (t.feasibility === "TIGHT" && t.expectedArrival) return { text: `Tight: ${Math.max(0, minutesBetween(t.expectedArrival, t.arriveBy))} min to spare`, tone: "warn" };
  return undefined;
}

/** The line under a leg: boarding for a bus, then when it lands and, before a class, the real margin. */
function legMeta(t: ClassTransition, route: RouteOption, arriveAt: Date | undefined, concerned: boolean): string {
  const parts: string[] = [];
  if (route.mode === "TRANSIT") {
    const first = route.steps?.find((s) => s.mode === "TRANSIT")?.transit;
    parts.push(formatDuration(route.durationMinutes));
    if (first) parts.push(`board ${formatClock(first.departureTime)} at ${first.departureStop}`);
  }
  if (arriveAt) {
    parts.push(`arrive ${formatClock(arriveAt)}`);
    // The real margin, not the configured buffer: a tight hop can land later than intended.
    const early = t.hasDeadline ? minutesBetween(arriveAt, t.arriveBy) : 0;
    if (early > 0 && !concerned) parts.push(`${early} min early`);
  }
  return parts.join(" · ");
}

function TransitSteps({ route }: { route: RouteOption }) {
  if (!route.steps) return null;
  return (
    <ol className="mt-2 space-y-1 text-[13px] leading-[18px]">
      {route.steps.map((s, i) => s.mode === "TRANSIT" && s.transit ? (
        <li key={i} className="rounded-xl bg-fill px-3 py-2">
          <span className="font-semibold">{s.transit.lineShort ?? s.transit.line}</span> {s.transit.vehicle.toLowerCase()}{s.transit.headsign ? ` toward ${s.transit.headsign}` : ""}
          <span className="block text-ink">Board {s.transit.departureStop} {formatClock(s.transit.departureTime)} &rarr; {s.transit.arrivalStop} {formatClock(s.transit.arrivalTime)}</span>
        </li>
      ) : (
        <li key={i} className="px-3 text-ink-muted">Walk {formatDuration(s.durationMinutes)}</li>
      ))}
    </ol>
  );
}

function MapsLink({ from, to, route }: { from: CampusLocation; to: CampusLocation; route?: RouteOption }) {
  return (
    <Button asChild variant="outline" size="touch">
      <a href={googleMapsDirectionsUrl(from, to, travelModeFor(route))} target="_blank" rel="noopener noreferrer">
        <ExternalLink /> Google Maps
      </a>
    </Button>
  );
}

/**
 * One line on why a walk uses the doors it does: only when campus knowledge changed the route, or
 * could not and the student needs telling how to get in. The full reasoning is a developer aid,
 * reached from the console (`window.uwgoCampus.legs()`), never rendered.
 */
function CampusNote({ t, route }: { t: ClassTransition; route: RouteOption }) {
  const decision = t.campus;
  if (!decision) return null;
  const shown = route.campus?.summary ?? (decision.outcome === "NO_USABLE_ROUTE" ? decision.warnings[0] : undefined);
  if (!shown) return null;
  return <p className={cn("mt-1.5 text-[13px] leading-[18px]", decision.outcome === "NO_USABLE_ROUTE" ? "text-warn" : "text-ink-muted")}>{shown}</p>;
}

/**
 * What only matters for the leg the student is looking at: how the way goes, why it changed, a closure to
 * report, a reminder and Google Maps. Shown under that one leg, never under every row.
 */
function LegDetails({ t, plan, route, choice }: { t: ClassTransition; plan: DayPlan; route: RouteOption; choice?: RouteChoice }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || prefersReducedMotion()) return;
    const anim = animate(el, { opacity: [0, 1], translateY: [4, 0], duration: DURATION.quick, ease: EASE_OUT });
    return () => {
      anim.cancel();
      el.style.opacity = "";
      el.style.transform = "";
    };
  }, []);
  // Reporting hangs off the route whose doors and links the student is sent through: this way when it
  // uses campus knowledge or the indoor network, otherwise the winter route when there is one.
  const reportOn = route.campus || route.indoorPath ? route : t.indoorRoute ?? route;
  return (
    <div ref={ref} data-leg-details className={cn(INDENT, "-mt-1 pb-3")}>
      {route.indoorPath && <p className="text-[13px] leading-[18px] text-ink-muted">Through {indoorPathLabel(route)}</p>}
      {route.mode === "TRANSIT" && <TransitSteps route={route} />}
      <RouteAdjustedNote route={route} />
      <CampusNote t={t} route={route} />
      <ReportClosure route={reportOn} />
      {route.durationMinutes > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {t.hasDeadline && <RemindButton day={plan} t={t} choice={choice} />}
          <MapsLink from={t.from} to={t.to} route={route} />
        </div>
      )}
    </div>
  );
}

export function LeaveRow({ t, plan, selected, choice, onPick }: {
  t: ClassTransition;
  plan: DayPlan;
  selected: boolean;
  /**
   * The way the student chose for this leg, when it is the one in focus. The row, its details and its
   * reminder all describe that way, so the day never contradicts the summary above it.
   */
  choice?: RouteChoice;
  onPick: (transitionId: string) => void;
}) {
  const route = choice?.route ?? t.recommendedRoute!;
  const leaveAt = choice ? choice.leaveAt : t.recommendedDeparture;
  const arriveAt = choice ? choice.arriveAt : t.expectedArrival;
  const concern = concernOf(t, choice);
  const title = legTitle(plan, t, route);
  return (
    <li data-reveal className={cn(selected && SELECTED)}>
      <button
        type="button"
        onClick={() => onPick(t.id)}
        aria-current={selected ? "true" : undefined}
        aria-label={`${title}${leaveAt ? `, leave ${formatClock(leaveAt)}` : ""}${concern ? `. ${concern.text}` : ""}`}
        className={ROW_BUTTON}
      >
        <Time at={leaveAt} />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-start gap-1.5 text-[16px] font-semibold leading-[22px]">
            <ModeIcon route={route} className="mt-[3px] text-ink-muted" />
            <span className="min-w-0">{title}</span>
          </span>
          <span className="mt-0.5 block text-[13px] leading-[18px] text-ink-muted">{legMeta(t, route, arriveAt, Boolean(concern))}</span>
          {concern && (
            <span className={cn("mt-1 flex items-center gap-1.5 text-[13px] font-medium leading-[18px]", concern.tone === "bad" ? "text-bad" : "text-warn")}>
              <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
              {concern.text}
            </span>
          )}
        </span>
      </button>
      {selected && <LegDetails t={t} plan={plan} route={route} choice={choice} />}
    </li>
  );
}

export function ClassRow({ c, selected, onPick }: { c: ScheduledClass; selected: boolean; onPick: (classId: string) => void }) {
  const m = c.meeting;
  const room = m.location.kind === "ROOM" ? `${m.location.buildingCode} ${m.location.roomNumber}` : m.location.kind === "ONLINE" ? "Online" : "Room TBA";
  const isWlu = m.university === "WLU";
  // A lecture is what a class usually is; the tag only says something when it is not, or is at Laurier.
  const tag = isWlu || m.component !== "LEC" ? `${isWlu ? "Laurier · " : ""}${m.component}${m.section ? ` ${m.section}` : ""}` : undefined;
  const building = c.room.buildingName ?? c.location.name;
  const where = c.room.floor === "unknown" ? building : `${building} · ${floorLabel(c.room)}`;
  return (
    <li data-reveal className={cn(selected && SELECTED)}>
      <button
        type="button"
        onClick={() => onPick(c.id)}
        aria-current={selected ? "true" : undefined}
        aria-label={`${m.courseCode} in ${room}, ${formatClock(c.start)} to ${formatClock(c.end)}`}
        className={ROW_BUTTON}
      >
        <Time at={c.start} end={c.end} />
        <span className="min-w-0 flex-1">
          <span className="flex items-start justify-between gap-2">
            <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
              <span className="text-[16px] font-semibold leading-[22px]">{m.courseCode}</span>
              <span className="font-mono text-[15px] font-medium leading-[22px] text-ink-muted">{room}</span>
            </span>
            {tag && <Badge variant={isWlu ? "wlu" : "neutral"} className="mt-0.5">{tag}</Badge>}
          </span>
          <span className="mt-0.5 block text-[13px] leading-[18px] text-ink-muted">{where}</span>
        </span>
      </button>
    </li>
  );
}

/** The buffer implied by the analysis: gap minus travel minus usable time, never below zero. */
function cfgBuffer(h: HomeReturnAnalysis): number {
  return Math.max(0, h.gapMinutes - h.travelHomeMinutes - h.travelBackMinutes - h.usableHomeMinutes);
}

/**
 * Going home in a gap, once chosen: the verdict and the one number that matters, time at home with the
 * travel already taken out. The trips there and back are ordinary legs in the day below this row.
 */
function HomeSummary({ h }: { h: HomeReturnAnalysis }) {
  const verdict = h.recommendation === "WORTH_IT"
    ? { Icon: Check, text: "You can go home", cls: "text-ok" }
    : h.recommendation === "POSSIBLE"
      ? { Icon: AlertTriangle, text: "Possible, but probably not worth it", cls: "text-warn" }
      : h.possible
        ? { Icon: X, text: "Not worth going home", cls: "text-bad" }
        : { Icon: X, text: "Not enough time to go home", cls: "text-bad" };
  const detail = h.possible && h.leaveHomeAt
    ? `${formatDuration(h.usableHomeMinutes)} at home · leave home ${formatClock(h.leaveHomeAt)}`
    : `${formatDuration(h.travelHomeMinutes)} home and ${formatDuration(h.travelBackMinutes)} back don't fit in ${formatDuration(h.gapMinutes)} with your ${formatDuration(cfgBuffer(h))} buffer.`;
  return (
    <div className="mt-2">
      <p className={cn("flex items-center gap-1.5 text-[14px] font-medium leading-5", verdict.cls)}>
        <verdict.Icon className="size-4 shrink-0" aria-hidden="true" />
        {verdict.text}
      </p>
      <p className="mt-0.5 text-[13px] leading-[18px] text-ink-muted">{detail}</p>
    </div>
  );
}

/**
 * The day as one list: leaving, classes, free time. Rows are picked by what they are (a leg by its
 * transition id, a class by its id), never by position, so a rebuilt plan never moves the highlight onto
 * another row. Picking a row changes what the planner is about; the summary and the map follow.
 */
export function DayTimeline({ plan, home, busy, focusId, focusChoice, onPickLeg, onPickClass, onChooseGap }: {
  plan: DayPlan;
  home: UserHome | undefined;
  busy: boolean;
  focusId: string | undefined;
  /** The way the student chose for the leg in focus, which its row and details describe. */
  focusChoice?: RouteChoice;
  onPickLeg: (transitionId: string) => void;
  onPickClass: (classId: string) => void;
  onChooseGap?: ChooseGap;
}) {
  if (plan.classes.length === 0) return <p className="px-4 py-10 text-center text-[15px] text-ink-muted">No classes on this day.</p>;
  return (
    <div className={cn("transition-opacity duration-200", busy && "opacity-60")}>
      {plan.warnings.length > 0 && (
        <ul className="mx-4 mb-3 space-y-1 rounded-xl bg-bad-soft p-3 text-[14px] leading-5 text-bad sm:mx-5 lg:mx-0">{plan.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
      )}
      {/*
        One list, hairlines between rows: the day reads as a sequence, not a stack of cards. The entrance plays
        for a new day. Rows are keyed by what they are, so a plan rebuilt for the same day (a gap answered, a
        closure confirmed) keeps its rows, an open gap picker and the focus inside it.
      */}
      <Reveal key={plan.date} as="ol" step={30} duration={300} className="divide-y divide-line border-y border-line bg-surface lg:overflow-hidden lg:rounded-2xl lg:border">
        {plan.items.map((item, i) => {
          switch (item.kind) {
            case "LEAVE": {
              const selected = focusId === legRowId(item.transition.id);
              return <LeaveRow key={`leave:${item.transition.id}`} t={item.transition} plan={plan} selected={selected} choice={selected ? focusChoice : undefined} onPick={onPickLeg} />;
            }
            // The arrival and its margin are already in the leg's own line.
            case "ARRIVE": return null;
            case "CLASS": return <ClassRow key={`class:${item.scheduledClass.id}`} c={item.scheduledClass} selected={focusId === classRowId(item.scheduledClass.id)} onPick={onPickClass} />;
            case "GYM": return (
              <li key={`gym:${i}`} data-reveal className={ROW_STATIC}>
                <Time />
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-semibold leading-[22px]">Gym after class?</p>
                  <GymCard w={item.window} />
                </div>
              </li>
            );
            case "GAP": return (
              <li key={`gap:${item.classId}`} data-reveal className={ROW_STATIC}>
                <Time />
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-semibold leading-[22px]">{formatDuration(item.minutes)} free</p>
                  <p className="text-[13px] leading-[18px] text-ink-muted">{formatClock(item.from)} &ndash; {formatClock(item.to)}</p>
                  {/* The detail blocks only make sense once the student has committed to going. */}
                  {item.choice?.value.kind === "REZ" && item.homeReturn && <HomeSummary h={item.homeReturn} />}
                  {item.choice?.value.kind === "GYM" && item.gym && <GymCard w={item.gym} heading="Your workout" compact />}
                  {onChooseGap
                    ? <GapChoicePicker gap={item} onChoose={onChooseGap} />
                    : !home && <p className="mt-1 text-[13px] leading-[18px] text-ink-muted">Set where you live to see if you can go home.</p>}
                </div>
              </li>
            );
            case "NOTE": return (
              <li key={`note:${i}`} data-reveal className={cn(ROW_STATIC, "text-[13px] leading-[18px] text-ink-muted")}>
                <Time />
                <p className="min-w-0 flex-1">{item.text}</p>
              </li>
            );
          }
        })}
      </Reveal>
    </div>
  );
}
