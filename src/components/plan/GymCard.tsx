"use client";
import type { GymWindow } from "@/domain/types";
import { CROWD_LABELS, waitLabel } from "@/data/pac/crowd";
import { formatClock, formatDuration } from "@/time/toronto";

function crowdClass(level: GymWindow["crowd"]["level"]): string {
  switch (level) {
    case "QUIET": return "bg-ok-soft text-ok";
    case "BEARABLE": return "bg-brand-soft text-brand";
    case "BUSY": return "bg-warn-soft text-warn";
    default: return "bg-bad-soft text-bad";
  }
}

function sourceNote(w: GymWindow): string {
  switch (w.crowd.source) {
    case "LIVE": return "live right now";
    case "LIVE_ADJUSTED": return "from a recent live reading";
    default: return "usually";
  }
}

/** One workout window: the time, the crowd, the estimated machine wait, and the travel either side. */
export function GymCard({ w, heading, compact }: { w: GymWindow; heading?: string; compact?: boolean }) {
  const crowd = w.crowd;
  return (
    <div className="mt-2 rounded-xl bg-canvas p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          {heading && <div className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{heading}</div>}
          <div className="font-semibold">{"\u{1F3CB}️"} PAC {formatClock(w.start)}–{formatClock(w.end)}</div>
        </div>
        <span className={`chip ${crowdClass(crowd.level)}`}>{CROWD_LABELS[crowd.level]}</span>
      </div>
      <div className="mt-1 text-sm text-ink">
        {formatDuration(w.workoutMinutes)} workout fits · {CROWD_LABELS[crowd.level].toLowerCase()} {sourceNote(w)}
      </div>
      <div className="text-sm text-ink-muted">Estimated machine wait: {waitLabel(crowd)}</div>
      {!compact && (
        <ul className="mt-2 space-y-0.5 text-xs text-ink-muted">
          <li>{formatDuration(w.routeIn.durationMinutes)} from {w.fromLabel} · leave {formatClock(w.leaveAt)}</li>
          <li>{formatDuration(w.routeOut.durationMinutes)} to {w.toLabel} · leave PAC by {formatClock(w.leavePacBy)}</li>
          <li>{formatDuration(w.usableMinutes)} usable at PAC after travel</li>
        </ul>
      )}
    </div>
  );
}
