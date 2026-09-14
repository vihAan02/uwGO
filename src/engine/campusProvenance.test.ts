import { describe, expect, it } from "vitest";
import { encode } from "@googlemaps/polyline-codec";
import type { LatLng, RouteOption } from "@/domain/types";
import { DEFAULT_PLANNER_CONFIG as CFG } from "@/domain/config";
import { CAMPUS_OVERLAY, CAMPUS_RESEARCH, compileKnowledge, type FieldPromotion } from "@/data/campus";
import { UW_INDOOR_NETWORK as NET } from "@/data/indoor/uw-indoor-network.generated";
import { haversineMeters } from "@/routing/EstimateRoutingProvider";
import { torontoDate } from "@/time/toronto";
import { campusWalk, explainCampusDecision } from "./campusRoute";
import { describeProvenance, provenanceKinds, segmentProvenance } from "./campusProvenance";
import { campusGraph, graphOver, type IndoorGraph } from "./indoorGraph";
import { networkBuildingLocation } from "./indoorRoute";

/**
 * Every campus decision says what activated it and what each door and link it uses rests on: official
 * research, UW Go's review, the WATIsGrass survey, or a visit on the ground once one is promoted.
 */

const NOON = torontoDate("2026-09-15", 12 * 60);
const SLC_PAC = "c34ea719b8b9dee5";
const SLC_EAST = "5ba0e3d2964bf706";
const MC = networkBuildingLocation("MC")!;
const PAC = networkBuildingLocation("PAC")!;

const google = {
  async walk(from: LatLng, to: LatLng): Promise<RouteOption> {
    const metres = haversineMeters(from, to) * 1.3;
    return { mode: "WALK", durationMinutes: Math.ceil(metres / 1.33 / 60), durationSeconds: Math.round(metres / 1.33), distanceMeters: Math.round(metres), polyline: encode([[from.latitude, from.longitude], [to.latitude, to.longitude]]), provider: "google-routes", computedAt: "", isEstimate: false };
  },
};

const toPac = async (g: IndoorGraph = campusGraph()) => (await campusWalk({ from: MC, to: PAC, at: NOON }, await google.walk(MC, PAC), google, CFG, NOON, g))!.decision;

describe("where a campus decision's evidence comes from", () => {
  it("names what activated the walk into PAC: PAC's own rule, on official research and UW Go's review", async () => {
    const d = await toPac();
    expect(d.outcome).toBe("CORRECTED");
    expect(d.activatedBy).toEqual([expect.objectContaining({ subject: "building:PAC", evidence: "OFFICIAL", from: ["OFFICIAL_RESEARCH", "UW_GO_REVIEW"], sourceIds: ["B_PAC", "PACFIT"] })]);
  });

  it("names the sources of every door and link the walk uses, and counts what only the survey describes", async () => {
    const d = await toPac();
    const link = d.chosen!.provenance.find((p) => p.subject === SLC_PAC)!;
    expect(link).toMatchObject({ label: "SLC–PAC link at the PAC front desk", evidence: "CORROBORATED", from: ["OFFICIAL_RESEARCH", "UW_GO_REVIEW", "WATISGRASS"] });
    expect(d.chosen!.provenance.map((p) => p.subject)).toContain(SLC_EAST);
    expect(d.chosen!.surveyedSegments).toBeGreaterThan(0);
    const text = explainCampusDecision(d);
    expect(text).toContain("Activated by:\n  PAC's rule about its map point (in: prohibited, out: allowed): official, from official research + UW Go's review [B_PAC, PACFIT]");
    expect(text).toContain("Resting on:\n");
    expect(text).toContain("Evidence from: official research + UW Go's review + WATIsGrass survey");
  });

  it("once a field observation of the SLC east doors is promoted, says the walk rests on that visit", async () => {
    const promotion: FieldPromotion = {
      id: "FP_SLC_EAST_TEST",
      observationIds: ["fo-20260920T181500Z-a1b2"],
      subject: { edges: [{ edgeId: SLC_EAST, kind: "DOOR", between: ["OUT", "SLC"] }] },
      claims: { passage: { "OUT>SLC": "ALLOWED" } },
      observedOn: "2026-09-20", verifiedBy: ["DM"], reviewedAt: "2026-09-21", reviewedBy: "DM", basis: "Went in from outside at noon.",
    };
    const d = await toPac(graphOver(NET, compileKnowledge(CAMPUS_RESEARCH, CAMPUS_OVERLAY, [promotion])));
    const door = d.chosen!.provenance.find((p) => p.subject === SLC_EAST)!;
    expect(door).toMatchObject({ evidence: "FIELD_VERIFIED", field: [{ promotionId: "FP_SLC_EAST_TEST", observedOn: "2026-09-20", verifiedBy: ["DM"] }] });
    expect(door.from).toEqual(["OFFICIAL_RESEARCH", "FIELD", "UW_GO_REVIEW", "WATISGRASS"]);
    expect(provenanceKinds(d.chosen!.provenance)).toContain("FIELD");
    expect(explainCampusDecision(d)).toContain("checked on the ground 2026-09-20 by DM (FP_SLC_EAST_TEST)");
  });

  it("stops using a door someone found is not where UW Go shows it", async () => {
    const wrong: FieldPromotion = {
      id: "FP_SLC_EAST_WRONG", observationIds: ["fo-20260920T181500Z-a1b2"],
      subject: { edges: [{ edgeId: SLC_EAST, kind: "DOOR", between: ["OUT", "SLC"] }] },
      claims: { placement: "WRONG" },
      observedOn: "2026-09-20", verifiedBy: ["DM"], reviewedAt: "2026-09-21", reviewedBy: "DM", basis: "No door on the east face where the survey draws one.",
    };
    const d = await toPac(graphOver(NET, compileKnowledge(CAMPUS_RESEARCH, CAMPUS_OVERLAY, [wrong])));
    expect(d.outcome).toBe("CORRECTED");
    expect(d.chosen!.provenance.map((p) => p.subject)).not.toContain(SLC_EAST);
  });

  it("rests PAC's rule on a visit only when the visit checked the way in or out, not the hours", async () => {
    const visit: Omit<FieldPromotion, "id" | "claims"> = {
      observationIds: ["fo-20260920T181500Z-a1b2"], subject: { building: "PAC" },
      observedOn: "2026-09-20", verifiedBy: ["DM"], reviewedAt: "2026-09-21", reviewedBy: "DM", basis: "Read the posted hours; left by a corner door.",
    };
    const rule = async (p: FieldPromotion) => (await toPac(graphOver(NET, compileKnowledge(CAMPUS_RESEARCH, CAMPUS_OVERLAY, [p])))).activatedBy.find((x) => x.subject === "building:PAC")!;
    expect((await rule({ ...visit, id: "FP_PAC_HOURS", claims: { hours: { kind: "ALWAYS" } } })).from).not.toContain("FIELD");
    expect((await rule({ ...visit, id: "FP_PAC_EXIT", claims: { passage: { "PAC>OUT": "ALLOWED" } } })).from).toContain("FIELD");
  });

  it("with PAC's only allowed way in closed, keeps Google's walk with a warning and names why, without claiming a route's evidence", async () => {
    const d = (await campusWalk({ from: MC, to: PAC, at: NOON, closedEdgeIds: new Set([SLC_PAC]) }, await google.walk(MC, PAC), google, CFG, NOON))!.decision;
    expect(d.outcome).toBe("NO_USABLE_ROUTE");
    expect(d.chosen).toBeUndefined();
    expect(d.activatedBy.map((p) => p.subject)).toContain("building:PAC");
    const text = explainCampusDecision(d);
    expect(text).toContain("Google's walk could not be used because of:\n  PAC's rule about its map point");
    expect(text).not.toContain("Activated by:");
    expect(text).not.toContain("Evidence from:");
  });

  it("describes a surveyed segment nothing else is known about as the survey's alone", () => {
    const g = campusGraph();
    const hallway = g.net.edges.findIndex((e, i) => e.kind === "HALLWAY" && !g.facts[i]);
    const p = segmentProvenance(g, hallway);
    expect(p.from).toEqual(["WATISGRASS"]);
    expect(describeProvenance(p)).toMatch(/: surveyed, from WATIsGrass survey$/);
  });

  it("leaves nothing activated when Google's walk stands", async () => {
    const DC = networkBuildingLocation("DC")!;
    const d = (await campusWalk({ from: MC, to: DC, at: NOON }, await google.walk(MC, DC), google, CFG, NOON))!.decision;
    expect(d.outcome).toBe("KEPT_GOOGLE");
    expect(d.activatedBy).toEqual([]);
  });
});
