import { describe, expect, it, vi } from "vitest";
import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CampusLocation, ClassTransition, RouteOption } from "@/domain/types";
import { buildingLocation, findBuilding } from "@/data/buildings";
import { indoorRouteBetween } from "@/engine/indoorRoute";
import { IndoorComparison, pressable, type Selectable } from "./DayTimeline";

type El = ReactElement<{ children?: ReactNode; onClick?: (e: unknown) => void; "aria-pressed"?: boolean; type?: string }>;

/** Expands hook-free components into host elements, so a handler can be called the way a click calls it. */
function expand(node: ReactNode): ReactNode {
  if (Array.isArray(node)) return node.map(expand);
  if (!isValidElement(node)) return node;
  const el = node as El;
  if (typeof el.type === "function") return expand((el.type as (p: unknown) => ReactNode)(el.props));
  return { ...el, props: { ...el.props, children: expand(el.props.children) } } as El;
}

function buttons(node: ReactNode): El[] {
  if (Array.isArray(node)) return node.flatMap(buttons);
  if (!isValidElement(node)) return [];
  const el = node as El;
  return [...(el.type === "button" ? [el] : []), ...buttons(el.props.children)];
}

function text(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(text).join("");
  if (typeof node === "string" || typeof node === "number") return String(node);
  return isValidElement(node) ? text((node as El).props.children) : "";
}

const place = (code: string): CampusLocation => buildingLocation(findBuilding("UW", code)!)!;

/** STC -> MC: Google's 4 minute walk, with the STC -> B2 -> QNC -> MC tunnel as the winter alternative. */
async function stcToMc(): Promise<ClassTransition> {
  const from = place("STC");
  const to = place("MC");
  const fastest: RouteOption = { mode: "WALK", durationMinutes: 4, distanceMeters: 300, polyline: "google", provider: "google-routes", computedAt: "x", isEstimate: false };
  return {
    id: "stc->mc", kind: "CLASS_TO_CLASS", from, to,
    departAfter: new Date("2026-09-11T15:20:00Z"), arriveBy: new Date("2026-09-11T15:30:00Z"), hasDeadline: true, availableMinutes: 10,
    walkingRoute: fastest, indoorRoute: await indoorRouteBetween(from, to), recommendedRoute: fastest,
    recommendedDeparture: new Date("2026-09-11T15:21:00Z"), expectedArrival: new Date("2026-09-11T15:25:00Z"),
    feasibility: "TIGHT", crossCampus: false,
  };
}

const LABEL = "MATH 137 (STC) → CS 135 (MC)";

describe("the Fastest / Winter route choice on a leg", () => {
  it("Winter route is a button that shows the indoor path, and the leg row underneath does not take the click", async () => {
    const t = await stcToMc();
    expect(t.indoorRoute?.indoorPath).toEqual(["STC", "B2", "QNC", "MC"]);
    const onSelect = vi.fn();
    const sel: Selectable = { selectedId: undefined, onSelect };
    const [fastest, winter] = buttons(expand(createElement(IndoorComparison, { t, id: "leg-3", label: LABEL, sel })));
    expect(text(fastest)).toMatch(/^Fastest · 4 min/);
    expect(text(winter)).toMatch(/^Winter route · \d+ min/);

    const stopPropagation = vi.fn();
    winter.props.onClick!({ stopPropagation });
    expect(stopPropagation).toHaveBeenCalled();
    expect(onSelect).toHaveBeenCalledWith("leg-3-winter", { kind: "LEG", label: LABEL, from: t.from, to: t.to, route: t.indoorRoute, walkFallback: t.walkingRoute });

    fastest.props.onClick!({ stopPropagation });
    expect(onSelect).toHaveBeenLastCalledWith("leg-3-fastest", { kind: "LEG", label: LABEL, from: t.from, to: t.to, route: t.walkingRoute, walkFallback: t.walkingRoute });
  });

  it("lights the way the map is showing, and the plan's own choice until one is tapped", async () => {
    const t = await stcToMc();
    const pressed = (selectedId: string | undefined, tt = t) =>
      buttons(expand(createElement(IndoorComparison, { t: tt, id: "leg-3", label: LABEL, sel: { selectedId, onSelect: () => {} } }))).map((b) => b.props["aria-pressed"]);
    expect(pressed(undefined)).toEqual([true, false]);
    expect(pressed("leg-3")).toEqual([true, false]);
    expect(pressed("leg-3-winter")).toEqual([false, true]);
    expect(pressed("leg-3-fastest")).toEqual([true, false]);
    expect(pressed("leg-4-winter")).toEqual([true, false]);
    // A student who prefers indoors: the plan took the tunnel, and tapping Fastest still switches.
    const indoors = { ...t, recommendedRoute: t.indoorRoute };
    expect(pressed(undefined, indoors)).toEqual([false, true]);
    expect(pressed("leg-3-fastest", indoors)).toEqual([true, false]);

    const html = renderToStaticMarkup(createElement(IndoorComparison, { t, id: "leg-3", label: LABEL, sel: { selectedId: "leg-3-winter", onSelect: () => {} } }));
    expect(html.match(/<button type="button" aria-pressed="(true|false)"/g)).toEqual(['<button type="button" aria-pressed="false"', '<button type="button" aria-pressed="true"']);
  });
});

describe("a pressable timeline row", () => {
  const key = (k: string, onRow: boolean) => {
    const row = {};
    return { key: k, currentTarget: row, target: onRow ? row : {}, preventDefault: vi.fn() };
  };

  it("selects on Enter or Space pressed on the row itself", () => {
    const select = vi.fn();
    const { onKeyDown } = pressable(select);
    const enter = key("Enter", true);
    onKeyDown(enter as never);
    onKeyDown(key(" ", true) as never);
    expect(select).toHaveBeenCalledTimes(2);
    expect(enter.preventDefault).toHaveBeenCalled();
  });

  it("leaves keys pressed on a control inside the row (Google Maps, Remind me, a route choice) to that control", () => {
    const select = vi.fn();
    const enter = key("Enter", false);
    pressable(select).onKeyDown(enter as never);
    pressable(select).onKeyDown(key(" ", false) as never);
    expect(select).not.toHaveBeenCalled();
    expect(enter.preventDefault).not.toHaveBeenCalled();
  });
});
