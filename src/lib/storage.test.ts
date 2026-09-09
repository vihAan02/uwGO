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
});
