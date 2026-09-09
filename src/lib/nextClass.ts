import type { ClassTransition, DayPlan, ScheduledClass, WeekPlan } from "@/domain/types";
import { DAYS_IN_ORDER } from "@/domain/types";

export interface NextUp {
  /**
   * IN_CLASS: happening now. UPCOMING: still ahead. PREVIEW: nothing is ahead in this
   * plan (a past or future week is being browsed) so the shown class is the first one
   * of the day being looked at. NONE: the plan has no classes at all.
   */
  status: "IN_CLASS" | "UPCOMING" | "PREVIEW" | "NONE";
  scheduledClass?: ScheduledClass;
  /** The trip that gets the student there, when the plan has one. */
  transition?: ClassTransition;
  day?: DayPlan;
  /** True when the class is not on today's date. */
  isLaterDay?: boolean;
  /**
   * While a class is in progress, the one after it. The end of a class is exactly when
   * a student needs the next departure time, so the card would otherwise go blank at
   * the moment it matters most.
   */
  upNext?: { scheduledClass: ScheduledClass; transition?: ClassTransition; day: DayPlan };
}

/** The LEAVE transition immediately before a class in the day's item list. */
function transitionInto(day: DayPlan, sc: ScheduledClass): ClassTransition | undefined {
  const at = day.items.findIndex((it) => it.kind === "CLASS" && it.scheduledClass.id === sc.id);
  if (at < 0) return undefined;
  for (let i = at - 1; i >= 0; i--) {
    const it = day.items[i];
    if (it.kind === "CLASS") return undefined;
    if (it.kind === "LEAVE") return it.transition;
  }
  return undefined;
}

/**
 * What the student should be looking at right now: the class in progress, or the next one
 * that hasn't finished yet. Looks at today first, then later days in the same week plan.
 */
export function findNextUp(plan: WeekPlan | undefined, now: Date = new Date(), previewDay?: DayPlan): NextUp {
  if (!plan) return { status: "NONE" };
  const days = DAYS_IN_ORDER.map((d) => plan.days[d]).filter((d): d is DayPlan => Boolean(d?.classes.length));
  const upcoming = days
    .flatMap((day) => day.classes.map((c) => ({ day, c })))
    .filter(({ c }) => c.end.getTime() > now.getTime())
    .sort((a, b) => a.c.start.getTime() - b.c.start.getTime())[0];

  if (!upcoming) {
    const first = previewDay?.classes[0];
    if (!first) return { status: "NONE" };
    return { status: "PREVIEW", scheduledClass: first, transition: transitionInto(previewDay, first), day: previewDay, isLaterDay: true };
  }
  const { day, c } = upcoming;
  const isLaterDay = day.date !== isoOf(now);
  const inClass = c.start.getTime() <= now.getTime();
  const after = inClass
    ? days.flatMap((d) => d.classes.map((cl) => ({ day: d, c: cl })))
        .filter((x) => x.c.start.getTime() >= c.end.getTime())
        .sort((a, b) => a.c.start.getTime() - b.c.start.getTime())[0]
    : undefined;
  return {
    status: inClass ? "IN_CLASS" : "UPCOMING",
    scheduledClass: c,
    transition: transitionInto(day, c),
    day,
    isLaterDay,
    upNext: after ? { scheduledClass: after.c, transition: transitionInto(after.day, after.c), day: after.day } : undefined,
  };
}

function isoOf(d: Date): string {
  // The plan's dates are Toronto wall-clock dates; the browser clock is the student's own.
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** Whole minutes from now until `at`, negative once it has passed. */
export function minutesUntil(at: Date, now: Date = new Date()): number {
  return Math.round((at.getTime() - now.getTime()) / 60000);
}

export function countdownLabel(minutes: number): string {
  if (minutes <= 0) return "now";
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} hr ${m} min` : `${h} hr`;
}
