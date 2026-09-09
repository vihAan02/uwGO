/**
 * All wall-clock <-> instant conversions for the app. The zone is fixed to America/Toronto;
 * the developer's or user's machine zone is never consulted.
 */
import { TZDate } from "@date-fns/tz";
import { addMinutes, format, differenceInMilliseconds, addDays } from "date-fns";
import type { DayOfWeek, MinutesOfDay } from "@/domain/types";
import { DAYS_IN_ORDER } from "@/domain/types";

export const TORONTO_TZ = "America/Toronto";

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseISODate(iso: string): { y: number; m: number; d: number } {
  const m = ISO_DATE.exec(iso);
  if (!m) throw new Error(`Not an ISO date: ${iso}`);
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

export function toISODate(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Build the instant for `minutes` past midnight on `dateISO` in Toronto. */
export function torontoDate(dateISO: string, minutes: MinutesOfDay = 0): TZDate {
  const { y, m, d } = parseISODate(dateISO);
  const h = Math.floor(minutes / 60);
  const min = minutes % 60;
  return new TZDate(y, m - 1, d, h, min, 0, 0, TORONTO_TZ);
}

/** Re-express any Date as a TZDate in Toronto (same instant). */
export function inToronto(date: Date): TZDate {
  return new TZDate(date.getTime(), TORONTO_TZ);
}

export function addMin(date: Date, minutes: number): TZDate {
  return addMinutes(inToronto(date), minutes);
}

/** Whole minutes from a to b (b - a). Rounds to nearest minute to avoid float drift. */
export function minutesBetween(a: Date, b: Date): number {
  return Math.round(differenceInMilliseconds(b, a) / 60000);
}

export function formatClock(date: Date): string {
  return format(inToronto(date), "h:mm a");
}

export function formatISODate(date: Date): string {
  return format(inToronto(date), "yyyy-MM-dd");
}

/** Minutes past midnight, Toronto wall clock. */
export function minutesOfDay(date: Date): MinutesOfDay {
  const t = inToronto(date);
  return t.getHours() * 60 + t.getMinutes();
}

export function formatMinutesOfDay(minutes: MinutesOfDay): string {
  const h24 = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${h24 < 12 ? "AM" : "PM"}`;
}

export function formatDuration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r === 0 ? `${h} hr` : `${h} hr ${r} min`;
}

/** JS getDay(): 0 = Sunday. Map to Quest codes. */
const JS_DAY_TO_CODE: DayOfWeek[] = ["Su", "M", "T", "W", "Th", "F", "S"];

export function weekdayOf(dateISO: string): DayOfWeek {
  return JS_DAY_TO_CODE[torontoDate(dateISO, 12).getDay()];
}

export function todayISO(now: Date = new Date()): string {
  return formatISODate(now);
}

/** ISO date of the Monday of the week containing `dateISO` (Toronto). */
export function mondayOfWeek(dateISO: string): string {
  const d = torontoDate(dateISO, 12);
  const js = d.getDay(); // 0..6, Sunday = 0
  const back = js === 0 ? 6 : js - 1;
  return formatISODate(addDays(d, -back));
}

/** ISO date for a given weekday within the week starting on `mondayISO`. */
export function dateForDay(mondayISO: string, day: DayOfWeek): string {
  const idx = DAYS_IN_ORDER.indexOf(day); // M=0 .. Su=6
  return formatISODate(addDays(torontoDate(mondayISO, 12), idx));
}

/** "9:30AM" | "12:50PM" | "9:30 am" | "09:30" (24h) -> minutes of day. Returns undefined if unparseable. */
export function parseClock(text: string): MinutesOfDay | undefined {
  const m = /^\s*(\d{1,2}):(\d{2})\s*([AaPp][Mm])?\s*$/.exec(text);
  if (!m) return undefined;
  let h = Number(m[1]);
  const min = Number(m[2]);
  if (min > 59) return undefined;
  const ampm = m[3]?.toUpperCase();
  if (ampm) {
    if (h < 1 || h > 12) return undefined;
    if (ampm === "AM") h = h === 12 ? 0 : h;
    else h = h === 12 ? 12 : h + 12;
  } else if (h > 23) {
    return undefined;
  }
  return h * 60 + min;
}
