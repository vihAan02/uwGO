"use client";
import { useEffect, useState } from "react";
import type { NextUp } from "@/lib/nextClass";
import { countdownLabel, minutesUntil } from "@/lib/nextClass";
import { DAY_LABELS } from "@/domain/types";
import { formatClock, formatDuration } from "@/time/toronto";

/** Re-renders once a minute so the countdown stays honest without a timer library. */
function useMinuteTick(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);
  return tick;
}

export function NextClassCard({ next, onSelect }: { next: NextUp; onSelect: () => void }) {
  useMinuteTick();
  const now = new Date();

  if (next.status === "NONE" || !next.scheduledClass) {
    return (
      <div className="rounded-2xl bg-ink p-4 text-white">
        <p className="text-xs font-semibold uppercase tracking-wide text-white/60">Next class</p>
        <p className="mt-1 text-lg font-semibold">Nothing left this week.</p>
        <p className="text-sm text-white/70">Use the day tabs to look at another day.</p>
      </div>
    );
  }

  const c = next.scheduledClass;
  const m = c.meeting;
  const room = m.location.kind === "ROOM" ? `${m.location.buildingCode} ${m.location.roomNumber}` : m.location.kind === "ONLINE" ? "Online" : "Room TBA";
  const floor = c.room.floor === "unknown" ? undefined : `Floor ${c.room.floor}${c.room.floorConfidence === "likely" ? "?" : ""}`;
  const t = next.transition;
  const leaveAt = t?.recommendedDeparture;
  const leaveIn = leaveAt ? minutesUntil(leaveAt, now) : undefined;
  const dayPrefix = next.isLaterDay && next.day ? `${DAY_LABELS[next.day.day]} · ` : "";

  return (
    <button onClick={onSelect} className="w-full rounded-2xl bg-ink p-4 text-left text-white transition active:scale-[0.99]">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-white/60">
          {next.status === "IN_CLASS" ? "In class now" : next.status === "PREVIEW" ? `First class ${next.day ? DAY_LABELS[next.day.day] : ""}` : "Next class"}
        </p>
        {next.status === "UPCOMING" && leaveIn !== undefined && (
          <p className={`text-xs font-semibold ${leaveIn <= 0 ? "text-red-300" : leaveIn <= 10 ? "text-amber-300" : "text-white/60"}`}>
            {leaveIn <= 0 ? "Leave now" : `Leave in ${countdownLabel(leaveIn)}`}
          </p>
        )}
      </div>

      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-2xl font-bold">{m.courseCode}</span>
        <span className="text-sm text-white/70">{dayPrefix}{formatClock(c.start)}</span>
      </div>
      <div className="text-base font-semibold text-white/90">{room}</div>
      <div className="text-sm text-white/60">{c.room.buildingName ?? c.location.name}{floor ? ` · ${floor}` : ""}</div>

      {(next.status === "UPCOMING" || next.status === "PREVIEW") && t?.recommendedRoute && leaveAt && (
        <div className="mt-3 flex items-center gap-2 border-t border-white/15 pt-3 text-sm">
          <span className="rounded-lg bg-white/15 px-2 py-1 font-semibold">
            {t.recommendedRoute.mode === "TRANSIT" ? "🚌" : "🚶"} {formatDuration(t.recommendedRoute.durationMinutes)}
            {t.recommendedRoute.isEstimate ? " est." : ""}
          </span>
          <span className="text-white/80">Leave {formatClock(leaveAt)} from {t.from.name}</span>
        </div>
      )}
      {next.status === "IN_CLASS" && <div className="mt-3 border-t border-white/15 pt-3 text-sm text-white/70">Ends {formatClock(c.end)}</div>}
    </button>
  );
}
