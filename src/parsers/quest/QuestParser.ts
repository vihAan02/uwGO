/**
 * Parser for the text a student gets from Quest → Class Schedule → List View → Select All → Copy.
 *
 * Strategy: line-oriented "island" parsing. Course header lines ("CS 135 - Designing Functional Programs")
 * anchor blocks; inside a block, class-number anchors start section rows and every meeting pattern is
 * matched by shape (days/time, room, instructors, date range). A meeting pattern without a preceding
 * class-number anchor is a continuation row of the current section. Nothing depends on line offsets,
 * tab vs space separators, or a single date order.
 */
import type { Component, CourseMeeting, DayOfWeek, ParsedSchedule, ParseWarning, RawLocation, TermInfo } from "@/domain/types";
import { stableId } from "@/domain/ids";
import { classifyCourse, type CourseClassification } from "@/domain/laurier";
import { parseClock } from "@/time/toronto";
import { parseDayTokens } from "./days";
import { inferDateOrder, parseDateAs, termIdOf, type RawDateRange } from "./dates";
import type { ScheduleParser } from "../ScheduleParser";

const COURSE_HEADER = /^([A-Z]{2,10})\s+(\d{1,4}[A-Z]{0,2})\s+-\s+(.+)$/;
const TERM_LINE = /^(Spring|Fall|Winter)\s+(\d{4})\s*\|\s*([^|]+?)\s*\|\s*(.+?)$/;
const TERM_ANY = /\b(Spring|Fall|Winter)\s+(\d{4})\b/;
const CLASS_NBR_HEADER = /^Class\s*(?:Nbr|#|Number)\b/i;
const ANCHOR = /^\(?(\d{4,8})\)?$/;
const ANCHOR_COMBINED = /^\(?(\d{4,8})\)?\s+(\d{3}[A-Z]?)\s+([A-Z]{2,4})$/;
const SECTION = /^\d{3}[A-Z]?$/;
const COMPONENT = /^[A-Z]{2,4}$/;
const DAYS_TIME = /^([A-Za-z]{1,12})\s+(\d{1,2}:\d{2}\s*(?:[AaPp][Mm])?)\s*-\s*(\d{1,2}:\d{2}\s*(?:[AaPp][Mm])?)$/;
const DATE_RANGE = /^(\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4})\s*-\s*(\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4})$/;
const ROOM = /^([A-Z][A-Z0-9]*)\s+(\d+[A-Z]?)$/;
const TBA = /^TBA$/i;
const ONLINE = /^(?:ONLN\b|ONLINE\b)/i;
const HOMEPAGE_WIDGET = /^Class\s+Description\s+Days\/Times\s+Room/i;
// The same widget when a browser puts each header cell on its own line: rely on the page furniture around it.
const HOMEPAGE_MARKERS = [/^Collapse section My .*Class Schedule/i, /^Add Classes$/i, /^Enter Class Nbr$/i];
const NOT_REGISTERED = /you are not registered for classes in this term/i;
// Quest's Campus column names the institution offering the course. Not every paste carries it,
// so it is used when present and the course-number convention answers otherwise.
const LAURIER_CAMPUS_LINE = /wilfrid\s*laurier/i;
const COURSE_SELECTION = /\bmy course selection\b/i;

const KNOWN_COMPONENTS: readonly Component[] = ["LEC", "TUT", "LAB", "SEM", "PRJ", "PRA", "DIS", "TST", "STU", "FLD", "CLN"];

interface SectionContext { classNumber?: number; section?: string; component: Component; componentRaw: string }

interface RawMeeting {
  courseCode: string;
  courseTitle: string;
  cls: CourseClassification;
  ctx: SectionContext;
  days: DayOfWeek[];
  start: number;
  end: number;
  unscheduled: boolean;
  location: RawLocation;
  instructors: string[];
  rawStart?: string;
  rawEnd?: string;
}

function normalizeLines(text: string): string[] {
  return text.split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").trim());
}

function toComponent(raw: string): Component {
  const up = raw.toUpperCase();
  return (KNOWN_COMPONENTS as readonly string[]).includes(up) ? (up as Component) : "OTHER";
}

function parseTerm(lines: string[]): TermInfo | undefined {
  for (const line of lines) {
    const m = TERM_LINE.exec(line);
    if (m) {
      const season = m[1] as TermInfo["season"];
      const year = Number(m[2]);
      return { season, year, termId: termIdOf(season, year), level: m[3], institution: m[4] };
    }
  }
  for (const line of lines) {
    const m = TERM_ANY.exec(line);
    if (m) {
      const season = m[1] as TermInfo["season"];
      const year = Number(m[2]);
      return { season, year, termId: termIdOf(season, year) };
    }
  }
  return undefined;
}

function parseRoomLine(line: string): RawLocation | undefined {
  if (TBA.test(line)) return { kind: "TBA" };
  if (ONLINE.test(line)) return { kind: "ONLINE" };
  const m = ROOM.exec(line);
  if (m) return { kind: "ROOM", buildingCode: m[1].toUpperCase(), roomNumber: m[2].toUpperCase() };
  return undefined;
}

interface MeetingMatch {
  days: DayOfWeek[];
  start: number;
  end: number;
  unscheduled: boolean;
  location: RawLocation;
  instructors: string[];
  rawStart: string;
  rawEnd: string;
  next: number;
  dayWarning?: string;
}

/** Try to consume one meeting pattern starting at lines[i]. Returns undefined when the shape does not match. */
function tryParseMeetingAt(lines: string[], i: number, end: number): MeetingMatch | undefined {
  if (i >= end) return undefined;
  const daysLine = lines[i];
  let days: DayOfWeek[] = [];
  let start = 0;
  let endMin = 0;
  let unscheduled = true;
  let dayWarning: string | undefined;

  if (daysLine === "" || TBA.test(daysLine)) {
    unscheduled = true;
  } else {
    const m = DAYS_TIME.exec(daysLine);
    if (!m) return undefined;
    const tokens = parseDayTokens(m[1]);
    const s = parseClock(m[2]);
    const e = parseClock(m[3]);
    if (s === undefined || e === undefined) return undefined;
    if (!tokens) {
      dayWarning = `Unrecognised day token "${m[1]}"`;
    } else {
      days = tokens;
      start = s;
      endMin = e;
      unscheduled = false;
    }
  }

  const roomLine = lines[i + 1];
  if (roomLine === undefined || i + 1 >= end) return undefined;
  const location = parseRoomLine(roomLine);
  if (!location) return undefined;

  const instructors: string[] = [];
  let j = i + 2;
  while (j < end) {
    const line = lines[j];
    const dm = DATE_RANGE.exec(line);
    if (dm) {
      return { days, start, end: endMin, unscheduled, location, instructors, rawStart: dm[1], rawEnd: dm[2], next: j + 1, dayWarning };
    }
    if (line === "" || ANCHOR.test(line) || ANCHOR_COMBINED.test(line) || COURSE_HEADER.test(line) || instructors.length >= 25) return undefined;
    instructors.push(line.replace(/,\s*$/, "").trim());
    j++;
  }
  return undefined;
}

export function parseQuestSchedule(text: string): ParsedSchedule {
  const lines = normalizeLines(text);
  const warnings: ParseWarning[] = [];
  const hasClassNbrHeader = lines.some((l) => CLASS_NBR_HEADER.test(l));

  // Wrong-page detection first: these pastes must not be parsed as schedules.
  const widgetMarkers = HOMEPAGE_MARKERS.filter((re) => lines.some((l) => re.test(l))).length;
  if (!hasClassNbrHeader && (lines.some((l) => HOMEPAGE_WIDGET.test(l)) || widgetMarkers >= 2)) {
    warnings.push({ code: "WRONG_PAGE_HOMEPAGE_WIDGET", message: "This looks like the Student Center homepage table, not the Class Schedule List View. In Quest open Class Schedule, choose List View, press Ctrl/Cmd+A, copy, and paste again." });
    return { meetings: [], warnings, dateOrder: "UNKNOWN", recognised: false };
  }
  if (lines.some((l) => NOT_REGISTERED.test(l))) {
    warnings.push({ code: "NOT_REGISTERED", message: "Quest says you are not registered for classes in that term. Pick a term you are enrolled in." });
    return { meetings: [], warnings, dateOrder: "UNKNOWN", recognised: false, term: parseTerm(lines) };
  }
  if (!hasClassNbrHeader && lines.some((l) => COURSE_SELECTION.test(l))) {
    warnings.push({ code: "WRONG_PAGE_COURSE_SELECTION", message: "That looks like the Course Selection page. In Quest go to Class Schedule (List View) and paste that instead." });
    return { meetings: [], warnings, dateOrder: "UNKNOWN", recognised: false };
  }

  const term = parseTerm(lines);
  if (!term) warnings.push({ code: "NO_TERM_HEADER", message: "No term header (e.g. \"Fall 2026 | Undergraduate | University of Waterloo\") was found. Select the whole page with Ctrl/Cmd+A before copying so the term is included." });

  const headerIdx: number[] = [];
  lines.forEach((l, i) => { if (COURSE_HEADER.test(l)) headerIdx.push(i); });

  const raws: RawMeeting[] = [];
  for (let h = 0; h < headerIdx.length; h++) {
    const startIdx = headerIdx[h];
    const endIdx = h + 1 < headerIdx.length ? headerIdx[h + 1] : lines.length;
    const hm = COURSE_HEADER.exec(lines[startIdx])!;
    const courseCode = `${hm[1]} ${hm[2]}`;
    const courseTitle = hm[3].trim();
    // A double-degree student's Laurier courses are already in Quest, under a Waterloo subject
    // with a W on the number. Recognising them here is what makes a separate Laurier paste
    // unnecessary: Quest establishes that the course exists and when it meets.
    const campusLine = lines.slice(startIdx, endIdx).find((l) => LAURIER_CAMPUS_LINE.test(l));
    const cls = classifyCourse(hm[1], hm[2], campusLine);
    if (cls.unmappedSubject) {
      warnings.push({
        code: "UNKNOWN_CROSS_REGISTERED_SUBJECT",
        message: `${courseCode}: the "W" suggests a Laurier-hosted course, but ${cls.unmappedSubject} has no known Laurier subject, so it is kept as a Waterloo course.`,
        courseCode,
        line: startIdx + 1,
      });
    }

    let i = startIdx + 1;
    const tableHeader = lines.slice(startIdx + 1, endIdx).findIndex((l) => CLASS_NBR_HEADER.test(l));
    if (tableHeader >= 0) i = startIdx + 1 + tableHeader + 1;

    let ctx: SectionContext | undefined;
    let produced = 0;
    while (i < endIdx) {
      const line = lines[i];
      const combined = ANCHOR_COMBINED.exec(line);
      if (combined) {
        ctx = { classNumber: Number(combined[1]), section: combined[2], component: toComponent(combined[3]), componentRaw: combined[3] };
        i += 1;
      } else {
        const anchor = ANCHOR.exec(line);
        if (anchor) {
          const sec = lines[i + 1];
          const comp = lines[i + 2];
          if (sec !== undefined && comp !== undefined && SECTION.test(sec) && COMPONENT.test(comp) && i + 2 < endIdx) {
            ctx = { classNumber: Number(anchor[1]), section: sec, component: toComponent(comp), componentRaw: comp };
            i += 3;
          } else {
            ctx = { classNumber: Number(anchor[1]), component: "OTHER", componentRaw: "" };
            i += 1;
          }
        }
      }

      const meeting = tryParseMeetingAt(lines, i, endIdx);
      if (meeting) {
        if (meeting.dayWarning) warnings.push({ code: "UNKNOWN_DAY_TOKEN", message: `${courseCode}: ${meeting.dayWarning}; meeting kept without a time.`, courseCode, line: i + 1 });
        raws.push({
          courseCode, courseTitle, cls,
          ctx: ctx ?? { component: "OTHER", componentRaw: "" },
          days: meeting.days, start: meeting.start, end: meeting.end, unscheduled: meeting.unscheduled,
          location: meeting.location, instructors: meeting.instructors, rawStart: meeting.rawStart, rawEnd: meeting.rawEnd,
        });
        produced += 1;
        i = meeting.next;
        continue;
      }

      if (combined || ANCHOR.test(line)) {
        warnings.push({ code: "MEETING_UNPARSED", message: `${courseCode}: could not read the meeting row after class number ${ctx?.classNumber ?? "?"}.`, courseCode, line: i + 1 });
      }
      i += 1;
    }
    if (produced === 0) warnings.push({ code: "COURSE_BLOCK_UNPARSED", message: `${courseCode}: no meeting rows could be read.`, courseCode, line: startIdx + 1 });
  }

  // Date order across the whole paste.
  const ranges: RawDateRange[] = raws.filter((r) => r.rawStart && r.rawEnd).map((r) => ({ start: r.rawStart!, end: r.rawEnd! }));
  const inference = inferDateOrder(ranges, term);
  if (ranges.length > 0 && inference.order === "UNKNOWN") {
    warnings.push({
      code: inference.ambiguous ? "DATE_ORDER_AMBIGUOUS" : "DATE_ORDER_UNKNOWN",
      message: inference.ambiguous
        ? "Start/End dates could be read as day/month or month/day. Meeting dates were left blank; days and times are unaffected."
        : "Start/End dates could not be read. Meeting dates were left blank; days and times are unaffected.",
    });
  }

  const meetings: CourseMeeting[] = [];
  const seen = new Set<string>();
  for (const r of raws) {
    const startDate = r.rawStart && inference.order !== "UNKNOWN" ? parseDateAs(r.rawStart, inference.order) : undefined;
    const endDate = r.rawEnd && inference.order !== "UNKNOWN" ? parseDateAs(r.rawEnd, inference.order) : undefined;
    const locKey = r.location.kind === "ROOM" ? `${r.location.buildingCode} ${r.location.roomNumber}` : r.location.kind;
    const id = stableId(r.cls.university, r.courseCode, r.ctx.classNumber, r.ctx.section, r.ctx.component, r.days.join(""), r.start, r.end, r.unscheduled ? "U" : "S", locKey, startDate, endDate);
    if (seen.has(id)) {
      warnings.push({ code: "DUPLICATE_DROPPED", message: `${r.courseCode} ${r.ctx.componentRaw || r.ctx.component} ${r.ctx.section ?? ""}: duplicate meeting row ignored.`.replace(/\s+/g, " ").trim(), courseCode: r.courseCode });
      continue;
    }
    seen.add(id);
    meetings.push({
      id,
      university: r.cls.university,
      courseCode: r.courseCode,
      courseTitle: r.courseTitle,
      laurierCode: r.cls.laurierCode,
      classNumber: r.ctx.classNumber,
      section: r.ctx.section,
      component: r.ctx.component,
      days: r.days,
      start: r.start,
      end: r.end,
      startDate,
      endDate,
      location: r.location,
      instructors: r.instructors.length ? r.instructors : undefined,
      unscheduled: r.unscheduled || undefined,
      source: "QUEST",
      includeInPlan: r.ctx.component !== "TST",
    });
  }

  const recognised = hasClassNbrHeader || (Boolean(term) && headerIdx.length > 0);
  if (recognised && meetings.length === 0) warnings.push({ code: "NO_COURSES", message: "The page was recognised but no classes could be read." });

  return { term, meetings, warnings, dateOrder: inference.order, recognised };
}

export const questParser: ScheduleParser = {
  id: "QUEST",
  label: "Waterloo Quest",
  parse: parseQuestSchedule,
};
