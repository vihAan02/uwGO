import type { CourseMeeting } from "./types";

/**
 * Whether a meeting pattern is running on a date. Quest gives a meeting its first and last
 * dates, both inclusive: a class is not on before the first or after the last. A meeting whose
 * dates are unknown is taken to run every week.
 *
 * The weekly plan and the Courses timetable both ask this, so they can never disagree about
 * whether a class happens on a given day.
 */
export function withinMeetingDates(m: Pick<CourseMeeting, "startDate" | "endDate">, dateISO: string): boolean {
  if (m.startDate && dateISO < m.startDate) return false;
  if (m.endDate && dateISO > m.endDate) return false;
  return true;
}
