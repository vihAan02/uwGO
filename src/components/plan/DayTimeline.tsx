"use client";
import { useState } from "react";
import dynamic from "next/dynamic";
import type { CampusLocation, ClassTransition, DayPlan, DayPlanItem, HomeReturnAnalysis, RouteOption, ScheduledClass, UserHome } from "@/domain/types";
import type { PlannerConfig } from "@/domain/config";
import { formatClock, formatDuration } from "@/time/toronto";
import { MAPS_AVAILABLE, googleMapsDirectionsUrl, travelModeFor } from "@/lib/mapsLinks";

const LegMap = dynamic(() => import("../map/LegMap").then((m) => m.LegMap), { ssr: false, loading: () => <div className="h-64 animate-pulse rounded-xl bg-line" /> });

function Time({ at }: { at: Date }) {
  return <time className="w-20 shrink-0 pt-0.5 text-right font-mono text-sm font-semibold tabular-nums">{formatClock(at)}</time>;
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
  if (r.mode === "WALK") return r.durationMinutes === 0 ? "Same building" : `${formatDuration(r.durationMinutes)} walk${r.isEstimate ? " (est.)" : ""}`;
  const legs = r.steps?.filter((s) => s.mode === "TRANSIT") ?? [];
  const names = legs.map((s) => s.transit?.lineShort ?? s.transit?.line).filter(Boolean).join(" → ");
  return `${formatDuration(r.durationMinutes)} · ${names || "transit"}${r.transferCount ? ` · ${r.transferCount} transfer${r.transferCount > 1 ? "s" : ""}` : ""}`;
}

function TransitSteps({ route }: { route: RouteOption }) {
  if (!route.steps) return null;
  return (
    <ol className="mt-2 space-y-1 text-sm">
      {route.steps.map((s, i) => s.mode === "TRANSIT" && s.transit ? (
        <li key={i} className="rounded-lg bg-brand-soft px-2 py-1">
          <span className="font-semibold">{s.transit.lineShort ?? s.transit.line}</span> {s.transit.vehicle.toLowerCase()} {s.transit.headsign ? `toward ${s.transit.headsign}` : ""}
          <div className="text-ink-muted">Board {s.transit.departureStop} {formatClock(s.transit.departureTime)} → {s.transit.arrivalStop} {formatClock(s.transit.arrivalTime)}{s.transit.stopCount ? ` · ${s.transit.stopCount} stop${s.transit.stopCount > 1 ? "s" : ""}` : ""}</div>
        </li>
      ) : (
        <li key={i} className="px-2 text-ink-muted">Walk {formatDuration(s.durationMinutes)}{s.instruction ? ` · ${s.instruction}` : ""}</li>
      ))}
    </ol>
  );
}

/**
 * The map for one trip leg plus an "Open in Google Maps" link.
 * The embedded map needs the browser key; the link works with no keys at all.
 */
function LegMapPanel({ from, to, route, defaultOpen, label, linkText = "Open in Google Maps" }: { from: CampusLocation; to: CampusLocation; route?: RouteOption; defaultOpen: boolean; label: string; linkText?: string }) {
  const [open, setOpen] = useState(defaultOpen);
  const sameSpot = from.latitude === to.latitude && from.longitude === to.longitude;
  if (sameSpot) return null;
  const href = googleMapsDirectionsUrl(from, to, travelModeFor(route));
  return (
    <div className="mt-2">
      <div className="flex items-center justify-between gap-2 text-sm">
        {MAPS_AVAILABLE ? (
          <button className="font-medium text-brand" onClick={() => setOpen((v) => !v)} aria-expanded={open}>{open ? "Hide map" : "Show map"}</button>
        ) : <span />}
        <a className="font-medium text-brand" href={href} target="_blank" rel="noopener noreferrer" aria-label={`${linkText}: ${label}`}>{linkText} ↗</a>
      </div>
      {MAPS_AVAILABLE && open && (
        <div className="mt-2">
          <LegMap from={from} to={to} route={route} />
          {!route?.polyline && <p className="mt-1 text-xs text-ink-muted">Dashed line: straight-line estimate, not a walking path. Configure the Routes API key for real pathways.</p>}
        </div>
      )}
    </div>
  );
}

function LeaveRow({ t, legNumber, legCount, fromLabel, toLabel }: { t: ClassTransition; legNumber: number; legCount: number; fromLabel: string; toLabel: string }) {
  const rec = t.recommendedRoute!;
  const alt = rec.mode === "WALK" ? t.transitRoute : t.walkingRoute;
  const legLabel = `${fromLabel} → ${toLabel}`;
  return (
    <li className="flex gap-3">
      <Time at={t.recommendedDeparture!} />
      <div className="card flex-1 p-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Leg {legNumber} of {legCount} · {legLabel}</div>
        <div className="mt-1 flex items-start justify-between gap-2">
          <div>
            <div className="font-semibold">Leave {t.from.name}</div>
            <div className="text-sm text-ink-muted">{routeSummary(rec)}{t.hasDeadline && t.expectedArrival ? ` · arrive ${formatClock(t.expectedArrival)}` : ""}</div>
          </div>
          {t.hasDeadline && feasibilityChip(t.feasibility)}
        </div>
        {rec.mode === "TRANSIT" && <TransitSteps route={rec} />}
        {alt && (
          <div className="mt-2 rounded-lg border border-dashed border-line px-2 py-1 text-sm text-ink-muted">
            Alternative: {alt.mode === "WALK" ? routeSummary(alt) : `${routeSummary(alt)} · arrive ${alt.arrivalTime ? formatClock(alt.arrivalTime) : "?"}`}
          </div>
        )}
        {t.feasibility === "LIKELY_LATE" && <p className="mt-2 text-sm text-bad">Only {t.availableMinutes} min between classes; this trip needs more.</p>}
        <LegMapPanel from={t.from} to={t.to} route={rec} defaultOpen label={legLabel} />
      </div>
    </li>
  );
}

function ClassRow({ c }: { c: ScheduledClass }) {
  const m = c.meeting;
  const roomLabel = m.location.kind === "ROOM" ? `${m.location.buildingCode} ${m.location.roomNumber}` : "";
  const floor = c.room.floor === "unknown" ? "Floor unknown" : `Floor ${c.room.floor}${c.room.floorConfidence === "likely" ? " (unconfirmed)" : ""}`;
  const isWlu = m.university === "WLU";
  return (
    <li className="flex gap-3">
      <div className="w-20 shrink-0 pt-0.5 text-right font-mono text-sm tabular-nums">
        <div className="font-semibold">{formatClock(c.start)}</div>
        <div className="text-ink-muted">{formatClock(c.end)}</div>
      </div>
      <div className={`card flex-1 border-l-4 p-3 ${isWlu ? "border-l-wlu" : "border-l-brand"}`}>
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

function HomeCard({ h, home, from, to }: { h: HomeReturnAnalysis; home: UserHome | undefined; from?: CampusLocation; to?: CampusLocation }) {
  const verdict = h.recommendation === "WORTH_IT" ? { icon: "✅", text: "Worth going home", cls: "bg-ok-soft text-ok" }
    : h.recommendation === "POSSIBLE" ? { icon: "⚠️", text: `Possible, but only ~${formatDuration(h.usableHomeMinutes)} at home`, cls: "bg-warn-soft text-warn" }
    : { icon: "❌", text: h.possible ? `Not worth it: ~${formatDuration(h.usableHomeMinutes)} at home` : "Not enough time to go home", cls: "bg-bad-soft text-bad" };
  const homeLoc: CampusLocation | undefined = home ? { id: "home", name: home.name, latitude: home.latitude, longitude: home.longitude, kind: "HOME" } : undefined;
  return (
    <div className={`mt-2 rounded-xl p-3 ${verdict.cls}`}>
      <div className="font-semibold">{verdict.icon} {verdict.text}</div>
      {h.possible && (
        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm text-ink">
          <dt className="text-ink-muted">Walk home</dt><dd>{formatDuration(h.travelHomeMinutes)}{h.routeHome?.isEstimate ? " (est.)" : ""}</dd>
          <dt className="text-ink-muted">Arrive {home?.name ?? "home"}</dt><dd>{formatClock(h.arriveHomeAt!)}</dd>
          <dt className="text-ink-muted">Time at home</dt><dd className="font-semibold">{formatDuration(h.usableHomeMinutes)}</dd>
          <dt className="text-ink-muted">Leave home by</dt><dd className="font-semibold">{formatClock(h.leaveHomeAt!)}</dd>
          <dt className="text-ink-muted">Walk back</dt><dd>{formatDuration(h.travelBackMinutes)}</dd>
          <dt className="text-ink-muted">Next class</dt><dd>{formatClock(h.nextClassStart)}</dd>
        </dl>
      )}
      {h.possible && homeLoc && from && to && (
        <div className="mt-2 rounded-lg bg-surface/70 px-2 py-1 text-ink">
          <div className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Home trip</div>
          <LegMapPanel from={from} to={homeLoc} route={h.routeHome} defaultOpen={false} label={`${from.name} → ${homeLoc.name}`} linkText="Route home in Google Maps" />
          <LegMapPanel from={homeLoc} to={to} route={h.routeBack} defaultOpen={false} label={`${homeLoc.name} → ${to.name}`} linkText="Route back in Google Maps" />
        </div>
      )}
    </div>
  );
}

/** Short label for a leg endpoint: "Home" or "CS 135 (MC)". */
function endpointLabel(loc: CampusLocation, cls: ScheduledClass | undefined): string {
  if (loc.kind === "HOME") return "Home";
  if (!cls) return loc.name;
  const bld = cls.meeting.location.kind === "ROOM" ? cls.meeting.location.buildingCode : loc.buildingCode;
  return bld ? `${cls.meeting.courseCode} (${bld})` : cls.meeting.courseCode;
}

/** For each LEAVE item, the class it departs from (previous CLASS item) and the one it heads to (next CLASS item). */
function neighbouringClasses(items: DayPlanItem[], index: number): { prev?: ScheduledClass; next?: ScheduledClass } {
  let prev: ScheduledClass | undefined;
  let next: ScheduledClass | undefined;
  for (let i = index - 1; i >= 0; i--) { const it = items[i]; if (it.kind === "CLASS") { prev = it.scheduledClass; break; } }
  for (let i = index + 1; i < items.length; i++) { const it = items[i]; if (it.kind === "CLASS") { next = it.scheduledClass; break; } }
  return { prev, next };
}

export function DayTimeline({ plan, home, config, busy }: { plan: DayPlan; home: UserHome | undefined; config: PlannerConfig; busy: boolean }) {
  if (plan.classes.length === 0) return <p className="py-10 text-center text-ink-muted">No classes on this day.</p>;
  const leaveIndexes = plan.items.map((it, i) => (it.kind === "LEAVE" ? i : -1)).filter((i) => i >= 0);
  const legCount = leaveIndexes.length;
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
              return <LeaveRow key={i} t={t} legNumber={leaveIndexes.indexOf(i) + 1} legCount={legCount} fromLabel={endpointLabel(t.from, prev)} toLabel={endpointLabel(t.to, next)} />;
            }
            case "ARRIVE": return (
              <li key={i} className="flex gap-3">
                <Time at={item.at} />
                <div className="flex-1 px-3 text-sm text-ink-muted">Arrive {item.to.name}{item.transition.hasDeadline ? ` · ${config.arrivalBufferMinutes} min before class` : ""}</div>
              </li>
            );
            case "CLASS": return <ClassRow key={i} c={item.scheduledClass} />;
            case "GAP": {
              const { prev, next } = neighbouringClasses(plan.items, i);
              return (
                <li key={i} className="flex gap-3">
                  <div className="w-20 shrink-0" />
                  <div className="card flex-1 border-dashed p-3">
                    <div className="font-semibold">You have {formatDuration(item.minutes)} free</div>
                    <div className="text-sm text-ink-muted">{formatClock(item.from)} – {formatClock(item.to)}</div>
                    {item.homeReturn ? <HomeCard h={item.homeReturn} home={home} from={prev?.location} to={next?.location} /> : home ? <p className="mt-1 text-sm text-ink-muted">Home route unavailable.</p> : <p className="mt-1 text-sm text-ink-muted">Set where you live to see if you can go home.</p>}
                  </div>
                </li>
              );
            }
            case "NOTE": return <li key={i} className="pl-24 text-sm text-ink-muted">{item.text}</li>;
          }
        })}
      </ol>
    </div>
  );
}
