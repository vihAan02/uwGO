import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { parseQuestSchedule } from "./QuestParser";
import type { CourseMeeting } from "@/domain/types";

const FIX = path.resolve(__dirname, "../../../test/fixtures/quest");
const load = (name: string) => fs.readFileSync(path.join(FIX, name), "utf8");
const find = (ms: CourseMeeting[], code: string, component?: string) =>
  ms.filter((m) => m.courseCode === code && (component ? m.component === component : true));
const codes = (ms: CourseMeeting[]) => ms.map((m) => m.courseCode);
const warnCodes = (r: ReturnType<typeof parseQuestSchedule>) => r.warnings.map((w) => w.code);

describe("QuestParser on real Fall 2025 paste (4-space separators, DD/MM/YYYY)", () => {
  const r = parseQuestSchedule(load("uwflow-2025-fall-listview-spaces.txt"));
  it("recognises the page and term", () => {
    expect(r.recognised).toBe(true);
    expect(r.term).toMatchObject({ season: "Fall", year: 2025, termId: 1259, level: "Undergraduate" });
    expect(r.dateOrder).toBe("DMY");
    expect(warnCodes(r)).not.toContain("MEETING_UNPARSED");
    expect(warnCodes(r)).not.toContain("COURSE_BLOCK_UNPARSED");
  });
  it("parses a normal lecture with room, days, times, dates", () => {
    expect(r.meetings).toHaveLength(5);
    const [pm455] = find(r.meetings, "PMATH 455");
    expect(pm455).toMatchObject({
      courseTitle: "Convex Analysis & Geometry", classNumber: 8243, section: "001", component: "LEC",
      days: ["M", "W"], start: 16 * 60, end: 17 * 60 + 20,
      location: { kind: "ROOM", buildingCode: "MC", roomNumber: "2065" },
      instructors: ["Kateryna Tatarko"], startDate: "2025-09-03", endDate: "2025-12-02",
      source: "QUEST", includeInPlan: true,
    });
    expect(pm455.unscheduled).toBeUndefined();
  });
  it("marks online/TBA rows as unscheduled with multiple instructors", () => {
    const [cs234] = find(r.meetings, "CS 234");
    expect(cs234.unscheduled).toBe(true);
    expect(cs234.days).toEqual([]);
    expect(cs234.location).toEqual({ kind: "ONLINE" });
    expect(cs234.instructors).toEqual(["Collin Roberts", "Scott King"]);
    const [clas] = find(r.meetings, "CLAS 202");
    expect(clas.unscheduled).toBe(true);
    expect(clas.location).toEqual({ kind: "ONLINE" });
  });
});

describe("QuestParser on real Winter 2020 paste (tabs, MM/DD/YYYY, continuation row)", () => {
  const r = parseQuestSchedule(load("uwflow-2020-winter-listview-continuation.txt"));
  it("reads all 10 meeting rows", () => {
    expect(r.dateOrder).toBe("MDY");
    expect(r.meetings).toHaveLength(10);
    expect(new Set(codes(r.meetings))).toEqual(new Set(["CO 255", "CO 487", "CS 341", "CS 350", "CS 476", "SYDE 556"]));
  });
  it("keeps the second meeting pattern of SYDE 556 (no repeated class nbr)", () => {
    const syde = find(r.meetings, "SYDE 556");
    expect(syde).toHaveLength(2);
    expect(syde[0]).toMatchObject({ classNumber: 4595, section: "001", component: "LEC", days: ["T"], start: 11 * 60 + 30, end: 12 * 60 + 50, location: { kind: "ROOM", buildingCode: "E5", roomNumber: "4106" } });
    expect(syde[1]).toMatchObject({ classNumber: 4595, section: "001", component: "LEC", days: ["Th"], start: 9 * 60, end: 10 * 60 + 20, location: { kind: "ROOM", buildingCode: "E5", roomNumber: "6004" } });
    expect(syde[0].id).not.toBe(syde[1].id);
  });
  it("keeps TST rows but excludes them from the plan, with single-day ranges", () => {
    const [tst] = find(r.meetings, "CS 341", "TST");
    expect(tst).toMatchObject({ includeInPlan: false, days: ["T"], start: 19 * 60, end: 20 * 60 + 50, startDate: "2020-02-25", endDate: "2020-02-25", location: { kind: "TBA" } });
    expect(find(r.meetings, "CS 341")).toHaveLength(3);
    expect(find(r.meetings, "CS 341", "TUT")[0]).toMatchObject({ classNumber: 6448, section: "101", days: ["F"], location: { kind: "ROOM", buildingCode: "MC", roomNumber: "2034" } });
  });
});

describe("QuestParser on real Fall 2019 paste (DD/MM/YYYY)", () => {
  const r = parseQuestSchedule(load("uwflow-2019-fall-listview.txt"));
  it("parses rooms, evening times and single-day TST", () => {
    expect(r.dateOrder).toBe("DMY");
    expect(r.meetings).toHaveLength(9);
    const [bet] = find(r.meetings, "BET 420");
    expect(bet).toMatchObject({ days: ["Th"], start: 16 * 60, end: 18 * 60 + 50, location: { kind: "ROOM", buildingCode: "E7", roomNumber: "2317" }, startDate: "2019-09-04", endDate: "2019-12-03" });
    const [tst] = find(r.meetings, "CS 341", "TST");
    expect(tst.startDate).toBe("2019-10-22");
  });
});

describe("QuestParser on real Fall 2021 paste (YYYY/MM/DD, 5-digit class nbr, online)", () => {
  const r = parseQuestSchedule(load("uwflow-2021-fall-online-longclassnbr.txt"));
  it("handles long class numbers and many instructors", () => {
    expect(r.dateOrder).toBe("YMD");
    expect(find(r.meetings, "AFM 132", "TUT")[0].classNumber).toBe(11810);
    const [cs135] = find(r.meetings, "CS 135", "LEC");
    expect(cs135.unscheduled).toBe(true);
    expect(cs135.instructors).toHaveLength(7);
    expect(cs135.instructors![0]).toBe("Byron Becker");
    expect(cs135.location).toEqual({ kind: "ONLINE" });
    expect(find(r.meetings, "CS 135", "PRA")[0]).toMatchObject({ days: ["Th"], start: 14 * 60 + 30 });
    expect(find(r.meetings, "CS 135", "DIS")[0].component).toBe("DIS");
    expect(find(r.meetings, "MTHEL 99")[0]).toMatchObject({ startDate: "2021-08-03", endDate: "2021-09-07" });
    expect(r.meetings).toHaveLength(9);
  });
});

describe("QuestParser on real Spring 2013 paste (old UI, heavy tab noise, Grade column)", () => {
  const r = parseQuestSchedule(load("uwflow-2013-spring-old-ui.txt"));
  it("parses despite noise and collapses internal room whitespace", () => {
    expect(r.term).toMatchObject({ season: "Spring", year: 2013, termId: 1135 });
    expect(r.dateOrder).toBe("MDY");
    expect(r.meetings).toHaveLength(12);
    expect(find(r.meetings, "CS 488")[0].location).toEqual({ kind: "ROOM", buildingCode: "MC", roomNumber: "4040" });
    expect(find(r.meetings, "SE 401")[0]).toMatchObject({ component: "SEM", location: { kind: "ROOM", buildingCode: "RCH", roomNumber: "307" } });
  });
  it("handles blank days + TBA room, and TBA/TBA rows", () => {
    const [lab358] = find(r.meetings, "ECE 358", "LAB");
    expect(lab358).toMatchObject({ unscheduled: true, location: { kind: "TBA" }, instructors: ["Staff"] });
    const [lab464] = find(r.meetings, "SE 464", "LAB");
    expect(lab464).toMatchObject({ unscheduled: true, location: { kind: "TBA" } });
    const [wkrpt] = find(r.meetings, "WKRPT 400");
    expect(wkrpt).toMatchObject({ component: "PRJ", unscheduled: true, instructors: ["Mahesh Tripunitara"] });
    expect(find(r.meetings, "MUSIC 140")[0].location).toEqual({ kind: "ROOM", buildingCode: "STP", roomNumber: "105" });
  });
});

describe("QuestParser rejects wrong pages", () => {
  it("homepage widget table (both real fixtures)", () => {
    for (const f of ["uwflow-2019-fall-homepage-widget.txt", "uwflow-2019-fall-homepage-widget-whitespace.txt"]) {
      const r = parseQuestSchedule(load(f));
      expect(r.recognised).toBe(false);
      expect(r.meetings).toEqual([]);
      expect(warnCodes(r)).toContain("WRONG_PAGE_HOMEPAGE_WIDGET");
    }
  });
  it("not registered", () => {
    const r = parseQuestSchedule("Fall 2026 | Undergraduate | University of Waterloo\nYou are not registered for classes in this term.");
    expect(warnCodes(r)).toContain("NOT_REGISTERED");
    expect(r.meetings).toEqual([]);
  });
  it("course selection page", () => {
    const r = parseQuestSchedule("My Course Selection\nGroupbox\nFall 2026\nUndergraduate\nSubject Catalog Description Component Priority Campus");
    expect(warnCodes(r)).toContain("WRONG_PAGE_COURSE_SELECTION");
  });
  it("malformed garbage", () => {
    const r = parseQuestSchedule("hello world\nthis is not a schedule");
    expect(r.recognised).toBe(false);
    expect(r.meetings).toEqual([]);
    expect(warnCodes(r)).toContain("NO_TERM_HEADER");
  });
  it("empty string", () => {
    const r = parseQuestSchedule("");
    expect(r.recognised).toBe(false);
    expect(r.meetings).toEqual([]);
  });
});

const HEADER = "Fall 2026 | Undergraduate | University of Waterloo\n";
const TABLE = "Class Nbr\tSection\tComponent\tDays & Times\tRoom\tInstructor\tStart/End Date\n";
const block = (course: string, rows: string) => `${course}\nStatus\tUnits\tGrading\tDeadlines\nEnrolled\n0.50\nNumeric Grading Basis\nAcademic Calendar Deadlines\n${TABLE}${rows}`;

describe("QuestParser synthetic edge cases", () => {
  it("combined single-line anchor + continuation row (quest2cal shape)", () => {
    const text = HEADER + "CS 138 - Intro Data Abstract & Implem\n5951 001 LEC\nTTh 10:00AM - 11:20AM\nEIT 1015\nMike Godfrey\n09/09/2026 - 12/08/2026\n\nF 12:30PM - 1:20PM\nRCH 305\nTo be Announced\n09/09/2026 - 12/08/2026\n";
    const r = parseQuestSchedule(text);
    expect(r.meetings).toHaveLength(2);
    expect(r.meetings[0]).toMatchObject({ classNumber: 5951, section: "001", component: "LEC", days: ["T", "Th"] });
    expect(r.meetings[1]).toMatchObject({ classNumber: 5951, section: "001", component: "LEC", days: ["F"], location: { kind: "ROOM", buildingCode: "RCH", roomNumber: "305" } });
    expect(r.dateOrder).toBe("MDY");
    expect(r.meetings[0].startDate).toBe("2026-09-09");
  });

  it("24-hour times and weekend tokens", () => {
    const text = HEADER + block("ARCH 100 - Studio", "1234\n001\nSTU\nSaSu 09:30 - 12:20\nE2 1303\nStaff\n09/09/2026 - 12/08/2026\n");
    const r = parseQuestSchedule(text);
    expect(r.meetings[0]).toMatchObject({ days: ["S", "Su"], start: 570, end: 740, component: "STU" });
  });

  it("drops exact duplicate rows and a schedule pasted twice", () => {
    const one = HEADER + block("MATH 135 - Algebra for Hons Mathematics", "7001\n001\nLEC\nMWF 9:30AM - 10:20AM\nMC 2065\nStaff\n09/09/2026 - 12/08/2026\n");
    const r = parseQuestSchedule(one + one);
    expect(r.meetings).toHaveLength(1);
    expect(warnCodes(r)).toContain("DUPLICATE_DROPPED");
  });

  it("ambiguous date order leaves dates blank but keeps times", () => {
    const text = "Fall 2026\n" + block("CS 135 - Designing Functional Programs", "7001\n001\nLEC\nMWF 9:30AM - 10:20AM\nMC 2065\nStaff\n01/02/2026 - 03/04/2026\n");
    const r = parseQuestSchedule(text);
    expect(r.dateOrder).toBe("UNKNOWN");
    expect(warnCodes(r)).toContain("DATE_ORDER_AMBIGUOUS");
    expect(r.meetings[0].startDate).toBeUndefined();
    expect(r.meetings[0].start).toBe(570);
  });

  it("a broken row produces a warning and does not break the next course", () => {
    const text = HEADER +
      block("CS 135 - Designing Functional Programs", "7001\n001\nLEC\nMWF 9:30AM - 10:20AM\nStaff\n09/09/2026 - 12/08/2026\n") +
      block("MATH 137 - Calculus 1 for Honours Math", "7002\n001\nLEC\nTTh 1:00PM - 2:20PM\nRCH 101\nStaff\n09/09/2026 - 12/08/2026\n");
    const r = parseQuestSchedule(text);
    expect(warnCodes(r)).toContain("MEETING_UNPARSED");
    expect(warnCodes(r)).toContain("COURSE_BLOCK_UNPARSED");
    expect(r.meetings).toHaveLength(1);
    expect(r.meetings[0].courseCode).toBe("MATH 137");
  });

  it("missing room line is not silently treated as a room", () => {
    const text = HEADER + block("CS 135 - Designing Functional Programs", "7001\n001\nLEC\nMWF 9:30AM - 10:20AM\nZZ\n09/09/2026 - 12/08/2026\n");
    const r = parseQuestSchedule(text);
    expect(r.meetings).toHaveLength(0);
  });

  it("unknown component maps to OTHER; ids are stable across parses", () => {
    const text = HEADER + block("KIN 100 - Kinesiology", "7001\n001\nXYZ\nM 9:30AM - 10:20AM\nBMH 1001\nStaff\n09/09/2026 - 12/08/2026\n");
    const a = parseQuestSchedule(text);
    const b = parseQuestSchedule(text);
    expect(a.meetings[0].component).toBe("OTHER");
    expect(a.meetings[0].id).toBe(b.meetings[0].id);
  });

  it("term header missing but table present still parses with a warning", () => {
    const text = block("CS 135 - Designing Functional Programs", "7001\n001\nLEC\nMWF 9:30AM - 10:20AM\nMC 2065\nStaff\n09/09/2026 - 12/08/2026\n");
    const r = parseQuestSchedule(text);
    expect(r.recognised).toBe(true);
    expect(warnCodes(r)).toContain("NO_TERM_HEADER");
    expect(r.meetings).toHaveLength(1);
    expect(r.dateOrder).toBe("MDY"); // 12/08 cannot be DMY (month 12 ok) but 09/09..12/08 DMY = Sep 9..Aug 12 backwards
  });
});
