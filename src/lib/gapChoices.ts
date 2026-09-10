import type { GapChoice } from "@/domain/types";
import { EMPTY_GAP_CHOICES, gapDateKey, sanitizeGapChoice, type GapChoices } from "@/domain/gapChoices";
import { mondayOfWeek } from "@/time/toronto";

/**
 * Keeping and forgetting gap answers.
 *
 * A day answer is a note about one afternoon, so it is dropped once that week is behind the
 * student — cut at the Monday of the current week rather than today, or looking back at Monday
 * on a Friday would show a blank card where they clearly remember choosing something.
 * A weekly answer has no date and is kept until the class it belongs to leaves the schedule.
 */

/** Mirrors routeCacheStore's cap: a corrupted or ancient file cannot grow without bound. */
export const MAX_GAP_CHOICES = 400;

export function setGapChoice(
  choices: GapChoices | undefined,
  dateISO: string,
  classId: string,
  choice: GapChoice | undefined,
  everyWeek: boolean,
): GapChoices {
  const byDate = { ...(choices?.byDate ?? {}) };
  const byClass = { ...(choices?.byClass ?? {}) };
  const key = gapDateKey(dateISO, classId);

  if (!choice) {
    delete byDate[key];
    delete byClass[classId];
    return pruneGapChoices({ byDate, byClass }, dateISO);
  }

  if (everyWeek) {
    byClass[classId] = choice;
    // The standing answer now covers this day too; a leftover day answer would silently win.
    delete byDate[key];
  } else {
    byDate[key] = choice;
  }
  return pruneGapChoices({ byDate, byClass }, dateISO);
}

/** True when this class carries a standing weekly answer rather than a one-off. */
export function isEveryWeek(choices: GapChoices | undefined, classId: string): boolean {
  return Boolean(choices?.byClass?.[classId]);
}

export function pruneGapChoices(choices: GapChoices | undefined, todayISO: string): GapChoices {
  if (!choices) return EMPTY_GAP_CHOICES;
  const cutoff = mondayOfWeek(todayISO);
  const byDate: Record<string, GapChoice> = {};
  for (const [key, value] of Object.entries(choices.byDate ?? {})) {
    if (key.slice(0, 10) >= cutoff) byDate[key] = value;
  }
  return { byDate: cap(byDate), byClass: cap(choices.byClass ?? {}) };
}

/** Drop weekly answers for classes the student no longer takes. */
export function forgetMissingClasses(choices: GapChoices | undefined, meetingIds: readonly string[]): GapChoices {
  if (!choices) return EMPTY_GAP_CHOICES;
  const live = new Set(meetingIds);
  // A class id is `${meetingId}:${day}`, so the meeting is everything before the last colon.
  const kept = (key: string) => live.has(key.slice(key.lastIndexOf("|") + 1).replace(/:[^:]*$/, ""));
  const pick = (record: Record<string, GapChoice>) =>
    Object.fromEntries(Object.entries(record).filter(([key]) => kept(key)));
  return { byDate: pick(choices.byDate ?? {}), byClass: pick(choices.byClass ?? {}) };
}

function cap(record: Record<string, GapChoice>): Record<string, GapChoice> {
  const keys = Object.keys(record);
  if (keys.length <= MAX_GAP_CHOICES) return record;
  // Keys sort by date first, so the newest survive.
  const keep = keys.sort().slice(-MAX_GAP_CHOICES);
  return Object.fromEntries(keep.map((k) => [k, record[k]]));
}

/** Narrow anything read back from storage. Keys are checked, not just values. */
export function migrateGapChoices(raw: unknown, todayISO: string): GapChoices | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const source = raw as Partial<GapChoices>;
  const clean = (record: unknown, keyOk: (k: string) => boolean): Record<string, GapChoice> => {
    if (!record || typeof record !== "object") return {};
    const out: Record<string, GapChoice> = {};
    for (const [key, value] of Object.entries(record as Record<string, unknown>)) {
      if (!keyOk(key)) continue;
      const choice = sanitizeGapChoice(value);
      if (choice) out[key] = choice;
    }
    return out;
  };
  return pruneGapChoices(
    {
      byDate: clean(source.byDate, (k) => /^\d{4}-\d{2}-\d{2}\|.+$/.test(k)),
      byClass: clean(source.byClass, (k) => k.length > 0 && !k.includes("|")),
    },
    todayISO,
  );
}
