"use client";
import { useCallback, useSyncExternalStore } from "react";

/** Below Tailwind's `lg` breakpoint: the map-first phone layout with the bottom sheet. */
export const PHONE_LAYOUT = "(max-width: 63.999rem)";
export const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

/**
 * Whether a media query matches, kept current. The server render and hydration answer
 * `serverValue`, so the markup matches; the browser's own answer follows straight after. A derived
 * boolean rather than the window width, so a resize re-renders only when the answer flips.
 */
export function useMediaQuery(query: string, serverValue = false): boolean {
  const subscribe = useCallback((onChange: () => void) => {
    const mql = window.matchMedia(query);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => serverValue);
}

/** Read once, outside React: for animation code deciding whether to move at all. */
export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia(REDUCED_MOTION).matches;
}
