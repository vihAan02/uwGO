import { describe, expect, it } from "vitest";
import { UW_INDOOR_NETWORK as NET } from "./uw-indoor-network.generated";
import { edgeId, edgeIds, edgeIndexById, edgeKey, edgeLabel } from "./edgeId";

describe("canonical segment ids", () => {
  it("gives every segment in the network a distinct id", () => {
    const ids = edgeIds(NET);
    expect(ids).toHaveLength(NET.edges.length);
    expect(new Set(ids).size).toBe(NET.edges.length);
    expect(ids.every((id) => /^[0-9a-f]{16}$/.test(id))).toBe(true);
  });

  it("does not depend on which end of the segment is written first", () => {
    const e = NET.edges.find((x) => x.kind === "TUNNEL")!;
    const flipped = { ...e, a: e.b, b: e.a, path: [...e.path].reverse() };
    expect(edgeId(NET, flipped)).toBe(edgeId(NET, e));
    expect(edgeKey(NET, flipped)).toBe(edgeKey(NET, e));
  });

  it("describes the segment, not its position in the file", () => {
    const e = NET.edges[0];
    // A different kind over the same two points is a different segment.
    expect(edgeId(NET, { ...e, kind: "TUNNEL" })).not.toBe(edgeId(NET, e));
    // Reordering the array must not change any id.
    const shuffled = { ...NET, edges: [...NET.edges].reverse() };
    expect(edgeId(shuffled, e)).toBe(edgeId(NET, e));
  });

  it("finds a segment again from an id, and misses cleanly for an unknown one", () => {
    const index = edgeIndexById(NET);
    const e = NET.edges[42];
    expect(index.get(edgeId(NET, e))).toBe(42);
    expect(index.get("0".repeat(16))).toBeUndefined();
  });

  it("names a closed tunnel or bridge by the buildings it joins", () => {
    const tunnel = NET.edges.find((e) => e.kind === "TUNNEL")!;
    expect(edgeLabel(NET, tunnel)).toMatch(/^Tunnel between [A-Z0-9]+ and [A-Z0-9]+$/);
    const bridge = NET.edges.find((e) => e.kind === "BRIDGE" && NET.nodes[e.a].building !== NET.nodes[e.b].building)!;
    expect(edgeLabel(NET, bridge)).toMatch(/^Bridge between [A-Z0-9]+ and [A-Z0-9]+$/);
    // A path outside has no two buildings to name, so it is described rather than named.
    const outdoor = NET.edges.find((e) => e.kind === "OUTDOOR")!;
    expect(edgeLabel(NET, outdoor)).toBe("Path outside");
  });

  it("keeps a change of floor's id when it turns out to be an elevator or a ramp, and names it for what it is", () => {
    const stairs = NET.edges.find((e) => e.kind === "STAIRS" && e.floors !== 0)!;
    for (const kind of ["ELEVATOR", "RAMP", "OTHER_VERTICAL"] as const) expect(edgeId(NET, { ...stairs, kind })).toBe(edgeId(NET, stairs));
    expect(edgeLabel(NET, { ...stairs, kind: "ELEVATOR" })).toMatch(/^Elevator in [A-Z0-9]+$/);
    expect(edgeLabel(NET, { ...stairs, kind: "RAMP" })).toMatch(/^Ramp in [A-Z0-9]+$/);
    // Anything that is not a change of floor keeps its kind in the id.
    expect(edgeId(NET, { ...stairs, kind: "DOOR" })).not.toBe(edgeId(NET, stairs));
  });
});
