"use client";
import { useState } from "react";
import type { ClassTransition, DayPlan } from "@/domain/types";
import { useReminders } from "@/lib/useReminders";
import { formatClock } from "@/time/toronto";

/** "Remind me" for one leg. Toggles; asks for notification permission on the first use. */
export function RemindButton({ day, t, dark }: { day: DayPlan; t: ClassTransition; dark?: boolean }) {
  const rem = useReminders();
  const [mountedAt] = useState(() => Date.now());
  if (!t.recommendedDeparture || !t.recommendedRoute) return null;
  if (t.recommendedDeparture.getTime() < mountedAt) return null;
  const set = rem.get(day, t);
  const base = dark
    ? set ? "bg-white text-ink" : "bg-white/15 text-white"
    : set ? "bg-brand text-white" : "bg-brand-soft text-brand";
  return (
    <button
      type="button"
      className={`inline-flex min-h-9 items-center gap-1 rounded-lg px-3 text-xs font-semibold ${base}`}
      onClick={(e) => { e.stopPropagation(); void rem.toggle(day, t); }}
      aria-pressed={Boolean(set)}
      title={rem.permission === "denied" ? "Notifications are blocked for this site; the reminder will show inside the app while it is open." : undefined}
    >
      {set ? `✓ Reminder ${formatClock(new Date(set.at))}` : "\u{1F514} Remind me"}
    </button>
  );
}
