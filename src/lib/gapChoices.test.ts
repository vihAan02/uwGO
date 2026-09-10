import { describe, expect, it } from "vitest";
import { chosenFor, gapDateKey, type GapChoices } from "@/domain/gapChoices";
import { MAX_GAP_CHOICES, forgetMissingClasses, isEveryWeek, migrateGapChoices, pruneGapChoices, setGapChoice } from "./gapChoices";
import { loadState, saveState, type AppState } from "./storage";
import { DEFAULT_PLANNER_CONFIG } from "@/domain/config";

const CLASS = "math137-lec:W";
const WED = "2026-09-09"; // Wednesday
const MON = "2026-09-07"; // the Monday of that week
const FRI = "2026-09-11";
const LAST_WEEK = "2026-09-02";

describe("the day's answer beats the standing one", () => {
  it("finds the standing weekly answer when there is no answer for the day", () => {
    const gc: GapChoices = { byDate: {}, byClass: { [CLASS]: { kind: "GYM", gymThen: "REZ" } } };
    expect(chosenFor(gc, WED, CLASS)).toEqual({ value: { kind: "GYM", gymThen: "REZ" }, source: "CLASS" });
  });

  it("prefers the answer given for that day", () => {
    const gc: GapChoices = {
      byDate: { [gapDateKey(WED, CLASS)]: { kind: "STAY" } },
      byClass: { [CLASS]: { kind: "REZ" } },
    };
    expect(chosenFor(gc, WED, CLASS)).toEqual({ value: { kind: "STAY" }, source: "DATE" });
    // ...and only for that day.
    expect(chosenFor(gc, "2026-09-16", CLASS)?.source).toBe("CLASS");
  });

  it("returns nothing when the gap has never been answered", () => {
    expect(chosenFor(undefined, WED, CLASS)).toBeUndefined();
    expect(chosenFor({ byDate: {}, byClass: {} }, WED, CLASS)).toBeUndefined();
  });
});

describe("saving an answer", () => {
  it("this day only leaves other weeks alone", () => {
    const gc = setGapChoice(undefined, WED, CLASS, { kind: "STUDY" }, false);
    expect(chosenFor(gc, WED, CLASS)?.source).toBe("DATE");
    expect(chosenFor(gc, "2026-09-16", CLASS)).toBeUndefined();
    expect(isEveryWeek(gc, CLASS)).toBe(false);
  });

  it("every week carries to the following weeks", () => {
    const gc = setGapChoice(undefined, WED, CLASS, { kind: "REZ" }, true);
    expect(chosenFor(gc, "2026-09-16", CLASS)?.value).toEqual({ kind: "REZ" });
    expect(isEveryWeek(gc, CLASS)).toBe(true);
  });

  it("choosing every week clears a leftover answer for that day, which would otherwise win", () => {
    let gc = setGapChoice(undefined, WED, CLASS, { kind: "STAY" }, false);
    gc = setGapChoice(gc, WED, CLASS, { kind: "GYM", gymThen: "REZ" }, true);
    expect(chosenFor(gc, WED, CLASS)).toEqual({ value: { kind: "GYM", gymThen: "REZ" }, source: "CLASS" });
  });

  it("changing one day after setting a standing answer diverges only that day", () => {
    let gc = setGapChoice(undefined, WED, CLASS, { kind: "REZ" }, true);
    gc = setGapChoice(gc, WED, CLASS, { kind: "STAY" }, false);
    expect(chosenFor(gc, WED, CLASS)?.value).toEqual({ kind: "STAY" });
    expect(chosenFor(gc, "2026-09-16", CLASS)?.value).toEqual({ kind: "REZ" });
  });

  it("clearing removes both the day and the standing answer", () => {
    let gc = setGapChoice(undefined, WED, CLASS, { kind: "REZ" }, true);
    gc = setGapChoice(gc, WED, CLASS, { kind: "STAY" }, false);
    gc = setGapChoice(gc, WED, CLASS, undefined, false);
    expect(chosenFor(gc, WED, CLASS)).toBeUndefined();
    expect(chosenFor(gc, "2026-09-16", CLASS)).toBeUndefined();
  });
});

describe("forgetting", () => {
  it("drops last week's day answers but keeps this week's, even looking back from Friday", () => {
    const gc: GapChoices = {
      byDate: {
        [gapDateKey(LAST_WEEK, CLASS)]: { kind: "REZ" },
        [gapDateKey(MON, CLASS)]: { kind: "STAY" },
        [gapDateKey(WED, CLASS)]: { kind: "STUDY" },
      },
      byClass: {},
    };
    const pruned = pruneGapChoices(gc, FRI);
    expect(Object.keys(pruned.byDate).sort()).toEqual([gapDateKey(MON, CLASS), gapDateKey(WED, CLASS)]);
  });

  it("never prunes the standing weekly answers, which carry no date", () => {
    const gc: GapChoices = { byDate: {}, byClass: { [CLASS]: { kind: "REZ" } } };
    expect(pruneGapChoices(gc, "2027-05-01").byClass[CLASS]).toEqual({ kind: "REZ" });
  });

  it("caps the number of stored answers, keeping the newest", () => {
    const byDate: GapChoices["byDate"] = {};
    for (let i = 0; i < MAX_GAP_CHOICES + 50; i++) {
      byDate[gapDateKey(`2026-${String(9 + Math.floor(i / 28)).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`, `c${i}`)] = { kind: "STAY" };
    }
    const pruned = pruneGapChoices({ byDate, byClass: {} }, "2026-09-01");
    expect(Object.keys(pruned.byDate)).toHaveLength(MAX_GAP_CHOICES);
  });

  it("drops answers for a course the student no longer takes", () => {
    const gc: GapChoices = {
      byDate: { [gapDateKey(WED, "math137-lec:W")]: { kind: "REZ" }, [gapDateKey(WED, "dropped-lec:W")]: { kind: "STAY" } },
      byClass: { "math137-lec:W": { kind: "REZ" }, "dropped-lec:W": { kind: "STAY" } },
    };
    const kept = forgetMissingClasses(gc, ["math137-lec"]);
    expect(Object.keys(kept.byClass)).toEqual(["math137-lec:W"]);
    expect(Object.keys(kept.byDate)).toEqual([gapDateKey(WED, "math137-lec:W")]);
  });
});

describe("reading back what was stored", () => {
  it("drops an unknown kind rather than trusting it", () => {
    const gc = migrateGapChoices({ byClass: { [CLASS]: { kind: "PUB" } }, byDate: {} }, WED);
    expect(gc?.byClass).toEqual({});
  });

  it("strips gymThen when the choice is not the gym", () => {
    const gc = migrateGapChoices({ byClass: { [CLASS]: { kind: "REZ", gymThen: "STUDY" } }, byDate: {} }, WED);
    expect(gc?.byClass[CLASS]).toEqual({ kind: "REZ" });
  });

  it("drops an unknown gymThen but keeps the gym choice itself", () => {
    const gc = migrateGapChoices({ byClass: { [CLASS]: { kind: "GYM", gymThen: "PUB" } }, byDate: {} }, WED);
    expect(gc?.byClass[CLASS]).toEqual({ kind: "GYM" });
  });

  it("drops keys of the wrong shape", () => {
    const gc = migrateGapChoices({ byDate: { "not-a-date": { kind: "REZ" }, [gapDateKey(WED, CLASS)]: { kind: "REZ" } }, byClass: { "has|pipe": { kind: "REZ" } } }, WED);
    expect(Object.keys(gc!.byDate)).toEqual([gapDateKey(WED, CLASS)]);
    expect(gc!.byClass).toEqual({});
  });

  it("prunes stale days on the way in", () => {
    const gc = migrateGapChoices({ byDate: { [gapDateKey(LAST_WEEK, CLASS)]: { kind: "REZ" } }, byClass: {} }, FRI);
    expect(gc?.byDate).toEqual({});
  });

  it("survives a round trip through localStorage", () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
    const state: AppState = {
      schemaVersion: 1,
      config: DEFAULT_PLANNER_CONFIG,
      gapChoices: setGapChoice(undefined, WED, CLASS, { kind: "GYM", gymThen: "REZ" }, true),
    };
    expect(saveState(state, storage)).toBe(true);
    const back = loadState(storage);
    expect(chosenFor(back.gapChoices, WED, CLASS)?.value).toEqual({ kind: "GYM", gymThen: "REZ" });
  });

  it("is undefined for a state that predates the feature", () => {
    expect(migrateGapChoices(undefined, WED)).toBeUndefined();
    expect(migrateGapChoices("nonsense", WED)).toBeUndefined();
  });
});
