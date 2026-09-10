import type { DayOfWeek } from "@/domain/types";
import { weekdayOf } from "@/time/toronto";

/**
 * PAC Fitness Centre opening hours.
 * Source: https://athletics.uwaterloo.ca/sports/2010/7/21/Facility_Hours.aspx (read 2026-09-09).
 * Times are minutes past midnight, Toronto wall clock; a close after midnight is > 1440.
 * Every date is inclusive. Update this table when Athletics posts the next term.
 */
export interface OpenWindow { open: number; close: number }
type WeekHours = Record<"weekday" | "saturday" | "sunday", OpenWindow | undefined>;

const t = (h: number, m = 0) => h * 60 + m;

interface HoursPeriod { from: string; to: string; label: string; hours: WeekHours }

export const PAC_HOURS_PERIODS: HoursPeriod[] = [
  { from: "2026-08-01", to: "2026-09-05", label: "Reduced exam hours", hours: { weekday: { open: t(7, 30), close: t(22, 30) }, saturday: { open: t(9), close: t(17, 30) }, sunday: { open: t(9), close: t(17, 30) } } },
  { from: "2026-09-08", to: "2026-12-11", label: "Fall term", hours: { weekday: { open: t(6), close: t(24, 30) }, saturday: { open: t(9), close: t(24, 30) }, sunday: { open: t(9), close: t(24, 30) } } },
  { from: "2026-12-12", to: "2026-12-22", label: "Reduced exam hours", hours: { weekday: { open: t(6), close: t(24, 30) }, saturday: { open: t(9), close: t(22, 30) }, sunday: { open: t(9), close: t(22, 30) } } },
];

/** Special hours and closures from the same page. `undefined` = closed all day. */
export const PAC_SPECIAL_DAYS: Record<string, OpenWindow | undefined> = {
  "2026-09-05": { open: t(9), close: t(17, 30) },
  "2026-09-06": { open: t(9), close: t(22, 30) },
  "2026-09-07": { open: t(9), close: t(22, 30) },
  "2026-10-10": { open: t(9), close: t(17, 30) },
  "2026-10-11": undefined,
  "2026-10-12": undefined,
  "2026-12-23": { open: t(8), close: t(16, 30) },
  "2026-12-24": undefined, "2026-12-25": undefined, "2026-12-26": undefined, "2026-12-27": undefined, "2026-12-28": undefined,
  "2026-12-29": undefined, "2026-12-30": undefined, "2026-12-31": undefined, "2027-01-01": undefined, "2027-01-02": undefined, "2027-01-03": undefined,
};

/** Fallback when a date is outside every posted period: the regular term pattern, flagged by `known: false`. */
const FALLBACK: WeekHours = PAC_HOURS_PERIODS[1].hours;

export interface PacHours extends OpenWindow { known: boolean; label: string }

/** Opening window for one date, or undefined when PAC is closed that day. */
export function pacHoursOn(dateISO: string): PacHours | undefined {
  if (dateISO in PAC_SPECIAL_DAYS) {
    const w = PAC_SPECIAL_DAYS[dateISO];
    return w ? { ...w, known: true, label: "Special hours" } : undefined;
  }
  const day: DayOfWeek = weekdayOf(dateISO);
  const key = day === "S" ? "saturday" : day === "Su" ? "sunday" : "weekday";
  const period = PAC_HOURS_PERIODS.find((p) => dateISO >= p.from && dateISO <= p.to);
  const w = (period?.hours ?? FALLBACK)[key];
  return w ? { ...w, known: Boolean(period), label: period?.label ?? "Assumed regular hours" } : undefined;
}

export const PAC_HOURS_SOURCE = "https://athletics.uwaterloo.ca/sports/2010/7/21/Facility_Hours.aspx";
