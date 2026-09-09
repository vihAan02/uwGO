import type { Component, CourseMeeting, DayOfWeek, University } from "@/domain/types";
import { DAYS_IN_ORDER } from "@/domain/types";
import { stableId } from "@/domain/ids";
import { parseClock } from "@/time/toronto";
import { findBuilding } from "@/data/buildings";

export interface ManualMeetingInput {
  university: University;
  courseCode: string;
  component?: string;
  section?: string;
  days: DayOfWeek[];
  /** "9:30AM", "09:30", "13:45" */
  start: string;
  end: string;
  buildingCode: string;
  roomNumber?: string;
  startDate?: string;
  endDate?: string;
}

export type ManualResult = { ok: true; meeting: CourseMeeting } | { ok: false; errors: string[] };

const COMPONENTS: readonly Component[] = ["LEC", "TUT", "LAB", "SEM", "PRJ", "PRA", "DIS", "TST", "STU", "FLD", "CLN", "OTHER"];

/** Validate a hand-entered class (used for WLU, and for fixing anything Quest could not provide). */
export function createManualMeeting(input: ManualMeetingInput): ManualResult {
  const errors: string[] = [];
  const courseCode = input.courseCode.trim().toUpperCase().replace(/\s+/g, " ");
  if (!/^[A-Z]{2,10} \d{1,4}[A-Z]{0,2}$/.test(courseCode)) errors.push("Course code should look like \"BU 111\" or \"CS 135\".");
  const days = DAYS_IN_ORDER.filter((d) => input.days.includes(d));
  if (days.length === 0) errors.push("Pick at least one day.");
  const start = parseClock(input.start);
  const end = parseClock(input.end);
  if (start === undefined) errors.push("Start time is not valid (e.g. 9:30AM or 13:00).");
  if (end === undefined) errors.push("End time is not valid.");
  if (start !== undefined && end !== undefined && end <= start) errors.push("End time must be after start time.");
  const buildingCode = input.buildingCode.trim().toUpperCase();
  const building = findBuilding(input.university, buildingCode);
  if (!buildingCode) errors.push("Building code is required.");
  else if (!building) errors.push(`Unknown ${input.university} building code "${buildingCode}".`);
  else if (building.latitude === undefined) errors.push(`${building.name} has no coordinates on file yet, so it cannot be routed.`);
  const componentRaw = (input.component ?? "LEC").trim().toUpperCase();
  const component: Component = (COMPONENTS as readonly string[]).includes(componentRaw) ? (componentRaw as Component) : "OTHER";
  for (const [label, v] of [["Start date", input.startDate], ["End date", input.endDate]] as const) {
    if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) errors.push(`${label} must be yyyy-mm-dd.`);
  }
  if (errors.length) return { ok: false, errors };

  const roomNumber = input.roomNumber?.trim().toUpperCase() || "";
  const meeting: CourseMeeting = {
    id: stableId("MANUAL", input.university, courseCode, component, input.section, days.join(""), start, end, building!.code, roomNumber, input.startDate, input.endDate),
    university: input.university,
    courseCode,
    section: input.section?.trim() || undefined,
    component,
    days,
    start: start!,
    end: end!,
    startDate: input.startDate || undefined,
    endDate: input.endDate || undefined,
    location: { kind: "ROOM", buildingCode: building!.code, roomNumber },
    source: "MANUAL",
    includeInPlan: component !== "TST",
  };
  return { ok: true, meeting };
}
