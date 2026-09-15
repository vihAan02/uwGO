import { describe, expect, it } from "vitest";
import type { CampusLocation, DayOfWeek, DayPlan, ScheduledClass, WeekPlan } from "@/domain/types";
import { dayTabFor, openingDay } from "./openingDay";

/** September 2026: the 14th is a Monday, and Waterloo is UTC-4. */
const at = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00-04:00`);
const MC: CampusLocation = { id: "MC", name: "MC building", latitude: 43.47, longitude: -80.54, kind: "BUILDING", buildingCode: "MC" };

function dayWith(day: DayOfWeek, date: string, start: string, end: string): DayPlan {
  const c: ScheduledClass = {
    id: `c:${day}`, day, date, start: at(date, start), end: at(date, end), location: MC,
    meeting: { id: `m:${day}`, university: "UW", courseCode: "CS 135", component: "LEC", days: [day], start: 0, end: 0, location: { kind: "ROOM", buildingCode: "MC", roomNumber: "4020" }, source: "QUEST", includeInPlan: true },
    room: { raw: "MC 4020", buildingCode: "MC", roomNumber: "4020", floor: "unknown", resolved: true },
  };
  return { day, date, classes: [c], transitions: [], warnings: [], gym: [], items: [{ kind: "CLASS", scheduledClass: c }] };
}
const week = (...days: DayPlan[]): WeekPlan => ({ generatedAt: "", weekStartDate: "2026-09-14", skipped: [], usesEstimates: false, days: Object.fromEntries(days.map((d) => [d.day, d])) });

describe("the day the planner opens on", () => {
  const tueThu = week(dayWith("T", "2026-09-15", "10:30", "11:20"), dayWith("Th", "2026-09-17", "10:30", "11:20"));

  it("opens on today while today still has classes", () => {
    expect(openingDay(tueThu, at("2026-09-15", "08:00"), true)).toBe("T");
  });

  it("moves on to the next class's day once today's classes are over", () => {
    expect(openingDay(tueThu, at("2026-09-15", "18:00"), true)).toBe("Th");
  });

  it("opens a weekend day with a class later that day on that day, not on the Monday already gone", () => {
    const plan = week(dayWith("M", "2026-09-14", "10:30", "11:20"), dayWith("S", "2026-09-19", "13:00", "14:20"));
    expect(openingDay(plan, at("2026-09-19", "09:00"), true)).toBe("S");
  });

  it("shows Monday for a weekend day with no classes, and a weekday as itself", () => {
    const plan = week(dayWith("M", "2026-09-14", "10:30", "11:20"));
    expect(dayTabFor(plan, "2026-09-20")).toBe("M");
    expect(dayTabFor(plan, "2026-09-16")).toBe("W");
    expect(dayTabFor(week(dayWith("Su", "2026-09-20", "13:00", "14:00")), "2026-09-20")).toBe("Su");
  });
});
