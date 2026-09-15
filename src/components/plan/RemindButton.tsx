"use client";
import { useState } from "react";
import { Bell, BellRing } from "lucide-react";
import type { ClassTransition, DayPlan } from "@/domain/types";
import type { RouteChoice } from "@/lib/routeChoices";
import { useReminders } from "@/lib/useReminders";
import { formatClock } from "@/time/toronto";
import { Button } from "@/components/ui/button";

/**
 * "Remind me" for one leg, timed and worded for the way the student chose to make it (the plan's own
 * pick when they chose nothing). Toggles; asks for notification permission on the first use. When the
 * browser has notifications blocked the reminder still works inside the app, and the student is told
 * so in words rather than in a tooltip a phone never shows.
 */
export function RemindButton({ day, t, choice }: { day: DayPlan; t: ClassTransition; choice?: RouteChoice }) {
  const rem = useReminders();
  const [mountedAt] = useState(() => Date.now());
  const leaveAt = choice ? choice.leaveAt : t.recommendedDeparture;
  if (!leaveAt || !(choice?.route ?? t.recommendedRoute)) return null;
  if (leaveAt.getTime() < mountedAt) return null;
  const set = rem.get(day, t, choice);
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      <Button
        type="button"
        size="touch"
        variant="outline"
        className={set ? "border-ink bg-fill text-ink hover:bg-fill" : undefined}
        onClick={() => void rem.toggle(day, t, choice)}
        aria-pressed={Boolean(set)}
      >
        {set ? <BellRing /> : <Bell />}
        {set ? `Reminder ${formatClock(new Date(set.at))}` : "Remind me"}
      </Button>
      {set && rem.permission === "denied" && (
        <span className="text-[12px] leading-4 text-ink-muted">Notifications are blocked, so it shows here while UW GO is open.</span>
      )}
    </span>
  );
}
