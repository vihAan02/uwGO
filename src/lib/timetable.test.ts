import { describe, expect, it } from "vitest";
import {
  blockGeometry, blockLines, DEFAULT_GRID, durationToHeight, formatHourLabel, formatTimeRange, gridBounds, gridHeight,
  HOUR_HEIGHT, hourMarks, layoutDay, linesHeight, timeToY, type GridBounds, type TimetableEvent,
} from "./timetable";

const at = (id: string, start: number, end: number): TimetableEvent => ({ id, start, end });
const columnsOf = (placed: ReturnType<typeof layoutDay>) => placed.map((p) => `${p.item.id}:${p.column}/${p.columns}`);
const hm = (h: number, m = 0) => h * 60 + m;

describe("one conversion from time to pixels", () => {
  const grid: GridBounds = { fromHour: 8, toHour: 18 };
  const hourLine = (h: number) => timeToY(hm(h), grid);

  it("draws the hour lines exactly one hour-height apart, from the top of the grid", () => {
    expect(hourLine(8)).toBe(0);
    expect(hourLine(9) - hourLine(8)).toBe(HOUR_HEIGHT);
    expect(hourLine(13) - hourLine(12)).toBe(HOUR_HEIGHT);
    expect(gridHeight(grid)).toBe(timeToY(hm(18), grid));
  });

  it("starts a class at :00 exactly on its hour line", () => {
    expect(blockGeometry(at("a", hm(12), hm(12, 50)), grid).top).toBe(hourLine(12));
  });

  it("starts a class at :20 a third of the way to the next hour", () => {
    expect(blockGeometry(at("a", hm(12, 20), hm(13, 10)), grid).top).toBeCloseTo(hourLine(12) + HOUR_HEIGHT / 3, 9);
  });

  it("starts a class at :30 exactly halfway between the hour lines", () => {
    const { top } = blockGeometry(at("a", hm(12, 30), hm(13, 20)), grid);
    expect(top).toBe((hourLine(12) + hourLine(13)) / 2);
  });

  it("starts a class at :50 five sixths of the way to the next hour", () => {
    expect(blockGeometry(at("a", hm(9, 50), hm(10, 40)), grid).top).toBeCloseTo(hourLine(9) + (HOUR_HEIGHT * 5) / 6, 9);
  });

  it.each([
    [50, hm(12, 30), hm(13, 20)],
    [80, hm(10), hm(11, 20)],
    [110, hm(14, 30), hm(16, 20)],
  ])("makes a %i-minute class exactly that many minutes tall, ending on its end time", (minutes, start, end) => {
    const { top, height } = blockGeometry(at("a", start, end), grid);
    expect(height).toBeCloseTo((HOUR_HEIGHT * minutes) / 60, 9);
    expect(height).toBeCloseTo(durationToHeight(minutes), 9);
    expect(top + height).toBeCloseTo(timeToY(end, grid), 9);
  });

  it("keeps durations proportional: 110 minutes is 2.2 times 50", () => {
    expect(durationToHeight(110) / durationToHeight(50)).toBeCloseTo(2.2, 9);
    expect(durationToHeight(80) / durationToHeight(50)).toBeCloseTo(1.6, 9);
  });

  it("marks every hour the grid shows, top to bottom", () => {
    expect(hourMarks({ fromHour: 9, toHour: 12 })).toEqual([9, 10, 11]);
  });
});

describe("placing classes that do not clash", () => {
  it("gives each a full-width lane", () => {
    expect(columnsOf(layoutDay([at("a", 600, 680), at("b", 780, 860)]))).toEqual(["a:0/1", "b:0/1"]);
  });

  it("treats a class that ends when the next begins as not overlapping", () => {
    expect(columnsOf(layoutDay([at("a", 600, 680), at("b", 680, 760)]))).toEqual(["a:0/1", "b:0/1"]);
  });

  it("gives an empty day nothing to draw", () => {
    expect(layoutDay([])).toEqual([]);
  });
});

describe("placing classes that clash", () => {
  it("splits two overlapping classes into two lanes, each still at its own true time", () => {
    const grid: GridBounds = { fromHour: 9, toHour: 18 };
    const lecture = at("lec", hm(12, 30), hm(13, 20));
    const tutorial = at("tut", hm(13), hm(13, 50));
    const placed = layoutDay([tutorial, lecture]);
    expect(columnsOf(placed)).toEqual(["lec:0/2", "tut:1/2"]);
    expect(blockGeometry(lecture, grid).top).toBe(timeToY(hm(12, 30), grid));
    expect(blockGeometry(tutorial, grid).top).toBe(timeToY(hm(13), grid));
  });

  it("keeps a long lab beside the short tutorials it spans", () => {
    // The case a "compare with the previous event" implementation gets wrong: the 3-hour lab
    // overlaps all three tutorials, but the tutorials do not overlap each other.
    const placed = layoutDay([at("lab", 600, 780), at("t1", 610, 660), at("t2", 670, 720), at("t3", 730, 775)]);
    expect(placed.every((p) => p.columns === 2)).toBe(true);
    expect(placed.find((p) => p.item.id === "lab")!.column).toBe(0);
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

describe("the hours the grid shows", () => {
  it("opens on UW Flow's 9 to 5 day when every class fits inside it", () => {
    expect(gridBounds([])).toEqual(DEFAULT_GRID);
    expect(gridBounds([at("a", hm(10), hm(11, 20)), at("b", hm(16), hm(17, 50))])).toEqual(DEFAULT_GRID);
  });

  it("widens to whole hours around an early or late class", () => {
    expect(gridBounds([at("early", hm(8, 30), hm(9, 20))])).toEqual({ fromHour: 8, toHour: 18 });
    expect(gridBounds([at("late", hm(19), hm(21, 50))])).toEqual({ fromHour: 9, toHour: 22 });
  });

  it("never runs past the ends of the day", () => {
    expect(gridBounds([at("early", 10, 60), at("late", 1380, 1439)])).toEqual({ fromHour: 0, toHour: 24 });
  });
});

describe("what a block has room to say", () => {
  it("shows the code, time, section and room on a long class", () => {
    expect(blockLines(durationToHeight(80))).toEqual(["code", "time", "section", "room"]);
    expect(blockLines(durationToHeight(110))).toEqual(["code", "time", "section", "room"]);
  });

  it("keeps the code and time first on a 50-minute class, and folds the rest into one line", () => {
    expect(blockLines(durationToHeight(50))).toEqual(["code", "time", "sectionAndRoom"]);
  });

  it("drops to the code and time, then the code alone, as a block gets shorter", () => {
    expect(blockLines(durationToHeight(40)).slice(0, 2)).toEqual(["code", "time"]);
    expect(blockLines(durationToHeight(20))).toEqual(["code"]);
  });

  it("never asks for more height than the block has, at any duration a class can have", () => {
    for (let minutes = 25; minutes <= 360; minutes++) {
      const height = durationToHeight(minutes);
      expect(linesHeight(blockLines(height)), `${minutes} min`).toBeLessThanOrEqual(height);
    }
  });

  it("always shows at least as much on a longer class as on a shorter one", () => {
    for (let minutes = 10; minutes < 360; minutes++) {
      expect(blockLines(durationToHeight(minutes + 1)).length).toBeGreaterThanOrEqual(blockLines(durationToHeight(minutes)).length);
    }
  });
});

describe("time labels", () => {
  it("writes a block's time compactly and the gutter's hours in full", () => {
    expect(formatTimeRange(hm(12, 30), hm(13, 20))).toBe("12:30–1:20");
    expect(formatTimeRange(hm(8, 30), hm(9, 50))).toBe("8:30–9:50");
    expect([0, 9, 12, 13].map(formatHourLabel)).toEqual(["12 AM", "9 AM", "12 PM", "1 PM"]);
  });
});
