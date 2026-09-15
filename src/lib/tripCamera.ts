import { headingDelta, normalizeDegrees } from "./deviceHeading";
import type { Point } from "./routeProgress";

/**
 * The flat navigation camera. Two-dimensional on purpose: the tilted view stuttered on
 * phones, so the trip map is a plain map that follows the student and, when the compass
 * is trustworthy, turns so that ahead is up.
 */

export const NAV_ZOOM = 17.5;

export interface CameraPose {
  center: Point;
  /** Degrees clockwise from north; 0 is north-up. */
  heading: number;
  zoom: number;
}

/** A point `meters` away from `p` in the direction `bearingDeg`. */
export function offsetPoint(p: Point, meters: number, bearingDeg: number): Point {
  const rad = (bearingDeg * Math.PI) / 180;
  const dLat = (meters * Math.cos(rad)) / 111_320;
  const dLng = (meters * Math.sin(rad)) / (111_320 * Math.cos((p.lat * Math.PI) / 180));
  return { lat: p.lat + dLat, lng: p.lng + dLng };
}

/** How far ahead of the student the camera looks when the map is heading-up. */
export const LOOK_AHEAD_METERS = 45;

/** Ground metres per screen pixel at a latitude and zoom (Web Mercator, 256 px tiles). */
export function metersPerPixel(lat: number, zoom: number): number {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
}

/**
 * How much of the map is under the trip's own panels. The camera aims for the middle of what
 * is left, not the middle of the map, so the student is never hidden under the bottom sheet.
 */
export interface Insets { topPx: number; bottomPx: number }

/** Metres the map centre must sit behind the visible centre so that the visible centre is where it should be. */
export function centreShiftMeters(lat: number, zoom: number, insets: Insets | undefined): number {
  if (!insets) return 0;
  return ((insets.bottomPx - insets.topPx) / 2) * metersPerPixel(lat, zoom);
}

/**
 * Where the live-navigation camera wants to be. Heading-up puts the student a little below
 * the visible centre with the way ahead filling the screen; north-up centres them in what
 * is visible. `shiftMeters` is how far the visible centre sits above the map's own centre.
 */
export function navigationPose(user: Point, heading: number | undefined, zoom = NAV_ZOOM, shiftMeters = 0): CameraPose {
  if (heading === undefined) return { center: shiftMeters === 0 ? user : offsetPoint(user, shiftMeters, 180), heading: 0, zoom };
  return { center: offsetPoint(user, LOOK_AHEAD_METERS - shiftMeters, heading), heading: normalizeDegrees(heading), zoom };
}

export interface Bounds { north: number; south: number; east: number; west: number }

/** The bounds with the strips under the panels taken off the top and bottom, as fractions of the height. */
export function visibleBounds(b: Bounds, topFrac = 0, bottomFrac = 0): Bounds {
  const h = b.north - b.south;
  return { north: b.north - h * topFrac, south: b.south + h * bottomFrac, east: b.east, west: b.west };
}

/**
 * True while the point sits inside the middle `inner` share of the viewport, in each axis.
 * A north-up map only re-centres when the student drifts out of that comfortable zone, so
 * the map is not nudged on every fix.
 */
export function comfortablyVisible(b: Bounds, p: Point, inner = 0.5): boolean {
  const latHalf = ((b.north - b.south) * inner) / 2;
  const lngHalf = ((b.east - b.west) * inner) / 2;
  const cLat = (b.north + b.south) / 2;
  const cLng = (b.east + b.west) / 2;
  return Math.abs(p.lat - cLat) <= latHalf && Math.abs(p.lng - cLng) <= lngHalf;
}

/** One animation step from `from` towards `to`; headings take the short way round. */
export function stepPose(from: CameraPose, to: CameraPose, k: number): CameraPose {
  return {
    center: { lat: from.center.lat + (to.center.lat - from.center.lat) * k, lng: from.center.lng + (to.center.lng - from.center.lng) * k },
    heading: normalizeDegrees(from.heading + headingDelta(from.heading, to.heading) * k),
    zoom: from.zoom + (to.zoom - from.zoom) * k,
  };
}

/** Close enough that another frame would not be visible. */
export function poseSettled(a: CameraPose, b: CameraPose): boolean {
  return Math.abs(a.center.lat - b.center.lat) < 1e-6 && Math.abs(a.center.lng - b.center.lng) < 1e-6
    && Math.abs(headingDelta(a.heading, b.heading)) < 0.2 && Math.abs(a.zoom - b.zoom) < 0.005;
}
