import type { DateOrder, TermInfo } from "@/domain/types";
import { toISODate } from "@/time/toronto";

export interface RawDateRange { start: string; end: string }

const SEP = /[/.-]/;

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function build(y: number, m: number, d: number): string | undefined {
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return undefined;
  return toISODate(y, m, d);
}

/** Parse one date string under a given order. Returns ISO yyyy-mm-dd or undefined. */
export function parseDateAs(text: string, order: DateOrder): string | undefined {
  const parts = text.trim().split(SEP);
  if (parts.length !== 3 || parts.some((p) => !/^\d{1,4}$/.test(p))) return undefined;
  const n = parts.map(Number) as [number, number, number];
  switch (order) {
    case "YMD": return parts[0].length === 4 ? build(n[0], n[1], n[2]) : undefined;
    case "DMY": return parts[2].length === 4 ? build(n[2], n[1], n[0]) : undefined;
    case "MDY": return parts[2].length === 4 ? build(n[2], n[0], n[1]) : undefined;
    default: return undefined;
  }
}

/** Month window (1-12) in which a term's meeting dates plausibly fall, with slack. */
function termMonthWindow(term?: TermInfo): [number, number] | undefined {
  if (!term) return undefined;
  switch (term.season) {
    case "Fall": return [8, 12];
    case "Winter": return [1, 5];
    case "Spring": return [4, 9];
  }
}

export interface DateOrderInference { order: DateOrder; ambiguous: boolean }

/**
 * Pick the date order that makes every range valid (start <= end) and, when known,
 * consistent with the term's months. If two orders both fit equally, report ambiguity and pick none.
 */
export function inferDateOrder(ranges: RawDateRange[], term?: TermInfo): DateOrderInference {
  if (ranges.length === 0) return { order: "UNKNOWN", ambiguous: false };
  const candidates: DateOrder[] = ["YMD", "DMY", "MDY"];
  const window = termMonthWindow(term);
  const fits: { order: DateOrder; score: number }[] = [];
  for (const order of candidates) {
    let ok = true;
    let score = 0;
    for (const r of ranges) {
      const s = parseDateAs(r.start, order);
      const e = parseDateAs(r.end, order);
      if (!s || !e || s > e) { ok = false; break; }
      if (window) {
        const sm = Number(s.slice(5, 7));
        const em = Number(e.slice(5, 7));
        if (sm >= window[0] && sm <= window[1] && em >= window[0] && em <= window[1]) score += 1;
        if (term && (Number(s.slice(0, 4)) === term.year || Number(e.slice(0, 4)) === term.year)) score += 1;
      }
    }
    if (ok) fits.push({ order, score });
  }
  if (fits.length === 0) return { order: "UNKNOWN", ambiguous: false };
  if (fits.length === 1) return { order: fits[0].order, ambiguous: false };
  fits.sort((a, b) => b.score - a.score);
  if (fits[0].score > fits[1].score) return { order: fits[0].order, ambiguous: false };
  const identical = ranges.every((r) =>
    parseDateAs(r.start, fits[0].order) === parseDateAs(r.start, fits[1].order) &&
    parseDateAs(r.end, fits[0].order) === parseDateAs(r.end, fits[1].order));
  if (identical) return { order: fits[0].order, ambiguous: false };
  return { order: "UNKNOWN", ambiguous: true };
}

export function termIdOf(season: TermInfo["season"], year: number): number {
  const code = season === "Winter" ? 1 : season === "Spring" ? 5 : 9;
  return (year - 1900) * 10 + code;
}
