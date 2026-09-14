import { describe, expect, it } from "vitest";
import { DEFAULT_PLANNER_CONFIG as CFG } from "@/domain/config";
import { networkBuildingLocation } from "./indoorRoute";
import { campusGraph } from "./indoorGraph";
import { REGRESSION_AT } from "./networkRegression";
import { BenchmarkWalks, campusMetrics, campusSnapshot, compareCampusSnapshots, renderCampusComparison, renderCampusMetrics } from "./campusBenchmark";

/** The benchmark reads the engine's decisions faithfully, and a comparison with itself finds nothing. */

const places = ["MC", "PAC", "DC", "QNC"].map((c) => networkBuildingLocation(c)!);

describe("the campus-aware walk benchmark", () => {
  it("records every pair's decision, what it passes through, and what Google was asked for", async () => {
    const walks = new BenchmarkWalks();
    const s = await campusSnapshot(campusGraph(), CFG, REGRESSION_AT, walks, places);
    expect(Object.keys(s.pairs)).toHaveLength(12);
    expect(s.pairs["MC>PAC"].outcome).toBe("CORRECTED");
    expect(s.pairs["MC>PAC"].through).toEqual(["SLC"]);
    expect(s.pairs["MC>QNC"].links).toBeGreaterThan(0);
    expect(s.pairs["MC>PAC"].lookups).toBeLessThanOrEqual(3);
    expect(walks.asked).toBeGreaterThan(12);
    const m = campusMetrics(s);
    expect(m.pairs).toBe(12);
    expect(m.corrected).toBe(3);
    expect(m.lookups.total).toBe(Object.values(s.pairs).reduce((n, d) => n + d.lookups, 0));
    expect(renderCampusMetrics(m, "Now").join("\n")).toMatch(/corrected because it relied on a way that may not be used: 3/);
  });

  it("finds no change between a snapshot and itself, and names the kind of every change", async () => {
    const s = await campusSnapshot(campusGraph(), CFG, REGRESSION_AT, undefined, places);
    const same = compareCampusSnapshots(s, s);
    expect(same.changes).toEqual([]);
    expect(same.unchanged).toBe(12);
    const later = { ...s, pairs: { ...s.pairs, "MC>PAC": { ...s.pairs["MC>PAC"], outcome: "NO_USABLE_ROUTE" as const, total: undefined, seconds: undefined }, "MC>QNC": { ...s.pairs["MC>QNC"], total: (s.pairs["MC>QNC"].total ?? 0) + 30 } } };
    const c = compareCampusSnapshots(s, later);
    expect(c.counts.NOW_INVALID).toBe(1);
    expect(c.counts.LONGER).toBe(1);
    expect(renderCampusComparison(c).join("\n")).toMatch(/NOW_INVALID \(1\):\n {2}MC > PAC/);
  });
});
