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
import { torontoDate } from "@/time/toronto";
import { campusWalk, explainCampusDecision, type CampusWalkRequest } from "./campusRoute";
import { graphOver } from "./indoorGraph";
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
const uwp = findBuilding("UW", "UWP")!;
const HOME: CampusLocation = { id: "home", name: "UW Place", latitude: uwp.latitude!, longitude: uwp.longitude!, kind: "HOME", university: "UW", buildingCode: "UWP" };

const SLC_PAC = "c34ea719b8b9dee5";
const SLC_EAST = "5ba0e3d2964bf706";
const DC_WEST = "df658713a18c09af";
const SLC_DOORS = ["5ba0e3d2964bf706", "b97df0c640324bea", "07284470cb96f524", "dc942af2f1e25066"];

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

/** A point `metres` west of a surveyed door, outdoors. */
function westOf(doorEdgeId: string, metres: number): CampusLocation {
  const e = edgeById(NET, doorEdgeId)!;
  const inside = NET.nodes[e.a].building === "OUT" ? NET.nodes[e.b] : NET.nodes[e.a];
  return livePosition({ latitude: inside.lat, longitude: inside.lng - metres / (111_320 * Math.cos((inside.lat * Math.PI) / 180)) });
}

const near = ([lat, lng]: number[], p: LatLng) => haversineMeters({ latitude: lat, longitude: lng }, p) < 2;

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
    expect(route.campus!.via.some((v) => v.includes("SLC"))).toBe(true);
    expect(r.decision.summary).toMatch(/exit-only\. This way goes in through the /);
    const line = decode(route.polyline!);
    expect(near(line[0], MC)).toBe(true);
    expect(near(line[line.length - 1], PAC)).toBe(true);
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
    // Two joins at most, the winter route's own, and a few entrances: never an unbounded search.
    expect(asked.length - 1).toBeLessThanOrEqual(2 + 3);
    const doorPoints = NET.edges.filter((e) => e.kind === "DOOR").flatMap((e) => [NET.nodes[e.a], NET.nodes[e.b]]).filter((n) => n.building !== "OUT");
    for (const to of asked.slice(1)) expect(doorPoints.some((n) => n.lat === to.latitude && n.lng === to.longitude)).toBe(true);
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

describe("where in the building a trip starts", () => {
  it("starts the campus network on the trip's floor when the location knows it, and on any floor when it does not", async () => {
    const through = (d: NonNullable<Awaited<ReturnType<typeof walk>>>["decision"]) =>
      [d.chosen, ...d.alternatives].filter((c) => c && c.via[0] === "through MC").map((c) => c!.seconds);
    const top = (await walk({ ...MC, floor: "6" }, PAC))!.decision;
    const ground = (await walk({ ...MC, floor: "1" }, PAC))!.decision;
    const anywhere = (await walk(MC, PAC))!.decision;
    expect(through(top).length).toBeGreaterThan(0);
    // Five flights down from the sixth floor cost time that starting on the ground floor does not.
    expect(Math.min(...through(top))).toBeGreaterThan(Math.min(...through(ground)));
    expect(Math.min(...through(anywhere))).toBeLessThanOrEqual(Math.min(...through(ground)));
  });
});

describe("a better door, and walking through a building", () => {
  it("takes a nearer door of the destination when it beats Google's walk to the building's map point", async () => {
    const outside = westOf(DC_WEST, 25);
    const f = google({ [key(outside, DC)]: 240 });
    const r = (await walk(outside, DC, f))!;
    expect(r.decision.outcome).toBe("BETTER_ENTRANCE");
    expect(r.route!.indoorEdgeIds![0]).toBe(DC_WEST);
    expect(r.route!.durationSeconds!).toBeLessThan(240 - CFG.campusShortcutMinBenefitSeconds);
  });

  it("walks through SLC when that saves a real amount of time over walking round", async () => {
    const outside = westOf("07284470cb96f524", 25);
    const r = (await walk(outside, MC, google({ [key(outside, MC)]: 600 })))!;
    expect(r.decision.outcome).toBe("SHORTCUT");
    expect(r.decision.summary).toMatch(/^Through SLC: /);
    expect(SLC_DOORS).toContain(r.route!.indoorEdgeIds![0]);
  });

  it("does not send anyone through a building to save less than the margin", async () => {
    const outside = westOf("07284470cb96f524", 25);
    const best = (await walk(outside, MC, google({ [key(outside, MC)]: 600 })))!.decision.chosen!.seconds;
    const small = (await walk(outside, MC, google({ [key(outside, MC)]: best + 30 })))!;
    expect(small.decision.outcome).toBe("KEPT_GOOGLE");
    expect(small.route).toBeUndefined();
    const enough = (await walk(outside, MC, google({ [key(outside, MC)]: best + CFG.campusShortcutMinBenefitSeconds + 1 })))!;
    expect(enough.decision.outcome).toBe("SHORTCUT");
  });

  it("leaves Google's walk alone when the campus has nothing better, without pricing doors it could not use", async () => {
    const f = google();
    const r = (await walk(HOME, DC, f))!;
    expect(r.decision.outcome).toBe("KEPT_GOOGLE");
    expect(r.route).toBeUndefined();
    expect(f.walk.mock.calls.length).toBeLessThanOrEqual(1 + 2);
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

  it("a step-free trip to PAC never changes floor by stairs or lift of unknown kind", async () => {
    const r = (await walk(MC, PAC, google(), { access: { stepFree: true } }))!;
    for (const id of r.route?.indoorEdgeIds ?? []) {
      const e = edgeById(NET, id)!;
      expect(e.kind === "STAIRS" && e.floors !== 0, id).toBe(false);
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

describe("falling back to Google's walk", () => {
  it("has nothing to say when neither end is on the campus network, for the same building, or with no Google walk", async () => {
    const lh = findBuilding("WLU", "LH")!;
    const laurier: CampusLocation = { id: "WLU:LH", name: lh.name, university: "WLU", latitude: lh.latitude!, longitude: lh.longitude!, kind: "BUILDING", buildingCode: "LH" };
    expect(await walk(HOME, laurier)).toBeUndefined();
    expect(await walk(MC, MC)).toBeUndefined();
    expect(await campusWalk({ from: MC, to: PAC, at: NOON }, undefined, google(), CFG, NOON)).toBeUndefined();
    const noData = graphOver({ ...NET, anchors: [] });
    const f = google();
    expect(await campusWalk({ from: MC, to: PAC, at: NOON }, await f.walk(MC, PAC), f, CFG, NOON, noData)).toBeUndefined();
  });

  it("keeps Google's walk and warns when the only walks to an allowed entrance cannot be priced", async () => {
    const f = { walk: vi.fn(async (from: LatLng, to: LatLng) => (to === PAC ? (await google().walk(from, to)) : undefined)) };
    const r = (await walk(HOME, PAC, f))!;
    expect(r.decision.outcome).toBe("NO_USABLE_ROUTE");
    expect(r.decision.warnings).toHaveLength(1);
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
});
