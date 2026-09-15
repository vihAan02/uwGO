import type { DayOfWeek, WeekPlan } from "@/domain/types";
import { todayISO, weekdayOf } from "@/time/toronto";
import { findNextUp } from "./nextClass";

/** The day tab for a date: its own weekday, or Monday for a weekend day the plan has no classes on. */
export function dayTabFor(plan: WeekPlan | undefined, iso: string): DayOfWeek {
  const d = weekdayOf(iso);
  return (d === "S" || d === "Su") && !plan?.days[d]?.classes.length ? "M" : d;
}

/**
 * The day the planner opens on: today (Monday at a weekend with no classes), or, when today's classes
 * are over, the day of the next class this week. Decided from the moment the page opened, so the day
 * never changes under a student who is looking at it.
 */
export function openingDay(plan: WeekPlan | undefined, openedAt: Date, isThisWeek: boolean): DayOfWeek {
  const iso = todayISO(openedAt);
  const today = dayTabFor(plan, iso);
  if (!plan || !isThisWeek) return today;
  const next = findNextUp(plan, openedAt);
  if (next.status !== "UPCOMING" || !next.day || next.day.date <= iso) return today;
  const todays = plan.days[today];
  return !todays || todays.classes.every((c) => c.end.getTime() <= openedAt.getTime()) ? next.day.day : today;
}
