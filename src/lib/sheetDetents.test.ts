import { describe, expect, it } from "vitest";
import { SHEET, available, computeDetents, detentOrder, heightOf, releaseDetent, rubberBand, stepDetent } from "./sheetDetents";

describe("where the planner sheet rests", () => {
  it("peeks at the summary, sits at half, and expands while leaving the map in view", () => {
    // iPhone 13 mini, a 130px summary.
    expect(computeDetents(812, 130)).toEqual({ peek: 130, mid: 406, expanded: 617 });
    expect(812 - 617).toBeGreaterThanOrEqual(SHEET.minMapAbove);
  });

  it("keeps the minimum of map above the sheet on a short phone, not the share", () => {
    const d = computeDetents(568, 130);
    expect(d.expanded).toBe(568 - SHEET.minMapAbove);
    expect(d.mid).toBe(284);
  });

  it("drops the middle stop when a landscape phone has no room for it", () => {
    const d = computeDetents(390, 130);
    expect(d.mid).toBeUndefined();
    expect(detentOrder(d)).toEqual(["peek", "expanded"]);
    expect(d.expanded - d.peek).toBeGreaterThanOrEqual(SHEET.minGap);
  });

  it("never lets the peek swallow the screen, nor shrink below a usable strip", () => {
    expect(computeDetents(700, 500).peek).toBe(Math.round(700 * SHEET.maxPeekShare));
    expect(computeDetents(812, 40).peek).toBe(SHEET.minPeek);
  });

  it("never cuts a landscape phone's peek short of its content, so Start stays above the home indicator", () => {
    // 812x375: handle, a 128px summary block and 14px under it, plus a 21px bottom inset.
    const d = computeDetents(375, 187);
    expect(d.peek).toBe(187);
    expect(d.mid).toBeUndefined();
    expect(d.expanded - d.peek).toBeGreaterThanOrEqual(SHEET.minGap);
    expect(d.expanded).toBeLessThan(375);
  });

  it("gives a missing mid's place to the peek", () => {
    const d = computeDetents(390, 130);
    expect(available(d, "mid")).toBe("peek");
    expect(heightOf(d, "mid")).toBe(d.peek);
    expect(available(computeDetents(812, 130), "mid")).toBe("mid");
  });
});

describe("dragging and letting go", () => {
  const d = computeDetents(812, 130); // 130 / 406 / 617

  it("follows the finger between the ends and resists past them", () => {
    expect(rubberBand(300, d)).toBe(300);
    expect(rubberBand(717, d)).toBeCloseTo(617 + 100 * SHEET.rubber);
    expect(rubberBand(80, d)).toBeCloseTo(130 - 50 * SHEET.rubber);
  });

  it("settles a slow release on the detent nearest where it was heading", () => {
    expect(releaseDetent(d, 390, 0)).toBe("mid");
    expect(releaseDetent(d, 160, 0)).toBe("peek");
    // Let go just under half way from mid to expanded, still drifting up.
    expect(releaseDetent(d, 500, 0.3)).toBe("expanded");
    expect(releaseDetent(d, 500, -0.1)).toBe("mid");
  });

  it("moves a flick on by one detent in its direction and never skips one", () => {
    expect(releaseDetent(d, 140, 1.5)).toBe("mid");
    expect(releaseDetent(d, 410, 1.5)).toBe("expanded");
    expect(releaseDetent(d, 600, -1.5)).toBe("mid");
    expect(releaseDetent(d, 400, -1.5)).toBe("peek");
    // A finger that dragged all the way past mid before flicking up goes to expanded.
    expect(releaseDetent(d, 450, 0.8)).toBe("expanded");
  });

  it("stays put at an end when flicked further that way", () => {
    expect(releaseDetent(d, 640, 2)).toBe("expanded");
    expect(releaseDetent(d, 110, -2)).toBe("peek");
  });

  it("flicks between the two stops a landscape layout has", () => {
    const flat = computeDetents(390, 130);
    expect(releaseDetent(flat, 140, 1)).toBe("expanded");
    expect(releaseDetent(flat, flat.expanded - 5, -1)).toBe("peek");
  });
});

describe("stepping with the keyboard or the handle", () => {
  it("steps one detent at a time and stops at the ends", () => {
    const d = computeDetents(812, 130);
    expect(stepDetent(d, "peek", 1)).toBe("mid");
    expect(stepDetent(d, "mid", 1)).toBe("expanded");
    expect(stepDetent(d, "expanded", 1)).toBe("expanded");
    expect(stepDetent(d, "mid", -1)).toBe("peek");
    expect(stepDetent(d, "peek", -1)).toBe("peek");
  });

  it("steps over the missing mid on a landscape phone", () => {
    const flat = computeDetents(390, 130);
    expect(stepDetent(flat, "peek", 1)).toBe("expanded");
    expect(stepDetent(flat, "mid", 1)).toBe("expanded");
    expect(stepDetent(flat, "expanded", -1)).toBe("peek");
  });
});
