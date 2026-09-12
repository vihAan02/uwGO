import { describe, expect, it } from "vitest";
import { UW_INDOOR_NETWORK as NET } from "@/data/indoor/uw-indoor-network.generated";
import { edgeId, edgeLabel } from "@/data/indoor/edgeId";
import { indoorRouteBetween, networkBuildingLocation } from "./indoorRoute";

const loc = (code: string) => networkBuildingLocation(code)!;
const edgeBetween = (x: string, y: string, kind: string) =>
  NET.edges.find((e) => e.kind === kind
    && ((NET.nodes[e.a].building === x && NET.nodes[e.b].building === y)
      || (NET.nodes[e.a].building === y && NET.nodes[e.b].building === x)))!;

const MC_QNC_BRIDGE = edgeBetween("MC", "QNC", "BRIDGE");
const MC_QNC_ID = edgeId(NET, MC_QNC_BRIDGE);
const MC_C2_ID = edgeId(NET, edgeBetween("MC", "C2", "TUNNEL"));

describe("telling the student which closure changed their route", () => {
  it("names the segment the route had to go round", async () => {
    const r = (await indoorRouteBetween(loc("STC"), loc("MC"), undefined, undefined, { closedEdgeIds: new Set([MC_QNC_ID]) }))!;
    expect(r.avoidedClosures).toEqual([MC_QNC_ID]);
    expect(edgeLabel(NET, MC_QNC_BRIDGE)).toBe("Bridge between MC and QNC");
    // The journey still happens, by another way.
    expect(r.indoorPath).not.toEqual(["STC", "B2", "QNC", "MC"]);
    expect(r.indoorEdgeIds).not.toContain(MC_QNC_ID);
  });

  it("says nothing when the closure was somewhere the route never went", async () => {
    const r = (await indoorRouteBetween(loc("STC"), loc("MC"), undefined, undefined, { closedEdgeIds: new Set([MC_C2_ID]) }))!;
    expect(r.avoidedClosures).toBeUndefined();
    expect(r.indoorPath).toEqual(["STC", "B2", "QNC", "MC"]);
  });

  it("says nothing when nothing is closed", async () => {
    const r = (await indoorRouteBetween(loc("STC"), loc("MC")))!;
    expect(r.avoidedClosures).toBeUndefined();
    expect(r.indoorEdgeIds!.length).toBeGreaterThan(0);
  });

  it("carries the ids of the segments it does travel, so one of them can be reported", async () => {
    const r = (await indoorRouteBetween(loc("MC"), loc("DC")))!;
    expect(r.indoorEdgeIds).toContain(MC_C2_ID);
    expect(r.indoorEdgeIds!.every((id) => /^[0-9a-f]{16}$/.test(id))).toBe(true);
  });
});
