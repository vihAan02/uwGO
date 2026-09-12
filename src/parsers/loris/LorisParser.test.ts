import { describe, expect, it } from "vitest";
import { findLaurierRoom, parseLorisDays, parseLorisSchedule } from "./LorisParser";

/**
 * No verified LORIS capture exists, so these samples are written to the shape Ellucian Banner's
 * "Student Detail Schedule" produces. The parser is deliberately tolerant, and these cases pin
 * the parts that are recognised on their own merits rather than by column position.
 */
const SAMPLE = `
Student Detail Schedule
Fall 2026

Introduction to Business Organization - BU111 - A
Associated Term: Fall 2026
CRN: 1234
Status: Registered on Jul 10, 2026
Instructor: Jane Smith (P)
Campus: Waterloo
Scheduled Meeting Times
Type Time Days Where Date Range Schedule Type Instructors
Class 10:00 am - 11:20 am MW Lazaridis Hall LH1001 Sep 08, 2026 - Dec 05, 2026 Lecture Jane Smith (P)

Business Finance - BU352 - B
Associated Term: Fall 2026
CRN: 5678
Instructor: Ravi Patel (P)
Scheduled Meeting Times
Class 2:30 pm - 3:50 pm TR Schlegel Building SB201 Sep 08, 2026 - Dec 05, 2026 Lecture Ravi Patel (P)
`;

describe("reading a LORIS schedule", () => {
  const parsed = parseLorisSchedule(SAMPLE);

  it("recognises the page and its term", () => {
    expect(parsed.recognised).toBe(true);
    expect(parsed.term).toEqual({ season: "Fall", year: 2026, termId: 1269 });
    expect(parsed.records).toHaveLength(2);
  });

  it("reads the course, section, professor, room and times", () => {
    const bu111 = parsed.records[0];
    expect(bu111.courseCode).toBe("BU111");
    expect(bu111.section).toBe("A");
    expect(bu111.crn).toBe(1234);
    expect(bu111.instructors).toEqual(["Jane Smith"]);
    expect(bu111.days).toEqual(["M", "W"]);
    expect(bu111.start).toBe(600);
    expect(bu111.end).toBe(680);
    expect(bu111.location).toEqual({ buildingCode: "LH", roomNumber: "1001" });
    expect(bu111.title).toBe("Introduction to Business Organization");
  });

  it("reads Banner's R as Thursday, and an afternoon time as the afternoon", () => {
    const bu352 = parsed.records[1];
    expect(bu352.days).toEqual(["T", "Th"]);
    expect(bu352.start).toBe(870);
    expect(bu352.end).toBe(950);
    expect(bu352.location).toEqual({ buildingCode: "SB", roomNumber: "201" });
    expect(bu352.instructors).toEqual(["Ravi Patel"]);
  });

  it("keeps a course whose meeting row cannot be read, for the professor alone", () => {
    const r = parseLorisSchedule(`
Student Detail Schedule
Associated Term: Winter 2027
Organizational Behaviour - BU288 - C
CRN: 4242
Instructor: Dana Lee (P)
Scheduled Meeting Times
TBA
`);
    expect(r.recognised).toBe(true);
    expect(r.records).toHaveLength(1);
    expect(r.records[0]).toMatchObject({ courseCode: "BU288", section: "C", instructors: ["Dana Lee"], days: [] });
    expect(r.records[0].start).toBeUndefined();
  });

  it("says so plainly when the paste is not a LORIS schedule", () => {
    const r = parseLorisSchedule("just some text the student happened to copy");
    expect(r.recognised).toBe(false);
    expect(r.records).toEqual([]);
    expect(r.warnings[0].code).toBe("PARSER_NOT_IMPLEMENTED");
  });
});

describe("LORIS day tokens", () => {
  it("uses Banner's letters, where R is Thursday and U is Sunday", () => {
    expect(parseLorisDays("MWF")).toEqual(["M", "W", "F"]);
    expect(parseLorisDays("TR")).toEqual(["T", "Th"]);
    expect(parseLorisDays("R")).toEqual(["Th"]);
    expect(parseLorisDays("U")).toEqual(["Su"]);
    expect(parseLorisDays("Th")).toEqual(["Th"]); // some exports use Quest's spelling
    expect(parseLorisDays("Lecture")).toBeUndefined();
    expect(parseLorisDays("")).toBeUndefined();
  });
});

describe("finding the room", () => {
  it("asks Laurier's building registry rather than counting columns", () => {
    expect(findLaurierRoom("Class 10:00 am - 11:20 am MW Lazaridis Hall LH1001 Sep 08, 2026 - Dec 05, 2026")).toEqual({ buildingCode: "LH", roomNumber: "1001" });
    expect(findLaurierRoom("Bricker Academic BA201")).toEqual({ buildingCode: "BA", roomNumber: "201" });
    expect(findLaurierRoom("Dr. Alvin Woods Building DAWB 2-108")).toEqual({ buildingCode: "DAWB", roomNumber: "2-108" });
  });

  it("gives nothing when there is no room to find", () => {
    expect(findLaurierRoom("Class TBA Sep 08, 2026 - Dec 05, 2026")).toBeUndefined();
  });
});
