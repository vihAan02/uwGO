"use client";
import { Dumbbell } from "lucide-react";
import type { GymWindow } from "@/domain/types";
import { CROWD_LABELS, waitLabel } from "@/data/pac/crowd";
import { formatClock, formatDuration } from "@/time/toronto";
import { Badge } from "@/components/ui/badge";

/** How busy, as a state colour only where it means something; a bearable gym needs no colour at all. */
function crowdVariant(level: GymWindow["crowd"]["level"]): "ok" | "neutral" | "warn" | "bad" {
  switch (level) {
    case "QUIET": return "ok";
    case "BEARABLE": return "neutral";
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
      {heading && <p className="text-[13px] font-medium leading-[18px]">{heading}</p>}
      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[14px] font-medium leading-5">
        <Dumbbell className="size-4 text-ink-muted" aria-hidden="true" />
        PAC {formatClock(w.start)}–{formatClock(w.end)}
        <Badge variant={crowdVariant(crowd.level)}>{CROWD_LABELS[crowd.level]}</Badge>
      </p>
      <p className="mt-0.5 text-[13px] leading-[18px] text-ink-muted">
        {formatDuration(w.workoutMinutes)} workout fits · {CROWD_LABELS[crowd.level].toLowerCase()} {sourceNote(w)} · wait {waitLabel(crowd)}
      </p>
      {!compact && (
        <p className="mt-0.5 text-[13px] leading-[18px] text-ink-muted">
          Leave {w.fromLabel} {formatClock(w.leaveAt)} ({formatDuration(w.routeIn.durationMinutes)}) · leave PAC by {formatClock(w.leavePacBy)} for {w.toLabel} · {formatDuration(w.usableMinutes)} at PAC
        </p>
      )}
    </div>
  );
}
