import { describe, expect, it } from "vitest";
import type { CourseMeeting } from "@/domain/types";
import type { LaurierRecord } from "./LorisParser";
import { matchesFor, mergeLaurier } from "./merge";

const meeting = (over: Partial<CourseMeeting> = {}): CourseMeeting => ({
  id: "bus352-lec", university: "WLU", courseCode: "BUS 352W", laurierCode: "BU352",
  section: "999", component: "LEC", days: ["T", "Th"], start: 870, end: 950,
  location: { kind: "TBA" }, source: "QUEST", includeInPlan: true,
  ...over,
});

const record = (over: Partial<LaurierRecord> = {}): LaurierRecord => ({
  courseCode: "BU352", section: "999", instructors: ["Ravi Patel"],
  days: ["T", "Th"], start: 870, end: 950,
  location: { buildingCode: "LH", roomNumber: "1001" },
  ...over,
});

describe("folding a LORIS import into the Quest schedule", () => {
  it("fills in the professor and the Laurier room without creating a second course", () => {
    const before = [meeting()];
    const { meetings, enriched, unmatched } = mergeLaurier(before, [record()]);
    expect(meetings).toHaveLength(1); // no duplicate
    expect(enriched).toBe(1);
    expect(unmatched).toEqual([]);
    expect(meetings[0].instructors).toEqual(["Ravi Patel"]);
    expect(meetings[0].location).toEqual({ kind: "ROOM", buildingCode: "LH", roomNumber: "1001" });
  });

  it("keeps the meeting's id, so the student's other answers still point at it", () => {
    const { meetings } = mergeLaurier([meeting()], [record()]);
    expect(meetings[0].id).toBe("bus352-lec");
  });

  it("matches Quest's BUS 352W to LORIS's BU352 across the two spellings", () => {
    expect(matchesFor(record(), [meeting()])).toHaveLength(1);
    // And a Laurier class added by hand as "BU 352" matches the same record.
    const byHand = meeting({ id: "manual", courseCode: "BU 352", laurierCode: undefined, source: "MANUAL" });
    expect(matchesFor(record(), [byHand])).toHaveLength(1);
  });

  it("never touches a Waterloo course", () => {
    const uw = meeting({ id: "econ101", university: "UW", courseCode: "ECON 101", laurierCode: undefined });
    const { meetings, unmatched } = mergeLaurier([uw], [record({ courseCode: "ECON101" })]);
    expect(meetings[0]).toBe(uw);
    expect(unmatched).toHaveLength(1);
  });

  it("leaves a record describing a meeting the schedule does not have unmatched", () => {
    // Same course, a different time: applying this would put a professor on the wrong class.
    const { meetings, enriched, unmatched } = mergeLaurier([meeting()], [record({ start: 600, end: 680, days: ["M", "W"] })]);
    expect(enriched).toBe(0);
    expect(meetings[0].instructors).toBeUndefined();
    expect(unmatched).toHaveLength(1);
  });

  it("applies a course-level professor to every meeting of that course", () => {
    const lec = meeting({ id: "lec" });
    const tut = meeting({ id: "tut", component: "TUT", days: ["F"], start: 600, end: 650 });
    const courseLevel = record({ section: undefined, days: [], start: undefined, end: undefined, location: undefined });
    const { meetings, enriched } = mergeLaurier([lec, tut], [courseLevel]);
    expect(enriched).toBe(2);
    expect(meetings.map((m) => m.instructors)).toEqual([["Ravi Patel"], ["Ravi Patel"]]);
  });

  it("uses the section when the record names one but has no times", () => {
    const a = meeting({ id: "a", section: "999" });
    const b = meeting({ id: "b", section: "001" });
    const bySection = record({ days: [], start: undefined, end: undefined, section: "999", location: undefined });
    const { meetings } = mergeLaurier([a, b], [bySection]);
    expect(meetings[0].instructors).toEqual(["Ravi Patel"]);
    expect(meetings[1].instructors).toBeUndefined();
  });

  it("is idempotent: importing the same LORIS paste twice changes nothing the second time", () => {
    const once = mergeLaurier([meeting()], [record()]);
    const twice = mergeLaurier(once.meetings, [record()]);
    expect(twice.enriched).toBe(0);
    expect(twice.meetings[0]).toBe(once.meetings[0]);
    expect(twice.meetings).toHaveLength(1);
  });

  it("reports a Laurier course the student has no Quest record for, rather than inventing it", () => {
    const { meetings, unmatched } = mergeLaurier([meeting()], [record({ courseCode: "BU481" })]);
    expect(meetings).toHaveLength(1);
    expect(unmatched.map((r) => r.courseCode)).toEqual(["BU481"]);
  });
});
