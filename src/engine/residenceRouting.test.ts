import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildWeekPlan, type PlanInput } from "./planner";
import { DEFAULT_PLANNER_CONFIG as CFG } from "@/domain/config";
import type { CourseMeeting, DayPlanItem, LatLng, RouteOption, UserHome } from "@/domain/types";
import { gapDateKey } from "@/domain/gapChoices";
import { CachedRoutingProvider, WALK_CACHE_TTL_MS } from "@/routing/CachedRoutingProvider";
import { EstimateRoutingProvider } from "@/routing/EstimateRoutingProvider";
import { pairKey, type RoutingProvider } from "@/routing/RoutingProvider";
import { LocalStorageRouteCacheStore } from "@/lib/routeCacheStore";

/**
 * Residence legs, the go-home card and the gap options reach routing through the same provider
 * stack the browser uses (CachedRoutingProvider over the localStorage cache). These tests replay
 * the bug where a browser that had once planned against a server with no GOOGLE_MAPS_SERVER_KEY
 * kept straight-line times for those pairs after the real provider was back.
 */

const MONDAY = "2026-09-14";
const ROUTES_KEY = "uwgo.routes.v1";
const home: UserHome = { name: "UW Place", latitude: 43.4708351, longitude: -80.53525, preset: { university: "UW", buildingCode: "UWP" } };

let n = 0;
const at = (h: number, m = 0) => h * 60 + m;
const meeting = (over: Partial<CourseMeeting>): CourseMeeting => ({
  id: `r${++n}`, university: "UW", courseCode: `CS ${100 + n}`, component: "LEC", days: ["M"], start: at(9), end: at(9, 50),
  location: { kind: "ROOM", buildingCode: "MC", roomNumber: "2065" }, source: "MANUAL", includeInPlan: true, ...over,
});

/** One day that walks every kind of trip: residence <-> building, building <-> building, residence <-> Laurier. */
const input: PlanInput = {
  meetings: [
    meeting({ id: "mc-9", start: at(9), end: at(9, 50) }),
    meeting({ id: "dc-10", start: at(10), end: at(10, 50), location: { kind: "ROOM", buildingCode: "DC", roomNumber: "1350" } }),
    meeting({ id: "lh-13", university: "WLU", start: at(13), end: at(14, 20), location: { kind: "ROOM", buildingCode: "LH", roomNumber: "1001" } }),
    meeting({ id: "mc-16", start: at(16, 30), end: at(17, 20) }),
  ],
  home,
  mondayISO: MONDAY,
  config: CFG,
  days: ["M"],
  gapChoices: { byDate: { [gapDateKey(MONDAY, "dc-10:M")]: { kind: "REZ" }, [gapDateKey(MONDAY, "lh-13:M")]: { kind: "REZ" } }, byClass: {} },
};

/** Stands in for Google Routes: a real walk for every pair (never the straight-line number), and a record of what was asked. */
class RealRoutes implements RoutingProvider {
  readonly id = "google-routes";
  readonly asked = new Set<string>();
  async getWalkingRoute(from: LatLng, to: LatLng): Promise<RouteOption> {
    this.asked.add(pairKey(from, to));
    const straight = await new EstimateRoutingProvider().getWalkingRoute(from, to);
    return { mode: "WALK", durationMinutes: straight.durationMinutes + 1, distanceMeters: straight.distanceMeters, polyline: "real", provider: "google-routes", computedAt: "2026-09-11T12:00:00.000Z", isEstimate: false };
  }
  async getTransitRoute(): Promise<RouteOption | undefined> {
    return undefined;
  }
}

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; },
    key: (i) => Array.from(m.keys())[i] ?? null,
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    clear: () => m.clear(),
  };
}

const cachedRoutes = (): Record<string, { route: RouteOption }> => JSON.parse(window.localStorage.getItem(ROUTES_KEY) ?? "{}");
const label = (l: { kind?: string; buildingCode?: string; id: string }) => (l.kind === "HOME" ? "home" : l.buildingCode ?? l.id);
const isGap = (i: DayPlanItem): i is Extract<DayPlanItem, { kind: "GAP" }> => i.kind === "GAP";

/** Writes what an estimate-mode server used to leave in the browser: a straight-line walk per pair, kept for 30 days. */
async function planOnceWithoutAKey(): Promise<string[]> {
  const pairs: string[] = [];
  const estimateServer: RoutingProvider = {
    id: "estimate",
    async getWalkingRoute(from, to) {
      const route = await new EstimateRoutingProvider().getWalkingRoute(from, to);
      new LocalStorageRouteCacheStore().set(`WALK|${pairKey(from, to)}`, { route, expiresAt: Date.now() + WALK_CACHE_TTL_MS });
      pairs.push(pairKey(from, to));
      return route;
    },
    async getTransitRoute() { return undefined; },
  };
  await buildWeekPlan(input, estimateServer);
  return pairs;
}

describe("residence routing uses the real provider", () => {
  beforeEach(() => { vi.stubGlobal("window", { localStorage: memoryStorage() }); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("every leg of the day, the trip home and back, and every gap option come from the real provider, even over a cache of old estimates", async () => {
    const poisoned = await planOnceWithoutAKey();
    expect(Object.values(cachedRoutes()).every((e) => e.route.isEstimate)).toBe(true);

    const real = new RealRoutes();
    const plan = await buildWeekPlan(input, new CachedRoutingProvider(real, new LocalStorageRouteCacheStore()));
    const day = plan.days.M!;

    expect(plan.skipped).toEqual([]);
    expect(day.transitions.map((t) => `${label(t.from)}->${label(t.to)}`)).toEqual(["home->MC", "MC->DC", "DC->home", "home->LH", "LH->home", "home->MC", "MC->home"]);
    for (const t of day.transitions) {
      expect(t.walkingRoute, `${label(t.from)}->${label(t.to)}`).toMatchObject({ provider: "google-routes", isEstimate: false });
      expect(t.recommendedRoute?.isEstimate, `${label(t.from)}->${label(t.to)}`).toBe(false);
    }
    expect(plan.usesEstimates).toBe(false);

    // The go-home decision and the Trip home / Trip back buttons read these routes.
    const gaps = day.items.filter(isGap);
    const chosenRez = gaps.filter((g) => g.choice?.value.kind === "REZ");
    expect(chosenRez).toHaveLength(2);
    for (const g of chosenRez) {
      expect(g.homeReturn?.routeHome).toMatchObject({ provider: "google-routes", isEstimate: false });
      expect(g.homeReturn?.routeBack).toMatchObject({ provider: "google-routes", isEstimate: false });
    }
    for (const g of gaps) for (const o of g.options) expect(o.isEstimate, `${g.classId} ${o.id}`).toBe(false);

    // Every pair the estimate server had answered was asked again, and the browser cache now holds real routes.
    for (const p of poisoned) expect(real.asked.has(p), p).toBe(true);
    expect(Object.values(cachedRoutes()).some((e) => e.route.isEstimate)).toBe(false);
  });

  it("a server with no key still plans, flagged as estimates, and leaves nothing behind in the browser cache", async () => {
    const plan = await buildWeekPlan(input, new CachedRoutingProvider(new EstimateRoutingProvider(), new LocalStorageRouteCacheStore()));
    expect(plan.usesEstimates).toBe(true);
    expect(plan.days.M!.transitions.every((t) => t.walkingRoute?.isEstimate)).toBe(true);
    expect(cachedRoutes()).toEqual({});
  });
});
