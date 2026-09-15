import { describe, expect, it } from "vitest";
import { HEADER_SCROLL, initialHeaderScroll, nextHeaderScroll, type HeaderScrollState } from "./headerScroll";

/** Feeds positions in order, the way scroll events arrive. */
function scroll(positions: number[], from: HeaderScrollState = initialHeaderScroll(), max?: number): HeaderScrollState {
  return positions.reduce((s, y) => nextHeaderScroll(s, y, max), from);
}

/** Scrolled some way down with the header showing and no movement under way. */
const resting = (at: number): HeaderScrollState => ({ visible: true, anchor: at, last: at });

describe("the compact header hiding while the student scrolls", () => {
  it("stays put for a thumb resting on the glass", () => {
    expect(scroll([302, 299, 304, 301, 306], resting(300)).visible).toBe(true);
  });

  it("hides after a deliberate scroll down, and not before", () => {
    expect(nextHeaderScroll(resting(100), 100 + HEADER_SCROLL.hideAfter - 1).visible).toBe(true);
    expect(nextHeaderScroll(resting(100), 100 + HEADER_SCROLL.hideAfter).visible).toBe(false);
  });

  it("comes back after a deliberate scroll up, but not for a small one", () => {
    const hidden = scroll([20, 120, 400]);
    expect(hidden.visible).toBe(false);
    expect(scroll([390], hidden).visible).toBe(false);
    expect(scroll([390, 400 - HEADER_SCROLL.showAfter + 1], hidden).visible).toBe(false);
    expect(scroll([390, 400 - HEADER_SCROLL.showAfter], hidden).visible).toBe(true);
  });

  it("measures travel from where the direction last changed, not from where scrolling began", () => {
    // Down, up 20 (not enough to show), then down 10: still hidden, the new run is only 10.
    expect(scroll([20, 340, 320, 330]).visible).toBe(false);
    // Up 20 and then another 10 is 30 in one run: shown.
    expect(scroll([20, 340, 320, 310]).visible).toBe(true);
  });

  it("always shows near the top, including iOS pulling past it", () => {
    const hidden = scroll([20, 200]);
    expect(hidden.visible).toBe(false);
    expect(nextHeaderScroll(hidden, HEADER_SCROLL.topZone).visible).toBe(true);
    expect(nextHeaderScroll(hidden, -35).visible).toBe(true);
  });

  it("ignores the content springing back from a bounce past the bottom", () => {
    const hidden = scroll([20, 500, 800], initialHeaderScroll(), 800);
    expect(hidden.visible).toBe(false);
    expect(scroll([860, 840, 800], hidden, 800).visible).toBe(false);
  });

  it("returns the same object when nothing changed, so a listener can skip work", () => {
    const top = scroll([10]);
    expect(nextHeaderScroll(top, 10)).toBe(top);
    const hidden = scroll([20, 200]);
    expect(nextHeaderScroll(hidden, 200)).toBe(hidden);
  });
});
