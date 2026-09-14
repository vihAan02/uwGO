import { describe, expect, it } from "vitest";
import { campusGraph, routeBetweenBuildings } from "./indoorGraph";
import { REGRESSION_MODES, compareSnapshots, regressionOptions, renderRouteComparison, routeSnapshot, type RouteSnapshot } from "./networkRegression";

/**
 * The route regression a network regeneration or a field promotion is read against. It is only worth
 * trusting if it routes exactly as production does, so that is what these hold it to.
 */

describe("route regression", () => {
  const g = campusGraph();
  const snapshot = routeSnapshot(g);

  it("routes every ordered pair of network buildings in each mode", () => {
    const n = g.anchorsByBuilding.size;
    expect(Object.keys(snapshot)).toHaveLength(n * (n - 1) * REGRESSION_MODES.length);
  });

  it("reads each route off one search per origin exactly as a search between the two buildings finds it", () => {
    for (const [from, to] of [["MC", "DC"], ["STC", "MC"], ["MC", "PAC"], ["E2", "QNC"], ["DWE", "RCH"], ["PAC", "EV3"]]) {
      for (const mode of REGRESSION_MODES) {
        const direct = routeBetweenBuildings(from, to, regressionOptions(mode));
        const read = snapshot[`${from}>${to}|${mode}`];
        expect(read?.edgeIds ?? null, `${from} > ${to} (${mode})`).toEqual(direct?.edgeIds ?? null);
        if (direct) expect(read!.seconds).toBe(Math.round(direct.seconds));
      }
    }
  });

  it("gives the same snapshot every time", () => {
    expect(routeSnapshot(g)).toEqual(snapshot);
  });

  it("names each kind of change between two snapshots", () => {
    const r = { seconds: 100, buildings: ["A", "B"], edgeIds: ["x", "y"] };
    const before: RouteSnapshot = { "A>B|winter": r, "A>C|winter": r, "B>C|winter": null, "C>A|winter": r, "C>B|winter": r };
    const after: RouteSnapshot = { "A>B|winter": r, "A>C|winter": null, "B>C|winter": r, "C>A|winter": { ...r, edgeIds: ["x", "z"] }, "C>B|winter": { ...r, seconds: 120 } };
    const c = compareSnapshots(before, after);
    expect(c.unchanged).toBe(1);
    expect(c.changes.map((x) => [x.key, x.kind])).toEqual([["A>C|winter", "LOST"], ["B>C|winter", "GAINED"], ["C>A|winter", "REROUTED"], ["C>B|winter", "RETIMED"]]);
    expect(renderRouteComparison(c)).toContain("1 unchanged, 1 lost, 1 gained, 1 rerouted, 1 retimed");
  });
});
