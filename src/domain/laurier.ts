import type { University } from "./types";

/**
 * Cross-registered Laurier courses as they appear in Waterloo's Quest.
 *
 * A double-degree student sees their Laurier courses in Quest already, under a Waterloo subject
 * with a "W" on the catalogue number. Quest is therefore enough to know the course exists and
 * when it meets; what it may not carry is the professor and the Laurier room.
 *
 * Officially documented, in matching words, by both universities:
 *  - Laurier Enrolment Services, cross-registration: "All Laurier courses have a W attached to
 *    the course number on Quest. (e.g., BU352 at WLU versus BUS 352W at UW)"
 *    students.wlu.ca/academics/records-and-registration/academic-standing-and-registration/alternative-registration-procedures/cross-registration.html
 *  - UW Math Business and Accounting Programs: "BU352 at Laurier versus BUS 352W at Waterloo"
 *    uwaterloo.ca/math-business-accounting-programs/current-students/business-courses-wilfrid-laurier-university
 *  - UW Undergraduate Calendar, BUS subject: all BUS courses are offered by Laurier's Lazaridis
 *    School and "appear with prefix 'BUS' on University of Waterloo records with 'W' attached".
 *    ucalendar.uwaterloo.ca/2324/COURSE/course-BUS.html
 *  - UW Cheriton School (BBA/BCS): the same applies to Economics ("EC"/"ECON").
 *    cs.uwaterloo.ca/bbabcs-courses
 *
 * Three things the obvious implementation gets wrong, so they are spelled out here:
 *  1. The subject mapping is a table, not "the first two letters". GESC 231W is Laurier's
 *     GESC 231, so a two-letter rule would invent "GE231".
 *  2. Only the final W is dropped. BUS 461AW is BU461A, not BU461.
 *  3. The subject must match as a whole token. ARBUS, AFM and BET are real Waterloo subjects,
 *     and Waterloo teaches its own ECON courses, which carry no W.
 */

/**
 * Quest subject to Laurier subject, from UW's course-offerings list (classes.uwaterloo.ca).
 * Deliberately data rather than logic: the list is open, and an unknown W-suffixed subject is
 * reported rather than guessed at (see `unmappedSubject`).
 */
export const CROSS_REGISTERED_SUBJECTS: Readonly<Record<string, string>> = {
  BUS: "BU",
  ECON: "EC",
  GESC: "GESC",
};

/**
 * A Laurier-hosted catalogue number in Quest: three digits, an optional stream letter, then W.
 * Kept strict on purpose. A looser pattern would start claiming Waterloo courses.
 */
const LAURIER_NUMBER = /^(\d{3}[A-Z]?)W$/;

/** Quest's Campus column names the institution that offers the course. */
const LAURIER_CAMPUS = /wilfrid\s*laurier/i;

/** Sections numbered 999 are reserved for double-degree students (UW Registrar cross-registration form). */
export const DOUBLE_DEGREE_SECTION = "999";

export interface CourseClassification {
  university: University;
  /** The Laurier code for a Laurier-hosted course, e.g. "BU352". Absent for Waterloo courses. */
  laurierCode?: string;
  /**
   * A W-suffixed catalogue number in a subject we have no Laurier mapping for. Treated as
   * Waterloo, because inventing a Laurier code would be worse than leaving it alone, but
   * surfaced so the table can be extended rather than silently drifting.
   */
  unmappedSubject?: string;
}

/** "BUS 352W" split into its parts, or undefined when it is not a course code at all. */
export function splitCourseCode(code: string): { subject: string; number: string } | undefined {
  const m = /^([A-Za-z]{2,10})\s*(\d{1,4}[A-Za-z]{0,2})$/.exec(code.trim());
  return m ? { subject: m[1].toUpperCase(), number: m[2].toUpperCase() } : undefined;
}

/**
 * Which university actually teaches this course, and its Laurier code when it is Laurier's.
 * `campus` is Quest's Campus column when the paste carries one; it wins, because it is the
 * institution stated by the registrar rather than a convention read off the course number.
 */
export function classifyCourse(subject: string, catalogNumber: string, campus?: string): CourseClassification {
  const subj = subject.trim().toUpperCase();
  const num = catalogNumber.trim().toUpperCase();
  const suffixed = LAURIER_NUMBER.exec(num);
  const mapped = suffixed ? CROSS_REGISTERED_SUBJECTS[subj] : undefined;
  const byCampus = campus !== undefined && LAURIER_CAMPUS.test(campus);

  if (mapped && suffixed) return { university: "WLU", laurierCode: `${mapped}${suffixed[1]}` };
  if (byCampus) return suffixed ? { university: "WLU", unmappedSubject: subj } : { university: "WLU" };
  if (suffixed) return { university: "UW", unmappedSubject: subj };
  return { university: "UW" };
}

/** The same question for a whole course code, e.g. "BUS 352W". */
export function classifyCourseCode(code: string, campus?: string): CourseClassification {
  const parts = splitCourseCode(code);
  if (!parts) return { university: "UW" };
  return classifyCourse(parts.subject, parts.number, campus);
}

/**
 * One canonical spelling of a course code, for matching records that came from different
 * systems: lower case, no spaces. "BUS 352W", "bus352w" and "BUS352W" are all `bus352w`.
 * (The idea is UW Flow's: one key on write, formatted for display at the edges.)
 */
export function normalizeCourseCode(code: string): string {
  return code.replace(/\s+/g, "").toLowerCase();
}

/**
 * The identity a Laurier record shares with its Quest record: the Laurier code when we know
 * it, otherwise the normalised course code. This is what lets a LORIS paste for "BU352" find
 * the Quest course "BUS 352W" instead of creating a second one.
 */
export function courseIdentity(courseCode: string, laurierCode?: string): string {
  return normalizeCourseCode(laurierCode ?? courseCode);
}

/**
 * Whether a Laurier-hosted course is still missing the things Quest cannot carry: where it
 * actually meets, and who teaches it. This is what the Courses tab marks as incomplete and what
 * an optional LORIS import fills in. A Waterloo course is never incomplete in this sense.
 */
export function laurierEnrichmentNeeded(meeting: {
  university: string;
  location: { kind: string };
  instructors?: string[];
}): { room: boolean; professor: boolean; any: boolean } {
  if (meeting.university !== "WLU") return { room: false, professor: false, any: false };
  const room = meeting.location.kind !== "ROOM";
  const professor = (meeting.instructors?.length ?? 0) === 0;
  return { room, professor, any: room || professor };
}
