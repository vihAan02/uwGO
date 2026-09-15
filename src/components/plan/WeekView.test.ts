import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The planner's map must stay mounted for the life of the page (DESIGN.md §2): a remount loses the
 * student's camera, flashes tiles and bills another Dynamic Maps load. These are the shapes that would
 * remount it, checked in the source because a Node test cannot mount Google Maps.
 */

const read = (file: string) => readFileSync(path.join(__dirname, file), "utf8");
const weekView = read("WeekView.tsx");
const mapPanel = read("../map/MapPanel.tsx");

describe("the planner map stays mounted", () => {
  it("is rendered exactly once, unconditionally", () => {
    const uses = weekView.match(/<MapPanel\b/g) ?? [];
    expect(uses).toHaveLength(1);
    const line = weekView.split("\n").find((l) => l.includes("<MapPanel"))!;
    // Not behind `cond && <MapPanel` or `cond ? <MapPanel`, which would unmount it when the condition flips.
    expect(line.trimStart().startsWith("<MapPanel")).toBe(true);
    const before = weekView.slice(0, weekView.indexOf("<MapPanel")).trimEnd();
    expect(before.endsWith("&&")).toBe(false);
    expect(before.endsWith("?")).toBe(false);
    expect(before.endsWith("(")).toBe(false);
  });

  it("lives outside the sheet and the day's tab panel, so neither a detent nor a day change can take it with them", () => {
    const at = weekView.indexOf("<MapPanel");
    expect(at).toBeLessThan(weekView.indexOf("<PlanSheet"));
    const tabsOpen = weekView.indexOf("<TabsContent");
    const tabsClose = weekView.indexOf("</TabsContent>");
    expect(at < tabsOpen || at > tabsClose).toBe(true);
  });

  it("is never keyed, and neither is the element around it", () => {
    const at = weekView.indexOf("<MapPanel");
    const container = weekView.lastIndexOf("<div", at);
    expect(weekView.slice(container, weekView.indexOf("/>", at))).not.toMatch(/\bkey=/);
  });

  it("is imported once at module scope, so the dynamic wrapper is a stable component", () => {
    const dynamicAt = weekView.indexOf("const MapPanel = dynamic(");
    expect(dynamicAt).toBeGreaterThan(-1);
    expect(dynamicAt).toBeLessThan(weekView.indexOf("export function WeekView"));
  });

  it("is memoised, so the sheet moving and the header hiding do not re-render the map", () => {
    expect(mapPanel).toMatch(/export const MapPanel = memo\(/);
  });
});
