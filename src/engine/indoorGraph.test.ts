import { describe, expect, it } from "vitest";
import { UW_INDOOR_NETWORK } from "@/data/indoor/uw-indoor-network.generated";
import { findBuilding } from "@/data/buildings";
import { haversineMeters } from "@/routing/EstimateRoutingProvider";
import { INDOOR_PACE, OUTDOOR_PENALTY, anchorsOf, indoorNetworkBuildings, isOnIndoorNetwork, nearestEntrances, routeBetweenBuildings, type IndoorGraphRoute } from "./indoorGraph";

/**
 * Real Waterloo pairs over the surveyed network. Expected paths are what the survey supports:
 * the DC–MC and DC–M3 overpasses are not in it (removed October 2024), so MC reaches DC by
 * the C2 tunnel and bridge, and M3 is reached only by walking outside.
 */

const minutes = (r: IndoorGraphRoute) => r.seconds / 60;
const route = (a: string, b: string) => {
  const r = routeBetweenBuildings(a, b);
  expect(r, `${a} → ${b}`).toBeDefined();
  return r!;
};

describe("the network as loaded", () => {
  it("has the surveyed buildings, all of them in UW Go's building registry with coordinates", () => {
    const codes = indoorNetworkBuildings();
    expect(codes.length).toBe(40);
    for (const c of ["MC", "DC", "QNC", "SLC", "PAC", "E5", "PSE", "LIB", "STC", "B2", "HH", "ML"]) expect(codes).toContain(c);
    for (const c of codes) {
      const b = findBuilding("UW", c);
      expect(b, c).toBeDefined();
      expect(b!.latitude, c).toBeTypeOf("number");
    }
    expect(isOnIndoorNetwork("UWP")).toBe(false);
    expect(isOnIndoorNetwork(undefined)).toBe(false);
  });

  it("every edge joins two nodes that exist, and every entry point is a node of its building", () => {
    const n = UW_INDOOR_NETWORK.nodes.length;
    for (const e of UW_INDOOR_NETWORK.edges) {
      expect(e.a).toBeLessThan(n);
      expect(e.b).toBeLessThan(n);
      expect(e.path.length).toBeGreaterThan(0);
      if (e.metres > 0) expect(e.path.length).toBeGreaterThan(1);
    }
    for (const a of UW_INDOOR_NETWORK.anchors) expect(UW_INDOOR_NETWORK.nodes[a.node].building).toBe(a.building);
    expect(anchorsOf("MC").map((x) => x.floor)).toEqual(["1", "2", "3", "4", "5", "6"]);
  });

  it("edge lengths agree with their geometry", () => {
    for (const e of UW_INDOOR_NETWORK.edges) {
      if (e.path.length < 2) continue;
      let m = 0;
      for (let i = 1; i < e.path.length; i++) m += haversineMeters({ latitude: e.path[i - 1][0], longitude: e.path[i - 1][1] }, { latitude: e.path[i][0], longitude: e.path[i][1] });
      expect(Math.abs(m - e.metres), `${e.kind} ${e.a}-${e.b}`).toBeLessThan(0.6);
    }
  });
});

describe("routes across campus", () => {
  it("MC → DC stays under cover through the C2 tunnel and bridge, not across the courtyard", () => {
    const r = route("MC", "DC");
    expect(r.buildings).toEqual(["MC", "C2", "DC"]);
    expect(r.outdoorMetres).toBe(0);
    expect(r.segments.map((s) => s.kind)).toContain("TUNNEL");
    expect(r.segments.map((s) => s.kind)).toContain("BRIDGE");
    expect(minutes(r)).toBeGreaterThan(2);
    expect(minutes(r)).toBeLessThan(6);
  });

  it("MC → QNC is the one overpass", () => {
    const r = route("MC", "QNC");
    expect(r.buildings).toEqual(["MC", "QNC"]);
    expect(r.outdoorMetres).toBe(0);
    expect(r.segments.filter((s) => s.kind === "BRIDGE")).toHaveLength(1);
  });

  it("MC → M3 has no indoor way: the survey has no bridge to M3, so the route crosses outside", () => {
    const r = route("MC", "M3");
    expect(r.buildings).toEqual(["MC", "M3"]);
    expect(r.outdoorMetres).toBeGreaterThan(50);
    expect(r.outdoorMetres).toBeLessThan(150);
  });

  it("DC → E5 and DC → PSE (E7) go by the E3 overpasses, all under cover", () => {
    expect(route("DC", "E5").buildings).toEqual(["DC", "E3", "E5"]);
    const r = route("DC", "PSE");
    expect(r.buildings).toEqual(["DC", "E3", "E5", "PSE"]);
    expect(r.outdoorMetres).toBe(0);
    expect(minutes(r)).toBeLessThan(9);
  });

  it("SLC and PAC reach MC and QNC by the SLC overpass", () => {
    expect(route("SLC", "MC").buildings).toEqual(["SLC", "MC"]);
    expect(route("PAC", "MC").buildings).toEqual(["PAC", "SLC", "MC"]);
    expect(route("PAC", "QNC").buildings).toEqual(["PAC", "SLC", "MC", "QNC"]);
    expect(route("PAC", "QNC").outdoorMetres).toBe(0);
  });

  it("a long way round with several bridges: E2 → QNC and DWE → MC", () => {
    const r = route("E2", "QNC");
    expect(r.buildings).toEqual(["E2", "PHY", "EIT", "ESC", "B1", "B2", "QNC"]);
    expect(r.outdoorMetres).toBe(0);
    expect(r.segments.filter((s) => s.kind === "BRIDGE").length).toBeGreaterThanOrEqual(2);
    const d = route("DWE", "MC");
    expect(d.buildings).toEqual(["DWE", "E2", "E3", "DC", "C2", "MC"]);
    expect(d.outdoorMetres).toBe(0);
  });

  it("QNC → STC is the short way through B2", () => {
    expect(route("QNC", "STC").buildings).toEqual(["QNC", "B2", "STC"]);
  });

  it("the Arts tunnels: EV1 → SCH through AL", () => {
    const r = route("EV1", "SCH");
    expect(r.buildings).toEqual(["EV1", "AL", "SCH"]);
    expect(r.outdoorMetres).toBe(0);
    expect(r.segments.filter((s) => s.kind === "TUNNEL").length).toBeGreaterThanOrEqual(2);
  });

  it("two buildings with no indoor connection give nothing, never an invented link", () => {
    expect(routeBetweenBuildings("MC", "UWP")).toBeUndefined();
    expect(routeBetweenBuildings("MC", "NOPE")).toBeUndefined();
  });

  it("every route is the same in reverse: same buildings, same distance, same time", () => {
    for (const [a, b] of [["MC", "DC"], ["MC", "M3"], ["DC", "PSE"], ["E2", "QNC"], ["PAC", "QNC"], ["MC", "HH"], ["DC", "LIB"]]) {
      const f = route(a, b);
      const r = route(b, a);
      expect(r.buildings).toEqual([...f.buildings].reverse());
      expect(r.metres).toBeCloseTo(f.metres, 5);
      expect(r.seconds).toBeCloseTo(f.seconds, 5);
    }
  });

  it("a route's segments chain: each starts where the last ended, and the line is continuous", () => {
    for (const [a, b] of [["MC", "DC"], ["E2", "QNC"], ["MC", "HH"], ["MC", "M3"]]) {
      const r = route(a, b);
      for (let i = 1; i < r.segments.length; i++) {
        expect(r.segments[i].from.id).toBe(r.segments[i - 1].to.id);
        const prev = r.segments[i - 1].path[r.segments[i - 1].path.length - 1];
        const next = r.segments[i].path[0];
        expect(next).toEqual(prev);
      }
      expect(r.segments[0].from.building).toBe(a);
      expect(r.segments[r.segments.length - 1].to.building).toBe(b);
    }
  });

  it("times are sensible: indoor pace, plus stairs", () => {
    const r = route("MC", "DC");
    const walking = r.segments.filter((s) => s.metres > 0).reduce((n, s) => n + s.metres, 0) / INDOOR_PACE.indoorMetresPerSecond;
    const stairs = r.segments.filter((s) => s.kind === "STAIRS").reduce((n, s) => n + Math.abs(s.floors) * INDOOR_PACE.secondsPerFloor, 0);
    const doors = r.segments.filter((s) => s.kind === "DOOR").length * INDOOR_PACE.secondsPerDoor;
    expect(r.seconds).toBeCloseTo(walking + stairs + doors, 5);
    expect(stairs).toBeGreaterThan(0); // basement tunnel up to a third-floor bridge
  });
});

describe("how much the outdoors is avoided", () => {
  it("the penalty is what makes MC → DC take the tunnel: with none, it crosses the courtyard", () => {
    const plain = routeBetweenBuildings("MC", "DC", { outdoorPenalty: 1 })!;
    expect(plain.buildings).toEqual(["MC", "DC"]);
    expect(plain.outdoorMetres).toBeGreaterThan(100);
    expect(routeBetweenBuildings("MC", "DC")!.outdoorMetres).toBe(0);
  });

  it("but it does not chase every last second outside: MC → HH takes the short walkway rather than a 15-minute detour", () => {
    const chosen = routeBetweenBuildings("MC", "HH")!;
    expect(chosen.outdoorMetres).toBeLessThan(120);
    expect(minutes(chosen)).toBeLessThan(12);
    const atAllCosts = routeBetweenBuildings("MC", "HH", { outdoorPenalty: 1000 })!;
    expect(atAllCosts.outdoorMetres).toBeLessThan(chosen.outdoorMetres);
    expect(minutes(atAllCosts)).toBeGreaterThan(minutes(chosen) + 3);
    expect(OUTDOOR_PENALTY).toBe(4);
  });
});

describe("joining a place off the network", () => {
  it("finds the nearest doors from outside, nearest first", () => {
    const uwp = findBuilding("UW", "UWP")!;
    const doors = nearestEntrances({ latitude: uwp.latitude!, longitude: uwp.longitude! }, 3);
    expect(doors).toHaveLength(3);
    expect(doors[0].metres).toBeLessThanOrEqual(doors[1].metres);
    expect(doors[1].metres).toBeLessThanOrEqual(doors[2].metres);
    for (const d of doors) {
      expect(d.node.building).toBe(d.building);
      expect(d.node.building).not.toBe("OUT");
    }
  });
});
