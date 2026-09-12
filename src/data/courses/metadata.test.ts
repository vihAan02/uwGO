import { describe, expect, it } from "vitest";
import { courseTitleFor, formatCourseCode, REFERENCE_COURSE_COUNT, referenceTitle } from "./metadata";

describe("course titles", () => {
  it("finds a title however the code is spelled", () => {
    expect(referenceTitle("CS 135")).toBe("Designing Functional Programs");
    expect(referenceTitle("cs135")).toBe("Designing Functional Programs");
    expect(referenceTitle("CS135")).toBe("Designing Functional Programs");
  });

  it("always prefers the title the student actually imported", () => {
    // Quest is the source of truth; the reference set only fills gaps.
    expect(courseTitleFor("CS 135", "Designing Functional Programs (Winter offering)")).toBe("Designing Functional Programs (Winter offering)");
    expect(courseTitleFor("CS 135", "   ")).toBe("Designing Functional Programs");
    expect(courseTitleFor("CS 135")).toBe("Designing Functional Programs");
  });

  it("gives nothing rather than inventing a title", () => {
    expect(referenceTitle("XYZ 999")).toBeUndefined();
    expect(courseTitleFor("XYZ 999")).toBeUndefined();
    // A Laurier course is not UW Flow's to describe.
    expect(referenceTitle("BU111")).toBeUndefined();
    expect(courseTitleFor("BUS 111W", "Introduction to Business Organization")).toBe("Introduction to Business Organization");
  });

  it("formats a code for display", () => {
    expect(formatCourseCode("cs135")).toBe("CS 135");
    expect(formatCourseCode("BUS 352W")).toBe("BUS 352W");
    expect(formatCourseCode("MATH137")).toBe("MATH 137");
  });

  it("stays a small reference set rather than a copy of the calendar", () => {
    expect(REFERENCE_COURSE_COUNT).toBeLessThan(120);
    expect(REFERENCE_COURSE_COUNT).toBeGreaterThan(20);
  });
});
