import type { GapChoice, GapChoiceKind, GymThen } from "./types";

/**
 * What the student decided to do with their gaps.
 *
 * Two maps rather than one, because "this Thursday" and "every Thursday" are different promises.
 * A `byClass` entry is the standing answer; a `byDate` entry overrides it for one day only. The
 * class key works across weeks because `ScheduledClass.id` is `${meetingId}:${day}` — stable for
 * the life of the schedule — so it really does mean "every Thursday after MATH 239".
 *
 * There is deliberately no `everyWeek` flag on a choice: presence in `byClass` IS the flag, and
 * a derived answer cannot disagree with the maps it describes.
 */
export interface GapChoices {
  byDate: Record<string, GapChoice>;
  byClass: Record<string, GapChoice>;
}

export const EMPTY_GAP_CHOICES: GapChoices = { byDate: {}, byClass: {} };

export const gapDateKey = (dateISO: string, classId: string) => `${dateISO}|${classId}`;

export interface ChosenGap {
  value: GapChoice;
  /** DATE: chosen for this day only. CLASS: the standing weekly answer. */
  source: "DATE" | "CLASS";
}

/** The answer in force for one gap: the day's own beats the standing one. */
export function chosenFor(choices: GapChoices | undefined, dateISO: string, classId: string): ChosenGap | undefined {
  if (!choices) return undefined;
  const byDate = choices.byDate?.[gapDateKey(dateISO, classId)];
  if (byDate) return { value: byDate, source: "DATE" };
  const byClass = choices.byClass?.[classId];
  return byClass ? { value: byClass, source: "CLASS" } : undefined;
}

const KINDS = new Set<GapChoiceKind>(["STAY", "REZ", "GYM", "STUDY"]);
const THENS = new Set<GymThen>(["REZ", "STUDY", "CLASS"]);

/** Narrow anything read back from storage, dropping what does not belong. */
export function sanitizeGapChoice(raw: unknown): GapChoice | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const c = raw as Partial<GapChoice>;
  if (!c.kind || !KINDS.has(c.kind)) return undefined;
  // A "then" only means anything after a workout; anywhere else it is noise.
  const gymThen = c.kind === "GYM" && c.gymThen && THENS.has(c.gymThen) ? c.gymThen : undefined;
  return gymThen ? { kind: c.kind, gymThen } : { kind: c.kind };
}
