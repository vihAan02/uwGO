import type { DayOfWeek } from "@/domain/types";
import { weekdayOf } from "@/time/toronto";

/**
 * Opening hours for a place that posts them: PAC, a library, anything else added later.
 *
 * Times are minutes past midnight, Toronto wall clock. A close after midnight is > 1440 and is
 * deliberately NOT wrapped into 0..1439 — a consumer must not treat these as `MinutesOfDay`.
 * Every date is inclusive. A date outside every posted period still gets an answer, but flagged
 * `known: false`, so the UI can say "assumed" rather than presenting a guess as fact.
 */
export interface OpenWindow { open: number; close: number }

export type WeekHours = Record<"weekday" | "saturday" | "sunday", OpenWindow | undefined>;

export interface HoursPeriod { from: string; to: string; label: string; hours: WeekHours }

export interface HoursTable {
  /** Cited page the hours were read from, plus the date they were read. */
  source: string;
  periods: HoursPeriod[];
  /** Special hours and closures. A key present with `undefined` means closed all day. */
  special: Record<string, OpenWindow | undefined>;
  /** Used when a date falls outside every period. Answers are flagged `known: false`. */
  fallback: WeekHours;
}

export interface ResolvedHours extends OpenWindow { known: boolean; label: string }

/** Minutes past midnight, for building tables readably. */
export const t = (h: number, m = 0) => h * 60 + m;

/** The opening window for one date, or undefined when the place is closed that day. */
export function hoursOn(table: HoursTable, dateISO: string): ResolvedHours | undefined {
  if (dateISO in table.special) {
    const w = table.special[dateISO];
    return w ? { ...w, known: true, label: "Special hours" } : undefined;
  }
  const day: DayOfWeek = weekdayOf(dateISO);
  const key = day === "S" ? "saturday" : day === "Su" ? "sunday" : "weekday";
  const period = table.periods.find((p) => dateISO >= p.from && dateISO <= p.to);
  const w = (period?.hours ?? table.fallback)[key];
  return w ? { ...w, known: Boolean(period), label: period?.label ?? "Assumed regular hours" } : undefined;
}
