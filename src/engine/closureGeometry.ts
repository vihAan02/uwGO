import { haversineMeters } from "@/routing/EstimateRoutingProvider";
import type { IndoorEdge, IndoorNetwork } from "@/data/indoor/network";
import { edgeId } from "@/data/indoor/edgeId";

/**
 * Whether a route drawn by Google runs along a path students have reported closed.
 *
 * The winter and mixed routes are computed over our own graph, so a closed segment is simply
 * removed from the search and genuinely avoided. The "Fastest" route is Google's, and the Routes
 * API offers no way to exclude a footpath, so the honest thing is to detect the overlap and say
 * so rather than pretend the route avoids it.
 *
 * "Runs along" is not "crosses". A route that cuts across a closed path at a junction is fine; a
 * route that walks its length is not. So a closed segment counts only when several of its points
 * lie close to the route, not just one.
 */

/** How near a route has to pass a closed path before it counts as being on it. */
export const CLOSURE_TOUCH_METRES = 12;
/** How many of the closed segment's points must be that near before it counts as travelling along it. */
export const CLOSURE_TOUCH_POINTS = 2;

export type LatLngTuple = [number, number];

/** Metres from a point to a line segment, in a local flat frame. Good to well under a metre at campus scale. */
export function distanceToSegment(p: LatLngTuple, a: LatLngTuple, b: LatLngTuple): number {
  const mPerLat = 111_320;
  const mPerLng = mPerLat * Math.cos((p[0] * Math.PI) / 180);
  const px = p[1] * mPerLng, py = p[0] * mPerLat;
  const ax = a[1] * mPerLng, ay = a[0] * mPerLat;
  const bx = b[1] * mPerLng, by = b[0] * mPerLat;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Where a polyline passes nearest a point. */
export interface PathProjection {
  /** Metres along the path, from its first point to the nearest point. */
  along: number;
  /** Metres from the point to the path. */
  off: number;
  /** The whole path, in metres. */
  metres: number;
  /** The nearest point lies between `path[segment]` and `path[segment + 1]`. */
  segment: number;
  point: LatLngTuple;
}

/** The point of a polyline nearest a point, and how far along the polyline it is, in the same local flat frame. */
export function projectOntoPath(p: LatLngTuple, path: readonly LatLngTuple[]): PathProjection {
  const metresBetween = (a: LatLngTuple, b: LatLngTuple) => haversineMeters({ latitude: a[0], longitude: a[1] }, { latitude: b[0], longitude: b[1] });
  if (path.length < 2) return { along: 0, off: path.length ? metresBetween(p, path[0]) : Infinity, metres: 0, segment: 0, point: path[0] ?? p };
  const mPerLat = 111_320;
  const mPerLng = mPerLat * Math.cos((p[0] * Math.PI) / 180);
  let best: Omit<PathProjection, "metres"> = { along: 0, off: Infinity, segment: 0, point: path[0] };
  let run = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    const ax = (a[1] - p[1]) * mPerLng, ay = (a[0] - p[0]) * mPerLat;
    const dx = (b[1] - a[1]) * mPerLng, dy = (b[0] - a[0]) * mPerLat;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, -(ax * dx + ay * dy) / len2));
    const off = Math.hypot(ax + t * dx, ay + t * dy);
    const length = metresBetween(a, b);
    if (off < best.off) best = { along: run + t * length, off, segment: i, point: [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])] };
    run += length;
  }
  return { ...best, metres: run };
}

/** Metres from either end of a straight step within which it may cross a surveyed segment: a door and the paths beside it are drawn only so precisely. */
export const STEP_END_METRES = 3;

/**
 * The edges of the network a straight step cuts away from its ends: a path it crosses, a corridor, a link. A
 * step drawn between one of Google's lines and a door must cut none, or it is drawn through a wall or across a
 * path nobody walks it by. Edges in `except`, such as the door the step reaches, are not counted.
 */
export function edgesCut(net: IndoorNetwork, from: LatLngTuple, to: LatLngTuple, except: ReadonlySet<number> = new Set(), endMetres = STEP_END_METRES): number[] {
  const mPerLat = 111_320;
  const mPerLng = mPerLat * Math.cos((from[0] * Math.PI) / 180);
  const dx = (to[1] - from[1]) * mPerLng, dy = (to[0] - from[0]) * mPerLat;
  const length = Math.hypot(dx, dy);
  if (length <= 2 * endMetres) return [];
  const minLat = Math.min(from[0], to[0]), maxLat = Math.max(from[0], to[0]);
  const minLng = Math.min(from[1], to[1]), maxLng = Math.max(from[1], to[1]);
  const cut: number[] = [];
  net.edges.forEach((e, i) => {
    if (except.has(i)) return;
    for (let s = 1; s < e.path.length; s++) {
      const a = e.path[s - 1], b = e.path[s];
      if (Math.max(a[0], b[0]) < minLat || Math.min(a[0], b[0]) > maxLat || Math.max(a[1], b[1]) < minLng || Math.min(a[1], b[1]) > maxLng) continue;
      const cx = (a[1] - from[1]) * mPerLng, cy = (a[0] - from[0]) * mPerLat;
      const fx = (b[1] - a[1]) * mPerLng, fy = (b[0] - a[0]) * mPerLat;
      const den = dx * fy - dy * fx;
      if (den === 0) continue;
      const t = (cx * fy - cy * fx) / den;
      const u = (cx * dy - cy * dx) / den;
      if (u < 0 || u > 1 || t * length <= endMetres || (1 - t) * length <= endMetres) continue;
      cut.push(i);
      return;
    }
  });
  return cut;
}

/** Metres from a point to the nearest part of a polyline. */
export function distanceToPath(p: LatLngTuple, path: readonly LatLngTuple[]): number {
  if (path.length === 0) return Infinity;
  if (path.length === 1) return haversineMeters({ latitude: p[0], longitude: p[1] }, { latitude: path[0][0], longitude: path[0][1] });
  let best = Infinity;
  for (let i = 0; i < path.length - 1; i++) best = Math.min(best, distanceToSegment(p, path[i], path[i + 1]));
  return best;
}

/** Whether the route walks the length of this closed segment. */
export function routeRunsAlong(
  route: readonly LatLngTuple[],
  segment: readonly LatLngTuple[],
  touchMetres = CLOSURE_TOUCH_METRES,
  touchPoints = CLOSURE_TOUCH_POINTS,
): boolean {
  if (route.length < 2 || segment.length === 0) return false;
  let near = 0;
  for (const point of segment) {
    if (distanceToPath(point, route) <= touchMetres) near++;
    if (near >= Math.min(touchPoints, segment.length)) return true;
  }
  return false;
}

/**
 * The closed segments an outdoor route passes along. Only segments outside are considered: a
 * Google walking route cannot be inside a building, so a closed corridor says nothing about it.
 */
export function closuresOnRoute(
  net: IndoorNetwork,
  routePath: readonly LatLngTuple[],
  closedEdgeIds: ReadonlySet<string>,
): IndoorEdge[] {
  if (closedEdgeIds.size === 0 || routePath.length < 2) return [];
  const hit: IndoorEdge[] = [];
  for (const e of net.edges) {
    if (e.kind !== "OUTDOOR") continue;
    if (!closedEdgeIds.has(edgeId(net, e))) continue;
    if (routeRunsAlong(routePath, e.path)) hit.push(e);
  }
  return hit;
}
