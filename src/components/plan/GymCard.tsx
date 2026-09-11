"use client";
import { Dumbbell } from "lucide-react";
import type { GymWindow } from "@/domain/types";
import { CROWD_LABELS, waitLabel } from "@/data/pac/crowd";
import { formatClock, formatDuration } from "@/time/toronto";
import { Badge } from "@/components/ui/badge";

function crowdVariant(level: GymWindow["crowd"]["level"]): "ok" | "brand" | "warn" | "bad" {
  switch (level) {
    case "QUIET": return "ok";
    case "BEARABLE": return "brand";
    case "BUSY": return "warn";
    default: return "bad";
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
    <div className="mt-2">
      {heading && <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-muted">{heading}</div>}
      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="flex items-center gap-1.5 font-semibold">
          <Dumbbell className="size-4 text-ink-muted" aria-hidden="true" />
          PAC {formatClock(w.start)}–{formatClock(w.end)}
        </span>
        <Badge variant={crowdVariant(crowd.level)}>{CROWD_LABELS[crowd.level]}</Badge>
      </div>
      <div className="mt-1 text-sm">
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
