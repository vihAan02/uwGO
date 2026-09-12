import type { CourseMeeting } from "@/domain/types";
import { courseIdentity, normalizeCourseCode } from "@/domain/laurier";
import type { LaurierRecord } from "./LorisParser";

/**
 * Attaching a LORIS import to the courses Quest already created.
 *
 * The rule this module exists to enforce: LORIS never creates a course. A double-degree
 * student's Laurier courses come from Quest, so a LORIS record either finds the meeting it
 * describes and fills in what Quest could not carry, or it is reported as unmatched. It is
 * never turned into a second copy of a course the student already has.
 *
 * Matching uses the strongest signal the record actually carries:
 *  1. the Laurier course identity, always required (Quest's "BUS 352W" and LORIS's "BU352"
 *     normalise to the same key);
 *  2. then the meeting's days and times, when the record describes a meeting;
 *  3. then the section, when the record names one;
 *  4. otherwise the course as a whole, which is right for a course-level fact like the professor.
 *
 * A record that names a meeting we do not have is left unmatched rather than guessed onto a
 * different one. Meeting ids are deliberately preserved: a meeting's id is a hash that includes
 * its room, so recomputing it when a room arrives would orphan the student's gap answers.
 */

export interface LaurierMergeResult {
  meetings: CourseMeeting[];
  /** Meetings that gained a professor, a room or a title. */
  enriched: number;
  /** Records that matched no Quest course. Reported to the student, never invented into one. */
  unmatched: LaurierRecord[];
}

const sameSection = (a: string | undefined, b: string | undefined): boolean => {
  if (!a || !b) return false;
  const x = a.trim().toUpperCase();
  const y = b.trim().toUpperCase();
  if (x === y) return true;
  const nx = Number(x);
  const ny = Number(y);
  return Number.isFinite(nx) && Number.isFinite(ny) && nx === ny;
};

const sameDays = (m: CourseMeeting, r: LaurierRecord): boolean =>
  r.days.length > 0 && m.days.length === r.days.length && m.days.every((d) => r.days.includes(d));

const sameTimes = (m: CourseMeeting, r: LaurierRecord): boolean =>
  r.start !== undefined && r.end !== undefined && m.start === r.start && m.end === r.end;

/** Whether the record describes one particular meeting rather than the course as a whole. */
const describesMeeting = (r: LaurierRecord): boolean => r.days.length > 0 && r.start !== undefined && r.end !== undefined;

/** The meetings one record should be applied to, or an empty list when it matches nothing safely. */
export function matchesFor(record: LaurierRecord, meetings: CourseMeeting[]): CourseMeeting[] {
  const id = normalizeCourseCode(record.courseCode);
  const pool = meetings.filter((m) => m.university === "WLU" && courseIdentity(m.courseCode, m.laurierCode) === id);
  if (pool.length === 0) return [];

  const byMeeting = pool.filter((m) => sameDays(m, record) && sameTimes(m, record));
  if (byMeeting.length) return byMeeting;
  // The record names a meeting, and it is not one of this course's. Applying it to a different
  // meeting would put a professor on the wrong class, so nothing is applied.
  if (describesMeeting(record)) return [];

  const bySection = record.section ? pool.filter((m) => sameSection(m.section, record.section)) : [];
  if (bySection.length) return bySection;
  if (record.section && pool.some((m) => m.section)) return [];
  return pool;
}

/** One meeting with the record's information folded in. Returns the original when nothing changed. */
export function applyRecord(meeting: CourseMeeting, record: LaurierRecord): CourseMeeting {
  const next: CourseMeeting = { ...meeting };
  let changed = false;

  if (record.instructors.length && (meeting.instructors ?? []).join("|") !== record.instructors.join("|")) {
    next.instructors = [...record.instructors];
    changed = true;
  }
  // LORIS is the authority on where a Laurier class actually is; Quest often has nothing to say.
  if (record.location) {
    const room = record.location.roomNumber ?? "";
    const current = meeting.location;
    const differs = current.kind !== "ROOM" || current.buildingCode !== record.location.buildingCode || current.roomNumber !== room;
    if (differs && room) {
      next.location = { kind: "ROOM", buildingCode: record.location.buildingCode, roomNumber: room };
      changed = true;
    }
  }
  if (!meeting.courseTitle && record.title) {
    next.courseTitle = record.title;
    changed = true;
  }
  // Nothing sets includeInPlan here: a meeting that was only unroutable for want of a room
  // becomes routable the moment the room arrives, because normalizeWeek skips on location, not
  // on a flag.
  return changed ? next : meeting;
}

/**
 * Fold a LORIS import into the schedule. The returned list has the same meetings, in the same
 * order, with the same ids: only their contents can change.
 */
export function mergeLaurier(meetings: CourseMeeting[], records: readonly LaurierRecord[]): LaurierMergeResult {
  const byId = new Map(meetings.map((m) => [m.id, m]));
  const unmatched: LaurierRecord[] = [];

  for (const record of records) {
    const targets = matchesFor(record, [...byId.values()]);
    if (targets.length === 0) { unmatched.push(record); continue; }
    for (const t of targets) byId.set(t.id, applyRecord(byId.get(t.id)!, record));
  }

  const merged = meetings.map((m) => byId.get(m.id)!);
  const enriched = merged.reduce((n, m, i) => n + (m === meetings[i] ? 0 : 1), 0);
  return { meetings: merged, enriched, unmatched };
}
