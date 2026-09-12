import { addDays, format } from "date-fns";
import type { CourseMeeting, DayOfWeek } from "@/domain/types";
import { DAYS_IN_ORDER } from "@/domain/types";
import { withinMeetingDates } from "@/domain/meetingDates";
import { formatISODate, mondayOfWeek, parseISODate, toISODate, torontoDate, weekdayOf } from "@/time/toronto";

/**
 * The timetable as a calendar: real dates, not abstract weekdays.
 *
 * Adapted from UW Flow's profile calendar (MIT, see THIRD_PARTY_NOTICES.md;
 * `src/pages/profilePage/ProfileCalendar.tsx`): recurring meetings become dated occurrences only
 * between their first and last dates, the week opens on today or on the first week of classes if
 * term has not started, the header reads "Sep 21st – 25th, 2026", and a weekend column appears
 * only when something is on. Day and month views are UW Go's, built on the same occurrences.
 *
 * All dates are Toronto calendar dates as ISO strings, so the machine's own zone never shifts a
 * class onto the wrong day.
 */

export type CalendarView = "day" | "week" | "month";

export interface ClassOccurrence {
  /** Unique per meeting per date. */
  id: string;
  date: string;
  /** Minutes from midnight. */
  start: number;
  end: number;
  meeting: CourseMeeting;
}

export interface CalendarDay {
  date: string;
  day: DayOfWeek;
  /** "Mon 21" */
  label: string;
  isToday: boolean;
  occurrences: ClassOccurrence[];
}

const noon = (iso: string) => torontoDate(iso, 12);

export function addDaysISO(iso: string, days: number): string {
  return formatISODate(addDays(noon(iso), days));
}

/** A meeting that can be drawn at a time: it has days, and ends after it starts. */
export function isOnTimetable(m: CourseMeeting): boolean {
  return !m.unscheduled && m.days.length > 0 && m.end > m.start;
}

/** The classes that actually happen on a date, earliest first. */
export function occurrencesOn(meetings: readonly CourseMeeting[], dateISO: string): ClassOccurrence[] {
  const day = weekdayOf(dateISO);
  return meetings
    .filter((m) => isOnTimetable(m) && m.days.includes(day) && withinMeetingDates(m, dateISO))
    .map((m) => ({ id: `${m.id}:${dateISO}`, date: dateISO, start: m.start, end: m.end, meeting: m }))
    .sort((a, b) => a.start - b.start || a.end - b.end || a.id.localeCompare(b.id));
}

export function calendarDay(meetings: readonly CourseMeeting[], dateISO: string, todayISO: string): CalendarDay {
  return { date: dateISO, day: weekdayOf(dateISO), label: format(noon(dateISO), "EEE d"), isToday: dateISO === todayISO, occurrences: occurrencesOn(meetings, dateISO) };
}

/** The whole Monday-to-Sunday week containing `anchorISO`. */
export function fullWeek(meetings: readonly CourseMeeting[], anchorISO: string, todayISO: string): CalendarDay[] {
  const monday = mondayOfWeek(anchorISO);
  return DAYS_IN_ORDER.map((_, i) => calendarDay(meetings, addDaysISO(monday, i), todayISO));
}

/** The columns of the week view: Monday to Friday always, Saturday and Sunday only when a class falls on them. */
export function weekColumns(meetings: readonly CourseMeeting[], anchorISO: string, todayISO: string): CalendarDay[] {
  return fullWeek(meetings, anchorISO, todayISO).filter((d, i) => i < 5 || d.occurrences.length > 0);
}

export interface MonthCell extends CalendarDay {
  inMonth: boolean;
}

/** The month containing `anchorISO` as whole Monday-first weeks, padded with the neighbouring months' days. */
export function monthWeeks(meetings: readonly CourseMeeting[], anchorISO: string, todayISO: string): MonthCell[][] {
  const { y, m } = parseISODate(anchorISO);
  const first = toISODate(y, m, 1);
  const prefix = first.slice(0, 7);
  const weeks: MonthCell[][] = [];
  // A week belongs to the month when it holds any of the month's days.
  for (let monday = mondayOfWeek(first); ; monday = addDaysISO(monday, 7)) {
    const days = DAYS_IN_ORDER.map((_, i) => addDaysISO(monday, i));
    if (!days.some((d) => d.startsWith(prefix))) break;
    weeks.push(days.map((date) => ({ ...calendarDay(meetings, date, todayISO), inMonth: date.startsWith(prefix) })));
  }
  return weeks;
}

/** The first date any class actually meets, if the schedule carries dates at all. */
export function firstClassDate(meetings: readonly CourseMeeting[]): string | undefined {
  let first: string | undefined;
  for (const m of meetings) {
    if (!isOnTimetable(m) || !m.startDate) continue;
    for (let i = 0; i < 7; i++) {
      const date = addDaysISO(m.startDate, i);
      if (!withinMeetingDates(m, date)) break;
      if (m.days.includes(weekdayOf(date))) { if (!first || date < first) first = date; break; }
    }
  }
  return first;
}

/** Where the timetable opens: today, or the first day of classes when term has not started yet. */
export function initialAnchor(meetings: readonly CourseMeeting[], todayISO: string): string {
  const first = firstClassDate(meetings);
  return first && todayISO < first ? first : todayISO;
}

/**
 * One step backward or forward. A week or month step lands on today when today is in the period
 * stepped to, and otherwise on its first day, so switching to the day view afterwards shows the
 * day a student would expect.
 */
export function stepAnchor(view: CalendarView, anchorISO: string, direction: 1 | -1, todayISO: string): string {
  if (view === "day") return addDaysISO(anchorISO, direction);
  if (view === "week") {
    const monday = addDaysISO(mondayOfWeek(anchorISO), 7 * direction);
    return mondayOfWeek(todayISO) === monday ? todayISO : monday;
  }
  const { y, m } = parseISODate(anchorISO);
  const target = new Date(Date.UTC(y, m - 1 + direction, 1));
  const first = toISODate(target.getUTCFullYear(), target.getUTCMonth() + 1, 1);
  return todayISO.slice(0, 7) === first.slice(0, 7) ? todayISO : first;
}

/**
 * "Sep 21st – 25th, 2026", "Sep 28th – Oct 2nd, 2026", "Dec 28th, 2026 – Jan 1st, 2027", as UW
 * Flow writes a range, and a single day in full.
 */
export function formatDateRange(startISO: string, endISO: string): string {
  const s = noon(startISO);
  const e = noon(endISO);
  if (startISO === endISO) return format(s, "EEEE, MMM do, yyyy");
  if (s.getFullYear() !== e.getFullYear()) return `${format(s, "MMM do, yyyy")} – ${format(e, "MMM do, yyyy")}`;
  if (s.getMonth() !== e.getMonth()) return `${format(s, "MMM do")} – ${format(e, "MMM do, yyyy")}`;
  return `${format(s, "MMM do")} – ${format(e, "do, yyyy")}`;
}

/** "Mon, Sep 21" */
export function formatShortDate(dateISO: string): string {
  return format(noon(dateISO), "EEE, MMM d");
}

export function formatMonth(anchorISO: string): string {
  return format(noon(anchorISO), "MMMM yyyy");
}

/** Hours of class across some days, to the nearest half hour, as UW Flow counts them. */
export function hoursOfClass(days: readonly CalendarDay[]): number {
  const minutes = days.reduce((sum, d) => sum + d.occurrences.reduce((s, o) => s + (o.end - o.start), 0), 0);
  return Math.round((2 * minutes) / 60) / 2;
}
