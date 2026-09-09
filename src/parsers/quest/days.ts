import type { DayOfWeek } from "@/domain/types";
import { DAYS_IN_ORDER } from "@/domain/types";

/**
 * Quest day tokens are concatenated with no separator: "MWF", "TTh", "ThF", "M".
 * Two-letter tokens (Th, Su, Sa) must be consumed before single letters.
 * Bare "S" = Saturday and "U" = Sunday follow the PeopleSoft convention (unverified in live Quest; accepted defensively).
 */
export function parseDayTokens(text: string): DayOfWeek[] | undefined {
  const out: DayOfWeek[] = [];
  const s = text.trim();
  if (!s) return undefined;
  let i = 0;
  while (i < s.length) {
    const two = s.slice(i, i + 2);
    if (two === "Th") { out.push("Th"); i += 2; continue; }
    if (two === "Su") { out.push("Su"); i += 2; continue; }
    if (two === "Sa") { out.push("S"); i += 2; continue; }
    const one = s[i];
    if (one === "M") out.push("M");
    else if (one === "T") out.push("T");
    else if (one === "W") out.push("W");
    else if (one === "F") out.push("F");
    else if (one === "S") out.push("S");
    else if (one === "U") out.push("Su");
    else return undefined;
    i += 1;
  }
  const set = new Set(out);
  return DAYS_IN_ORDER.filter((d) => set.has(d));
}
