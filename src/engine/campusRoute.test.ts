import { describe, expect, it, vi } from "vitest";
import { decode, encode } from "@googlemaps/polyline-codec";
import type { CampusLocation, LatLng, RouteOption } from "@/domain/types";
import { DEFAULT_PLANNER_CONFIG as CFG } from "@/domain/config";
import { haversineMeters } from "@/routing/EstimateRoutingProvider";
import { CachedRoutingProvider } from "@/routing/CachedRoutingProvider";
import type { RoutingProvider } from "@/routing/RoutingProvider";
import { findBuilding } from "@/data/buildings";
import { UW_INDOOR_NETWORK as NET } from "@/data/indoor/uw-indoor-network.generated";
import { edgeById, edgeId } from "@/data/indoor/edgeId";
import { isVertical } from "@/data/indoor/network";
import { CAMPUS_KNOWLEDGE, claimsUsable } from "@/data/campus";
import { torontoDate } from "@/time/toronto";
import { CAMPUS_LOOKUPS, campusWalk, explainCampusDecision, type CampusWalkRequest } from "./campusRoute";
import { campusGraph, graphOver, refusalFor } from "./indoorGraph";
import { networkBuildingLocation, type ConnectorFetcher } from "./indoorRoute";
import { livePosition } from "./selectRoute";

/**
 * The campus-aware fastest walk against the real network and research, with Google stood in for by
 * walks shaped like its own: a line between the two points and a time from the distance.
 */

const NOON = torontoDate("2026-09-15", 12 * 60);
const loc = (code: string) => networkBuildingLocation(code)!;
const MC = loc("MC");
const PAC = loc("PAC");
const DC = loc("DC");
const QNC = loc("QNC");
const uwp = findBuilding("UW", "UWP")!;
const HOME: CampusLocation = { id: "home", name: "UW Place", latitude: uwp.latitude!, longitude: uwp.longitude!, kind: "HOME", university: "UW", buildingCode: "UWP" };

const SLC_PAC = "c34ea719b8b9dee5";
const SLC_EAST = "5ba0e3d2964bf706";
const SLC_NORTH = "b97df0c640324bea";
const SLC_WEST = "07284470cb96f524";
const DC_WEST = "df658713a18c09af";
const MC_QNC_BRIDGE = "ff30b07ec3446542";

const key = (a: LatLng, b: LatLng) => `${a.latitude.toFixed(5)},${a.longitude.toFixed(5)}->${b.latitude.toFixed(5)},${b.longitude.toFixed(5)}`;

/** Google-shaped walks: a line, and seconds from the distance with a normal detour at a normal pace, unless a pair is given its own time. */
function google(times: Record<string, number> = {}, over: Partial<RouteOption> = {}) {
  return {
    walk: vi.fn(async (from: LatLng, to: LatLng): Promise<RouteOption | undefined> => {
      const metres = haversineMeters(from, to) * 1.3;
      const seconds = times[key(from, to)] ?? metres / 1.33;
      return {
        mode: "WALK", durationMinutes: Math.max(1, Math.ceil(seconds / 60)), durationSeconds: Math.round(seconds), distanceMeters: Math.round(metres),
        polyline: encode([[from.latitude, from.longitude], [to.latitude, to.longitude]]), provider: "google-routes", computedAt: "", isEstimate: false, ...over,
      };
    }),
  };
}

async function walk(from: CampusLocation, to: CampusLocation, f: ConnectorFetcher = google(), extra: Partial<CampusWalkRequest> = {}) {
  const baseline = await f.walk(from, to);
  return campusWalk({ from, to, at: NOON, ...extra }, baseline, f, CFG, NOON);
}

/** A point outdoors, `north` metres north and `east` metres east of a surveyed door, with an id of its own so two of them are two places. */
function nearDoor(doorEdgeId: string, north: number, east: number): CampusLocation {
  const e = edgeById(NET, doorEdgeId)!;
  const inside = NET.nodes[e.a].building === "OUT" ? NET.nodes[e.b] : NET.nodes[e.a];
  const at = livePosition({ latitude: inside.lat + north / 111_320, longitude: inside.lng + east / (111_320 * Math.cos((inside.lat * Math.PI) / 180)) });
  return { ...at, id: `${doorEdgeId}+${north}+${east}`, name: `${north} m north, ${east} m east of ${doorEdgeId}` };
}
const westOf = (doorEdgeId: string, metres: number) => nearDoor(doorEdgeId, 0, -metres);

const near = ([lat, lng]: number[], p: LatLng, metres = 2) => haversineMeters({ latitude: lat, longitude: lng }, p) < metres;
const doorPoints = NET.edges.filter((e) => e.kind === "DOOR").flatMap((e) => [NET.nodes[e.a], NET.nodes[e.b]]).filter((n) => n.building !== "OUT");
const isDoorPoint = (p: LatLng) => doorPoints.some((n) => n.lat === p.latitude && n.lng === p.longitude);

/** Google's time that leaves a candidate exactly at the margin it has to save, given the margin's share of Google's time. */
const googleAtMargin = (totalSeconds: number, buildingsThrough: number) => {
  const m = CFG.campusShortcutMargin;
  return (totalSeconds + m.baseSeconds + m.perBuildingSeconds * buildingsThrough) / (1 - m.shareOfGoogle);
};

describe("going to PAC", () => {
  it("rejects Google's walk to PAC's map point, which ends at its exit-only corner doors, and goes in through SLC", async () => {
    const r = (await walk(MC, PAC))!;
    expect(r.decision.outcome).toBe("CORRECTED");
    expect(r.decision.googleUsable).toBe(false);
    expect(r.decision.rejected[0].label).toBe("Google's walk to PAC");
    expect(r.decision.rejected[0].because).toMatch(/exit-only/);
    expect(r.decision.rejected[0].sourceIds).toEqual(["B_PAC", "PACFIT"]);
    const route = r.route!;
    expect(route.provider).toBe("uw-campus");
    // Whatever way it takes, the last thing it crosses is the SLC–PAC link at the front desk.
    expect(route.indoorEdgeIds!.at(-1)).toBe(SLC_PAC);
    expect(route.campus!.via).toContain("SLC–PAC link at the PAC front desk");
    expect(route.campus!.via).toContain("through SLC");
    expect(r.decision.summary).toMatch(/exit-only\. This way goes in through the /);
    const line = decode(route.polyline!);
    expect(near(line[0], MC)).toBe(true);
    expect(near(line[line.length - 1], PAC)).toBe(true);
  });

  it("from every side of campus, and from a residence, ends at the front desk and never arrives by PAC's own doors", async () => {
    for (const from of [DC, QNC, loc("STC"), loc("EXP"), loc("V1"), loc("E2"), HOME]) {
      const r = (await walk(from, PAC))!;
      expect(r.decision.outcome, from.name).toBe("CORRECTED");
      const route = r.route!;
      expect(route.indoorEdgeIds!.at(-1), from.name).toBe(SLC_PAC);
      expect(route.campus!.via, from.name).toContain("through SLC");
      // Google prices the way to the door only from the trip's own start.
      for (const step of route.steps ?? []) expect(step.instruction, from.name).not.toMatch(/^Walk from the/);
    }
  });

  it("leaves PAC through those same doors without complaint: going out of them is what they are for", async () => {
    const r = await walk(PAC, MC);
    expect(r?.decision.googleUsable ?? true).toBe(true);
    expect(r?.decision.outcome).not.toBe("CORRECTED");
    expect((r?.decision.rejected ?? []).some((x) => /exit-only/.test(x.because))).toBe(false);
  });

  it("from home, prices walks only to entrances that lead to PAC, a few of them, and still ends at the front desk", async () => {
    const f = google();
    const r = (await walk(HOME, PAC, f))!;
    expect(r.decision.outcome).toBe("CORRECTED");
    expect(r.route!.indoorEdgeIds!.at(-1)).toBe(SLC_PAC);
    const asked = f.walk.mock.calls.map(([, to]) => to);
    expect(asked[0]).toBe(PAC); // Google's own walk, which the caller priced
    // A few entrances: never an unbounded search, and no walk from PAC's map point, which may not be arrived at.
    expect(asked.length - 1).toBeLessThanOrEqual(CAMPUS_LOOKUPS.calls + CAMPUS_LOOKUPS.highValueCalls);
    for (const to of asked.slice(1)) expect(isDoorPoint(to)).toBe(true);
    expect(r.route!.steps![0].instruction).toMatch(/^Walk to the /);
  });

  it("with the SLC east doors reported closed, goes in by another SLC door and says the east doors could not be used", async () => {
    const r = (await walk(MC, PAC, google(), { closedEdgeIds: new Set([SLC_EAST]) }))!;
    expect(r.decision.outcome).toBe("CORRECTED");
    expect(r.route!.indoorEdgeIds).not.toContain(SLC_EAST);
    expect(r.route!.indoorEdgeIds!.at(-1)).toBe(SLC_PAC);
    expect(r.decision.rejected).toContainEqual({ label: "SLC east doors (toward MC)", because: "reported closed", sourceIds: ["PACFIT"] });
  });

  it("with the SLC–PAC link closed there is no allowed way in: keeps Google's walk and tells the student how to get in", async () => {
    const r = (await walk(MC, PAC, google(), { closedEdgeIds: new Set([SLC_PAC]) }))!;
    expect(r.decision.outcome).toBe("NO_USABLE_ROUTE");
    expect(r.route).toBeUndefined();
    expect(r.decision.warnings[0]).toMatch(/Student Life Centre/);
    expect(r.decision.rejected.some((x) => x.label === "SLC–PAC link at the PAC front desk" && x.because === "reported closed")).toBe(true);
  });

  it("explains itself in plain text", async () => {
    const text = explainCampusDecision((await walk(MC, PAC))!.decision);
    expect(text).toMatch(/^Selected:/);
    expect(text).toMatch(/Rejected:\n {2}Google's walk to PAC\nbecause: PAC's outside corner doors are exit-only/);
  });

  it("is the same answer every time", async () => {
    const a = (await walk(HOME, PAC))!;
    const b = (await walk(HOME, PAC))!;
    expect(JSON.stringify(b.decision)).toBe(JSON.stringify(a.decision));
    expect(b.route!.polyline).toBe(a.route!.polyline);
  });
});

describe("floor to floor", () => {
  it("charges Google's walk the way from the floor to the door it starts from, and a campus route its own stairs", async () => {
    const decision = async (floor?: string) => (await walk(floor ? { ...MC, floor } : MC, PAC))!.decision;
    const third = await decision("3");
    const sixth = await decision("6");
    const any = await decision();
    // MC's north-west doors are on floor 2: three flights down from the sixth floor cost more than one from the third.
    expect(third.inside.originDoor).toMatch(/^MC /);
    expect(sixth.inside.originSeconds).toBeGreaterThan(third.inside.originSeconds);
    expect(sixth.chosen!.totalSeconds).toBeGreaterThan(third.chosen!.totalSeconds);
    // With no floor known the route starts on whichever floor is most convenient, never a worse one.
    expect(any.chosen!.totalSeconds).toBeLessThanOrEqual(third.chosen!.totalSeconds);
    // The way in to PAC has no surveyed door of its own to charge for.
    expect(third.inside.destinationSeconds).toBe(0);
  });

  it("names the doors Google's walk is taken to use, at both ends", async () => {
    const d = (await walk(MC, DC, google({ [key(MC, DC)]: 60 })))!.decision;
    expect(d.inside.originDoor).toMatch(/^MC /);
    expect(d.inside.destinationDoor).toBe("DC west doors (toward MC)");
    expect(d.inside.originSeconds).toBeGreaterThan(0);
    expect(d.inside.destinationSeconds).toBeGreaterThan(0);
  });
});

describe("a better door, a bridge, and walking through a building", () => {
  it("takes a nearer door of the destination when it beats Google's walk to the building's map point", async () => {
    const outside = westOf(DC_WEST, 25);
    const f = google({ [key(outside, DC)]: 240 });
    const r = (await walk(outside, DC, f))!;
    expect(r.decision.outcome).toBe("BETTER_ENTRANCE");
    expect(r.route!.indoorEdgeIds![0]).toBe(DC_WEST);
    expect(r.decision.googleSeconds! + r.decision.inside.destinationSeconds - r.decision.chosen!.totalSeconds).toBeGreaterThanOrEqual(r.decision.marginSeconds);
  });

  it("takes the bridge between two adjacent buildings when walking outside is slower", async () => {
    const r = (await walk(MC, QNC))!;
    expect(r.decision.outcome).toBe("SHORTCUT");
    expect(r.decision.summary).toMatch(/^By the MC–QNC bridge: .* quicker than walking outside\.$/);
    expect(r.route!.indoorEdgeIds).toContain(MC_QNC_BRIDGE);
    expect(r.route!.indoorShare).toBe(1);
  });

  it("leaves a building by the door that suits the trip, not the one at its map point", async () => {
    const r = (await walk(MC, loc("M3")))!;
    expect(r.decision.outcome).toBe("BETTER_ENTRANCE");
    expect(r.decision.summary).toMatch(/^By the MC north doors: /);
    expect(r.route!.steps!.at(-1)!.instruction).toMatch(/^Walk from the MC north doors to /);
    expect(r.route!.campus!.via.slice(0, 3)).toEqual(["through MC", "MC north doors", "outside"]);
  });

  it("walks through a building between two points outside it when Google walks round: priced to a door, through, and on from another", async () => {
    const north = nearDoor(SLC_NORTH, 30, 0);
    const west = nearDoor(SLC_WEST, 0, -30);
    const f = google({ [key(north, west)]: 600 });
    const r = (await walk(north, west, f))!;
    expect(r.decision.outcome).toBe("SHORTCUT");
    expect(r.decision.summary).toMatch(/^Through SLC: /);
    const steps = r.route!.steps!;
    expect(steps[0].instruction).toBe("Walk to the SLC north doors");
    expect(steps.at(-1)!.instruction).toMatch(/^Walk from the SLC west doors to /);
    expect(r.route!.indoorEdgeIds![0]).toBe(SLC_NORTH);
    expect(r.route!.indoorEdgeIds!.at(-1)).toBe(SLC_WEST);
    // Two Google-priced legs, and the survey in between: the line runs from the start, in at one door and out at the other.
    const line = decode(r.route!.polyline!);
    expect(near(line[0], north)).toBe(true);
    expect(near(line[line.length - 1], west)).toBe(true);
  });

  it("asks a way through a building to save more than a nearer door does, and takes it only from that margin", async () => {
    // With no line to read a door walk off, each door walk is priced on its own, so only Google's time moves the saving.
    const lineless = (times: Record<string, number>) => google(times, { polyline: undefined });
    const north = nearDoor(SLC_NORTH, 30, 0);
    const west = nearDoor(SLC_WEST, 0, -30);
    const through = (await walk(north, west, lineless({ [key(north, west)]: 600 })))!.decision.chosen!;
    const margin = googleAtMargin(through.totalSeconds, 1);
    const under = (await walk(north, west, lineless({ [key(north, west)]: margin - 2 })))!.decision;
    expect(under.outcome).toBe("KEPT_GOOGLE");
    expect(under.rejected.some((x) => /saves only .*, under the .* it has to save/.test(x.because))).toBe(true);
    const over = (await walk(north, west, lineless({ [key(north, west)]: margin + 2 })))!.decision;
    expect(over.outcome).toBe("SHORTCUT");
    expect(over.marginSeconds).toBeGreaterThan(CFG.campusShortcutMargin.baseSeconds + CFG.campusShortcutMargin.perBuildingSeconds);

    const outside = westOf(DC_WEST, 25);
    const door = (await walk(outside, DC, lineless({ [key(outside, DC)]: 240 })))!.decision;
    const need = googleAtMargin(door.chosen!.totalSeconds - door.inside.destinationSeconds, 0);
    const doorUnder = (await walk(outside, DC, lineless({ [key(outside, DC)]: need - 2 })))!.decision;
    expect(doorUnder.outcome).toBe("KEPT_GOOGLE");
    const doorOver = (await walk(outside, DC, lineless({ [key(outside, DC)]: need + 2 })))!.decision;
    expect(doorOver.outcome).toBe("BETTER_ENTRANCE");
    expect(doorOver.marginSeconds).toBeLessThan(over.marginSeconds);
  });

  it("leaves Google's walk alone when the campus has nothing better, pricing only a few doors and none it could not use", async () => {
    const f = google({ [key(HOME, DC)]: 200 });
    const r = (await walk(HOME, DC, f))!;
    expect(r.decision.outcome).toBe("KEPT_GOOGLE");
    expect(r.route).toBeUndefined();
    expect(f.walk.mock.calls.length).toBeLessThanOrEqual(1 + CAMPUS_LOOKUPS.calls + CAMPUS_LOOKUPS.highValueCalls);
    const g = campusGraph();
    for (const [, to] of f.walk.mock.calls.slice(1)) {
      const door = g.exteriorDoors.find((d) => g.net.nodes[d.inside].lat === to.latitude && g.net.nodes[d.inside].lng === to.longitude)!;
      expect(refusalFor(g, g.adj[door.outside].find((a) => a.index === door.index)!, { constraints: { at: NOON, endpoints: ["DC"] } }, NOON.getTime())).toBeUndefined();
    }
  });
});

describe("closures, access and what may not be used", () => {
  it("replaces a Google walk that runs along a closed path with a campus way round it", async () => {
    const outdoor = NET.edges.find((e) => e.kind === "OUTDOOR" && e.path.length >= 2)!;
    const closedWalk: RouteOption = { mode: "WALK", durationMinutes: 3, durationSeconds: 180, distanceMeters: 220, polyline: encode(outdoor.path), provider: "google-routes", computedAt: "", isEstimate: false };
    const r = (await campusWalk({ from: MC, to: DC, at: NOON, closedEdgeIds: new Set([edgeId(NET, outdoor)]) }, closedWalk, google(), CFG, NOON))!;
    expect(r.decision.googleUsable).toBe(false);
    expect(r.decision.outcome).toBe("CORRECTED");
    expect(r.route!.indoorEdgeIds).not.toContain(edgeId(NET, outdoor));
  });

  it("a door reported closed at the end of Google's walk makes that walk unusable, and the way in is by another door", async () => {
    const r = (await walk(MC, DC, google({ [key(MC, DC)]: 60 }), { closedEdgeIds: new Set([DC_WEST]) }))!;
    expect(r.decision.googleUsable).toBe(false);
    expect(r.decision.rejected[0]).toMatchObject({ label: "Google's walk to DC", because: expect.stringMatching(/arrives by the DC west doors \(toward MC\), reported closed/) });
    expect(r.decision.outcome).toBe("CORRECTED");
    expect(r.decision.summary).toMatch(/^The DC west doors \(toward MC\) are reported closed\./);
    expect(r.route!.indoorEdgeIds).not.toContain(DC_WEST);
    expect(r.decision.activatedBy.some((p) => p.subject === "closures")).toBe(true);
  });

  it("a step-free trip to PAC never changes floor by stairs, or by an elevator or ramp nobody has confirmed step-free", async () => {
    const r = (await walk(MC, PAC, google(), { access: { stepFree: true } }))!;
    for (const id of r.route?.indoorEdgeIds ?? []) {
      const e = edgeById(NET, id)!;
      const fact = CAMPUS_KNOWLEDGE.edgeFacts.get(id);
      const confirmed = fact?.access?.stepFree === true && claimsUsable(fact.evidence, false);
      expect(isVertical(e.kind) && e.floors !== 0 && !confirmed, id).toBe(false);
    }
  });

  it("never uses the quarantined room-1501 passage, whatever the outcome", async () => {
    const r = await walk(loc("DWE"), loc("RCH"), google({ [key(loc("DWE"), loc("RCH"))]: 900 }));
    expect(r?.route?.indoorEdgeIds ?? []).not.toContain("da37b9775d7d3903");
    for (const alt of r?.decision.alternatives ?? []) expect(alt.edgeIds).not.toContain("da37b9775d7d3903");
  });

  it("never builds on a straight-line estimate, and makes no claim of saving time against one", async () => {
    const toPac = google({}, { isEstimate: true, polyline: undefined });
    const pac = (await walk(HOME, PAC, toPac))!;
    expect(pac.decision.outcome).toBe("NO_USABLE_ROUTE");
    expect(pac.route).toBeUndefined();
    const toDc = google({}, { isEstimate: true, polyline: undefined });
    const dc = (await walk(HOME, DC, toDc))!;
    expect(dc.decision.outcome).toBe("KEPT_GOOGLE");
    expect(toDc.walk).toHaveBeenCalledTimes(1); // Google's own walk: against an estimate, no door is worth pricing
  });
});

describe("the line on the map is the route that was chosen", () => {
  it("passes through every door and link the decision names, in order, from the start to the end", async () => {
    for (const [from, to] of [[MC, PAC], [MC, QNC], [HOME, PAC], [nearDoor(SLC_NORTH, 30, 0), nearDoor(SLC_WEST, 0, -30)]] as const) {
      const f = google({ [key(from, to)]: 600 });
      const r = (await walk(from, to, f))!;
      if (!r.route) continue;
      const line = decode(r.route.polyline!);
      expect(near(line[0], from), `${from.name} start`).toBe(true);
      expect(near(line[line.length - 1], to), `${to.name} end`).toBe(true);
      let at = 0;
      for (const id of r.route.indoorEdgeIds!) {
        const e = edgeById(NET, id)!;
        if (e.kind !== "DOOR" && e.kind !== "OPEN" && e.kind !== "BRIDGE" && e.kind !== "TUNNEL") continue;
        const point = e.path[0];
        const found = line.findIndex((p, i) => i >= at && near(p, { latitude: point[0], longitude: point[1] }, 1));
        expect(found, `${from.name} → ${to.name}: ${id} on the line after point ${at}`).toBeGreaterThanOrEqual(at);
        at = found;
      }
    }
  });
});

describe("falling back to Google's walk", () => {
  it("has nothing to say for the same building or with no Google walk, and only Google's walk for two places off the network", async () => {
    const lh = findBuilding("WLU", "LH")!;
    const laurier: CampusLocation = { id: "WLU:LH", name: lh.name, university: "WLU", latitude: lh.latitude!, longitude: lh.longitude!, kind: "BUILDING", buildingCode: "LH" };
    const f = google();
    const r = (await walk(HOME, laurier, f))!;
    expect(r.decision.outcome).toBe("KEPT_GOOGLE");
    expect(r.decision.alternatives).toEqual([]);
    expect(f.walk).toHaveBeenCalledTimes(1); // no building lies on the way, so no door walk is worth pricing
    expect(await walk(MC, MC)).toBeUndefined();
    expect(await campusWalk({ from: MC, to: PAC, at: NOON }, undefined, google(), CFG, NOON)).toBeUndefined();
    const noData = graphOver({ ...NET, anchors: [] });
    const g = google();
    expect((await campusWalk({ from: MC, to: PAC, at: NOON }, await g.walk(MC, PAC), g, CFG, NOON, noData))!.decision.outcome).toBe("KEPT_GOOGLE");
  });

  it("keeps Google's walk and warns when the only walks to an allowed entrance cannot be priced", async () => {
    // No line to read a door walk off either: every way in needs a walk of its own, and none comes back.
    const f = { walk: vi.fn(async (from: LatLng, to: LatLng) => (to === PAC ? { ...(await google().walk(from, to))!, polyline: undefined } : undefined)) };
    const r = (await walk(HOME, PAC, f))!;
    expect(r.decision.outcome).toBe("NO_USABLE_ROUTE");
    expect(r.decision.warnings).toHaveLength(1);
  });

  it("reads the walk to a door off Google's own line when the line passes it, with no walk of its own", async () => {
    const f = { walk: vi.fn(async (from: LatLng, to: LatLng) => (to === PAC ? google().walk(from, to) : undefined)) };
    const r = (await walk(HOME, PAC, f))!;
    expect(r.decision.outcome).toBe("CORRECTED");
    expect(r.decision.chosen!.timing[0]).toBe("GOOGLE");
    // The way to the door is Google's own line as far as the door.
    const baseline = decode((await f.walk(HOME, PAC))!.polyline!);
    expect(decode(r.route!.polyline!)[0]).toEqual(baseline[0]);
  });

  it("asks Google for each door walk once: a cached provider serves a repeat trip without a call", async () => {
    let calls = 0;
    const inner: RoutingProvider = {
      id: "google-routes",
      async getWalkingRoute(from, to) { calls++; return google().walk(from, to); },
      async getTransitRoute() { return undefined; },
    };
    const cached = new CachedRoutingProvider(inner);
    const f = { walk: (a: LatLng, b: LatLng) => cached.getWalkingRoute(a, b) };
    await walk(HOME, PAC, f);
    const first = calls;
    expect(first).toBeGreaterThan(1);
    await walk(HOME, PAC, f);
    expect(calls).toBe(first);
  });

  it("does not ask Google for door walks that could not save the margin", async () => {
    const f = google({ [key(loc("EV1"), loc("STC"))]: 60 });
    const r = (await walk(loc("EV1"), loc("STC"), f))!;
    // Against a one-minute walk nothing through a building or by another door can win, so nothing is priced.
    expect(r.decision.outcome).toBe("KEPT_GOOGLE");
    expect(f.walk).toHaveBeenCalledTimes(1);
  });
});
