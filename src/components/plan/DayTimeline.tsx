"use client";
import { useEffect, useRef } from "react";
import { AlertTriangle, Check, ExternalLink, MapPin, X } from "lucide-react";
import type { CampusLocation, ClassTransition, DayPlan, DayPlanItem, EndOfDayDestination, HomeReturnAnalysis, RouteOption, ScheduledClass, UserHome } from "@/domain/types";
import { formatClock, formatDuration, minutesBetween } from "@/time/toronto";
import { googleMapsDirectionsUrl, travelModeFor } from "@/lib/mapsLinks";
import { indoorPathLabel } from "@/engine/indoorRoute";
import { findRoomPosition } from "@/data/floorplans";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Reveal } from "@/components/ui/reveal";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { MapSelection } from "../map/MapPanel";
import { RemindButton } from "./RemindButton";
import { GymCard } from "./GymCard";
import { ModeIcon } from "./ModeIcon";
import { GapChoicePicker, type ChooseGap } from "./GapChoicePicker";
import { ReportClosure, RouteAdjustedNote } from "./ClosureControls";

export interface Selectable {
  selectedId: string | undefined;
  onSelect: (id: string, selection: MapSelection) => void;
}

/** The time rail on the left of every row. */
function Time({ at, end }: { at: Date; end?: Date }) {
  return (
    <div className="w-16 shrink-0 pt-0.5 text-right font-mono text-xs font-semibold tabular-nums sm:w-[4.5rem] sm:text-[13px]">
      <time>{formatClock(at)}</time>
      {end && <div className="font-normal text-ink-muted"><time>{formatClock(end)}</time></div>}
    </div>
  );
}

function feasibilityBadge(f: ClassTransition["feasibility"]) {
  switch (f) {
    case "COMFORTABLE": return <Badge variant="ok">On time</Badge>;
    case "TIGHT": return <Badge variant="warn">Tight</Badge>;
    case "LIKELY_LATE": return <Badge variant="bad">Likely late</Badge>;
    default: return <Badge>No route</Badge>;
  }
}

function routeSummary(r: RouteOption): string {
  if (r.indoorPath) return `${formatDuration(r.durationMinutes)} indoors · ${indoorPathLabel(r)}`;
  if (r.mode === "WALK") return r.durationMinutes === 0 ? "Same building" : `${formatDuration(r.durationMinutes)} walk${r.isEstimate ? " (est.)" : ""}`;
  const names = (r.steps ?? []).filter((s) => s.mode === "TRANSIT").map((s) => s.transit?.lineShort ?? s.transit?.line).filter(Boolean).join(" → ");
  return `${formatDuration(r.durationMinutes)} · ${names || "transit"}${r.transferCount ? ` · ${r.transferCount} transfer${r.transferCount > 1 ? "s" : ""}` : ""}`;
}

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

function WalkChoiceRow({ label, r, chosen, note, onSelect }: { label: string; r: RouteOption; chosen: boolean; note: string; onSelect: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={chosen}
      // The leg row underneath is pressable too; without this it would take the click and show its own route.
      onClick={(e) => { e.stopPropagation(); onSelect(); }}
      className={cn("flex w-full cursor-pointer items-baseline justify-between gap-2 rounded-lg px-2 py-1 text-left", chosen ? "bg-brand-soft text-brand" : "text-ink-muted")}
    >
      <span><span className="font-semibold">{label}</span> · {formatDuration(r.durationMinutes)}</span>
      <span className="text-xs">{note}</span>
    </button>
  );
}

/** The two ways to walk: Google's fastest and the indoor path, side by side. Tapping one shows that way on the map. */
export function IndoorComparison({ t, id, label, sel }: { t: ClassTransition; id: string; label: string; sel: Selectable }) {
  const rec = t.recommendedRoute;
  const indoor = t.indoorRoute;
  // The fastest walk is the campus-aware one when the plan took it, otherwise Google's.
  const fastest = t.campusWalk ?? t.walkingRoute;
  if (!rec || !indoor || !fastest || rec.mode === "TRANSIT") return null;
  // Lit: the way the map is showing for this leg, or until one is tapped, the way the plan took.
  const winterShown = sel.selectedId === `${id}-winter` || (sel.selectedId !== `${id}-fastest` && Boolean(rec.indoorPath));
  const show = (which: "fastest" | "winter", route: RouteOption) =>
    sel.onSelect(`${id}-${which}`, { kind: "LEG", label, from: t.from, to: t.to, route, walkFallback: fastest });
  // The buildings the walk cuts through, not the ones it starts and ends in.
  const through = (fastest.campus?.via.filter((v) => v.startsWith("through ")).map((v) => v.slice("through ".length)) ?? []).filter((b) => b !== t.from.buildingCode && b !== t.to.buildingCode);
  return (
    <div className="mt-2 space-y-1 text-sm">
      <WalkChoiceRow label="Fastest" r={fastest} chosen={!winterShown} note={through.length ? `via ${through.join(", ")}` : "mostly outdoors"} onSelect={() => show("fastest", fastest)} />
      <WalkChoiceRow label="Winter route" r={indoor} chosen={winterShown} note={`${indoorPathLabel(indoor)} · mostly indoors`} onSelect={() => show("winter", indoor)} />
    </div>
  );
}

function TransitSteps({ route }: { route: RouteOption }) {
  if (!route.steps) return null;
  return (
    <ol className="mt-2 space-y-1 text-sm">
      {route.steps.map((s, i) => s.mode === "TRANSIT" && s.transit ? (
        <li key={i} className="rounded-lg bg-brand-soft px-2 py-1">
          <span className="font-semibold">{s.transit.lineShort ?? s.transit.line}</span> {s.transit.vehicle.toLowerCase()} {s.transit.headsign ? `toward ${s.transit.headsign}` : ""}
          <div className="text-ink-muted">Board {s.transit.departureStop} {formatClock(s.transit.departureTime)} &rarr; {s.transit.arrivalStop} {formatClock(s.transit.arrivalTime)}</div>
        </li>
      ) : (
        <li key={i} className="px-2 text-ink-muted">Walk {formatDuration(s.durationMinutes)}</li>
      ))}
    </ol>
  );
}

function MapsLink({ from, to, route }: { from: CampusLocation; to: CampusLocation; route?: RouteOption }) {
  return (
    <Button asChild variant="ghost" size="xs" className="-ml-2 text-ink-muted">
      <a href={googleMapsDirectionsUrl(from, to, travelModeFor(route))} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
        <ExternalLink /> Google Maps
      </a>
    </Button>
  );
}

const ROW = "flex gap-3 px-3 py-3 transition-colors duration-150 sm:gap-4 sm:px-4";
const SELECTED = "bg-brand/[0.045] shadow-[inset_3px_0_0_0_var(--color-brand)]";
const PRESSABLE = "-m-1 min-w-0 flex-1 cursor-pointer rounded-lg p-1 outline-none focus-visible:ring-[3px] focus-visible:ring-brand/35";

export function pressable(select: () => void) {
  return {
    role: "button" as const,
    tabIndex: 0,
    onClick: select,
    onKeyDown: (e: React.KeyboardEvent) => {
      // A key pressed on a control inside the row (Google Maps, Remind me, a route choice) is that control's.
      if (e.target !== e.currentTarget) return;
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(); }
    },
  };
}

/**
 * One line on why a walk uses the doors it does: only when campus knowledge changed the route, or
 * could not and the student needs telling how to get in. The full reasoning is a developer aid,
 * reached from the console (`window.uwgoCampus.legs()`), never rendered.
 */
function CampusNote({ t }: { t: ClassTransition }) {
  const decision = t.campus;
  if (!decision) return null;
  const shown = t.recommendedRoute?.campus?.summary ?? (decision.outcome === "NO_USABLE_ROUTE" ? decision.warnings[0] : undefined);
  if (!shown) return null;
  return <p className={cn("mt-1.5 text-xs", decision.outcome === "NO_USABLE_ROUTE" ? "text-warn" : "text-ink-muted")}>{shown}</p>;
}

function LeaveRow({ t, id, sel, label, day }: { t: ClassTransition; id: string; sel: Selectable; label: string; day: DayPlan }) {
  const rec = t.recommendedRoute!;
  // The walk to fall back on, or to offer beside a bus: the campus-aware one when there is one.
  const walk = t.campusWalk ?? t.walkingRoute;
  const alt = rec.mode === "WALK" ? t.transitRoute : walk;
  const sameSpot = rec.durationMinutes === 0;
  const select = () => sel.onSelect(id, { kind: "LEG", label, from: t.from, to: t.to, route: rec, walkFallback: walk });
  return (
    <li data-reveal className={cn(ROW, (sel.selectedId === id || sel.selectedId?.startsWith(`${id}-`)) && SELECTED)}>
      <Time at={t.recommendedDeparture!} />
      <div className={PRESSABLE} {...pressable(select)}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 font-semibold leading-snug">Leave {t.from.name}</div>
          {t.hasDeadline && feasibilityBadge(t.feasibility)}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-sm text-ink-muted">
          <ModeIcon route={rec} />
          <span>{routeSummary(rec)}{t.hasDeadline && t.expectedArrival ? ` · arrive ${formatClock(t.expectedArrival)}` : ""}</span>
        </div>
        {rec.mode === "TRANSIT" && <TransitSteps route={rec} />}
        <RouteAdjustedNote route={rec} />
        <CampusNote t={t} />
        <IndoorComparison t={t} id={id} label={label} sel={sel} />
        {/* Reporting hangs off the route whose doors and links the student is sent through: a
            campus-aware walk when the plan took one, otherwise the winter route when there is one,
            whether or not the plan chose to take it today. */}
        <ReportClosure route={rec.campus ? rec : t.indoorRoute ?? rec} />
        {alt && (
          <div className="mt-1.5 flex items-center gap-1.5 text-xs text-ink-muted">
            <ModeIcon route={alt} className="size-3.5" />
            <span>
              Also: {routeSummary(alt)}
              {alt.mode === "TRANSIT" && alt.departureTime && alt.arrivalTime ? ` · leave ${formatClock(alt.departureTime)}, arrive ${formatClock(alt.arrivalTime)}` : ""}
            </span>
          </div>
        )}
        {t.feasibility === "LIKELY_LATE" && <p className="mt-2 text-sm text-bad">Only {t.availableMinutes} min between classes; this trip needs more.</p>}
        {!sameSpot && (
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <MapsLink from={t.from} to={t.to} route={rec} />
            {t.hasDeadline && <RemindButton day={day} t={t} />}
          </div>
        )}
      </div>
    </li>
  );
}

function ClassRow({ c, id, sel, focusRef }: { c: ScheduledClass; id: string; sel: Selectable; focusRef?: (el: HTMLLIElement | null) => void }) {
  const m = c.meeting;
  const roomLabel = m.location.kind === "ROOM" ? `${m.location.buildingCode} ${m.location.roomNumber}` : "";
  const floor = floorLabel(c.room);
  const isWlu = m.university === "WLU";
  const select = () => sel.onSelect(id, { kind: "PLACE", label: `${m.courseCode} · ${roomLabel}`, at: c.location });
  return (
    <li ref={focusRef} data-reveal className={cn(ROW, "py-3.5", sel.selectedId === id && SELECTED)}>
      <Time at={c.start} end={c.end} />
      <div className={PRESSABLE} {...pressable(select)}>
        <div className="flex items-baseline justify-between gap-2">
          <div className="text-lg font-bold leading-tight tracking-[-0.01em]">{m.courseCode}</div>
          <Badge variant={isWlu ? "wlu" : "neutral"}>{isWlu ? "Laurier · " : ""}{m.component}{m.section ? ` ${m.section}` : ""}</Badge>
        </div>
        {m.courseTitle && <div className="text-sm text-ink-muted">{m.courseTitle}</div>}
        <div className="mt-1.5 font-semibold">{roomLabel}</div>
        <div className="text-sm text-ink-muted">{c.room.buildingName ?? c.location.name} · {floor}</div>
      </div>
    </li>
  );
}

/** The buffer implied by the analysis: gap minus travel minus usable time, never below zero. */
function cfgBuffer(h: HomeReturnAnalysis): number {
  return Math.max(0, h.gapMinutes - h.travelHomeMinutes - h.travelBackMinutes - h.usableHomeMinutes);
}

function legLine(r: RouteOption | undefined, minutes: number): string {
  if (!r) return formatDuration(minutes);
  if (r.mode === "TRANSIT") {
    const names = (r.steps ?? []).filter((x) => x.mode === "TRANSIT").map((x) => x.transit?.lineShort ?? x.transit?.line).filter(Boolean).join(" → ");
    return `${formatDuration(minutes)} · bus ${names || ""}`.trim();
  }
  return `${formatDuration(minutes)} ${r.indoorPath ? "indoors" : "walk"}${r.isEstimate && !r.indoorPath ? " (est.)" : ""}`;
}

/**
 * previous class ends -> travel home -> time at home -> leave home -> travel back -> next class.
 * The number that matters is usable time at home; travel is already taken out of it.
 */
function HomeCard({ h, home, from, to, gapStart, idBase, sel, day, backLeg }: { h: HomeReturnAnalysis; home: UserHome | undefined; from?: CampusLocation; to?: CampusLocation; gapStart: Date; idBase: string; sel: Selectable; day: DayPlan; backLeg?: ClassTransition }) {
  const verdict = h.recommendation === "WORTH_IT"
    ? { Icon: Check, text: "You can go home", cls: "text-ok" }
    : h.recommendation === "POSSIBLE"
      ? { Icon: AlertTriangle, text: "Possible, but probably not worth it", cls: "text-warn" }
      : h.possible
        ? { Icon: X, text: "Not worth going home", cls: "text-bad" }
        : { Icon: X, text: "Not enough time to go home", cls: "text-bad" };
  const sub = h.recommendation === "WORTH_IT"
    ? undefined
    : h.possible
      ? `You would only have ${formatDuration(h.usableHomeMinutes)} at home after ${formatDuration(h.travelHomeMinutes)} there and ${formatDuration(h.travelBackMinutes)} back.`
      : `${formatDuration(h.travelHomeMinutes)} home and ${formatDuration(h.travelBackMinutes)} back don't fit in ${formatDuration(h.gapMinutes)} with your ${formatDuration(cfgBuffer(h))} buffer; you wouldn't make your next class safely.`;
  const homeLoc: CampusLocation | undefined = home ? { id: "home", name: home.name, latitude: home.latitude, longitude: home.longitude, kind: "HOME" } : undefined;
  return (
    <div className="mt-3 border-t border-line pt-3">
      <div className={cn("flex items-center gap-1.5 font-semibold", verdict.cls)}>
        <verdict.Icon className="size-4 shrink-0" aria-hidden="true" />
        {verdict.text}
      </div>
      {sub && <p className="mt-1 text-sm text-ink-muted">{sub}</p>}
      {h.possible && h.arriveHomeAt && h.leaveHomeAt && (
        <>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-ink-muted">Class ends</dt><dd className="font-mono tabular-nums">{formatClock(gapStart)}</dd>
            <dt className="text-ink-muted">Get home</dt><dd className="font-mono tabular-nums">{formatClock(h.arriveHomeAt)} <span className="font-sans text-ink-muted">· {legLine(h.routeHome, h.travelHomeMinutes)}</span></dd>
            <dt className="text-ink-muted">Time at home</dt><dd className="text-base font-bold">{formatDuration(h.usableHomeMinutes)}</dd>
            <dt className="text-ink-muted">Leave home</dt><dd className="font-mono font-semibold tabular-nums">{formatClock(h.leaveHomeAt)} <span className="font-sans font-normal text-ink-muted">· {legLine(h.routeBack, h.travelBackMinutes)}</span></dd>
            <dt className="text-ink-muted">Next class</dt><dd className="font-mono tabular-nums">{formatClock(h.nextClassStart)}</dd>
          </dl>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {homeLoc && from && to && (
              <>
                <Button variant="outline" size="xs" onClick={(e) => { e.stopPropagation(); sel.onSelect(`${idBase}-out`, { kind: "LEG", label: `${from.name} → ${homeLoc.name}`, from, to: homeLoc, route: h.routeHome }); }}><MapPin /> Trip home</Button>
                <Button variant="outline" size="xs" onClick={(e) => { e.stopPropagation(); sel.onSelect(`${idBase}-back`, { kind: "LEG", label: `${homeLoc.name} → ${to.name}`, from: homeLoc, to, route: h.routeBack }); }}><MapPin /> Trip back</Button>
              </>
            )}
            {backLeg && <RemindButton day={day} t={backLeg} />}
          </div>
        </>
      )}
    </div>
  );
}

function endpointLabel(loc: CampusLocation, cls: ScheduledClass | undefined): string {
  if (loc.kind === "HOME") return "Home";
  if (!cls) return loc.name;
  const bld = cls.meeting.location.kind === "ROOM" ? cls.meeting.location.buildingCode : loc.buildingCode;
  return bld ? `${cls.meeting.courseCode} (${bld})` : cls.meeting.courseCode;
}

function neighbouringClasses(items: DayPlanItem[], index: number): { prev?: ScheduledClass; next?: ScheduledClass } {
  let prev: ScheduledClass | undefined;
  let next: ScheduledClass | undefined;
  for (let i = index - 1; i >= 0; i--) { const it = items[i]; if (it.kind === "CLASS") { prev = it.scheduledClass; break; } }
  for (let i = index + 1; i < items.length; i++) { const it = items[i]; if (it.kind === "CLASS") { next = it.scheduledClass; break; } }
  return { prev, next };
}

const END_OF_DAY_LABELS: Record<EndOfDayDestination, string> = { HOME: "Home", GYM: "Gym", LIBRARY: "Library" };

/** After the last class: home (the default), the gym, or the nearest library. Same idiom as the gap picker. */
function EndOfDayPicker({ value, onChoose }: { value: EndOfDayDestination; onChoose: (d: EndOfDayDestination) => void }) {
  return (
    <div className="mt-3 border-t border-line px-1 pt-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-muted">After your last class</div>
      <ToggleGroup type="single" className="mt-2" value={value} onValueChange={(v) => { if (v) onChoose(v as EndOfDayDestination); }} aria-label="After your last class">
        {(Object.keys(END_OF_DAY_LABELS) as EndOfDayDestination[]).map((d) => (
          <ToggleGroupItem key={d} value={d} className="min-w-[5.5rem] flex-none">{END_OF_DAY_LABELS[d]}</ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}

export function DayTimeline({ plan, home, busy, sel, focusClassId, onChooseGap, endOfDay, onChooseEndOfDay }: { plan: DayPlan; home: UserHome | undefined; busy: boolean; sel: Selectable; focusClassId?: string; onChooseGap?: ChooseGap; endOfDay?: EndOfDayDestination; onChooseEndOfDay?: (d: EndOfDayDestination) => void }) {
  const focusEl = useRef<HTMLLIElement | null>(null);
  const scrolledFor = useRef<string | undefined>(undefined);

  // Bring the class that matters into view once, when today is opened. Tracking the id
  // it last scrolled for means a student who then scrolls away is left alone.
  useEffect(() => {
    if (!focusClassId || scrolledFor.current === focusClassId) return;
    const el = focusEl.current;
    if (!el) return;
    scrolledFor.current = focusClassId;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focusClassId, plan]);

  if (plan.classes.length === 0) return <p className="py-12 text-center text-ink-muted">No classes on this day.</p>;
  return (
    <div className={cn("transition-opacity duration-200", busy && "opacity-60")}>
      {plan.warnings.length > 0 && (
        <ul className="mb-3 space-y-1 rounded-xl bg-bad-soft p-3 text-sm text-bad">{plan.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
      )}
      {/* One list, hairlines between rows: the day reads as a sequence, not a stack of cards. Replays its entrance when the day or the plan's shape changes. */}
      <Reveal key={`${plan.date}-${plan.items.length}`} as="ol" step={30} duration={450} className="overflow-hidden rounded-2xl border border-line bg-surface divide-y divide-line">
        {plan.items.map((item, i) => {
          switch (item.kind) {
            case "LEAVE": {
              const { prev, next } = neighbouringClasses(plan.items, i);
              const t = item.transition;
              return <LeaveRow key={i} t={t} id={`leg-${i}`} sel={sel} label={`${endpointLabel(t.from, prev)} → ${endpointLabel(t.to, next)}`} day={plan} />;
            }
            case "GYM": return (
              <li key={i} data-reveal className={cn(ROW, "bg-canvas/60")}>
                <div className="w-16 shrink-0 sm:w-[4.5rem]" />
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">Gym after class?</div>
                  <GymCard w={item.window} />
                </div>
              </li>
            );
            case "ARRIVE": return (
              <li key={i} data-reveal className={cn(ROW, "py-2 text-sm text-ink-muted")}>
                <Time at={item.at} />
                {/* The real margin, not the configured buffer: a tight hop can land later than intended. */}
                <div className="min-w-0 flex-1 pt-0.5">
                  Arrive {item.to.name}
                  {item.transition.hasDeadline ? ` · ${Math.max(0, minutesBetween(item.at, item.transition.arriveBy))} min before class` : ""}
                </div>
              </li>
            );
            case "CLASS": return (
              <ClassRow
                key={i}
                c={item.scheduledClass}
                id={`class-${i}`}
                sel={sel}
                focusRef={item.scheduledClass.id === focusClassId ? (el) => { focusEl.current = el; } : undefined}
              />
            );
            case "GAP": {
              const { prev, next } = neighbouringClasses(plan.items, i);
              return (
                <li key={i} data-reveal className={cn(ROW, "bg-canvas/60")}>
                  <div className="w-16 shrink-0 sm:w-[4.5rem]" />
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold">{formatDuration(item.minutes)} free</div>
                    <div className="text-sm text-ink-muted">{formatClock(item.from)} &ndash; {formatClock(item.to)}</div>
                    {/* The detail blocks only make sense once the student has committed to going. */}
                    {item.choice?.value.kind === "REZ" && item.homeReturn && (
                      <HomeCard h={item.homeReturn} home={home} from={prev?.location} to={next?.location} gapStart={item.from} idBase={`home-${i}`} sel={sel} day={plan} backLeg={plan.transitions.find((t) => t.from.kind === "HOME" && next && t.arriveBy.getTime() === next.start.getTime() && t.to.id === next.location.id)} />
                    )}
                    {item.choice?.value.kind === "GYM" && item.gym && <GymCard w={item.gym} heading="Your workout" />}
                    {onChooseGap
                      ? <GapChoicePicker gap={item} onChoose={onChooseGap} />
                      : !home && <p className="mt-1 text-sm text-ink-muted">Set where you live to see if you can go home.</p>}
                  </div>
                </li>
              );
            }
            case "NOTE": return (
              <li key={i} data-reveal className={cn(ROW, "py-2 text-sm text-ink-muted")}>
                <div className="w-16 shrink-0 sm:w-[4.5rem]" />
                <div className="min-w-0 flex-1">{item.text}</div>
              </li>
            );
          }
        })}
      </Reveal>
      {onChooseEndOfDay && <EndOfDayPicker value={endOfDay ?? "HOME"} onChoose={onChooseEndOfDay} />}
    </div>
  );
}
