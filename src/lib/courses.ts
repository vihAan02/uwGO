import type { CourseMeeting, TermInfo, University } from "@/domain/types";
import { courseTitleFor, formatCourseCode } from "@/data/courses/metadata";
import { laurierEnrichmentNeeded, normalizeCourseCode } from "@/domain/laurier";

/**
 * The student's courses, as courses rather than as meeting rows.
 *
 * The schedule is stored as one row per meeting pattern, which is what routing needs. A profile
 * page wants the other view: one entry per course, with its lectures, tutorials and labs under
 * it. Pure, so it can be tested without rendering anything.
 */

export interface CourseGroup {
  /** Canonical key, e.g. "cs135". */
  key: string;
  /** How to write it: "CS 135", "BUS 352W". */
  code: string;
  title?: string;
  university: University;
  /** For a Laurier-hosted course, its Laurier code: "BU352". */
  laurierCode?: string;
  meetings: CourseMeeting[];
  /** True when this is a Laurier course still missing its room or its professor. */
  needsLaurierInfo: boolean;
  instructors: string[];
}

const startOf = (m: CourseMeeting) => (m.unscheduled ? Number.MAX_SAFE_INTEGER : m.start);

/** One entry per course, in the order a student would read them: by code. */
export function groupCourses(meetings: readonly CourseMeeting[]): CourseGroup[] {
  const byKey = new Map<string, CourseMeeting[]>();
  for (const m of meetings) {
    const key = normalizeCourseCode(m.courseCode);
    const list = byKey.get(key);
    if (list) list.push(m);
    else byKey.set(key, [m]);
  }

  const groups: CourseGroup[] = [];
  for (const [key, list] of byKey) {
    const sorted = [...list].sort((a, b) => startOf(a) - startOf(b) || a.component.localeCompare(b.component));
    const first = sorted[0];
    const instructors = [...new Set(sorted.flatMap((m) => m.instructors ?? []))];
    groups.push({
      key,
      code: formatCourseCode(first.courseCode),
      title: courseTitleFor(first.courseCode, sorted.find((m) => m.courseTitle)?.courseTitle),
      university: first.university,
      laurierCode: sorted.find((m) => m.laurierCode)?.laurierCode,
      meetings: sorted,
      needsLaurierInfo: sorted.some((m) => laurierEnrichmentNeeded(m).any),
      instructors,
    });
  }
  return groups.sort((a, b) => a.code.localeCompare(b.code));
}

/** "Fall 2026", or nothing when the paste never said. */
export function termLabel(term: TermInfo | undefined): string | undefined {
  return term ? `${term.season} ${term.year}` : undefined;
}

/** What to call the student when all we have is the address they signed in with. */
export function displayName(email: string | undefined): string | undefined {
  if (!email) return undefined;
  const local = email.split("@")[0];
  return local ? local : undefined;
}
