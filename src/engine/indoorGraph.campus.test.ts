import { describe, expect, it } from "vitest";
import type { IndoorEdge, IndoorEdgeKind, IndoorNetwork, IndoorNode } from "@/data/indoor/network";
import { edgeId } from "@/data/indoor/edgeId";
import { UW_INDOOR_NETWORK as NET } from "@/data/indoor/uw-indoor-network.generated";
import { haversineMeters } from "@/routing/EstimateRoutingProvider";
import { CAMPUS_RESEARCH, compileKnowledge, type Availability, type CampusOverlay, type EdgeFact } from "@/data/campus";
import { torontoDate } from "@/time/toronto";
import { anchorsOf, graphOver, nearestEntrances, openState, routeBetweenBuildings, routeBetweenNodes, searchTo, type RouteOptions } from "./indoorGraph";

/**
 * What the campus routing knowledge does to a search. A small made-up campus holds each rule on
 * its own; the real network then shows the research decisions taking effect.
 *
 *   o1 ─door─ A ─door─ o2a ─path─ o2b ─door─ B ─door─ o3        (floor 1)
 *   └────── walkway round A ──────┘   └────── walkway round B ──┘
 *             A/2 ════════ bridge ════════ B/2                     (floor 2, stairs down to each anchor)
 *
 * The door cases use the campus without its upper floor, so a door is the only way in or out.
 */

type Point = [number, number];
const LAT = 43.47;
const east = (lng: number, north = 0): Point => [LAT + north, -80.543 + lng];

interface Campus { net: IndoorNetwork; node: Record<string, number>; edge: Record<string, IndoorEdge> }

function campus(upstairs: boolean): Campus {
  const nodes: IndoorNode[] = [];
  const node: Record<string, number> = {};
  const add = (name: string, [lat, lng]: Point, building: string, floor: string) => {
    node[name] = nodes.length;
    nodes.push({ id: nodes.length, lat, lng, building, floor });
  };
  add("o1", east(0.0002), "OUT", "0");
  add("aW", east(0.0002), "A", "1");
  add("aAnchor", east(0.0005), "A", "1");
  add("aE", east(0.0008), "A", "1");
  add("o2a", east(0.0008), "OUT", "0");
  add("o2b", east(0.0009), "OUT", "0");
  add("bW", east(0.0009), "B", "1");
  add("bAnchor", east(0.0012), "B", "1");
  add("bE", east(0.0015), "B", "1");
  add("o3", east(0.0015), "OUT", "0");
  if (upstairs) {
    add("a2", east(0.0005), "A", "2");
    add("b2", east(0.0012), "B", "2");
  }

  const edges: IndoorEdge[] = [];
  const edge: Record<string, IndoorEdge> = {};
  const length = (path: Point[]) => path.slice(1).reduce((m, p, i) => m + haversineMeters({ latitude: path[i][0], longitude: path[i][1] }, { latitude: p[0], longitude: p[1] }), 0);
  const link = (name: string, kind: IndoorEdgeKind, a: string, b: string, via: Point[] = [], floors = 0) => {
    const pa: Point = [nodes[node[a]].lat, nodes[node[a]].lng];
    const pb: Point = [nodes[node[b]].lat, nodes[node[b]].lng];
    const path = kind === "DOOR" || kind === "STAIRS" ? [pa] : [pa, ...via, pb];
    const e: IndoorEdge = { a: node[a], b: node[b], kind, metres: path.length > 1 ? Math.round(length(path) * 10) / 10 : 0, floors, path };
    edge[name] = e;
    edges.push(e);
  };
  link("aWestDoor", "DOOR", "o1", "aW");
  link("aHallW", "HALLWAY", "aW", "aAnchor");
  link("aHallE", "HALLWAY", "aAnchor", "aE");
  link("aEastDoor", "DOOR", "aE", "o2a");
  link("between", "OUTDOOR", "o2a", "o2b");
  link("bWestDoor", "DOOR", "o2b", "bW");
  link("bHallW", "HALLWAY", "bW", "bAnchor");
  link("bHallE", "HALLWAY", "bAnchor", "bE");
  link("bEastDoor", "DOOR", "bE", "o3");
  link("aroundA", "OUTDOOR", "o1", "o2a", [east(0.0002, 0.0003), east(0.0008, 0.0003)]);
  link("aroundB", "OUTDOOR", "o2b", "o3", [east(0.0009, 0.0003), east(0.0015, 0.0003)]);
  if (upstairs) {
    link("aStairs", "STAIRS", "aAnchor", "a2", [], 1);
    link("bStairs", "STAIRS", "bAnchor", "b2", [], 1);
    link("bridge", "BRIDGE", "a2", "b2");
  }

  const anchors = [{ building: "A", floor: "1", node: node.aAnchor }, { building: "B", floor: "1", node: node.bAnchor }];
  if (upstairs) anchors.push({ building: "A", floor: "2", node: node.a2 }, { building: "B", floor: "2", node: node.b2 });
  return { net: { source: { name: "test", url: "", commit: "", licence: "" }, nodes, edges, anchors }, node, edge };
}

const FULL = campus(true);
const DOORS = campus(false);
const id = (name: string, c: Campus = FULL) => edgeId(c.net, c.edge[name]);

function fact(name: string, over: Partial<EdgeFact>, c: Campus = FULL): EdgeFact {
  const e = c.edge[name];
  return {
    ref: { edgeId: id(name, c), kind: e.kind, between: [c.net.nodes[e.a].building, c.net.nodes[e.b].building] },
    label: name, activation: "ACTIVE", evidence: "OFFICIAL", sourceIds: [], basis: "test", ...over,
  };
}

const knowing = (over: Partial<CampusOverlay>, c: Campus = FULL) =>
  graphOver(c.net, compileKnowledge(CAMPUS_RESEARCH, { reviewedAt: "", edges: [], historical: [], buildings: [], conflicts: [], fieldChecks: [], ...over }));

const route = (g: ReturnType<typeof graphOver>, from: string, to: string, opts: RouteOptions = {}, c: Campus = FULL) =>
  routeBetweenNodes([c.node[from]], [c.node[to]], opts, g);

describe("doors that only work one way", () => {
  it("a door with nothing known about it works both ways, as surveyed", () => {
    const g = graphOver(DOORS.net);
    expect(route(g, "o2b", "bAnchor", {}, DOORS)!.edgeIds).toContain(id("bWestDoor", DOORS));
    expect(route(g, "bAnchor", "o2b", {}, DOORS)!.edgeIds).toContain(id("bWestDoor", DOORS));
  });

  it("an entrance-only door is never used to leave: the route goes out another way", () => {
    const g = knowing({ edges: [fact("bWestDoor", { passage: { "B>OUT": "PROHIBITED" } }, DOORS)] }, DOORS);
    expect(route(g, "o2b", "bAnchor", {}, DOORS)!.edgeIds).toContain(id("bWestDoor", DOORS));
    const out = route(g, "bAnchor", "o2b", {}, DOORS)!;
    expect(out.edgeIds).not.toContain(id("bWestDoor", DOORS));
    expect(out.edgeIds).toContain(id("bEastDoor", DOORS));
  });

  it("an exit-only door is never used to enter, and still works as an exit", () => {
    const g = knowing({ edges: [fact("bWestDoor", { passage: { "OUT>B": "PROHIBITED" } }, DOORS)] }, DOORS);
    const inward = route(g, "o2b", "bAnchor", {}, DOORS)!;
    expect(inward.edgeIds).not.toContain(id("bWestDoor", DOORS));
    expect(inward.edgeIds).toContain(id("bEastDoor", DOORS));
    expect(route(g, "bAnchor", "o2b", {}, DOORS)!.edgeIds).toContain(id("bWestDoor", DOORS));
  });

  it("with every door of a building exit-only, the way in is the one that is allowed, never a locked door", () => {
    const exitOnly = [fact("bWestDoor", { passage: { "OUT>B": "PROHIBITED" } }), fact("bEastDoor", { passage: { "OUT>B": "PROHIBITED" } })];
    const inward = route(knowing({ edges: exitOnly }), "o2b", "bAnchor")!;
    expect(inward.edgeIds).not.toContain(id("bWestDoor"));
    expect(inward.edgeIds).not.toContain(id("bEastDoor"));
    expect(inward.buildings).toEqual(["A", "B"]); // in through A and over the bridge
    // Take the bridge away and there is simply no way in.
    expect(route(knowing({ edges: [...exitOnly, fact("bridge", { activation: "QUARANTINED" })] }), "o2b", "bAnchor")).toBeUndefined();
  });

  it("a restriction holds whatever its evidence; a door only an anecdote calls exit-only is still not an entrance", () => {
    const g = knowing({ edges: [fact("bWestDoor", { evidence: "ANECDOTAL", passage: { "OUT>B": "PROHIBITED" } }, DOORS)] }, DOORS);
    expect(route(g, "o2b", "bAnchor", {}, DOORS)!.edgeIds).not.toContain(id("bWestDoor", DOORS));
  });

  it("a closed entrance is ignored and the trip goes in by another door", () => {
    const g = graphOver(DOORS.net);
    const r = route(g, "o2b", "bAnchor", { closedEdgeIds: new Set([id("bWestDoor", DOORS)]) }, DOORS)!;
    expect(r.edgeIds).not.toContain(id("bWestDoor", DOORS));
    expect(r.edgeIds).toContain(id("bEastDoor", DOORS));
  });

  it("offers only doors that can be used the way the walk needs", () => {
    const g = knowing({ edges: [fact("bWestDoor", { passage: { "OUT>B": "PROHIBITED" } }, DOORS)] }, DOORS);
    const near = { latitude: DOORS.net.nodes[DOORS.node.bW].lat, longitude: DOORS.net.nodes[DOORS.node.bW].lng };
    expect(nearestEntrances(near, 1, g, { direction: "IN" })[0].edgeId).not.toBe(id("bWestDoor", DOORS));
    expect(nearestEntrances(near, 1, g, { direction: "OUT" })[0].edgeId).toBe(id("bWestDoor", DOORS));
    expect(nearestEntrances(near, 1, g)[0].edgeId).toBe(id("bWestDoor", DOORS));
  });
});

describe("step-free routing", () => {
  const stepFree: RouteOptions = { constraints: { access: { stepFree: true } } };

  it("refuses a change of floor whose kind is unknown rather than assuming a lift", () => {
    const g = graphOver(FULL.net);
    expect(route(g, "a2", "bAnchor")!.segments.some((s) => s.kind === "STAIRS" && s.floors !== 0)).toBe(true);
    expect(route(g, "a2", "bAnchor", stepFree)).toBeUndefined();
  });

  it("uses a documented step-free lift, but not on an anecdote unless experimental data is asked for", () => {
    const official = knowing({ edges: [fact("bStairs", { evidence: "CORROBORATED", access: { stepFree: true } })] });
    expect(route(official, "a2", "bAnchor", stepFree)!.edgeIds).toEqual([id("bridge"), id("bStairs")]);
    const anecdote = knowing({ edges: [fact("bStairs", { evidence: "ANECDOTAL", access: { stepFree: true } })] });
    expect(route(anecdote, "a2", "bAnchor", stepFree)).toBeUndefined();
    expect(route(anecdote, "a2", "bAnchor", { constraints: { access: { stepFree: true }, experimental: true } })).toBeDefined();
  });

  it("never takes a link known not to be step-free, even when it is the fastest", () => {
    const g = knowing({ edges: [fact("bridge", { evidence: "ANECDOTAL", access: { stepFree: false } }), fact("bStairs", { access: { stepFree: true } })] });
    expect(route(g, "a2", "b2")!.edgeIds).toEqual([id("bridge")]);
    expect(route(g, "a2", "b2", stepFree)?.edgeIds ?? []).not.toContain(id("bridge"));
  });

  it("charges an undocumented crossing when access matters, and nothing for a documented one", () => {
    const documented = knowing({ edges: [fact("bWestDoor", { access: { accessibleDesignation: true } }, DOORS)] }, DOORS);
    const unknown = graphOver(DOORS.net);
    const needs: RouteOptions = { constraints: { access: { stepFree: true }, unknownAccessSeconds: 60 } };
    const base = route(unknown, "o2b", "bAnchor", {}, DOORS)!;
    expect(route(documented, "o2b", "bAnchor", needs, DOORS)!.cost).toBeCloseTo(base.cost, 6);
    expect(route(unknown, "o2b", "bAnchor", needs, DOORS)!.cost).toBeCloseTo(base.cost + 60, 6);
  });
});

describe("what the evidence allows", () => {
  it("leaves an experimental link out of normal routing and uses it when asked", () => {
    const g = knowing({ edges: [fact("bridge", { activation: "EXPERIMENTAL", evidence: "ANECDOTAL" })] });
    expect(route(g, "a2", "b2")!.edgeIds).not.toContain(id("bridge"));
    expect(route(g, "a2", "b2", { constraints: { experimental: true } })!.edgeIds).toEqual([id("bridge")]);
  });

  it("never routes a quarantined link, even experimentally", () => {
    const g = knowing({ edges: [fact("bridge", { activation: "QUARANTINED", evidence: "UNRESOLVED" })] });
    expect(route(g, "a2", "b2", { constraints: { experimental: true } })!.edgeIds).not.toContain(id("bridge"));
  });

  it("never brings back a demolished link, whatever id a later survey gives it", () => {
    const g = knowing({ historical: [{ kind: "BRIDGE", between: ["B", "A"], removed: "2024", sourceIds: [], basis: "test" }] });
    expect(route(g, "a2", "b2", { constraints: { experimental: true } })!.edgeIds).not.toContain(id("bridge"));
  });

  it("charges each crossing by its evidence, and nothing for official ones", () => {
    const survey = graphOver(DOORS.net);
    const plain = route(survey, "o2b", "bAnchor", {}, DOORS)!;
    const uncertain = route(survey, "o2b", "bAnchor", { constraints: { uncertaintySeconds: { SURVEYED: 10 } } }, DOORS)!;
    expect(uncertain.cost - plain.cost).toBeCloseTo(10, 6);
    const official = knowing({ edges: [fact("bWestDoor", { evidence: "OFFICIAL" }, DOORS)] }, DOORS);
    expect(route(official, "o2b", "bAnchor", { constraints: { uncertaintySeconds: { SURVEYED: 10, OFFICIAL: 0 } } }, DOORS)!.cost).toBeCloseTo(plain.cost, 6);
  });
});

describe("opening hours", () => {
  const TUESDAY = "2026-09-15";
  const weekdays9to5: Availability = { kind: "SCHEDULE", windows: [{ days: [1, 2, 3, 4, 5], open: 9 * 60, close: 17 * 60 }] };
  const bHours = knowing({ buildings: [{ code: "B", availability: { value: weekdays9to5, evidence: "OFFICIAL", sourceIds: [], basis: "test" } }] }, DOORS);
  const at = (h: number, rest: RouteOptions["constraints"] = {}): RouteOptions => ({ outdoorPenalty: 1, constraints: { at: torontoDate(TUESDAY, h * 60), ...rest } });

  it("walks through a building while it is open and round it once it closes", () => {
    expect(route(bHours, "o2b", "o3", at(10), DOORS)!.buildings).toEqual(["B"]);
    expect(route(bHours, "o2b", "o3", at(18), DOORS)!.buildings).toEqual([]);
  });

  it("never lets a building's hours stop a trip that starts or ends in it", () => {
    expect(route(bHours, "o2b", "bAnchor", at(18), DOORS)).toBeUndefined();
    expect(route(bHours, "o2b", "bAnchor", at(18, { endpoints: ["B"] }), DOORS)).toBeDefined();
  });

  it("does not invent hours: unknown hours pass through by day, not at night, and are not checked at all without a time", () => {
    const g = graphOver(DOORS.net);
    expect(route(g, "o1", "o2a", at(12), DOORS)!.buildings).toEqual(["A"]);
    expect(route(g, "o1", "o2a", at(23), DOORS)!.buildings).toEqual([]);
    expect(route(g, "o1", "o2a", { outdoorPenalty: 1 }, DOORS)!.buildings).toEqual(["A"]);
  });

  it("reads a schedule across midnight and leaves unstated days unknown", () => {
    const late: Availability = { kind: "SCHEDULE", windows: [{ days: [2], open: 6 * 60, close: 24 * 60 + 30 }], unknownDays: [0] };
    expect(openState(late, { weekday: 2, minutes: 23 * 60 })).toBe("OPEN");
    expect(openState(late, { weekday: 3, minutes: 15 })).toBe("OPEN");
    expect(openState(late, { weekday: 3, minutes: 45 })).toBe("CLOSED");
    expect(openState(late, { weekday: 0, minutes: 12 * 60 })).toBe("UNKNOWN");
    expect(openState({ kind: "TEMPORARILY_CLOSED", reason: "test", until: "2026-09-10" }, { weekday: 2, minutes: 0, dateISO: "2026-09-15" })).toBe("UNKNOWN");
  });
});

describe("the research decisions on the real network", () => {
  const DWE_RCH_1501 = "da37b9775d7d3903";
  const TC_AL = "88c0db7685cb4592";
  const SLC_PAC = "c34ea719b8b9dee5";

  it("does not route through lecture room 1501 or the disputed TC–AL tunnel, which the survey alone would", () => {
    const survey = graphOver(NET);
    expect(routeBetweenBuildings("DWE", "RCH", {}, survey)!.edgeIds).toContain(DWE_RCH_1501);
    const dweRch = routeBetweenBuildings("DWE", "RCH")!;
    expect(dweRch.edgeIds).not.toContain(DWE_RCH_1501);
    expect(dweRch.buildings.at(-1)).toBe("RCH");
    expect(routeBetweenBuildings("AL", "TC")?.edgeIds ?? []).not.toContain(TC_AL);
  });

  it("reaches PAC only through SLC", () => {
    const r = routeBetweenBuildings("MC", "PAC")!;
    expect(r.edgeIds.at(-1)).toBe(SLC_PAC);
    expect(r.buildings.slice(-2)).toEqual(["SLC", "PAC"]);
  });

  it("keeps step-free trips off the EV1–HH tunnel and the E2–RCH link, and independent trips off the E3–E5 bridge", () => {
    const stepFree: RouteOptions = { constraints: { access: { stepFree: true } } };
    expect(routeBetweenBuildings("EV1", "HH", stepFree)?.edgeIds ?? []).not.toContain("fc8df53f6b2f3f8b");
    expect(routeBetweenBuildings("E2", "RCH", stepFree)?.edgeIds ?? []).not.toContain("ded1b09ccca59dc8");
    expect(routeBetweenBuildings("DC", "E5")!.edgeIds).toContain("6461ff856f562761");
    expect(routeBetweenBuildings("DC", "E5", { constraints: { access: { independent: true } } })?.edgeIds ?? []).not.toContain("6461ff856f562761");
  });

  it("is deterministic: the same question gives the same route", () => {
    const opts: RouteOptions = { constraints: { uncertaintySeconds: { SURVEYED: 10 }, at: torontoDate("2026-09-15", 12 * 60) } };
    const first = routeBetweenBuildings("V1", "EXP", opts);
    const second = routeBetweenBuildings("V1", "EXP", opts);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it("searching back from a destination agrees with searching forward to it", () => {
    const forward = routeBetweenBuildings("MC", "DC")!;
    const back = searchTo(anchorsOf("DC").map((n) => n.id));
    const best = Math.min(...anchorsOf("MC").map((n) => back.cost.get(n.id) ?? Infinity));
    expect(best).toBeCloseTo(forward.cost, 6);
  });
});
