"use client";
import { useEffect, useRef } from "react";
import type { CampusLocation, ClassTransition, DayPlan, DayPlanItem, HomeReturnAnalysis, RouteOption, ScheduledClass, UserHome } from "@/domain/types";
import { formatClock, formatDuration, minutesBetween } from "@/time/toronto";
import { googleMapsDirectionsUrl, travelModeFor } from "@/lib/mapsLinks";
import { indoorPathLabel } from "@/engine/indoorRoute";
import { findRoomPosition } from "@/data/floorplans";
import type { MapSelection } from "../map/MapPanel";
import { RemindButton } from "./RemindButton";
import { GymCard } from "./GymCard";

export interface Selectable {
  selectedId: string | undefined;
  onSelect: (id: string, selection: MapSelection) => void;
}

function Time({ at }: { at: Date }) {
  return <time className="w-16 shrink-0 pt-0.5 text-right font-mono text-xs font-semibold tabular-nums sm:w-20 sm:text-sm">{formatClock(at)}</time>;
}

function feasibilityChip(f: ClassTransition["feasibility"]) {
  switch (f) {
    case "COMFORTABLE": return <span className="chip bg-ok-soft text-ok">On time</span>;
    case "TIGHT": return <span className="chip bg-warn-soft text-warn">Tight</span>;
    case "LIKELY_LATE": return <span className="chip bg-bad-soft text-bad">Likely late</span>;
    default: return <span className="chip bg-canvas text-ink-muted">No route</span>;
  }
}

function routeSummary(r: RouteOption): string {
  if (r.indoorPath) return `${formatDuration(r.durationMinutes)} indoors · ${indoorPathLabel(r)}`;
  if (r.mode === "WALK") return r.durationMinutes === 0 ? "Same building" : `${formatDuration(r.durationMinutes)} walk${r.isEstimate ? " (est.)" : ""}`;
  const names = (r.steps ?? []).filter((s) => s.mode === "TRANSIT").map((s) => s.transit?.lineShort ?? s.transit?.line).filter(Boolean).join(" → ");
  return `${formatDuration(r.durationMinutes)} · ${names || "transit"}${r.transferCount ? ` · ${r.transferCount} transfer${r.transferCount > 1 ? "s" : ""}` : ""}`;
}

function modeIcon(r: RouteOption | undefined) {
  if (r?.indoorPath) return "\u{1F3E2}";
  return r?.mode === "TRANSIT" ? "\u{1F68C}" : "\u{1F6B6}";
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

function WalkChoiceRow({ label, r, chosen, note }: { label: string; r: RouteOption; chosen: boolean; note: string }) {
  return (
    <div className={`flex items-baseline justify-between gap-2 rounded-lg px-2 py-1 ${chosen ? "bg-brand-soft text-brand" : "text-ink-muted"}`}>
      <span><span className="font-semibold">{label}</span> · {formatDuration(r.durationMinutes)}</span>
      <span className="text-xs">{note}</span>
    </div>
  );
}

/** The two ways to walk: Google's fastest and the indoor path, side by side. */
function IndoorComparison({ t }: { t: ClassTransition }) {
  const rec = t.recommendedRoute;
  const indoor = t.indoorRoute;
  const fastest = t.walkingRoute;
  if (!rec || !indoor || !fastest || rec.mode === "TRANSIT") return null;
  const chosenIndoor = Boolean(rec.indoorPath);
  return (
    <div className="mt-2 space-y-1 text-sm">
      <WalkChoiceRow label="Fastest" r={fastest} chosen={!chosenIndoor} note="mostly outdoors" />
      <WalkChoiceRow label="Winter route" r={indoor} chosen={chosenIndoor} note={`${indoorPathLabel(indoor)} · mostly indoors`} />
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
    <a
      className="-mx-1 inline-flex min-h-11 items-center px-1 text-xs font-medium text-ink-muted underline decoration-dotted"
      href={googleMapsDirectionsUrl(from, to, travelModeFor(route))}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
    >
      Open in Google Maps &#8599;
    </a>
  );
}

const SELECTED = "ring-2 ring-brand";

function LeaveRow({ t, id, sel, label, day }: { t: ClassTransition; id: string; sel: Selectable; label: string; day: DayPlan }) {
  const rec = t.recommendedRoute!;
  const alt = rec.mode === "WALK" ? t.transitRoute : t.walkingRoute;
  const sameSpot = rec.durationMinutes === 0;
  const select = () => sel.onSelect(id, { kind: "LEG", label, from: t.from, to: t.to, route: rec, walkFallback: t.walkingRoute });
  return (
    <li className="flex gap-2 sm:gap-3">
      <Time at={t.recommendedDeparture!} />
      <div
        role="button"
        tabIndex={0}
        onClick={select}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(); } }}
        className={`card flex-1 cursor-pointer p-3 ${sel.selectedId === id ? SELECTED : ""}`}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="font-semibold">Leave {t.from.name}</div>
            <div className="text-sm text-ink-muted">{modeIcon(rec)} {routeSummary(rec)}{t.hasDeadline && t.expectedArrival ? ` · arrive ${formatClock(t.expectedArrival)}` : ""}</div>
          </div>
          {t.hasDeadline && feasibilityChip(t.feasibility)}
        </div>
        {rec.mode === "TRANSIT" && <TransitSteps route={rec} />}
        <IndoorComparison t={t} />
        {alt && (
          <div className="mt-2 rounded-lg border border-dashed border-line px-2 py-1 text-sm text-ink-muted">
            Also: {modeIcon(alt)} {routeSummary(alt)}
            {alt.mode === "TRANSIT" && alt.departureTime && alt.arrivalTime
              ? ` · leave ${formatClock(alt.departureTime)}, arrive ${formatClock(alt.arrivalTime)}`
              : ""}
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
    <li ref={focusRef} className="flex gap-2 sm:gap-3">
      <div className="w-16 shrink-0 pt-0.5 text-right font-mono text-xs tabular-nums sm:w-20 sm:text-sm">
        <div className="font-semibold">{formatClock(c.start)}</div>
        <div className="text-ink-muted">{formatClock(c.end)}</div>
      </div>
      <div
        role="button"
        tabIndex={0}
        onClick={select}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(); } }}
        className={`card flex-1 cursor-pointer border-l-4 p-3 ${isWlu ? "border-l-wlu" : "border-l-brand"} ${sel.selectedId === id ? SELECTED : ""}`}
      >
        <div className="flex items-baseline justify-between gap-2">
          <div className="text-lg font-bold">{m.courseCode}</div>
          <span className={`chip ${isWlu ? "bg-wlu-soft text-wlu" : "bg-brand-soft text-brand"}`}>{isWlu ? "Laurier" : "Waterloo"} · {m.component}{m.section ? ` ${m.section}` : ""}</span>
        </div>
        {m.courseTitle && <div className="text-sm text-ink-muted">{m.courseTitle}</div>}
        <div className="mt-2 text-base font-semibold">{roomLabel}</div>
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
    ? { icon: "\u2705", text: "You can go home", cls: "bg-ok-soft text-ok" }
    : h.recommendation === "POSSIBLE"
      ? { icon: "\u26A0\uFE0F", text: "Possible, but probably not worth it", cls: "bg-warn-soft text-warn" }
      : h.possible
        ? { icon: "\u274C", text: "Not worth going home", cls: "bg-bad-soft text-bad" }
        : { icon: "\u274C", text: "Not enough time to go home", cls: "bg-bad-soft text-bad" };
  const sub = h.recommendation === "WORTH_IT"
    ? undefined
    : h.possible
      ? `You would only have ${formatDuration(h.usableHomeMinutes)} at home after ${formatDuration(h.travelHomeMinutes)} there and ${formatDuration(h.travelBackMinutes)} back.`
      : `${formatDuration(h.travelHomeMinutes)} home and ${formatDuration(h.travelBackMinutes)} back don't fit in ${formatDuration(h.gapMinutes)} with your ${formatDuration(cfgBuffer(h))} buffer; you wouldn't make your next class safely.`;
  const homeLoc: CampusLocation | undefined = home ? { id: "home", name: home.name, latitude: home.latitude, longitude: home.longitude, kind: "HOME" } : undefined;
  return (
    <div className={`mt-2 rounded-xl p-3 ${verdict.cls}`}>
      <div className="font-semibold">{verdict.icon} {verdict.text}</div>
      {sub && <p className="mt-1 text-sm">{sub}</p>}
      {h.possible && h.arriveHomeAt && h.leaveHomeAt && (
        <>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm text-ink">
            <dt className="text-ink-muted">Class ends</dt><dd className="font-mono tabular-nums">{formatClock(gapStart)}</dd>
            <dt className="text-ink-muted">Get home</dt><dd className="font-mono tabular-nums">{formatClock(h.arriveHomeAt)} <span className="font-sans text-ink-muted">· {legLine(h.routeHome, h.travelHomeMinutes)}</span></dd>
            <dt className="text-ink-muted">Time at home</dt><dd className="text-base font-bold">{formatDuration(h.usableHomeMinutes)}</dd>
            <dt className="text-ink-muted">Leave home</dt><dd className="font-mono tabular-nums font-semibold">{formatClock(h.leaveHomeAt)} <span className="font-sans font-normal text-ink-muted">· {legLine(h.routeBack, h.travelBackMinutes)}</span></dd>
            <dt className="text-ink-muted">Next class</dt><dd className="font-mono tabular-nums">{formatClock(h.nextClassStart)}</dd>
          </dl>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            {homeLoc && from && to && (
              <>
                <button className="min-h-11 rounded-lg bg-surface px-3 font-medium text-ink" onClick={() => sel.onSelect(`${idBase}-out`, { kind: "LEG", label: `${from.name} → ${homeLoc.name}`, from, to: homeLoc, route: h.routeHome })}>Map trip home</button>
                <button className="min-h-11 rounded-lg bg-surface px-3 font-medium text-ink" onClick={() => sel.onSelect(`${idBase}-back`, { kind: "LEG", label: `${homeLoc.name} → ${to.name}`, from: homeLoc, to, route: h.routeBack })}>Map trip back</button>
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

export function DayTimeline({ plan, home, busy, sel, focusClassId }: { plan: DayPlan; home: UserHome | undefined; busy: boolean; sel: Selectable; focusClassId?: string }) {
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

  if (plan.classes.length === 0) return <p className="py-10 text-center text-ink-muted">No classes on this day.</p>;
  return (
    <div className={busy ? "opacity-60" : ""}>
      {plan.warnings.length > 0 && (
        <ul className="mb-3 space-y-1 rounded-xl bg-bad-soft p-3 text-sm text-bad">{plan.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
      )}
      <ol className="space-y-3">
        {plan.items.map((item, i) => {
          switch (item.kind) {
            case "LEAVE": {
              const { prev, next } = neighbouringClasses(plan.items, i);
              const t = item.transition;
              return <LeaveRow key={i} t={t} id={`leg-${i}`} sel={sel} label={`${endpointLabel(t.from, prev)} → ${endpointLabel(t.to, next)}`} day={plan} />;
            }
            case "GYM": return (
              <li key={i} className="flex gap-2 sm:gap-3">
                <div className="w-16 shrink-0 sm:w-20" />
                <div className="card flex-1 border-dashed p-3">
                  <div className="font-semibold">Gym after class?</div>
                  <GymCard w={item.window} />
                </div>
              </li>
            );
            case "ARRIVE": return (
              <li key={i} className="flex gap-2 sm:gap-3">
                <Time at={item.at} />
                {/* The real margin, not the configured buffer: a tight hop can land later than intended. */}
                <div className="flex-1 px-3 text-sm text-ink-muted">
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
                <li key={i} className="flex gap-2 sm:gap-3">
                  <div className="w-16 shrink-0 sm:w-20" />
                  <div className="card flex-1 border-dashed p-3">
                    <div className="font-semibold">{formatDuration(item.minutes)} free</div>
                    <div className="text-sm text-ink-muted">{formatClock(item.from)} &ndash; {formatClock(item.to)}</div>
                    {item.homeReturn ? <HomeCard h={item.homeReturn} home={home} from={prev?.location} to={next?.location} gapStart={item.from} idBase={`home-${i}`} sel={sel} day={plan} backLeg={plan.transitions.find((t) => t.from.kind === "HOME" && next && t.arriveBy.getTime() === next.start.getTime() && t.to.id === next.location.id)} />
                      : home ? <p className="mt-1 text-sm text-ink-muted">Home route unavailable.</p>
                      : <p className="mt-1 text-sm text-ink-muted">Set where you live to see if you can go home.</p>}
                    {item.gym && <GymCard w={item.gym} heading={item.homeReturn?.recommendation === "WORTH_IT" ? "Or go to the gym" : "PAC fits here"} />}
                  </div>
                </li>
              );
            }
            case "NOTE": return <li key={i} className="pl-[4.5rem] text-sm text-ink-muted sm:pl-24">{item.text}</li>;
          }
        })}
      </ol>
    </div>
  );
}
