import { afterEach, describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { DURATION, prefersReducedMotion } from "./motion";

/**
 * DESIGN.md §14: every movement the app makes has a reduced-motion path, and motion stays short. A Node
 * test cannot watch an animation, so it holds the rule where it can be broken: any app component that
 * animates with Anime.js must also ask whether motion is welcome.
 */

const COMPONENTS = path.join(__dirname, "..", "components");

function sources(dir: string): { file: string; text: string }[] {
  return (readdirSync(dir, { recursive: true }) as string[])
    .filter((f) => f.endsWith(".tsx") && !f.endsWith(".test.tsx"))
    .map((f) => ({ file: f, text: readFileSync(path.join(dir, f), "utf8") }));
}

const g = globalThis as { window?: unknown };
afterEach(() => { delete g.window; });

describe("motion respects the student's settings", () => {
  it("guards every Anime.js animation in the app with a reduced-motion check", () => {
    const animating = sources(COMPONENTS).filter(({ text }) => /from "animejs"/.test(text));
    expect(animating.length).toBeGreaterThan(0);
    const unguarded = animating
      .filter(({ text }) => !/prefersReducedMotion|reducedMotion\(|reduceMotion|prefers-reduced-motion/.test(text))
      .map(({ file }) => file);
    expect(unguarded).toEqual([]);
  });

  it("reads the preference from the browser, and assumes motion is fine where there is no browser", () => {
    expect(prefersReducedMotion()).toBe(false);
    g.window = { matchMedia: (q: string) => ({ matches: q === "(prefers-reduced-motion: reduce)" }) };
    expect(prefersReducedMotion()).toBe(true);
  });

  it("keeps interface motion inside the 100-300ms budget, exits quicker than entrances", () => {
    for (const ms of Object.values(DURATION)) expect(ms).toBeGreaterThanOrEqual(100);
    for (const ms of Object.values(DURATION)) expect(ms).toBeLessThanOrEqual(300);
    expect(DURATION.exit).toBeLessThan(DURATION.base);
  });
});
