/**
 * Motion tokens from DESIGN.md §14, for the code that animates with Anime.js. CSS transitions use the
 * same durations with the `ease-standard`, `ease-enter` and `ease-exit` utilities from globals.css.
 */
export const DURATION = {
  /** Press feedback. */
  press: 100,
  /** A segment chosen, a cross-fade, a number swap. */
  quick: 150,
  /** Something arriving: the header, a map control, new summary content, a drawn route. */
  base: 220,
  /** Something leaving: exits are quicker than entrances. */
  exit: 180,
} as const;

/** Anime.js's decelerating ease, the feel of `ease-enter` for motion driven from script. */
export const EASE_OUT = "out(3)";

export { prefersReducedMotion } from "./useMediaQuery";
