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
