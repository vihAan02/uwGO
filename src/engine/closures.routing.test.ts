import { describe, expect, it } from "vitest";
import { UW_INDOOR_NETWORK as NET } from "@/data/indoor/uw-indoor-network.generated";
import { edgeId, edgeLabel } from "@/data/indoor/edgeId";
import { routeBetweenBuildings, type IndoorGraphRoute } from "./indoorGraph";

/**
 * What a confirmed closure does to real routes over the surveyed network. The point of every
 * case here: one shut segment costs a detour, never the journey.
 */

const edgeBetween = (x: string, y: string, kind: string) =>
  NET.edges.find((e) => e.kind === kind
    && ((NET.nodes[e.a].building === x && NET.nodes[e.b].building === y)
      || (NET.nodes[e.a].building === y && NET.nodes[e.b].building === x)))!;

/** The canonical ids of the segments a route actually travels. */
const usedEdgeIds = (r: IndoorGraphRoute): Set<string> => {
  const ids = new Set<string>();
  for (const s of r.segments) {
    const e = NET.edges.find((x) => x.kind === s.kind
      && ((x.a === s.from.id && x.b === s.to.id) || (x.a === s.to.id && x.b === s.from.id)));
    if (e) ids.add(edgeId(NET, e));
  }
  return ids;
};

const route = (a: string, b: string, closed?: string[]) =>
  routeBetweenBuildings(a, b, closed ? { closedEdgeIds: new Set(closed) } : {});

const MC_C2_TUNNEL = edgeId(NET, edgeBetween("MC", "C2", "TUNNEL"));
const MC_QNC_BRIDGE = edgeId(NET, edgeBetween("MC", "QNC", "BRIDGE"));

describe("a segment the campus has reported shut", () => {
  it("is not used, and the journey still happens by another way", () => {
    const open = route("MC", "DC")!;
    expect(open.buildings).toEqual(["MC", "C2", "DC"]);
    expect(open.outdoorMetres).toBe(0);
    expect(usedEdgeIds(open).has(MC_C2_TUNNEL)).toBe(true);

    const closed = route("MC", "DC", [MC_C2_TUNNEL])!;
    expect(closed, "MC to DC must still be routable with the tunnel shut").toBeDefined();
    expect(usedEdgeIds(closed).has(MC_C2_TUNNEL)).toBe(false);
    // With the tunnel gone the way across is outdoors, which is the honest answer.
    expect(closed.outdoorMetres).toBeGreaterThan(0);
  });

  it("leaves every route that did not use it exactly as it was", () => {
    const before = route("STC", "MC")!;
    const after = route("STC", "MC", [MC_C2_TUNNEL])!;
    expect(after.buildings).toEqual(before.buildings);
    expect(after.seconds).toBe(before.seconds);
    expect(after.outdoorMetres).toBe(before.outdoorMetres);
  });

  it("sends a winter route round an indoor closure and keeps it indoors", () => {
    const before = route("STC", "MC")!;
    expect(before.buildings).toEqual(["STC", "B2", "QNC", "MC"]);

    const after = route("STC", "MC", [MC_QNC_BRIDGE])!;
    expect(after.buildings).not.toEqual(before.buildings);
    expect(usedEdgeIds(after).has(MC_QNC_BRIDGE)).toBe(false);
    expect(after.outdoorMetres).toBe(0); // still a winter route: the detour stays under cover
    expect(after.seconds).toBeGreaterThan(before.seconds); // and it costs a little more
  });

  it("pushes a route off a walkway outside that has been closed", () => {
    const open = route("MC", "HH")!;
    const outdoorSegment = open.segments.find((s) => s.kind === "OUTDOOR")!;
    expect(outdoorSegment, "MC to HH should cross one short walkway outside").toBeDefined();
    const outdoorEdge = NET.edges.find((e) => e.kind === "OUTDOOR"
      && ((e.a === outdoorSegment.from.id && e.b === outdoorSegment.to.id)
        || (e.a === outdoorSegment.to.id && e.b === outdoorSegment.from.id)))!;
    const id = edgeId(NET, outdoorEdge);

    const closed = route("MC", "HH", [id]);
    if (closed) expect(usedEdgeIds(closed).has(id)).toBe(false);
    else expect(closed).toBeUndefined(); // no other way under cover is an honest answer too
  });

  it("only removes the segment reported, not every segment like it", () => {
    const closed = route("STC", "MC", [MC_QNC_BRIDGE])!;
    // Other bridges are still perfectly usable.
    expect(closed.segments.some((s) => s.kind === "BRIDGE")).toBe(true);
  });

  it("names the closed segment the way the student will read it", () => {
    expect(edgeLabel(NET, edgeBetween("MC", "C2", "TUNNEL"))).toBe("Tunnel between C2 and MC");
    expect(edgeLabel(NET, edgeBetween("MC", "QNC", "BRIDGE"))).toBe("Bridge between MC and QNC");
  });
});
