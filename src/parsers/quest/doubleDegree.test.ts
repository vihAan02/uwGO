import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseQuestSchedule } from "./QuestParser";
import { parseLorisSchedule } from "@/parsers/loris/LorisParser";
import { mergeLaurier } from "@/parsers/loris/merge";
import { normalizeWeek } from "@/engine/normalize";

/**
 * The double-degree import, end to end: a Quest paste is enough to create every course, Laurier
 * ones included, and a LORIS paste afterwards only fills in what Quest could not carry.
 */
const PASTE = readFileSync("test/fixtures/quest/synthetic-dd-mixed-laurier.txt", "utf8");
const parsed = parseQuestSchedule(PASTE);
const by = (code: string) => parsed.meetings.find((m) => m.courseCode === code)!;
const MONDAY = "2026-09-14";

describe("a Quest paste from a double degree student", () => {
  it("creates every course, Waterloo and Laurier alike, with no complaints", () => {
    expect(parsed.recognised).toBe(true);
    expect(parsed.term).toMatchObject({ season: "Fall", year: 2026, termId: 1269 });
    expect(parsed.warnings).toEqual([]);
    expect(parsed.meetings.map((m) => m.courseCode)).toEqual([
      "CS 245", "ECON 101", "ARBUS 102", "BUS 111W", "BUS 352W", "ECON 250W", "GESC 231W",
    ]);
  });

  it("recognises the W-suffixed courses as Laurier and gives each its Laurier code", () => {
    expect(by("BUS 111W")).toMatchObject({ university: "WLU", laurierCode: "BU111" });
    expect(by("BUS 352W")).toMatchObject({ university: "WLU", laurierCode: "BU352" });
    // Upper-year, not just first year, and economics as well as business.
    expect(by("ECON 250W")).toMatchObject({ university: "WLU", laurierCode: "EC250" });
    // GESC maps to itself; the two-letter rule would have invented "GE231".
    expect(by("GESC 231W")).toMatchObject({ university: "WLU", laurierCode: "GESC231" });
  });

  it("leaves Waterloo courses alone, including the ones that look Laurier at a glance", () => {
    for (const code of ["CS 245", "ECON 101", "ARBUS 102"]) {
      expect(by(code).university, code).toBe("UW");
      expect(by(code).laurierCode, code).toBeUndefined();
    }
  });

  it("gives a Laurier course that Quest has no room or professor for, rather than nothing", () => {
    const bu111 = by("BUS 111W");
    expect(bu111.days).toEqual(["M", "W"]);
    expect(bu111.start).toBe(690);
    expect(bu111.end).toBe(770);
    expect(bu111.location).toEqual({ kind: "TBA" });
    expect(bu111.instructors).toBeUndefined();
    expect(bu111.includeInPlan).toBe(true);
  });

  it("routes a Laurier course whose room Quest did give to the Laurier campus", () => {
    // LH exists at both universities; the course is Laurier's, so it must be Lazaridis Hall.
    const week = normalizeWeek(parsed.meetings, MONDAY);
    const cls = week.byDay.T.find((c) => c.meeting.courseCode === "BUS 352W")!;
    expect(cls.location.university).toBe("WLU");
    expect(cls.location.name).toBe("Lazaridis Hall");
  });
});

describe("enriching those courses from LORIS", () => {
  const LORIS = `
Student Detail Schedule
Associated Term: Fall 2026

Introduction to Business Organization - BU111 - 999
CRN: 4330
Status: Registered on Jul 10, 2026
Instructor: Jane Smith (P)
Scheduled Meeting Times
Type Time Days Where Date Range Schedule Type Instructors
Class 11:30 am - 12:50 pm MW Lazaridis Hall LH1001 Sep 08, 2026 - Dec 04, 2026 Lecture Jane Smith (P)
`;

  it("fills in the missing professor and room, and creates nothing", () => {
    const loris = parseLorisSchedule(LORIS);
    expect(loris.recognised).toBe(true);
    const { meetings, enriched, unmatched } = mergeLaurier(parsed.meetings, loris.records);

    expect(meetings).toHaveLength(parsed.meetings.length); // no duplicate course
    expect(enriched).toBe(1);
    expect(unmatched).toEqual([]);
    const bu111 = meetings.find((m) => m.courseCode === "BUS 111W")!;
    expect(bu111.instructors).toEqual(["Jane Smith"]);
    expect(bu111.location).toEqual({ kind: "ROOM", buildingCode: "LH", roomNumber: "1001" });
    expect(bu111.id).toBe(by("BUS 111W").id); // same course, not a replacement
  });

  it("leaves every other course exactly as Quest gave it", () => {
    const { meetings } = mergeLaurier(parsed.meetings, parseLorisSchedule(LORIS).records);
    for (const code of ["CS 245", "ECON 101", "ARBUS 102", "BUS 352W", "ECON 250W", "GESC 231W"]) {
      expect(meetings.find((m) => m.courseCode === code), code).toBe(by(code));
    }
  });

  it("routes the Laurier class once LORIS has said where it is", () => {
    const { meetings } = mergeLaurier(parsed.meetings, parseLorisSchedule(LORIS).records);
    const week = normalizeWeek(meetings, MONDAY);
    const cls = week.byDay.M.find((c) => c.meeting.courseCode === "BUS 111W")!;
    expect(cls).toBeDefined();
    expect(cls.location.university).toBe("WLU");
    expect(cls.location.name).toBe("Lazaridis Hall");
    expect(week.skipped.some((s) => s.meeting.courseCode === "BUS 111W")).toBe(false);
  });

  it("importing the same LORIS paste again changes nothing", () => {
    const records = parseLorisSchedule(LORIS).records;
    const once = mergeLaurier(parsed.meetings, records);
    const twice = mergeLaurier(once.meetings, records);
    expect(twice.enriched).toBe(0);
    expect(twice.meetings).toHaveLength(parsed.meetings.length);
  });
});
