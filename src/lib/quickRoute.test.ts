import { describe, expect, it, vi } from "vitest";
import type { LatLng, RouteOption, UserHome } from "@/domain/types";
import { findBuilding } from "@/data/buildings";
import { torontoDate } from "@/time/toronto";
import { ALREADY_THERE_METRES, planQuickRoute, positionProblem, type QuickRouteDeps } from "./quickRoute";

const at = (code: string): LatLng => {
  const b = findBuilding("UW", code)!;
  return { latitude: b.latitude!, longitude: b.longitude! };
};
const north = (p: LatLng, metres: number): LatLng => ({ latitude: p.latitude + metres / 111_320, longitude: p.longitude });
const walk: RouteOption = { mode: "WALK", durationMinutes: 6, durationSeconds: 360, provider: "google-routes", computedAt: "", isEstimate: false };
const home: UserHome = { name: "UW Place", latitude: 43.4708351, longitude: -80.53525, preset: { university: "UW", buildingCode: "UWP" } };
const TUESDAY_NOON = torontoDate("2026-09-15", 12 * 60);
const deps = (over: Partial<QuickRouteDeps> = {}): QuickRouteDeps => ({ home, position: async () => at("MC"), route: vi.fn(async () => walk), now: () => TUESDAY_NOON, ...over });

describe("quick routes from where the student is", () => {
  it("routes home from the live position, leaving now", async () => {
    const d = deps();
    const r = await planQuickRoute("HOME", d);
    expect(r.kind).toBe("ROUTE");
    if (r.kind !== "ROUTE") return;
    expect(r.to).toMatchObject({ kind: "HOME", name: "UW Place", buildingCode: "UWP" });
    expect(r.from.id).toBe("live-position");
    expect(r.from).toMatchObject(at("MC"));
    expect(r.route).toBe(walk);
    expect(d.route).toHaveBeenCalledWith(at("MC"), r.to, TUESDAY_NOON);
  });

  it("asks where the student lives before asking where they are", async () => {
    const position = vi.fn(async () => at("MC"));
    const r = await planQuickRoute("HOME", deps({ home: undefined, position }));
    expect(r).toEqual({ kind: "PROBLEM", message: "Set where you live to route home.", action: "SET_HOME" });
    expect(position).not.toHaveBeenCalled();
  });

  it("routes to the gym, and says so when the PAC is shut", async () => {
    const open = await planQuickRoute("GYM", deps());
    expect(open).toMatchObject({ kind: "ROUTE", to: { buildingCode: "PAC" } });
    expect(open.kind === "ROUTE" && open.note).toBeUndefined();
    // Fall-term weekdays run 6 am to 12:30 am: shut at 5 am, still open a quarter past midnight.
    const early = await planQuickRoute("GYM", deps({ now: () => torontoDate("2026-09-15", 5 * 60) }));
    expect(early).toMatchObject({ kind: "ROUTE", note: expect.stringMatching(/^The PAC opens at 6/) });
    const pastMidnight = await planQuickRoute("GYM", deps({ now: () => torontoDate("2026-09-16", 15) }));
    expect(pastMidnight.kind === "ROUTE" && pastMidnight.note).toBeUndefined();
  });

  it("goes to the library open now that is nearest, and says when none is open", async () => {
    const nearDavis = await planQuickRoute("LIBRARY", deps({ position: async () => north(at("DC"), 100) }));
    expect(nearDavis).toMatchObject({ kind: "ROUTE", to: { buildingCode: "DC", name: "Davis Centre Library" } });
    const nearDana = await planQuickRoute("LIBRARY", deps({ position: async () => north(at("LIB"), -100) }));
    expect(nearDana).toMatchObject({ kind: "ROUTE", to: { buildingCode: "LIB", name: "Dana Porter Library" } });
    // Sunday evening: both close at 5 pm.
    const position = vi.fn(async () => at("MC"));
    const sunday = await planQuickRoute("LIBRARY", deps({ now: () => torontoDate("2026-09-20", 19 * 60), position }));
    expect(sunday).toEqual({ kind: "PROBLEM", message: "No library is open right now." });
    expect(position).not.toHaveBeenCalled();
  });

  it("says the student is already there rather than routing a few metres", async () => {
    const route = vi.fn(async () => walk);
    const r = await planQuickRoute("GYM", deps({ position: async () => north(at("PAC"), ALREADY_THERE_METRES / 2), route }));
    expect(r).toMatchObject({ kind: "THERE", message: expect.stringMatching(/^You're already at /) });
    expect(route).not.toHaveBeenCalled();
  });

  it("explains a position it could not get, and a route it could not find", async () => {
    expect(await planQuickRoute("GYM", deps({ position: () => Promise.reject({ code: 1 }) }))).toEqual({ kind: "PROBLEM", message: "Allow location access to route from where you are." });
    expect(positionProblem({ code: 3 })).toMatch(/took too long/);
    expect(positionProblem(undefined)).toMatch(/isn't available/);
    expect(await planQuickRoute("GYM", deps({ route: async () => undefined }))).toMatchObject({ kind: "PROBLEM", message: expect.stringMatching(/^No route to /) });
    expect(await planQuickRoute("GYM", deps({ route: () => Promise.reject(new Error("offline")) }))).toMatchObject({ kind: "PROBLEM" });
  });
});
