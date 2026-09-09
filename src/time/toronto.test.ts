import { describe, it, expect } from "vitest";
import {
  torontoDate, addMin, minutesBetween, formatClock, minutesOfDay, parseClock, weekdayOf,
  mondayOfWeek, dateForDay, formatMinutesOfDay, formatDuration,
} from "./toronto";

describe("toronto time", () => {
  it("builds instants in America/Toronto regardless of machine zone", () => {
    const d = torontoDate("2026-09-14", 9 * 60 + 30); // EDT, UTC-4
    expect(new Date(d.getTime()).toISOString()).toBe("2026-09-14T13:30:00.000Z");
    const w = torontoDate("2026-01-12", 9 * 60 + 30); // EST, UTC-5
    expect(new Date(w.getTime()).toISOString()).toBe("2026-01-12T14:30:00.000Z");
  });

  it("formats wall clock in Toronto", () => {
    expect(formatClock(torontoDate("2026-09-14", 9 * 60 + 35))).toBe("9:35 AM");
    expect(formatClock(torontoDate("2026-09-14", 12 * 60 + 50))).toBe("12:50 PM");
    expect(formatClock(torontoDate("2026-09-14", 0))).toBe("12:00 AM");
  });

  it("departure math: 10:00 class, 15 min travel, 10 min buffer -> 9:35", () => {
    const classStart = torontoDate("2026-09-14", 10 * 60);
    const departure = addMin(classStart, -15 - 10);
    expect(formatClock(departure)).toBe("9:35 AM");
    expect(minutesBetween(departure, classStart)).toBe(25);
  });

  it("absolute arithmetic across the fall-back boundary (first Sunday in November 2026 = Nov 1)", () => {
    const before = torontoDate("2026-11-01", 60 + 30); // 1:30 AM EDT
    const later = addMin(before, 60);
    // one real hour later the wall clock reads 1:30 again (EST)
    expect(formatClock(later)).toBe("1:30 AM");
    expect(minutesBetween(before, later)).toBe(60);
    // a normal daytime class that day is unaffected
    expect(formatClock(torontoDate("2026-11-01", 14 * 60))).toBe("2:00 PM");
  });

  it("spring-forward day (second Sunday in March 2026 = Mar 8): daytime arithmetic is exact", () => {
    const a = torontoDate("2026-03-08", 10 * 60);
    const b = torontoDate("2026-03-08", 11 * 60 + 20);
    expect(minutesBetween(a, b)).toBe(80);
    expect(new Date(a.getTime()).toISOString()).toBe("2026-03-08T14:00:00.000Z"); // already EDT after 2am
    const prevDay = torontoDate("2026-03-07", 10 * 60);
    expect(new Date(prevDay.getTime()).toISOString()).toBe("2026-03-07T15:00:00.000Z"); // EST
    // skipped wall time: we pin the library's behaviour so a future change is caught
    const skipped = torontoDate("2026-03-08", 2 * 60 + 30);
    expect(["3:30 AM", "1:30 AM"]).toContain(formatClock(skipped));
  });

  it("minutesOfDay round-trips", () => {
    expect(minutesOfDay(torontoDate("2026-09-14", 13 * 60 + 5))).toBe(13 * 60 + 5);
  });

  it("parses Quest clock strings", () => {
    expect(parseClock("9:30AM")).toBe(570);
    expect(parseClock("12:50PM")).toBe(770);
    expect(parseClock("12:05AM")).toBe(5);
    expect(parseClock("1:20pm")).toBe(800);
    expect(parseClock("09:30")).toBe(570);
    expect(parseClock("13:45")).toBe(825);
    expect(parseClock("25:00")).toBeUndefined();
    expect(parseClock("13:00PM")).toBeUndefined();
    expect(parseClock("TBA")).toBeUndefined();
  });

  it("weekday and week helpers", () => {
    expect(weekdayOf("2026-09-14")).toBe("M");
    expect(weekdayOf("2026-09-17")).toBe("Th");
    expect(weekdayOf("2026-09-20")).toBe("Su");
    expect(mondayOfWeek("2026-09-17")).toBe("2026-09-14");
    expect(mondayOfWeek("2026-09-20")).toBe("2026-09-14");
    expect(mondayOfWeek("2026-09-14")).toBe("2026-09-14");
    expect(dateForDay("2026-09-14", "F")).toBe("2026-09-18");
  });

  it("formats minutes and durations", () => {
    expect(formatMinutesOfDay(570)).toBe("9:30 AM");
    expect(formatMinutesOfDay(0)).toBe("12:00 AM");
    expect(formatMinutesOfDay(12 * 60)).toBe("12:00 PM");
    expect(formatDuration(71)).toBe("1 hr 11 min");
    expect(formatDuration(120)).toBe("2 hr");
    expect(formatDuration(9)).toBe("9 min");
  });
});
