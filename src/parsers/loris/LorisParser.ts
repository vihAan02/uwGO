import type { DayOfWeek, ParseWarning, TermInfo } from "@/domain/types";
import { DAYS_IN_ORDER } from "@/domain/types";
import { parseClock } from "@/time/toronto";
import { findBuilding } from "@/data/buildings";
import { normalizeCourseCode } from "@/domain/laurier";
import { termIdOf } from "../quest/dates";

/**
 * Laurier's LORIS (Ellucian Banner) "Student Detail Schedule".
 *
 * This import never creates a course. A double-degree student's Laurier courses are already in
 * Quest, so by the time this runs the course exists, with its days and times. What Quest may not
 * carry is the professor and the Laurier room, and that is all this parser is for: it produces
 * enrichment records that `mergeLaurier` attaches to the meetings already imported.
 *
 * There is no verified capture of a LORIS paste in this repository, so the parser is deliberately
 * shape-tolerant rather than positional: it looks for the things it can recognise on their own
 * merits (a course code, a time range, a day token, a room that resolves in Laurier's building
 * registry) and reports what it could not read instead of guessing.
 */

export interface LaurierRecord {
  /** Laurier's own code, normalised for display: "BU111". */
  courseCode: string;
  section?: string;
  title?: string;
  /** Banner's course reference number, when the paste shows one. */
  crn?: number;
  instructors: string[];
  days: DayOfWeek[];
  start?: number;
  end?: number;
  location?: { buildingCode: string; roomNumber?: string };
}

export interface LorisImport {
  term?: TermInfo;
  records: LaurierRecord[];
  warnings: ParseWarning[];
  /** True when the text looked like a LORIS schedule at all. */
  recognised: boolean;
}

/** "Introduction to Business Organization - BU111 - A", with or without a CRN part. */
const COURSE_CODE = /^([A-Z]{2,6})\s?(\d{3}[A-Z]?)$/;
const TIME_RANGE = /(\d{1,2}:\d{2}\s*[APap][Mm])\s*-\s*(\d{1,2}:\d{2}\s*[APap][Mm])/;
const TERM_LINE = /(?:Associated\s+Term\s*:\s*)?\b(Fall|Winter|Spring)\s+(\d{4})\b/i;
const CRN_LINE = /\bCRN\s*:?\s*(\d{3,6})\b/i;
const INSTRUCTOR_LINE = /^Instructors?\s*:\s*(.+)$/i;
const DATE_RANGE = /\b[A-Z][a-z]{2}\s+\d{1,2},\s*\d{4}\s*-\s*[A-Z][a-z]{2}\s+\d{1,2},\s*\d{4}\b/;
/** Banner marks the primary instructor with a trailing "(P)". */
const PRIMARY_MARK = /\s*\(P\)\s*$/;
const LORIS_MARKERS = [/Scheduled\s+Meeting\s+Times/i, /Associated\s+Term/i, /\bCRN\b/i, /Student\s+Detail\s+Schedule/i];

/**
 * Banner day letters. R is Thursday and U is Sunday, which is where this differs from Quest;
 * Quest's own "Th" spelling is accepted too, because some exports use it.
 */
export function parseLorisDays(token: string): DayOfWeek[] | undefined {
  const s = token.trim();
  if (!s || !/^[MTWRFSUh]+$/.test(s)) return undefined;
  const out: DayOfWeek[] = [];
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
    else if (one === "R") out.push("Th");
    else if (one === "F") out.push("F");
    else if (one === "S") out.push("S");
    else if (one === "U") out.push("Su");
    else return undefined;
    i += 1;
  }
  const set = new Set(out);
  return DAYS_IN_ORDER.filter((d) => set.has(d));
}

/**
 * A room, found by asking Laurier's building registry rather than by counting columns.
 * "Lazaridis Hall LH1001" and "LH 1001" both give LH 1001; a token that is not a Laurier
 * building is not a room, however much it looks like one.
 */
export function findLaurierRoom(line: string): { buildingCode: string; roomNumber?: string } | undefined {
  const cleaned = line.replace(TIME_RANGE, " ").replace(DATE_RANGE, " ");
  // Arts wings are written floor-wing-room: 1C16, 2E5.
  const wing = /\b(\d)([ACE])(\d{1,3}[A-Z]?)\b/.exec(cleaned);
  if (wing && findBuilding("WLU", wing[2])) return { buildingCode: wing[2], roomNumber: `${wing[1]}${wing[2]}${wing[3]}` };
  const candidates = [...cleaned.matchAll(/\b([A-Z]{1,5})\s?(\d{1,4}(?:-\d{1,4})?[A-Z]?)\b/g)];
  for (const c of candidates) {
    const b = findBuilding("WLU", c[1]);
    if (b) return { buildingCode: b.code, roomNumber: c[2] };
  }
  for (const c of candidates) {
    if (findBuilding("UW", c[1])) return { buildingCode: c[1].toUpperCase(), roomNumber: c[2] };
  }
  return undefined;
}

/** One or more names off an instructor cell, without Banner's primary marker or trailing commas. */
function splitInstructors(raw: string): string[] {
  return raw
    .split(/\s*(?:,\s*(?=[A-Z][a-z])|;|\band\b)\s*/)
    .map((n) => n.replace(PRIMARY_MARK, "").replace(/[,;]\s*$/, "").trim())
    .filter((n) => n.length > 1 && /[A-Za-z]/.test(n) && !/^tba$/i.test(n));
}

/** The course code and section out of a Banner block header, whatever else the header carries. */
function parseHeader(line: string): { courseCode: string; section?: string; title?: string } | undefined {
  const parts = line.split(/\s+-\s+/).map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return undefined;
  for (let i = 0; i < parts.length; i++) {
    const m = COURSE_CODE.exec(parts[i].toUpperCase());
    if (!m) continue;
    return {
      courseCode: `${m[1]}${m[2]}`,
      section: parts[i + 1] && parts[i + 1].length <= 6 ? parts[i + 1].toUpperCase() : undefined,
      title: i > 0 ? parts.slice(0, i).join(" - ") : undefined,
    };
  }
  return undefined;
}

export function parseLorisSchedule(text: string): LorisImport {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/[\t ]+/g, " ").trim());
  const warnings: ParseWarning[] = [];
  const recognised = LORIS_MARKERS.some((re) => lines.some((l) => re.test(l))) && lines.some((l) => parseHeader(l));

  let term: TermInfo | undefined;
  for (const line of lines) {
    const m = TERM_LINE.exec(line);
    if (m) {
      const season = ((m[1][0].toUpperCase() + m[1].slice(1).toLowerCase()) as TermInfo["season"]);
      term = { season, year: Number(m[2]), termId: termIdOf(season, Number(m[2])) };
      break;
    }
  }

  // Block boundaries are the course headers; everything until the next one belongs to that course.
  const heads: number[] = [];
  lines.forEach((l, i) => { if (parseHeader(l)) heads.push(i); });

  const records: LaurierRecord[] = [];
  for (let h = 0; h < heads.length; h++) {
    const from = heads[h];
    const to = h + 1 < heads.length ? heads[h + 1] : lines.length;
    const head = parseHeader(lines[from])!;
    const block = lines.slice(from + 1, to);

    const crnMatch = block.map((l) => CRN_LINE.exec(l)).find(Boolean);
    const blockInstructors = block.flatMap((l) => {
      const m = INSTRUCTOR_LINE.exec(l);
      return m ? splitInstructors(m[1]) : [];
    });

    const meetingLines = block.filter((l) => TIME_RANGE.test(l));
    if (meetingLines.length === 0) {
      // A course with no readable meeting row still carries a professor worth keeping.
      records.push({
        courseCode: head.courseCode, section: head.section, title: head.title,
        crn: crnMatch ? Number(crnMatch[1]) : undefined,
        instructors: blockInstructors, days: [],
      });
      continue;
    }

    for (const line of meetingLines) {
      const tm = TIME_RANGE.exec(line)!;
      const start = parseClock(tm[1]);
      const end = parseClock(tm[2]);
      const after = line.slice(tm.index + tm[0].length).trim();
      let days: DayOfWeek[] = [];
      for (const token of after.split(" ").slice(0, 2)) {
        const parsed = parseLorisDays(token);
        if (parsed && parsed.length) { days = parsed; break; }
      }
      const rowInstructors = splitInstructors(after.replace(DATE_RANGE, " ").replace(/\b(Class|Lecture|Lab|Tutorial|Seminar)\b/gi, " "));
      const location = findLaurierRoom(line);
      records.push({
        courseCode: head.courseCode,
        section: head.section,
        title: head.title,
        crn: crnMatch ? Number(crnMatch[1]) : undefined,
        // Names on the row are the authority for that row; the block's Instructor line backs it up.
        instructors: blockInstructors.length ? blockInstructors : rowInstructors,
        days,
        start,
        end,
        location,
      });
    }
  }

  if (recognised && records.length === 0) {
    warnings.push({ code: "NO_COURSES", message: "That looked like a LORIS schedule, but no courses could be read from it." });
  }
  if (!recognised) {
    warnings.push({
      code: "PARSER_NOT_IMPLEMENTED",
      message: "That doesn't look like a LORIS Student Detail Schedule. In LORIS open Student Detail Schedule, select the whole page, copy, and paste it here.",
    });
  }
  return { term, records, warnings, recognised };
}

/** The identity a record will be matched on: Laurier's own code, normalised. */
export function recordIdentity(r: LaurierRecord): string {
  return normalizeCourseCode(r.courseCode);
}
