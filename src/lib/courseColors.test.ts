import { describe, expect, it } from "vitest";
import {
  assignCourseColors, BLOCK_TITLE_COLOR, COURSE_COLORS, MAX_COURSE_COLORS, sanitizeCourseColors, withCourseColor,
} from "./courseColors";

/** WCAG 2.x contrast ratio between two #rrggbb colours. */
function contrast(a: string, b: string): number {
  const luminance = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("the colour palette stays readable", () => {
  it.each(COURSE_COLORS.map((c) => [c.name, c] as const))("%s: text on the block passes WCAG AA, the course code AAA", (_, c) => {
    expect(contrast(BLOCK_TITLE_COLOR, c.fill)).toBeGreaterThanOrEqual(7);
    expect(contrast(c.text, c.fill)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(COURSE_COLORS.map((c) => [c.name, c] as const))("%s: the rail stands out from its fill, and a white check reads on the swatch", (_, c) => {
    expect(contrast(c.rail, c.fill)).toBeGreaterThanOrEqual(3);
    expect(contrast(c.rail, "#ffffff")).toBeGreaterThanOrEqual(4.5);
  });

  it("offers distinct, named colours", () => {
    expect(new Set(COURSE_COLORS.map((c) => c.id)).size).toBe(COURSE_COLORS.length);
    expect(new Set(COURSE_COLORS.map((c) => c.rail)).size).toBe(COURSE_COLORS.length);
  });
});

describe("which course gets which colour", () => {
  it("gives courses the palette in alphabetical order until the student chooses", () => {
    const colors = assignCourseColors(["MATH 135", "CS 135", "ECON 101"]);
    expect([...colors.entries()].map(([k, c]) => `${k}:${c.id}`)).toEqual(["cs135:blue", "econ101:green", "math135:purple"]);
  });

  it("keys a colour on the course, however its code is spelled", () => {
    const colors = assignCourseColors(["CS 135", "cs135", "CS135"], { cs135: "red" });
    expect(colors.size).toBe(1);
    expect(colors.get("cs135")?.id).toBe("red");
  });

  it("uses the student's choice, and recolouring one course leaves the others where they were", () => {
    const before = assignCourseColors(["CS 135", "ECON 101", "MATH 135"]);
    const after = assignCourseColors(["CS 135", "ECON 101", "MATH 135"], { math135: "orange" });
    expect(after.get("math135")?.id).toBe("orange");
    expect(after.get("cs135")).toEqual(before.get("cs135"));
    expect(after.get("econ101")).toEqual(before.get("econ101"));
  });

  it("moves only the course whose default the student just picked, so no two courses match", () => {
    const after = assignCourseColors(["CS 135", "ECON 101", "MATH 135"], { math135: "blue" }); // CS 135's default
    expect(after.get("math135")?.id).toBe("blue");
    expect(after.get("econ101")?.id).toBe("green");
    expect(after.get("cs135")?.id).not.toBe("blue");
    expect(new Set([...after.values()].map((c) => c.id)).size).toBe(3);
  });

  it("wraps around the palette for a long course list", () => {
    const keys = Array.from({ length: COURSE_COLORS.length + 1 }, (_, i) => `sub${String(i).padStart(2, "0")}`);
    const colors = assignCourseColors(keys);
    expect(colors.get(keys.at(-1)!)?.id).toBe(COURSE_COLORS[0].id);
  });
});

describe("saved colours", () => {
  it("keeps valid choices and drops anything that is not a course key and palette colour", () => {
    const { colors, dropped } = sanitizeCourseColors({ cs135: "blue", bus352w: "purple", "CS 135": "red", math135: "chartreuse", econ101: 7 });
    expect(colors).toEqual({ cs135: "blue", bus352w: "purple" });
    expect(dropped).toBe(3);
    expect(sanitizeCourseColors("blue")).toEqual({ dropped: 1 });
    expect(sanitizeCourseColors({})).toEqual({ colors: undefined, dropped: 0 });
  });

  it("caps how many it keeps", () => {
    const many = Object.fromEntries(Array.from({ length: MAX_COURSE_COLORS + 5 }, (_, i) => [`c${i}`, "blue"]));
    const { colors, dropped } = sanitizeCourseColors(many);
    expect(Object.keys(colors!)).toHaveLength(MAX_COURSE_COLORS);
    expect(dropped).toBe(5);
  });

  it("sets and clears one course, and lets go of courses no longer in the schedule", () => {
    const scheduled = ["CS 135", "MATH 135"];
    const set = withCourseColor({ cs135: "blue", stat230: "red" }, "MATH 135", "purple", scheduled);
    expect(set).toEqual({ cs135: "blue", math135: "purple" });
    expect(withCourseColor(set, "cs135", undefined, scheduled)).toEqual({ math135: "purple" });
    expect(withCourseColor({ math135: "purple" }, "math135", undefined, scheduled)).toBeUndefined();
  });
});
