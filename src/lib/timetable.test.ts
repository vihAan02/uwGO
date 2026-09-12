import { describe, expect, it } from "vitest";
import { blockGeometry, dayBounds, HOUR_HEIGHT, hourMarks, layoutDay, type TimetableEvent } from "./timetable";

const at = (id: string, start: number, end: number): TimetableEvent => ({ id, start, end });
const columnsOf = (placed: ReturnType<typeof layoutDay>) => placed.map((p) => `${p.item.id}:${p.column}/${p.columns}`);

describe("placing classes that do not clash", () => {
  it("gives each a full-width lane", () => {
    const placed = layoutDay([at("a", 600, 680), at("b", 780, 860)]);
    expect(columnsOf(placed)).toEqual(["a:0/1", "b:0/1"]);
  });

  it("treats a class that ends when the next begins as not overlapping", () => {
    const placed = layoutDay([at("a", 600, 680), at("b", 680, 760)]);
    expect(columnsOf(placed)).toEqual(["a:0/1", "b:0/1"]);
  });

  it("gives an empty day nothing to draw", () => {
    expect(layoutDay([])).toEqual([]);
  });
});

describe("placing classes that clash", () => {
  it("splits two overlapping classes into two lanes", () => {
    const placed = layoutDay([at("a", 600, 700), at("b", 660, 760)]);
    expect(columnsOf(placed)).toEqual(["a:0/2", "b:1/2"]);
  });

  it("keeps a long lecture beside the short tutorials it spans", () => {
    // The case a "compare with the previous event" implementation gets wrong: the 3-hour lab
    // overlaps all three tutorials, but the tutorials do not overlap each other.
    const placed = layoutDay([at("lab", 600, 780), at("t1", 610, 660), at("t2", 670, 720), at("t3", 730, 775)]);
    expect(placed.every((p) => p.columns === 2)).toBe(true);
    expect(placed.find((p) => p.item.id === "lab")!.column).toBe(0);
    // The tutorials reuse the second lane one after another rather than each taking a new one.
    expect(placed.filter((p) => p.item.id !== "lab").every((p) => p.column === 1)).toBe(true);
  });

  it("handles three at once, then frees the lanes again", () => {
    const placed = layoutDay([at("a", 600, 700), at("b", 610, 700), at("c", 620, 700), at("later", 800, 860)]);
    expect(placed.filter((p) => p.item.id !== "later").map((p) => p.columns)).toEqual([3, 3, 3]);
    expect(columnsOf(placed).at(-1)).toBe("later:0/1");
  });

  it("copes with irregular start times", () => {
    const placed = layoutDay([at("a", 605, 695), at("b", 632, 719), at("c", 700, 733)]);
    expect(placed.find((p) => p.item.id === "c")!.column).toBe(0); // "a" has finished by 700
    expect(placed.every((p) => p.columns === 2)).toBe(true);
  });
});

describe("the grid the blocks sit on", () => {
  it("shows the teaching day around the classes, rounded to whole hours", () => {
    expect(dayBounds([at("a", 610, 700)])).toEqual({ from: 10 * 60, to: 12 * 60 });
    expect(dayBounds([])).toEqual({ from: 8 * 60, to: 18 * 60 });
  });

  it("never runs past the ends of the day", () => {
    const b = dayBounds([at("early", 10, 60), at("late", 1380, 1439)]);
    expect(b.from).toBe(0);
    expect(b.to).toBe(24 * 60);
  });

  it("sizes a block by its real duration", () => {
    const bounds = { from: 9 * 60, to: 17 * 60 };
    expect(blockGeometry(at("a", 600, 660), bounds)).toEqual({ top: HOUR_HEIGHT, height: HOUR_HEIGHT });
    // An 80-minute class is exactly a third taller than an hour-long one.
    expect(blockGeometry(at("b", 600, 680), bounds).height).toBeCloseTo(HOUR_HEIGHT * (80 / 60), 6);
  });

  it("marks every hour of the window", () => {
    expect(hourMarks({ from: 9 * 60, to: 12 * 60 })).toEqual([540, 600, 660, 720]);
  });
});
