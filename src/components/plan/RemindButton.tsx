"use client";
import { useState } from "react";
import { Bell, BellRing } from "lucide-react";
import type { ClassTransition, DayPlan } from "@/domain/types";
import { useReminders } from "@/lib/useReminders";
import { formatClock } from "@/time/toronto";
import { Button } from "@/components/ui/button";

/** "Remind me" for one leg. Toggles; asks for notification permission on the first use. */
export function RemindButton({ day, t, dark }: { day: DayPlan; t: ClassTransition; dark?: boolean }) {
  const rem = useReminders();
  const [mountedAt] = useState(() => Date.now());
  if (!t.recommendedDeparture || !t.recommendedRoute) return null;
  if (t.recommendedDeparture.getTime() < mountedAt) return null;
  const set = rem.get(day, t);
  return (
    <Button
      type="button"
      size="xs"
      variant={dark ? (set ? "inverse" : "inverse-soft") : "outline"}
      className={!dark && set ? "border-brand/25 bg-brand-soft text-brand hover:bg-brand-soft" : undefined}
      onClick={(e) => { e.stopPropagation(); void rem.toggle(day, t); }}
      aria-pressed={Boolean(set)}
      title={rem.permission === "denied" ? "Notifications are blocked for this site; the reminder will show inside the app while it is open." : undefined}
    >
      {set ? <BellRing /> : <Bell />}
      {set ? `Reminder ${formatClock(new Date(set.at))}` : "Remind me"}
    </Button>
  );
}
