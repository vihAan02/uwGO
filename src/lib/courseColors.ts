import { normalizeCourseCode } from "@/domain/laurier";

/**
 * Course colours.
 *
 * Each course gets one hue, keyed on the course rather than a meeting, so its lectures, tutorials
 * and labs all read as the same thing. Blocks are a pale fill with a saturated rail down the left,
 * the way UW Flow draws them (MIT, see THIRD_PARTY_NOTICES.md;
 * `src/components/calendar/courseColors.ts`), and until a student picks a colour, courses take
 * the palette in alphabetical order, as UW Flow assigns them.
 *
 * The palette is fixed rather than free-choice so every option stays readable: the tests check
 * each fill against its text, and each rail against its fill and against white.
 */

export const COURSE_COLORS = [
  { id: "blue", name: "Blue", rail: "#2563eb", fill: "#eff6ff", text: "#1e3a8a" },
  { id: "green", name: "Green", rail: "#15803d", fill: "#f0fdf4", text: "#14532d" },
  { id: "purple", name: "Purple", rail: "#6d28d9", fill: "#f5f3ff", text: "#4c1d95" },
  { id: "orange", name: "Orange", rail: "#c2410c", fill: "#fff7ed", text: "#7c2d12" },
  { id: "sky", name: "Sky", rail: "#0369a1", fill: "#f0f9ff", text: "#0c4a6e" },
  { id: "pink", name: "Pink", rail: "#be185d", fill: "#fdf2f8", text: "#831843" },
  { id: "red", name: "Red", rail: "#b91c1c", fill: "#fef2f2", text: "#7f1d1d" },
  { id: "amber", name: "Amber", rail: "#a16207", fill: "#fefce8", text: "#713f12" },
] as const;

export type CourseColor = (typeof COURSE_COLORS)[number];
export type CourseColorId = CourseColor["id"];

/** Primary text on every fill. */
export const BLOCK_TITLE_COLOR = "#0f172a";

const BY_ID = new Map<string, CourseColor>(COURSE_COLORS.map((c) => [c.id, c]));

export function isCourseColorId(v: unknown): v is CourseColorId {
  return typeof v === "string" && BY_ID.has(v);
}

export function courseColor(id: CourseColorId): CourseColor {
  return BY_ID.get(id)!;
}

/** The key a colour is saved under: the course's canonical code, so "CS 135" and "cs135" are one course. */
export const courseColorKey = normalizeCourseCode;

/**
 * Every course's colour. Courses the student has not coloured take the palette by position in
 * alphabetical order, so recolouring one course leaves the others where they were. The one
 * exception is a course whose default is the very colour the student picked for another: it moves
 * to a colour no course is using, so a choice never makes two courses look the same while the
 * palette has room.
 */
export function assignCourseColors(courseKeys: readonly string[], chosen: Readonly<Record<string, CourseColorId>> = {}): Map<string, CourseColor> {
  const sorted = [...new Set(courseKeys.map(courseColorKey))].sort();
  const picked = (key: string) => (isCourseColorId(chosen[key]) ? chosen[key] : undefined);
  const ids = sorted.map((key, i) => picked(key) ?? COURSE_COLORS[i % COURSE_COLORS.length].id);
  const taken = new Set(sorted.flatMap((key) => picked(key) ?? []));
  const used = new Set(ids);
  sorted.forEach((key, i) => {
    if (picked(key) || !taken.has(ids[i])) return;
    const free = COURSE_COLORS.find((c) => !used.has(c.id));
    if (free) { ids[i] = free.id; used.add(free.id); }
  });
  return new Map(sorted.map((key, i) => [key, courseColor(ids[i])]));
}

/** Enough for several terms of courses; a cap so the preferences row cannot grow without bound. */
export const MAX_COURSE_COLORS = 60;
const KEY = /^[a-z0-9]{2,24}$/;

/**
 * Saved colours, read back from storage or the account. Entries that are not a known course key
 * and palette colour are dropped and counted rather than trusted.
 */
export function sanitizeCourseColors(raw: unknown): { colors?: Record<string, CourseColorId>; dropped: number } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { dropped: 1 };
  const colors: Record<string, CourseColorId> = {};
  let dropped = 0;
  for (const [key, value] of Object.entries(raw)) {
    if (!KEY.test(key) || !isCourseColorId(value) || Object.keys(colors).length >= MAX_COURSE_COLORS) { dropped++; continue; }
    colors[key] = value;
  }
  return { colors: Object.keys(colors).length ? colors : undefined, dropped };
}

/**
 * Set or clear one course's colour. Colours for courses no longer in the schedule are let go at
 * the same time, so a student's saved choices track the courses they actually have.
 */
export function withCourseColor(
  current: Readonly<Record<string, CourseColorId>> | undefined,
  courseKey: string,
  color: CourseColorId | undefined,
  scheduledCourseKeys: readonly string[],
): Record<string, CourseColorId> | undefined {
  const keep = new Set(scheduledCourseKeys.map(courseColorKey));
  const key = courseColorKey(courseKey);
  const next: Record<string, CourseColorId> = {};
  for (const [k, v] of Object.entries(current ?? {})) if (keep.has(k) && k !== key) next[k] = v;
  if (color) next[key] = color;
  return Object.keys(next).length ? next : undefined;
}
