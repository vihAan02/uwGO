"use client";
import { useState } from "react";
import dynamic from "next/dynamic";
import type { ClassTransition, DayPlan, HomeReturnAnalysis, RouteOption, ScheduledClass, UserHome } from "@/domain/types";
import type { PlannerConfig } from "@/domain/config";
import { formatClock, formatDuration } from "@/time/toronto";

const TransitionMap = dynamic(() => import("../map/TransitionMap").then((m) => m.TransitionMap), { ssr: false, loading: () => <div className="h-56 animate-pulse rounded-xl bg-line" /> });

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

function LeaveRow({ t }: { t: ClassTransition }) {
  const [showMap, setShowMap] = useState(false);
  const rec = t.recommendedRoute!;
  const alt = rec.mode === "WALK" ? t.transitRoute : t.walkingRoute;
  return (
    <li className="flex gap-3">
      <Time at={t.recommendedDeparture!} />
      <div className="card flex-1 p-3">
        <div className="flex items-start justify-between gap-2">
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
        {(t.walkingRoute?.polyline || t.transitRoute?.polyline) && (
          <button className="mt-2 text-sm font-medium text-brand" onClick={() => setShowMap((v) => !v)}>{showMap ? "Hide map" : "Show map"}</button>
        )}
        {showMap && <div className="mt-2"><TransitionMap transition={t} /></div>}
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

function HomeCard({ h, home }: { h: HomeReturnAnalysis; home: UserHome | undefined }) {
  const verdict = h.recommendation === "WORTH_IT" ? { icon: "✅", text: "Worth going home", cls: "bg-ok-soft text-ok" }
    : h.recommendation === "POSSIBLE" ? { icon: "⚠️", text: `Possible, but only ~${formatDuration(h.usableHomeMinutes)} at home`, cls: "bg-warn-soft text-warn" }
    : { icon: "❌", text: h.possible ? `Not worth it: ~${formatDuration(h.usableHomeMinutes)} at home` : "Not enough time to go home", cls: "bg-bad-soft text-bad" };
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
    </div>
  );
}

export function DayTimeline({ plan, home, config, busy }: { plan: DayPlan; home: UserHome | undefined; config: PlannerConfig; busy: boolean }) {
  if (plan.classes.length === 0) return <p className="py-10 text-center text-ink-muted">No classes on this day.</p>;
  return (
    <div className={busy ? "opacity-60" : ""}>
      {plan.warnings.length > 0 && (
        <ul className="mb-3 space-y-1 rounded-xl bg-bad-soft p-3 text-sm text-bad">{plan.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
      )}
      <ol className="space-y-3">
        {plan.items.map((item, i) => {
          switch (item.kind) {
            case "LEAVE": return <LeaveRow key={i} t={item.transition} />;
            case "ARRIVE": return (
              <li key={i} className="flex gap-3">
                <Time at={item.at} />
                <div className="flex-1 px-3 text-sm text-ink-muted">Arrive {item.to.name}{item.transition.hasDeadline ? ` · ${config.arrivalBufferMinutes} min before class` : ""}</div>
              </li>
            );
            case "CLASS": return <ClassRow key={i} c={item.scheduledClass} />;
            case "GAP": return (
              <li key={i} className="flex gap-3">
                <div className="w-20 shrink-0" />
                <div className="card flex-1 border-dashed p-3">
                  <div className="font-semibold">You have {formatDuration(item.minutes)} free</div>
                  <div className="text-sm text-ink-muted">{formatClock(item.from)} – {formatClock(item.to)}</div>
                  {item.homeReturn ? <HomeCard h={item.homeReturn} home={home} /> : home ? <p className="mt-1 text-sm text-ink-muted">Home route unavailable.</p> : <p className="mt-1 text-sm text-ink-muted">Set where you live to see if you can go home.</p>}
                </div>
              </li>
            );
            case "NOTE": return <li key={i} className="pl-24 text-sm text-ink-muted">{item.text}</li>;
          }
        })}
      </ol>
    </div>
  );
}
