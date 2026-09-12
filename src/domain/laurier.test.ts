import { describe, expect, it } from "vitest";
import { CROSS_REGISTERED_SUBJECTS, classifyCourse, classifyCourseCode, courseIdentity, normalizeCourseCode, splitCourseCode } from "./laurier";

describe("recognising a Laurier course inside a Quest paste", () => {
  it("maps the first-year double degree courses to their Laurier codes", () => {
    expect(classifyCourseCode("BUS 111W")).toEqual({ university: "WLU", laurierCode: "BU111" });
    expect(classifyCourseCode("BUS 121W")).toEqual({ university: "WLU", laurierCode: "BU121" });
    expect(classifyCourseCode("ECON 120W")).toEqual({ university: "WLU", laurierCode: "EC120" });
    expect(classifyCourseCode("ECON 140W")).toEqual({ university: "WLU", laurierCode: "EC140" });
  });

  it("maps upper-year courses too, not just first year", () => {
    const pairs: [string, string][] = [
      ["BUS 231W", "BU231"], ["BUS 247W", "BU247"], ["BUS 283W", "BU283"], ["BUS 288W", "BU288"],
      ["BUS 352W", "BU352"], ["BUS 362W", "BU362"], ["BUS 393W", "BU393"], ["BUS 491W", "BU491"],
      ["ECON 250W", "EC250"], ["ECON 290W", "EC290"], ["ECON 390W", "EC390"],
    ];
    for (const [quest, laurier] of pairs) {
      expect(classifyCourseCode(quest), quest).toEqual({ university: "WLU", laurierCode: laurier });
    }
  });

  it("keeps a stream letter and drops only the trailing W", () => {
    // BUS 461AW is BU461A. Removing every W, or the last letter, would both be wrong.
    expect(classifyCourseCode("BUS 461AW")).toEqual({ university: "WLU", laurierCode: "BU461A" });
    expect(classifyCourseCode("BUS 480ZW")).toEqual({ university: "WLU", laurierCode: "BU480Z" });
  });

  it("maps GESC to itself rather than to the first two letters", () => {
    // The naive rule would invent "GE231"; Laurier's own code is GESC 231.
    expect(classifyCourseCode("GESC 231W")).toEqual({ university: "WLU", laurierCode: "GESC231" });
  });

  it("does not treat a subject beginning with BUS or ECON as Laurier", () => {
    // Waterloo teaches its own economics, and ARBUS/AFM/BET are Waterloo subjects.
    for (const code of ["ECON 101", "ECON 201", "ECON 322", "ARBUS 102", "AFM 101", "BET 100", "BUSINESS 101"]) {
      expect(classifyCourseCode(code), code).toEqual({ university: "UW" });
    }
  });

  it("leaves ordinary Waterloo courses alone", () => {
    for (const code of ["CS 135", "MATH 135", "SYDE 101L", "STAT 230", "PSYCH 101"]) {
      expect(classifyCourseCode(code).university, code).toBe("UW");
      expect(classifyCourseCode(code).laurierCode).toBeUndefined();
    }
  });

  it("believes Quest's own Campus column over the course number", () => {
    expect(classifyCourse("BUS", "352W", "Wilfrid Laurier")).toEqual({ university: "WLU", laurierCode: "BU352" });
    // A course the number rule would not catch is still Laurier's if Quest says so.
    expect(classifyCourse("MB", "100", "Wilfrid Laurier")).toEqual({ university: "WLU" });
    expect(classifyCourse("CS", "135", "University of Waterloo (Main)")).toEqual({ university: "UW" });
  });

  it("reports a W-suffixed subject it has no mapping for instead of inventing a code", () => {
    const r = classifyCourseCode("PSYC 220W");
    expect(r.university).toBe("UW");
    expect(r.laurierCode).toBeUndefined();
    expect(r.unmappedSubject).toBe("PSYC");
  });

  it("knows the three documented cross-registered subjects", () => {
    expect(CROSS_REGISTERED_SUBJECTS).toEqual({ BUS: "BU", ECON: "EC", GESC: "GESC" });
  });
});

describe("course codes as identities", () => {
  it("splits a code into subject and number, whatever the spacing or case", () => {
    expect(splitCourseCode("bus 352w")).toEqual({ subject: "BUS", number: "352W" });
    expect(splitCourseCode("BUS352W")).toEqual({ subject: "BUS", number: "352W" });
    expect(splitCourseCode("not a course")).toBeUndefined();
  });

  it("normalises to one spelling so records from different systems match", () => {
    expect(normalizeCourseCode("BUS 352W")).toBe("bus352w");
    expect(normalizeCourseCode("bus352w")).toBe("bus352w");
    expect(normalizeCourseCode("BU 352")).toBe("bu352");
  });

  it("gives a Laurier course the identity LORIS will know it by", () => {
    // Quest calls it BUS 352W; a LORIS record calls it BU352. They must land on one key.
    expect(courseIdentity("BUS 352W", "BU352")).toBe("bu352");
    expect(courseIdentity("BU352")).toBe("bu352");
    expect(courseIdentity("CS 135")).toBe("cs135");
  });
});
