import type { Detent } from "./sheetDetents";

/**
 * Who owns a touch on the planner sheet: the sheet (it moves), the browser (the list scrolls, a row of
 * chips pans sideways), or nobody yet. Decided once per gesture from the first movement past a small
 * slop, following Base UI Drawer's arbitration (MIT). Two facts about the mobile web shape it: on iOS,
 * cancelling the first cancelable touchmove cancels native scrolling for the whole gesture, so nothing
 * is cancelled before the direction is known; and a touchmove that is no longer cancelable means the
 * browser is already scrolling, so the sheet lets it. See DESIGN.md §12.
 */

export type TouchOwner = "pending" | "sheet" | "native";

export const GESTURE = {
  /** Movement before a gesture is attributed. */
  slop: 6,
  /** Sideways movement must beat vertical by this much to be a sideways gesture. */
  bias: 2,
  /** Release velocity is measured over this much of the end of the drag. */
  velocityWindowMs: 80,
  minVelocityMs: 16,
  /** After a drag, a click arriving this soon belongs to the drag, not to what it started on. */
  suppressClickMs: 400,
  /** A finger that moved further than this made no tap, so no click follows its release. */
  tapSlop: 15,
} as const;

export interface TouchSituation {
  /** The handle and summary always move the sheet; the list below them may scroll. */
  region: "grab" | "content";
  detent: Detent;
  /** The list's scroll position when the finger went down. */
  scrollTopAtStart: number;
  /** Finger movement since touchstart; `dy` is positive while the finger moves down. */
  dx: number;
  dy: number;
  cancelable: boolean;
}

export function arbitrate(g: TouchSituation): TouchOwner {
  const ax = Math.abs(g.dx);
  const ay = Math.abs(g.dy);
  if (!g.cancelable) return "native";
  if (g.region === "grab") return ay >= GESTURE.slop ? "sheet" : ax >= GESTURE.slop ? "native" : "pending";
  if (ax >= GESTURE.slop && ax > ay + GESTURE.bias) return "native";
  if (ay < GESTURE.slop) return "pending";
  // Below expanded the list does not scroll: any vertical drag is the sheet's.
  if (g.detent !== "expanded") return "sheet";
  // Expanded: the list scrolls, except that pulling down from its very top collapses the sheet.
  return g.scrollTopAtStart <= 0 && g.dy > 0 ? "sheet" : "native";
}

export interface Sample { t: number; y: number }

/** Finger velocity in px per ms over the end of the drag; positive while the finger moves down. */
export function releaseVelocity(samples: readonly Sample[], now: number): number {
  const recent = samples.filter((s) => now - s.t <= GESTURE.velocityWindowMs);
  if (recent.length < 2) return 0;
  const first = recent[0];
  const last = recent[recent.length - 1];
  return (last.y - first.y) / Math.max(last.t - first.t, GESTURE.minVelocityMs);
}

/** How long a settle takes: a little longer for a longer trip, always between 180 and 300ms. */
export function settleDuration(distancePx: number): number {
  return Math.round(Math.min(300, Math.max(180, Math.abs(distancePx) * 0.6)));
}

/**
 * Whether a click can still follow a released drag: always for a mouse, whose press and release make one;
 * for a finger only when it barely moved, since browsers do not turn a drag into a tap. A guard armed for
 * a click that never comes would swallow the student's next real tap instead.
 */
export function clickMayFollow(pointer: "touch" | "mouse", travelPx: number): boolean {
  return pointer === "mouse" || travelPx <= GESTURE.tapSlop;
}
