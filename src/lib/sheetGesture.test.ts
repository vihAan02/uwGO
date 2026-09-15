import { describe, expect, it } from "vitest";
import { GESTURE, arbitrate, clickMayFollow, releaseVelocity, settleDuration, type TouchSituation } from "./sheetGesture";

const touch = (over: Partial<TouchSituation>): TouchSituation => ({ region: "content", detent: "mid", scrollTopAtStart: 0, dx: 0, dy: 0, cancelable: true, ...over });

describe("who a touch on the planner sheet belongs to", () => {
  it("waits for the finger to move before deciding anything", () => {
    expect(arbitrate(touch({ dy: GESTURE.slop - 1 }))).toBe("pending");
    expect(arbitrate(touch({ region: "grab", dy: -3, dx: 2 }))).toBe("pending");
  });

  it("gives any vertical drag on the handle or summary to the sheet, at every detent", () => {
    expect(arbitrate(touch({ region: "grab", detent: "expanded", scrollTopAtStart: 400, dy: -GESTURE.slop }))).toBe("sheet");
    expect(arbitrate(touch({ region: "grab", detent: "peek", dy: 12 }))).toBe("sheet");
  });

  it("moves the sheet from the list below expanded, where the list does not scroll", () => {
    expect(arbitrate(touch({ detent: "mid", dy: -10 }))).toBe("sheet");
    expect(arbitrate(touch({ detent: "peek", dy: 10 }))).toBe("sheet");
  });

  it("scrolls the list at expanded, except a pull down from its very top", () => {
    expect(arbitrate(touch({ detent: "expanded", scrollTopAtStart: 240, dy: 10 }))).toBe("native");
    expect(arbitrate(touch({ detent: "expanded", scrollTopAtStart: 240, dy: -10 }))).toBe("native");
    expect(arbitrate(touch({ detent: "expanded", scrollTopAtStart: 0, dy: -10 }))).toBe("native");
    expect(arbitrate(touch({ detent: "expanded", scrollTopAtStart: 0, dy: 10 }))).toBe("sheet");
  });

  it("leaves a sideways swipe to the browser, and a near-diagonal one to the sheet", () => {
    expect(arbitrate(touch({ dx: 9, dy: 6 }))).toBe("native");
    expect(arbitrate(touch({ dx: 7, dy: 6 }))).toBe("sheet");
    expect(arbitrate(touch({ region: "grab", dx: -12, dy: 2 }))).toBe("native");
  });

  it("never fights a scroll the browser has already started", () => {
    expect(arbitrate(touch({ detent: "mid", dy: 30, cancelable: false }))).toBe("native");
  });
});

describe("letting go", () => {
  it("measures velocity over the end of the drag only", () => {
    const samples = [{ t: 0, y: 500 }, { t: 100, y: 480 }, { t: 140, y: 440 }, { t: 180, y: 400 }];
    // The first sample is older than the window: 80px up over the last 80ms.
    expect(releaseVelocity(samples, 180)).toBeCloseTo(-1);
    expect(releaseVelocity([{ t: 0, y: 0 }], 10)).toBe(0);
    // Two samples a frame apart are not a flick of infinite speed.
    expect(releaseVelocity([{ t: 100, y: 0 }, { t: 101, y: 32 }], 101)).toBe(2);
  });

  it("settles longer trips a little more slowly, within 180-300ms", () => {
    expect(settleDuration(40)).toBe(180);
    expect(settleDuration(400)).toBe(240);
    expect(settleDuration(-900)).toBe(300);
  });

  it("only waits to swallow a click that can still come, so a finger drag never eats the next tap", () => {
    expect(clickMayFollow("mouse", 240)).toBe(true);
    expect(clickMayFollow("touch", GESTURE.tapSlop)).toBe(true);
    expect(clickMayFollow("touch", 240)).toBe(false);
  });
});
