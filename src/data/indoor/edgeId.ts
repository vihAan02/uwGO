import type { IndoorEdge, IndoorNetwork } from "./network";

/**
 * Canonical, stable identifiers for the segments of the campus indoor network.
 *
 * The network's own `a`/`b` are positions in a generated array: regenerate the data and every
 * number can shift. Anything stored outside the app (a closure report in the database, say) must
 * therefore key on something derived from what the segment *is*, not where it sits in a file.
 *
 * The key is the segment's kind plus its two endpoints, each as coordinate, building and floor,
 * written in a fixed order so that a→b and b→a give the same answer. Verified unique across the
 * whole network: 794 edges, 794 distinct keys.
 *
 * If a future survey moves a segment, its id changes and reports filed against the old one stop
 * matching. That is the safe direction to fail: a stale closure quietly stops applying, rather
 * than applying to some other corridor that happens to have inherited an index.
 */

/** 32-bit FNV-1a. Deterministic, dependency-free, and identical in Node and the browser. */
function fnv1a(input: string, seed: number): number {
  let h = seed;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

const hex8 = (n: number) => n.toString(16).padStart(8, "0");

/** The human-readable canonical form, e.g. "TUNNEL|43.4715,-80.5440@MC/1|43.4718,-80.5444@C2/1". */
export function edgeKey(net: IndoorNetwork, edge: IndoorEdge): string {
  const at = (id: number) => {
    const n = net.nodes[id];
    return `${n.lat},${n.lng}@${n.building}/${n.floor}`;
  };
  const a = at(edge.a);
  const b = at(edge.b);
  const [first, second] = a <= b ? [a, b] : [b, a];
  return `${edge.kind}|${first}|${second}`;
}

/** 16 hex characters derived from the canonical form. This is what the database stores. */
export function edgeId(net: IndoorNetwork, edge: IndoorEdge): string {
  const key = edgeKey(net, edge);
  return `${hex8(fnv1a(key, 0x811c9dc5))}${hex8(fnv1a(key, 0x9e3779b1))}`;
}

/** Every segment's id, in edge order. */
export function edgeIds(net: IndoorNetwork): string[] {
  return net.edges.map((e) => edgeId(net, e));
}

/** The segment an id refers to, or undefined when the network no longer has it. */
export function edgeById(net: IndoorNetwork, id: string): IndoorEdge | undefined {
  return net.edges.find((e) => edgeId(net, e) === id);
}

/** What to call the segment an id refers to. Falls back to a neutral word for an unknown id. */
export function labelForEdgeId(net: IndoorNetwork, id: string): string {
  const e = edgeById(net, id);
  return e ? edgeLabel(net, e) : "A section of the route";
}

/** Where to find a segment given an id from the database. */
export function edgeIndexById(net: IndoorNetwork): Map<string, number> {
  const map = new Map<string, number>();
  net.edges.forEach((e, i) => map.set(edgeId(net, e), i));
  return map;
}

/**
 * What to call a closed segment when telling the student why their route changed. Tunnels and
 * bridges join two named buildings and can be named exactly; a corridor or a path outside cannot,
 * so it is described by what it is and, where possible, where it is.
 */
export function edgeLabel(net: IndoorNetwork, edge: IndoorEdge): string {
  const a = net.nodes[edge.a];
  const b = net.nodes[edge.b];
  const named = (s: string) => s !== "OUT";
  // Named in a fixed order, so the same segment always reads the same way whichever end of it
  // the data happens to list first.
  const pair = [a.building, b.building].sort().join(" and ");
  switch (edge.kind) {
    case "TUNNEL":
      return named(a.building) && named(b.building) ? `Tunnel between ${pair}` : "Tunnel";
    case "BRIDGE":
      return named(a.building) && named(b.building) ? `Bridge between ${pair}` : "Bridge";
    case "DOOR": {
      const inside = named(a.building) ? a.building : named(b.building) ? b.building : undefined;
      return inside ? `Entrance to ${inside}` : "Doorway";
    }
    case "STAIRS":
      return named(a.building) ? `Stairs in ${a.building}` : "Stairs";
    case "HALLWAY":
      return named(a.building) ? `Hallway in ${a.building}` : "Hallway";
    case "OUTDOOR":
      return "Path outside";
    default:
      return "Link";
  }
}
