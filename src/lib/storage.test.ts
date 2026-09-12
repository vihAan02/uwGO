import { describe, expect, it } from "vitest";
import { loadState, STORAGE_KEY } from "./storage";
import { DEFAULT_PLANNER_CONFIG } from "@/domain/config";

describe("loadState", () => {
  it("keeps the student's buffer choice and drops stale engine thresholds", () => {
    const saved = { schemaVersion: 1, config: { ...DEFAULT_PLANNER_CONFIG, arrivalBufferMinutes: 15, transitConsiderWalkMinutes: 18, minTransitSavingMinutes: 99 } };
    const state = loadState({ getItem: (k) => (k === STORAGE_KEY ? JSON.stringify(saved) : null) });
    expect(state.config.arrivalBufferMinutes).toBe(15);
    expect(state.config.transitConsiderWalkMinutes).toBe(DEFAULT_PLANNER_CONFIG.transitConsiderWalkMinutes);
    expect(state.config.minTransitSavingMinutes).toBe(DEFAULT_PLANNER_CONFIG.minTransitSavingMinutes);
  });

  it("keeps gym and route preferences, sanitising anything odd", () => {
    const saved = { schemaVersion: 1, config: DEFAULT_PLANNER_CONFIG, gym: { enabled: true, durationMinutes: 75, preferredTime: "DAWN" }, routePreference: "INDOORS" };
    const state = loadState({ getItem: (k) => (k === STORAGE_KEY ? JSON.stringify(saved) : null) });
    expect(state.gym).toEqual({ enabled: true, durationMinutes: 60, preferredTime: "NONE" });
    expect(state.routePreference).toBe("INDOORS");
    const none = loadState({ getItem: () => JSON.stringify({ schemaVersion: 1, config: DEFAULT_PLANNER_CONFIG }) });
    expect(none.gym).toBeUndefined();
    expect(none.routePreference).toBeUndefined();
  });

  it("keeps course colours, dropping anything that is not a palette colour", () => {
    const saved = { schemaVersion: 1, config: DEFAULT_PLANNER_CONFIG, courseColors: { cs135: "blue", math135: "<script>" } };
    const state = loadState({ getItem: () => JSON.stringify(saved) });
    expect(state.courseColors).toEqual({ cs135: "blue" });
    expect(loadState({ getItem: () => JSON.stringify({ schemaVersion: 1, config: DEFAULT_PLANNER_CONFIG, courseColors: "red" }) }).courseColors).toBeUndefined();
  });
});
