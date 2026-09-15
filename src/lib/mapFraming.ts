import { decode } from "@googlemaps/polyline-codec";
import type { CampusLocation, RouteOption } from "@/domain/types";
import type { MapSelection } from "./mapSelection";
import { metersPerPixel } from "./tripCamera";

/**
 * How the planner map frames what the student picked, with the header and the sheet lying over it.
 * Pure, so the rules are tested without Google: frame into the part of the map that can be seen, move
 * the camera when the selection is about different places, and leave it alone when a new line between
 * the same places is already in view. See DESIGN.md §2.
 */

export type Point = { lat: number; lng: number };

/** Pixels of the map covered by the planner's own layers. */
export interface MapInset { top: number; right: number; bottom: number; left: number }
export const NO_INSET: MapInset = { top: 0, right: 0, bottom: 0, left: 0 };

export interface Bounds { north: number; south: number; east: number; west: number }

export const pointOf = (l: { latitude: number; longitude: number }): Point => ({ lat: l.latitude, lng: l.longitude });

/** The route's own line, or a straight line between the ends when it has none (an estimate). */
export function routePath(route: RouteOption | undefined, from: CampusLocation, to: CampusLocation): Point[] {
  return route?.polyline ? decode(route.polyline).map(([lat, lng]) => ({ lat, lng })) : [pointOf(from), pointOf(to)];
}

/** Everything the camera must be able to see for a selection. */
export function framePoints(s: MapSelection): Point[] {
  switch (s.kind) {
    case "LEG": return routePath(s.route, s.from, s.to);
    case "PLACE": return [pointOf(s.at)];
    case "DAY": return s.stops.map((x) => pointOf(x.at));
  }
}

const where = (l: CampusLocation) => `${l.id}@${l.latitude.toFixed(5)},${l.longitude.toFixed(5)}`;

/**
 * Changes only when the selection is about different places: another leg, place or day. A rebuilt plan
 * with the same stops keeps its key, so a refresh never throws away the student's pan and zoom.
 */
export function placeKey(s: MapSelection): string {
  switch (s.kind) {
    case "LEG": return `leg:${where(s.from)}>${where(s.to)}`;
    case "PLACE": return `place:${where(s.at)}`;
    case "DAY": return `day:${s.stops.map((x) => where(x.at)).join("|")}`;
  }
}

/** Changes when the line drawn changes: another way between the same places, or a rerouted one. */
export function lineKey(s: MapSelection): string {
  return s.kind === "LEG" ? `${placeKey(s)}#${s.route?.polyline ?? `straight:${s.route?.durationMinutes ?? ""}`}` : placeKey(s);
}

/** The part of the map's bounds that is not under the planner's layers. */
export function uncovered(b: Bounds, inset: MapInset, width: number, height: number): Bounds {
  const lat = b.north - b.south;
  const lng = b.east - b.west;
  return {
    north: b.north - lat * (inset.top / height),
    south: b.south + lat * (inset.bottom / height),
    west: b.west + lng * (inset.left / width),
    east: b.east - lng * (inset.right / width),
  };
}

export function allInside(b: Bounds, points: readonly Point[]): boolean {
  return points.every((p) => p.lat <= b.north && p.lat >= b.south && p.lng <= b.east && p.lng >= b.west);
}

/**
 * Padding for `fitBounds`: the layers plus breathing room. When the layers leave less than a usable
 * strip (a landscape phone with the sheet expanded), the padding shrinks in proportion rather than
 * asking Google for a frame that cannot exist.
 */
export function framePadding(inset: MapInset, width: number, height: number): MapInset {
  const pad = { top: inset.top + 40, bottom: inset.bottom + 28, left: inset.left + 32, right: inset.right + 32 };
  const fit = (a: number, b: number, room: number): [number, number] => {
    const total = a + b;
    if (total <= room) return [a, b];
    const k = Math.max(0, room) / total;
    return [Math.floor(a * k), Math.floor(b * k)];
  };
  const [top, bottom] = fit(pad.top, pad.bottom, height - 64);
  const [left, right] = fit(pad.left, pad.right, width - 64);
  return { top, right, bottom, left };
}

/** Where to centre the map so that `p` sits in the middle of the uncovered area at `zoom`. */
export function centreFor(p: Point, inset: MapInset, zoom: number): Point {
  const mpp = metersPerPixel(p.lat, zoom);
  // On screen the point should sit this far right of and below the map's own centre.
  const dx = (inset.left - inset.right) / 2;
  const dy = (inset.top - inset.bottom) / 2;
  return {
    lat: p.lat + (dy * mpp) / 111_320,
    lng: p.lng - (dx * mpp) / (111_320 * Math.cos((p.lat * Math.PI) / 180)),
  };
}

export type InsetResponse = { kind: "none" } | { kind: "frame" } | { kind: "pan"; dx: number; dy: number };

/**
 * What the camera does when the header or the sheet settles into a new inset. The selection is framed
 * again into what is now visible, unless the student has moved the map: then their view is kept in the
 * middle of the new visible area by panning half the change, without touching their zoom.
 */
export function insetResponse(prev: MapInset, next: MapInset, studentMoved: boolean): InsetResponse {
  if (prev.top === next.top && prev.right === next.right && prev.bottom === next.bottom && prev.left === next.left) return { kind: "none" };
  if (!studentMoved) return { kind: "frame" };
  const dx = ((next.right - prev.right) - (next.left - prev.left)) / 2;
  const dy = ((next.bottom - prev.bottom) - (next.top - prev.top)) / 2;
  return Math.abs(dx) >= 1 || Math.abs(dy) >= 1 ? { kind: "pan", dx, dy } : { kind: "none" };
}
