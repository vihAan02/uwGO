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

/**
 * Where the live-navigation camera wants to be. Heading-up puts the student a little below
 * centre with the way ahead filling the screen; north-up simply centres them.
 */
export function navigationPose(user: Point, heading: number | undefined, zoom = NAV_ZOOM): CameraPose {
  if (heading === undefined) return { center: user, heading: 0, zoom };
  return { center: offsetPoint(user, LOOK_AHEAD_METERS, heading), heading: normalizeDegrees(heading), zoom };
}

export interface Bounds { north: number; south: number; east: number; west: number }

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
