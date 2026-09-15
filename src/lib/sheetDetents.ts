/**
 * Where the planner's bottom sheet rests, and where it goes when the student lets go of it. Pure:
 * every number is pixels of the planner's own height, so how the sheet feels is tested without a
 * phone. See DESIGN.md §12.
 */

export type Detent = "peek" | "mid" | "expanded";

/** Visible heights, in px from the bottom of the planner. `mid` is absent when there is no room for it. */
export interface Detents {
  peek: number;
  mid?: number;
  expanded: number;
}

export const SHEET = {
  midShare: 0.5,
  expandedShare: 0.76,
  /** Map that must stay visible above the expanded sheet. */
  minMapAbove: 176,
  /**
   * The smallest peek, and the most of the screen a peek may take. Below that cap a peek always shows all
   * of its content: only a landscape phone with large text comes near it.
   */
  minPeek: 96,
  maxPeekShare: 0.6,
  /** A detent closer than this to a neighbour is not worth a stop. */
  minGap: 96,
  /** Faster than this, in px per ms, a release is a flick. */
  flickVelocity: 0.45,
  /** How far ahead a slow release is projected, in ms. */
  projectMs: 180,
  /** Past either end the sheet moves this much per px of finger. */
  rubber: 0.35,
} as const;

/**
 * The detents for a planner `viewport` px tall whose summary needs `peekContent` px (handle, the
 * summary's first block and the bottom safe area). The peek is never cut short of that content: a Start
 * button half off the screen or under the home indicator costs more than the strip of map it would save.
 */
export function computeDetents(viewport: number, peekContent: number): Detents {
  const peek = Math.round(Math.min(Math.max(peekContent, SHEET.minPeek), viewport * SHEET.maxPeekShare));
  const expanded = Math.round(Math.max(peek + SHEET.minGap, Math.min(viewport * SHEET.expandedShare, viewport - SHEET.minMapAbove)));
  const mid = Math.round(viewport * SHEET.midShare);
  const midFits = mid - peek >= SHEET.minGap && expanded - mid >= SHEET.minGap;
  return midFits ? { peek, mid, expanded } : { peek, expanded };
}

export function detentOrder(d: Detents): Detent[] {
  return d.mid === undefined ? ["peek", "expanded"] : ["peek", "mid", "expanded"];
}

/** The height of a detent; a missing mid stands in as whichever end is nearer half way. */
export function heightOf(d: Detents, detent: Detent): number {
  if (detent === "peek") return d.peek;
  if (detent === "expanded") return d.expanded;
  return d.mid ?? d.peek;
}

/** The detent this layout has that is closest to `wanted`, for a layout that lost its mid. */
export function available(d: Detents, wanted: Detent): Detent {
  return wanted === "mid" && d.mid === undefined ? "peek" : wanted;
}

/** A dragged height, resisted past either end. */
export function rubberBand(height: number, d: Detents): number {
  if (height > d.expanded) return d.expanded + (height - d.expanded) * SHEET.rubber;
  if (height < d.peek) return d.peek - (d.peek - height) * SHEET.rubber;
  return height;
}

function nearest(d: Detents, height: number): Detent {
  let best: Detent = "peek";
  for (const detent of detentOrder(d)) {
    if (Math.abs(heightOf(d, detent) - height) < Math.abs(heightOf(d, best) - height)) best = detent;
  }
  return best;
}

/**
 * Where a released sheet goes. `velocity` is px per ms, positive while the sheet grows. A flick moves
 * to the next detent past where the sheet was let go, in the flick's direction, and never skips one;
 * a slow release settles on the detent nearest where the sheet was heading.
 */
export function releaseDetent(d: Detents, height: number, velocity: number): Detent {
  const order = detentOrder(d);
  if (velocity >= SHEET.flickVelocity) return order.find((x) => heightOf(d, x) > height + 1) ?? "expanded";
  if (velocity <= -SHEET.flickVelocity) return [...order].reverse().find((x) => heightOf(d, x) < height - 1) ?? "peek";
  return nearest(d, height + velocity * SHEET.projectMs);
}

/** One detent up (1) or down (-1), for the keyboard and the handle. */
export function stepDetent(d: Detents, from: Detent, direction: 1 | -1): Detent {
  const order = detentOrder(d);
  const at = order.indexOf(available(d, from));
  return order[Math.min(order.length - 1, Math.max(0, at + direction))];
}
