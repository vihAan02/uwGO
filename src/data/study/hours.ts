import { hoursOn, t, type HoursTable, type ResolvedHours, type WeekHours } from "@/data/hours";

/**
 * Library opening hours.
 *
 * Source: https://libcal.uwaterloo.ca/hours/ — UW Libraries' own LibCal, read 2026-09-10.
 *
 * LibCal publishes week by week rather than stating a term-wide range, so the posted period
 * below is exactly the week that was read and nothing more. Every other date falls to the same
 * weekday pattern flagged `known: false`, which the UI shows as "assumed" — the alternative,
 * declaring a whole term from one week, would be asserting more than was actually checked.
 * Widen the period when the following weeks are confirmed.
 */
export const STUDY_HOURS_SOURCE = "https://libcal.uwaterloo.ca/hours/";

/** Labour Day 2026: both libraries closed all day. */
const LABOUR_DAY = { "2026-09-07": undefined };

/** Dana Porter: 8am-9pm weekdays, 11am-9pm Saturday, noon-5pm Sunday. */
const DANA_PORTER_WEEK: WeekHours = {
  weekday: { open: t(8), close: t(21) },
  saturday: { open: t(11), close: t(21) },
  sunday: { open: t(12), close: t(17) },
};

/** Davis Centre: 8am-midnight weekdays, 11am-midnight Saturday, noon-5pm Sunday. */
const DAVIS_WEEK: WeekHours = {
  weekday: { open: t(8), close: t(24) },
  saturday: { open: t(11), close: t(24) },
  sunday: { open: t(12), close: t(17) },
};

const READ_WEEK = { from: "2026-09-06", to: "2026-09-12", label: "Fall term" };

export const STUDY_HOURS: Record<string, HoursTable> = {
  "UW:LIB": {
    source: STUDY_HOURS_SOURCE,
    periods: [{ ...READ_WEEK, hours: DANA_PORTER_WEEK }],
    special: LABOUR_DAY,
    fallback: DANA_PORTER_WEEK,
  },
  "UW:DC": {
    source: STUDY_HOURS_SOURCE,
    periods: [{ ...READ_WEEK, hours: DAVIS_WEEK }],
    special: LABOUR_DAY,
    fallback: DAVIS_WEEK,
  },
};

/** Opening window for one spot on one date, or undefined when it is closed (or unknown to us). */
export function studyHoursOn(spotId: string, dateISO: string): ResolvedHours | undefined {
  const table = STUDY_HOURS[spotId];
  return table ? hoursOn(table, dateISO) : undefined;
}
