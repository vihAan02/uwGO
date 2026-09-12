import { normalizeCourseCode } from "@/domain/laurier";

/**
 * Reference metadata for Waterloo courses: a course code and the title it is properly known by.
 *
 * The student's own schedule is always the source of truth. Quest gives a title with every
 * course it lists, so this is only ever consulted when a title is missing, and it can never
 * contradict what the student actually imported.
 *
 * Shape and normalisation follow UW Flow (github.com/UWFlow/uwflow, MIT): one canonical key per
 * course, lower case and unspaced, formatted for display at the edges. No UW Flow code is used
 * and none of their data is bulk-copied. What is here is a small set of factual course titles
 * for the courses a Waterloo student is most likely to be taking, kept deliberately short: a
 * timetable does not need a copy of the calendar, and an offline UW Flow must never be able to
 * stop this app rendering. Nothing here is fetched at runtime.
 *
 * Laurier courses are deliberately absent. UW Flow has no authority over them; their titles come
 * from the student's Quest paste or their LORIS import.
 */

const TITLES: Readonly<Record<string, string>> = {
  cs115: "Introduction to Computer Science 1",
  cs135: "Designing Functional Programs",
  cs136: "Elementary Algorithm Design and Data Abstraction",
  cs145: "Designing Functional Programs (Advanced Level)",
  cs146: "Elementary Algorithm Design and Data Abstraction (Advanced Level)",
  cs240: "Data Structures and Data Management",
  cs241: "Foundations of Sequential Programs",
  cs245: "Logic and Computation",
  cs246: "Object-Oriented Software Development",
  cs251: "Computer Organization and Design",
  cs341: "Algorithms",
  cs343: "Concurrent and Parallel Programming",
  cs348: "Introduction to Database Management",
  cs350: "Operating Systems",
  math135: "Algebra for Honours Mathematics",
  math136: "Linear Algebra 1 for Honours Mathematics",
  math137: "Calculus 1 for Honours Mathematics",
  math138: "Calculus 2 for Honours Mathematics",
  math235: "Linear Algebra 2 for Honours Mathematics",
  math237: "Calculus 3 for Honours Mathematics",
  math239: "Introduction to Combinatorics",
  stat230: "Probability",
  stat231: "Statistics",
  stat240: "Probability (Advanced Level)",
  stat241: "Statistics (Advanced Level)",
  econ101: "Introduction to Microeconomics",
  econ102: "Introduction to Macroeconomics",
  phys121: "Mechanics",
  phys122: "Waves, Electricity and Magnetism",
  chem120: "Physical and Chemical Properties of Matter",
  chem123: "Chemical Reactions, Equilibria and Kinetics",
  bio130: "Introductory Cell Biology",
  psych101: "Introductory Psychology",
  engl109: "Introduction to Academic Writing",
  spcom223: "Public Speaking",
  se212: "Logic and Computation",
  ece105: "Classical Mechanics",
  ece108: "Discrete Mathematics and Logic 1",
  syde101: "Introduction to Design",
  arbus101: "Introduction to Business in North America",
  arbus102: "Functional Areas of Business",
};

/** The title we hold for a Waterloo course code, if any. Never a guess. */
export function referenceTitle(courseCode: string): string | undefined {
  return TITLES[normalizeCourseCode(courseCode)];
}

/**
 * The best title available for a course: what the student's own import said, falling back to our
 * reference set, and otherwise nothing at all. Never invents a title from the code.
 */
export function courseTitleFor(courseCode: string, importedTitle?: string): string | undefined {
  const own = importedTitle?.trim();
  if (own) return own;
  return referenceTitle(courseCode);
}

/** "CS 135" from any spelling of it, for display. Subject letters, then the rest. */
export function formatCourseCode(courseCode: string): string {
  const key = courseCode.trim().toUpperCase().replace(/\s+/g, "");
  const m = /^([A-Z]+)(.*)$/.exec(key);
  return m && m[2] ? `${m[1]} ${m[2]}` : courseCode.trim().toUpperCase();
}

/** How many courses the reference set covers. Used by the tests to keep it honestly small. */
export const REFERENCE_COURSE_COUNT = Object.keys(TITLES).length;
