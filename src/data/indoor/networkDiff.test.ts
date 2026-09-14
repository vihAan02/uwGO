import { describe, expect, it } from "vitest";
import { UW_INDOOR_NETWORK as NET } from "./uw-indoor-network.generated";
import type { IndoorEdge, IndoorNetwork } from "./network";
import { edgeId } from "./edgeId";
import { diffNetworks, isUnchanged, renderNetworkDiff } from "./networkDiff";

/** What the generator shows before it replaces the committed network. */

describe("comparing two versions of the network", () => {
  it("finds nothing between the network and itself", () => {
    const d = diffNetworks(NET, NET, edgeId);
    expect(isUnchanged(d)).toBe(true);
    expect(renderNetworkDiff(d)).toContain("No segment, entry point or building differs.");
  });

  it("reports a removed segment, an added one, a stairwell found to be an elevator, and a lost entry point", () => {
    const stairs = NET.edges.findIndex((e) => e.kind === "STAIRS" && e.floors !== 0);
    const tunnel = NET.edges.findIndex((e) => e.kind === "TUNNEL");
    const edges = NET.edges.map((e, i): IndoorEdge => (i === stairs ? { ...e, kind: "ELEVATOR" } : e)).filter((_, i) => i !== tunnel);
    edges.push({ ...NET.edges[tunnel], kind: "BRIDGE" });
    const next: IndoorNetwork = { ...NET, edges, anchors: NET.anchors.slice(1) };

    const d = diffNetworks(NET, next, edgeId);
    expect(isUnchanged(d)).toBe(false);
    expect(d.removedEdges.map((s) => s.id)).toEqual([edgeId(NET, NET.edges[tunnel])]);
    expect(d.addedEdges.map((s) => s.kind)).toEqual(["BRIDGE"]);
    // An elevator the survey used to call stairs keeps its id: a change to that segment, not a new one.
    expect(d.changedEdges).toHaveLength(1);
    expect(d.changedEdges[0].after.id).toBe(edgeId(NET, NET.edges[stairs]));
    expect(d.changedEdges[0].changes).toEqual(["kind STAIRS -> ELEVATOR"]);
    expect(d.kinds.ELEVATOR).toEqual([0, 1]);
    expect(d.removedAnchors).toHaveLength(1);
    expect(renderNetworkDiff(d)).toContain("segments changed (1):");
  });

  it("reports a climb that reverses, and not a segment merely written from its other end", () => {
    const i = NET.edges.findIndex((e) => e.kind === "STAIRS" && e.floors > 0);
    const e = NET.edges[i];
    const reversed: IndoorNetwork = { ...NET, edges: NET.edges.map((x, j): IndoorEdge => (j === i ? { ...x, floors: -x.floors } : x)) };
    const d = diffNetworks(NET, reversed, edgeId);
    expect(isUnchanged(d)).toBe(false);
    expect(d.changedEdges).toHaveLength(1);
    expect(d.changedEdges[0].changes).toEqual([expect.stringMatching(/^climb (up|down) \d+(\.5)? -> (up|down) \d+(\.5)?$/)]);
    expect(d.changedEdges[0].before.climb).toBe(-d.changedEdges[0].after.climb);

    const rewritten: IndoorNetwork = { ...NET, edges: NET.edges.map((x, j): IndoorEdge => (j === i ? { ...x, a: e.b, b: e.a, floors: -e.floors, path: [...e.path].reverse() } : x)) };
    expect(isUnchanged(diffNetworks(NET, rewritten, edgeId))).toBe(true);
  });

  it("flags two segments that would share an id", () => {
    const next: IndoorNetwork = { ...NET, edges: [...NET.edges, NET.edges[0]] };
    expect(diffNetworks(NET, next, edgeId).duplicateIds).toEqual([edgeId(NET, NET.edges[0])]);
  });
});
