/**
 * Whether the compact header shows, from where a scroll container is. Pure, so how it feels is
 * tested without a browser: a small movement changes nothing, a deliberate scroll down away from
 * the top hides the header, and a deliberate scroll back up, or a return near the top, brings it
 * back. Direction is judged over a whole run of movement, not frame by frame, which is what keeps
 * a thumb resting on the glass from flickering it.
 */

export interface HeaderScrollState {
  visible: boolean;
  /** Where the current run of movement in one direction began. */
  anchor: number;
  /** The last position seen. */
  last: number;
}

export interface HeaderScrollTuning {
  /** Always shown this close to the top. */
  topZone: number;
  /** Downward travel in one run before the header hides. */
  hideAfter: number;
  /** Upward travel in one run before it comes back. */
  showAfter: number;
}

export const HEADER_SCROLL: HeaderScrollTuning = { topZone: 24, hideAfter: 32, showAfter: 24 };

export function initialHeaderScroll(top = 0): HeaderScrollState {
  const y = Math.max(0, top);
  return { visible: true, anchor: y, last: y };
}

/**
 * The next state for a scroll position. `max` is the furthest the container can scroll: iOS
 * bounces past both ends, and the content springing back from the bottom must not read as the
 * student scrolling up.
 */
export function nextHeaderScroll(prev: HeaderScrollState, top: number, max = Number.POSITIVE_INFINITY, tuning = HEADER_SCROLL): HeaderScrollState {
  const y = Math.min(Math.max(0, top), Math.max(0, max));
  if (y <= tuning.topZone) {
    return prev.visible && prev.anchor === y && prev.last === y ? prev : { visible: true, anchor: y, last: y };
  }
  const step = y - prev.last;
  if (step === 0) return prev;
  const run = prev.last - prev.anchor;
  // A change of direction starts a new run from where the old one stopped.
  const anchor = run !== 0 && Math.sign(step) !== Math.sign(run) ? prev.last : prev.anchor;
  const travel = y - anchor;
  const visible = prev.visible ? travel < tuning.hideAfter : -travel >= tuning.showAfter;
  return { visible, anchor, last: y };
}
