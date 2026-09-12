import { describe, expect, it } from "vitest";
import type { CourseMeeting } from "@/domain/types";
import {
  firstClassDate, formatDateRange, formatMonth, fullWeek, hoursOfClass, initialAnchor, monthWeeks, occurrencesOn, stepAnchor, weekColumns,
} from "./calendar";

// MATH 135 LEC 009, MWF 12:30–1:20, first meeting Tuesday 8 September (so really Wednesday the 9th).
const meeting = (over: Partial<CourseMeeting> = {}): CourseMeeting => ({
  id: "math135-lec", university: "UW", courseCode: "MATH 135", section: "009", component: "LEC",
  days: ["M", "W", "F"], start: 750, end: 800, startDate: "2026-09-08", endDate: "2026-12-07",
  location: { kind: "ROOM", buildingCode: "EV3", roomNumber: "1408" }, source: "QUEST", includeInPlan: true,
  ...over,
});
const TODAY = "2026-09-23"; // a Wednesday in term
const datesWith = (meetings: CourseMeeting[], dates: string[]) => dates.filter((d) => occurrencesOn(meetings, d).length > 0);

describe("the week is a real week", () => {
  it("labels each weekday with its date", () => {
    const week = weekColumns([meeting()], "2026-09-23", TODAY);
    expect(week.map((d) => d.label)).toEqual(["Mon 21", "Tue 22", "Wed 23", "Thu 24", "Fri 25"]);
    expect(week.map((d) => d.date)).toEqual(["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25"]);
    expect(week.find((d) => d.isToday)?.date).toBe("2026-09-23");
  });

  it("titles the week as UW Flow does", () => {
    expect(formatDateRange("2026-09-21", "2026-09-25")).toBe("Sep 21st – 25th, 2026");
    expect(formatDateRange("2026-09-28", "2026-10-02")).toBe("Sep 28th – Oct 2nd, 2026");
    expect(formatDateRange("2026-12-28", "2027-01-01")).toBe("Dec 28th, 2026 – Jan 1st, 2027");
    expect(formatDateRange("2026-09-21", "2026-09-21")).toBe("Monday, Sep 21st, 2026");
    expect(formatMonth("2026-09-23")).toBe("September 2026");
  });

  it("shows a weekend column only when a class is on that day", () => {
    expect(weekColumns([meeting()], TODAY, TODAY)).toHaveLength(5);
    const saturday = weekColumns([meeting(), meeting({ id: "sat-lab", component: "LAB", days: ["S"] })], TODAY, TODAY);
    expect(saturday.map((d) => d.label)).toEqual(["Mon 21", "Tue 22", "Wed 23", "Thu 24", "Fri 25", "Sat 26"]);
  });

  it("counts the week's hours of class to the nearest half hour", () => {
    expect(hoursOfClass(weekColumns([meeting()], TODAY, TODAY))).toBe(2.5); // three 50-minute lectures
  });
});

describe("a class appears only on the dates it actually meets", () => {
  it("is not on before its first date, and is on from its first date, inclusive", () => {
    const firstWeek = fullWeek([meeting({ startDate: "2026-09-09" })], "2026-09-07", TODAY).map((d) => d.date);
    expect(datesWith([meeting({ startDate: "2026-09-09" })], firstWeek)).toEqual(["2026-09-09", "2026-09-11"]);
  });

  it("is on its last date, inclusive, and not after", () => {
    const lastWeek = fullWeek([meeting()], "2026-12-07", TODAY).map((d) => d.date);
    expect(datesWith([meeting()], lastWeek)).toEqual(["2026-12-07"]);
    expect(occurrencesOn([meeting()], "2026-12-09")).toEqual([]);
  });

  it("is on nowhere at all in a week outside its dates", () => {
    const summer = weekColumns([meeting()], "2027-06-16", TODAY);
    expect(summer.every((d) => d.occurrences.length === 0)).toBe(true);
  });

  it("runs every week when Quest gave no dates", () => {
    const undated = meeting({ startDate: undefined, endDate: undefined });
    expect(occurrencesOn([undated], "2031-03-03")).toHaveLength(1);
  });

  it("only on its own weekdays, and never when it has no scheduled time", () => {
    expect(occurrencesOn([meeting()], "2026-09-22")).toEqual([]); // a Tuesday
    expect(occurrencesOn([meeting({ unscheduled: true, days: [] })], "2026-09-21")).toEqual([]);
  });

  it("lists a day's classes earliest first, each at its own time", () => {
    const tut = meeting({ id: "cs135-tut", courseCode: "CS 135", component: "TUT", days: ["M"], start: 510, end: 560 });
    expect(occurrencesOn([meeting(), tut], "2026-09-21").map((o) => [o.meeting.id, o.start, o.end])).toEqual([
      ["cs135-tut", 510, 560],
      ["math135-lec", 750, 800],
    ]);
  });
});

describe("moving through the term", () => {
  it("steps a week at a time backward and forward, and each step shows that week's classes", () => {
    const later = stepAnchor("week", "2026-09-23", 1, "2026-01-01");
    expect(later).toBe("2026-09-28");
    expect(weekColumns([meeting()], later, TODAY).map((d) => d.label)).toEqual(["Mon 28", "Tue 29", "Wed 30", "Thu 1", "Fri 2"]);
    expect(stepAnchor("week", "2026-09-23", -1, "2026-01-01")).toBe("2026-09-14");
    // Back past the start of term: the first week has two classes, the week before has none.
    const firstWeek = stepAnchor("week", "2026-09-14", -1, "2026-01-01");
    const beforeTerm = stepAnchor("week", firstWeek, -1, "2026-01-01");
    expect(hoursOfClass(weekColumns([meeting()], firstWeek, TODAY))).toBe(1.5);
    expect(hoursOfClass(weekColumns([meeting()], beforeTerm, TODAY))).toBe(0);
  });

  it("lands on today when stepping into today's week or month", () => {
    expect(stepAnchor("week", "2026-09-16", 1, TODAY)).toBe(TODAY);
    expect(stepAnchor("month", "2026-08-10", 1, TODAY)).toBe(TODAY);
  });

  it("steps a day, and a month across a year boundary", () => {
    expect(stepAnchor("day", "2026-09-30", 1, TODAY)).toBe("2026-10-01");
    expect(stepAnchor("month", "2026-12-15", 1, TODAY)).toBe("2027-01-01");
    expect(stepAnchor("month", "2027-01-15", -1, TODAY)).toBe("2026-12-01");
  });

  it("opens on today in term or after it, and on the first day of classes before term starts", () => {
    expect(firstClassDate([meeting()])).toBe("2026-09-09");
    expect(initialAnchor([meeting()], "2026-08-20")).toBe("2026-09-09");
    expect(initialAnchor([meeting()], TODAY)).toBe(TODAY);
    expect(initialAnchor([meeting()], "2027-02-01")).toBe("2027-02-01");
    expect(initialAnchor([meeting({ startDate: undefined })], "2026-08-20")).toBe("2026-08-20");
  });
});

describe("the month view", () => {
  it("lays the month out as whole Monday-first weeks, padded from the neighbouring months", () => {
    const weeks = monthWeeks([meeting()], "2026-09-23", TODAY);
    expect(weeks).toHaveLength(5);
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    expect(weeks[0][0].date).toBe("2026-08-31");
    expect(weeks[0][0].inMonth).toBe(false);
    expect(weeks.at(-1)!.at(-1)!.date).toBe("2026-10-04");
    expect(weeks.flat().filter((c) => c.inMonth)).toHaveLength(30);
  });

  it("fits a month that starts on a Monday and ends on a Sunday into exactly its own weeks", () => {
    const feb = monthWeeks([], "2027-02-10", TODAY);
    expect(feb).toHaveLength(4);
    expect(feb[0][0].date).toBe("2027-02-01");
    expect(feb.flat().every((c) => c.inMonth)).toBe(true);
  });

  it("marks classes on the dates they actually meet", () => {
    const cells = monthWeeks([meeting()], "2026-09-01", TODAY).flat();
    const withClass = cells.filter((c) => c.occurrences.length > 0).map((c) => c.date);
    expect(withClass[0]).toBe("2026-09-09");
    expect(withClass).not.toContain("2026-09-07");
    expect(cells.find((c) => c.date === TODAY)?.isToday).toBe(true);
  });
});
