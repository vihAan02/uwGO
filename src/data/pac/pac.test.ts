import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseFacilityOccupancy } from "./live";
import { pacHoursOn } from "./hours";
import { crowdLevelFor, estimateCrowd, estimateFromPct, typicalOccupancy, blendWithSamples, MACHINE_WAIT_BY_LEVEL } from "./crowd";
import { torontoDate } from "@/time/toronto";

describe("PAC live occupancy parser (real portal HTML from 2026-09-09 10:02 PM)", () => {
  const html = readFileSync(new URL("../../../test/fixtures/pac-occupancy-2026-09-09.html", import.meta.url), "utf8");
  const live = parseFacilityOccupancy(html, new Date("2026-09-10T02:05:00Z"));

  it("finds every facility card with its live count and capacity", () => {
    const byName = Object.fromEntries(live.zones.map((z) => [z.name, z]));
    expect(byName["PAC - 1st Floor - Free Weights"]).toMatchObject({ occupancy: 42, capacity: 75, pct: 56 });
    expect(byName["PAC - 2nd Floor - Weight Machines"]).toMatchObject({ occupancy: 30, capacity: 40, pct: 75 });
    expect(byName["PAC - 2nd Floor - Cardio"]).toMatchObject({ occupancy: 18, capacity: 50, pct: 36 });
    expect(byName["PAC - 1st Floor - Functional"]).toMatchObject({ occupancy: 9, capacity: 25, pct: 36 });
    expect(byName["CIF Fitness Centre"]).toMatchObject({ occupancy: 28, capacity: 100 });
    expect(byName["Esports & Gaming Lounge - PC's"]).toBeDefined();
  });

  it("rolls the four PAC fitness zones into one capacity-weighted figure, leaving CIF and the esports lounge out", () => {
    // (42 + 30 + 18 + 9) / (75 + 40 + 50 + 25) = 99 / 190
    expect(live.pacPct).toBe(52);
    expect(live.resultsFrom).toBe("10:02 PM");
  });
});

describe("PAC hours (athletics.uwaterloo.ca Facility Hours)", () => {
  it("fall term: 6:00 AM to 12:30 AM on weekdays, 9:00 AM on weekends", () => {
    expect(pacHoursOn("2026-09-16")).toMatchObject({ open: 6 * 60, close: 24 * 60 + 30, known: true });
    expect(pacHoursOn("2026-09-19")).toMatchObject({ open: 9 * 60, close: 24 * 60 + 30 });
  });
  it("closures and special days win", () => {
    expect(pacHoursOn("2026-10-12")).toBeUndefined(); // Thanksgiving
    expect(pacHoursOn("2026-10-10")).toMatchObject({ open: 9 * 60, close: 17 * 60 + 30 });
    expect(pacHoursOn("2026-12-25")).toBeUndefined();
  });
  it("a date outside every posted period falls back to regular hours, flagged as assumed", () => {
    expect(pacHoursOn("2027-02-03")).toMatchObject({ open: 6 * 60, known: false });
  });
});

describe("crowd level and estimated machine wait", () => {
  it("thresholds map the observed readings sensibly", () => {
    expect(crowdLevelFor(75)).toBe("VERY_BUSY"); // weight machines at 10 PM
    expect(crowdLevelFor(56)).toBe("BUSY");
    expect(crowdLevelFor(36)).toBe("BEARABLE");
    expect(crowdLevelFor(12)).toBe("QUIET");
  });
  it("the wait range comes from one table, by level", () => {
    const e = estimateFromPct(40, "TYPICAL");
    expect(e).toMatchObject({ level: "BEARABLE", estimatedMachineWaitMin: MACHINE_WAIT_BY_LEVEL.BEARABLE.min, estimatedMachineWaitMax: MACHINE_WAIT_BY_LEVEL.BEARABLE.max });
  });
  it("typical pattern: quiet mornings, a 5-7 PM peak on weekdays", () => {
    expect(typicalOccupancy("W", 10 * 60 + 30)).toBeLessThan(typicalOccupancy("W", 13 * 60 + 30));
    expect(typicalOccupancy("W", 17 * 60 + 30)).toBeGreaterThan(70);
    expect(crowdLevelFor(typicalOccupancy("W", 17 * 60 + 30))).toBe("VERY_BUSY");
  });
  it("live reading is used as-is for the near term, nudges the pattern for a few hours, then the pattern stands alone", () => {
    const live = { occupancyPct: 20, at: torontoDate("2026-09-16", 17 * 60) }; // an unusually quiet 5 PM
    expect(estimateCrowd(torontoDate("2026-09-16", 17 * 60 + 20), live)).toMatchObject({ level: "QUIET", source: "LIVE", occupancyPct: 20 });
    const later = estimateCrowd(torontoDate("2026-09-16", 18 * 60 + 30), live);
    expect(later.source).toBe("LIVE_ADJUSTED");
    expect(later.occupancyPct).toBeLessThan(typicalOccupancy("W", 18 * 60 + 30));
    expect(estimateCrowd(torontoDate("2026-09-16", 22 * 60), live).source).toBe("TYPICAL");
    // A reading from another day never leaks into tomorrow's estimate.
    expect(estimateCrowd(torontoDate("2026-09-17", 17 * 60 + 20), live).source).toBe("TYPICAL");
  });
  it("the app's own samples refine the pattern once there are three for that weekday and hour", () => {
    const samples = [{ day: "T" as const, minutes: 10 * 60, pct: 70 }, { day: "T" as const, minutes: 10 * 60 + 20, pct: 72 }, { day: "T" as const, minutes: 10 * 60 + 40, pct: 74 }];
    expect(blendWithSamples("T", 10 * 60 + 30, samples.slice(0, 2))).toBe(typicalOccupancy("T", 10 * 60 + 30));
    expect(blendWithSamples("T", 10 * 60 + 30, samples)).toBeGreaterThan(typicalOccupancy("T", 10 * 60 + 30));
  });
});
