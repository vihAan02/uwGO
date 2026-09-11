/**
 * Which way the phone is facing, from the browser's orientation sensors. This is
 * deliberately separate from position: GPS says where the student is, the compass says
 * where they are looking. Nothing here guesses a heading when the sensor cannot give one.
 */

/** The parts of a DeviceOrientationEvent that matter, including Safari's iOS-only field. */
export interface OrientationReading {
  alpha: number | null;
  absolute?: boolean;
  /** iOS: degrees clockwise from true north that the top of the device points. */
  webkitCompassHeading?: number;
  /** iOS: expected error in degrees; negative means the compass is not calibrated. */
  webkitCompassAccuracy?: number;
}

/** A compass reading whose expected error is larger than this is not worth steering by. */
export const MAX_COMPASS_ERROR_DEGREES = 60;

export function normalizeDegrees(d: number): number {
  const n = d % 360;
  return n < 0 ? n + 360 : n;
}

/**
 * Compass heading (degrees clockwise from north) of the top of the screen, or undefined
 * when the reading is not anchored to north. Safari reports `webkitCompassHeading`
 * directly; other browsers give `alpha` relative to north only on absolute events, where
 * alpha runs counter-clockwise. `screenAngle` is `screen.orientation.angle`, so a phone
 * held sideways still reports the direction the top of the screen points.
 */
export function compassHeading(r: OrientationReading, screenAngle = 0): number | undefined {
  if (typeof r.webkitCompassHeading === "number" && Number.isFinite(r.webkitCompassHeading)) {
    const err = r.webkitCompassAccuracy;
    if (typeof err === "number" && (err < 0 || err > MAX_COMPASS_ERROR_DEGREES)) return undefined;
    return normalizeDegrees(r.webkitCompassHeading + screenAngle);
  }
  if (r.absolute === true && typeof r.alpha === "number" && Number.isFinite(r.alpha)) {
    return normalizeDegrees(360 - r.alpha + screenAngle);
  }
  return undefined;
}

/** Signed shortest turn from `a` to `b`, in (-180, 180]. */
export function headingDelta(a: number, b: number): number {
  const d = normalizeDegrees(b - a);
  return d > 180 ? d - 360 : d;
}

/**
 * Low-pass filter on a compass value that knows 359° and 1° are neighbours. The sensor
 * fires tens of times a second and jitters by a few degrees; this keeps the marker and
 * the map from twitching without lagging a real turn by more than a moment.
 */
export function smoothHeading(prev: number | undefined, next: number, factor = 0.25): number {
  if (prev === undefined) return normalizeDegrees(next);
  return normalizeDegrees(prev + headingDelta(prev, next) * factor);
}

/** What the trip screen knows about the compass. */
export type HeadingStatus =
  /** No orientation API at all. */
  | "unsupported"
  /** iOS: the sensor is there but needs the student's say-so, from a tap. */
  | "needs-permission"
  /** Listening, but no north-anchored reading has come through yet (desktops stay here). */
  | "waiting"
  /** Readings are arriving. */
  | "on"
  /** Permission refused, or the sensor reported it cannot give a heading. */
  | "unavailable";
