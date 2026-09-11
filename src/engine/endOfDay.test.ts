import { describe, expect, it } from "vitest";
import { buildWeekPlan } from "./planner";
import { findContinuityBreaks } from "./transitions";
import { DEFAULT_PLANNER_CONFIG as CFG } from "@/domain/config";
import { EstimateRoutingProvider } from "@/routing/EstimateRoutingProvider";
import { findBuilding } from "@/data/buildings";
import type { ClassTransition, DayPlan, EndOfDayDestination, GymPreferences, UserHome } from "@/domain/types";
import { FALL_2026, ORDINARY_WEEK_MONDAY } from "../../test/fixtures/fall2026Schedule";

/**
 * End-of-day destination: after the last class the student can go HOME (the default), to the GYM,
 * or to the LIBRARY. Travel comes from the app's own EstimateRoutingProvider on the real building
 * coordinates — the same resolver every other leg uses — so nothing here hand-picks a duration.
 */

const uwp = findBuilding("UW", "UWP")!;
const HOME: UserHome = { name: "UW Place", latitude: uwp.latitude!, longitude: uwp.longitude!, preset: { university: "UW", buildingCode: "UWP" } };
const GYM: GymPreferences = { enabled: true, durationMinutes: 60, preferredTime: "NONE" };

const plan = (endOfDay?: EndOfDayDestination, home: UserHome | undefined = HOME) =>
  buildWeekPlan({ meetings: FALL_2026, home, mondayISO: ORDINARY_WEEK_MONDAY, config: CFG, endOfDay, gym: GYM }, new EstimateRoutingProvider());

/** Same, but with no home at all (a student who never set a residence). */
const planNoHome = (endOfDay: EndOfDayDestination) =>
  buildWeekPlan({ meetings: FALL_2026, mondayISO: ORDINARY_WEEK_MONDAY, config: CFG, endOfDay, gym: GYM }, new EstimateRoutingProvider());

/** Friday in the ordinary week: MATH 137 (STC) → CS 135 tut (MC) → MATH 135 (QNC). Last class is QNC. */
const friday = (d: Awaited<ReturnType<typeof plan>>): DayPlan => d.days.F!;
const lastLeg = (day: DayPlan): ClassTransition => day.transitions[day.transitions.length - 1];
const firstLeg = (day: DayPlan): ClassTransition => day.transitions[0];
/** The destination the timeline's final ARRIVE actually points at (what the map would show). */
const finalArrival = (day: DayPlan) => [...day.items].reverse().find((i) => i.kind === "ARRIVE");

describe("end-of-day destination", () => {
  it("defaults to home, and HOME is the same as the default", async () => {
    for (const eod of [undefined, "HOME" as const]) {
      const day = friday(await plan(eod));
      const last = lastLeg(day);
      expect(last.to.kind).toBe("HOME");
      expect(last.kind).toBe("CLASS_TO_HOME");
      expect(last.from.buildingCode).toBe("QNC");
      expect(day.transitions.filter((t) => t.to.kind === "HOME")).toHaveLength(1);
      expect(findContinuityBreaks(day.transitions)).toEqual([]);
    }
  });

  it("GYM routes the last class to the PAC instead of home", async () => {
    const day = friday(await plan("GYM"));
    const last = lastLeg(day);
    expect(last.from.buildingCode).toBe("QNC");
    expect(last.to.buildingCode).toBe("PAC");
    expect(last.kind).toBe("CLASS_TO_END");
    expect(day.transitions.some((t) => t.to.kind === "HOME")).toBe(false);
    // The morning still starts from home; only the day's end changed.
    expect(firstLeg(day).from.kind).toBe("HOME");
    // The leg the map draws ends at the PAC, with a real resolved route.
    const arrival = finalArrival(day);
    expect(arrival?.kind === "ARRIVE" && arrival.to.buildingCode).toBe("PAC");
    expect(last.recommendedRoute).toBeDefined();
    expect(findContinuityBreaks(day.transitions)).toEqual([]);
  });

  it("LIBRARY routes the last class to the nearest study spot instead of home", async () => {
    const day = friday(await plan("LIBRARY"));
    const last = lastLeg(day);
    expect(last.from.buildingCode).toBe("QNC");
    // The curated study spots are the Davis Centre and Dana Porter libraries.
    expect(["DC", "LIB"]).toContain(last.to.buildingCode);
    expect(last.kind).toBe("CLASS_TO_END");
    expect(day.transitions.some((t) => t.to.kind === "HOME")).toBe(false);
    expect(last.recommendedRoute).toBeDefined();
    const arrival = finalArrival(day);
    expect(arrival?.kind === "ARRIVE" && ["DC", "LIB"].includes(arrival.to.buildingCode ?? "")).toBe(true);
    expect(findContinuityBreaks(day.transitions)).toEqual([]);
  });

  it("GYM and LIBRARY work with no home set: the day ends at the chosen place, with no morning-from-home leg", async () => {
    const gymDay = friday(await planNoHome("GYM"));
    expect(gymDay.transitions.every((t) => t.from.kind !== "HOME")).toBe(true);
    expect(lastLeg(gymDay).to.buildingCode).toBe("PAC");

    const libDay = friday(await planNoHome("LIBRARY"));
    expect(["DC", "LIB"]).toContain(lastLeg(libDay).to.buildingCode);
  });
});
