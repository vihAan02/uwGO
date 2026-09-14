"use client";
import { useEffect, useState } from "react";
import type { NextUp } from "@/lib/nextClass";
import { countdownLabel, minutesUntil } from "@/lib/nextClass";
import { DAY_LABELS } from "@/domain/types";
import { formatClock, formatDuration } from "@/time/toronto";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { RemindButton } from "./RemindButton";
import { ModeIcon } from "./ModeIcon";
import { floorLabel } from "./DayTimeline";

/** Re-renders once a minute so the countdown stays honest without a timer library. */
function useMinuteTick(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);
  return tick;
}

const EYEBROW = "text-[11px] font-semibold uppercase tracking-[0.06em] text-white/55";

/**
 * The one thing that matters right now: which class, which room, and the minute to leave.
 * Dark on purpose, the same treatment the landing page shows, so it is the first thing the
 * eye lands on.
 */
export function NextClassCard({ next, onSelect }: { next: NextUp; onSelect: () => void }) {
  useMinuteTick();
  const now = new Date();

  if (next.status === "NONE" || !next.scheduledClass) {
    return (
      <div className="rounded-2xl bg-ink p-4 text-white sm:p-5">
        <p className={EYEBROW}>Next class</p>
        <p className="mt-1.5 text-lg font-semibold">Nothing left this week.</p>
        <p className="text-sm text-white/65">Use the day tabs to look at another day.</p>
      </div>
    );
  }

  const c = next.scheduledClass;
  const m = c.meeting;
  const room = m.location.kind === "ROOM" ? `${m.location.buildingCode} ${m.location.roomNumber}` : m.location.kind === "ONLINE" ? "Online" : "Room TBA";
  const floor = c.room.floor === "unknown" ? undefined : floorLabel(c.room);
  const t = next.transition;
  const leaveAt = t?.recommendedDeparture;
  const leaveIn = leaveAt ? minutesUntil(leaveAt, now) : undefined;
  const dayPrefix = next.isLaterDay && next.day ? `${DAY_LABELS[next.day.day]} · ` : "";

  const rec = t?.recommendedRoute;
  const bus = rec?.mode === "TRANSIT" ? rec.steps?.find((s) => s.mode === "TRANSIT")?.transit : undefined;
  const walkAlt = rec?.mode === "TRANSIT" ? t?.campusWalk ?? t?.walkingRoute : undefined;
  const busAlt = rec?.mode === "WALK" ? t?.transitRoute : undefined;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(); } }}
      className="w-full cursor-pointer rounded-2xl bg-ink p-4 text-left text-white outline-none transition-transform duration-150 focus-visible:ring-[3px] focus-visible:ring-brand/50 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas active:scale-[0.995] sm:p-5"
    >
      <div className="flex items-baseline justify-between gap-2">
        <p className={EYEBROW}>
          {next.status === "IN_CLASS" ? "In class now" : next.status === "PREVIEW" ? `First class ${next.day ? DAY_LABELS[next.day.day] : ""}` : "Next class"}
        </p>
        {next.status === "UPCOMING" && leaveIn !== undefined && (
          <p className={cn("text-xs font-semibold", leaveIn <= 0 ? "text-red-300" : leaveIn <= 10 ? "text-amber-300" : "text-white/60")}>
            {leaveIn <= 0 ? "Leave now" : `Leave in ${countdownLabel(leaveIn)}`}
          </p>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <span className="text-[1.75rem] font-bold leading-none tracking-[-0.02em] sm:text-[2rem]">{m.courseCode}</span>
        <span className="text-sm text-white/65 tabular-nums">{dayPrefix}{formatClock(c.start)}</span>
      </div>
      <div className="mt-2 text-lg font-semibold leading-tight text-white/95">{room}</div>
      <div className="text-sm text-white/60">{c.room.buildingName ?? c.location.name}{floor ? ` · ${floor}` : ""}</div>

      {(next.status === "UPCOMING" || next.status === "PREVIEW") && rec && leaveAt && t && (
        <div className="mt-4 border-t border-white/15 pt-3.5 text-sm">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <Badge variant="onDark" className="gap-1.5 px-2 py-1 text-sm font-semibold [&_svg]:size-4">
              <ModeIcon route={rec} />
              {formatDuration(rec.durationMinutes)}{rec.isEstimate && !rec.indoorPath ? " est." : ""}
            </Badge>
            <span className="text-white/80">Leave <span className="font-semibold text-white">{formatClock(leaveAt)}</span> from {t.from.name}</span>
          </div>
          {bus && (
            <div className="mt-2 text-white/90">
              <span className="font-semibold">Recommended: {bus.vehicle.toLowerCase().includes("bus") ? "Bus" : bus.vehicle} {bus.lineShort ?? bus.line}</span>
              <span className="text-white/70"> · board {formatClock(bus.departureTime)} at {bus.departureStop}{t.expectedArrival ? `, arrive ${formatClock(t.expectedArrival)}` : ""}</span>
              {walkAlt && <span className="text-white/70"> · walk would be {formatDuration(walkAlt.durationMinutes)}</span>}
            </div>
          )}
          {!bus && busAlt && busAlt.departureTime && (
            <div className="mt-1 text-xs text-white/60">Bus {(busAlt.steps ?? []).find((s) => s.mode === "TRANSIT")?.transit?.lineShort ?? ""} at {formatClock(busAlt.departureTime)} would take {formatDuration(busAlt.durationMinutes)}; walking is as good.</div>
          )}
          {next.day && next.status === "UPCOMING" && (
            <div className="mt-3"><RemindButton day={next.day} t={t} dark /></div>
          )}
        </div>
      )}
      {next.status === "IN_CLASS" && (
        <div className="mt-4 border-t border-white/15 pt-3.5 text-sm">
          <span className="text-white/70">Ends {formatClock(c.end)}</span>
          {next.upNext && (
            <div className="mt-1 text-white/90">
              Then <span className="font-semibold">{next.upNext.scheduledClass.meeting.courseCode}</span> {formatClock(next.upNext.scheduledClass.start)}
              {next.upNext.transition?.recommendedDeparture && (
                <> · leave <span className="font-semibold">{formatClock(next.upNext.transition.recommendedDeparture)}</span></>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
