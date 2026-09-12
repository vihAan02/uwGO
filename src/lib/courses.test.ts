import { describe, expect, it } from "vitest";
import type { CourseMeeting } from "@/domain/types";
import { displayName, groupCourses, termLabel } from "./courses";

const meeting = (over: Partial<CourseMeeting> = {}): CourseMeeting => ({
  id: `m${Math.random()}`, university: "UW", courseCode: "CS 135", component: "LEC",
  days: ["T", "Th"], start: 600, end: 680,
  location: { kind: "ROOM", buildingCode: "MC", roomNumber: "4045" },
  source: "QUEST", includeInPlan: true, ...over,
});

describe("the student's courses, as courses", () => {
  it("gathers a course's lectures, tutorials and labs under one entry, earliest first", () => {
    const [course] = groupCourses([
      meeting({ id: "tut", component: "TUT", start: 780, end: 830 }),
      meeting({ id: "lec", component: "LEC", start: 600, end: 680 }),
    ]);
    expect(course.code).toBe("CS 135");
    expect(course.meetings.map((m) => m.id)).toEqual(["lec", "tut"]);
  });

  it("matches a course however its code was spelled", () => {
    const groups = groupCourses([meeting({ courseCode: "CS 135" }), meeting({ courseCode: "cs135" })]);
    expect(groups).toHaveLength(1);
    expect(groups[0].meetings).toHaveLength(2);
  });

  it("lists courses in the order a student reads them", () => {
    const groups = groupCourses([meeting({ courseCode: "MATH 137" }), meeting({ courseCode: "CS 135" }), meeting({ courseCode: "ECON 101" })]);
    expect(groups.map((g) => g.code)).toEqual(["CS 135", "ECON 101", "MATH 137"]);
  });

  it("uses the title the student imported, and fills a missing one from the reference set", () => {
    expect(groupCourses([meeting({ courseTitle: "Functional Programming, Fall" })])[0].title).toBe("Functional Programming, Fall");
    expect(groupCourses([meeting({ courseTitle: undefined })])[0].title).toBe("Designing Functional Programs");
    expect(groupCourses([meeting({ courseCode: "XYZ 999", courseTitle: undefined })])[0].title).toBeUndefined();
  });

  it("collects every distinct professor across a course's meetings", () => {
    const g = groupCourses([
      meeting({ id: "a", instructors: ["Ada Lovelace"] }),
      meeting({ id: "b", component: "TUT", instructors: ["Ada Lovelace", "Grace Hopper"] }),
    ])[0];
    expect(g.instructors).toEqual(["Ada Lovelace", "Grace Hopper"]);
  });
});

describe("marking a Laurier course as incomplete", () => {
  const laurier = (over: Partial<CourseMeeting> = {}) =>
    meeting({ university: "WLU", courseCode: "BUS 352W", laurierCode: "BU352", ...over });

  it("flags a Laurier course with no room and no professor", () => {
    const g = groupCourses([laurier({ location: { kind: "TBA" }, instructors: undefined })])[0];
    expect(g.university).toBe("WLU");
    expect(g.laurierCode).toBe("BU352");
    expect(g.needsLaurierInfo).toBe(true);
  });

  it("flags one that has a room but still no professor", () => {
    expect(groupCourses([laurier({ instructors: undefined })])[0].needsLaurierInfo).toBe(true);
  });

  it("stops flagging it once the room and the professor are known", () => {
    const g = groupCourses([laurier({ location: { kind: "ROOM", buildingCode: "LH", roomNumber: "1001" }, instructors: ["Ravi Patel"] })])[0];
    expect(g.needsLaurierInfo).toBe(false);
  });

  it("never calls a Waterloo course incomplete, even with no professor listed", () => {
    const g = groupCourses([meeting({ instructors: undefined, location: { kind: "TBA" } })])[0];
    expect(g.needsLaurierInfo).toBe(false);
  });
});

describe("profile odds and ends", () => {
  it("names the term, or says nothing", () => {
    expect(termLabel({ season: "Fall", year: 2026, termId: 1269 })).toBe("Fall 2026");
    expect(termLabel(undefined)).toBeUndefined();
  });

  it("takes a name from the sign-in address without inventing one", () => {
    expect(displayName("j2smith@uwaterloo.ca")).toBe("j2smith");
    expect(displayName(undefined)).toBeUndefined();
  });
});
