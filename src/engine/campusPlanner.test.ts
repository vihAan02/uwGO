import { describe, expect, it } from "vitest";
import { encode } from "@googlemaps/polyline-codec";
import { buildWeekPlan } from "./planner";
import { DEFAULT_PLANNER_CONFIG as CFG } from "@/domain/config";
import type { CourseMeeting, LatLng, RouteOption } from "@/domain/types";
import type { RoutingProvider } from "@/routing/RoutingProvider";
import { haversineMeters } from "@/routing/EstimateRoutingProvider";
import { findBuilding } from "@/data/buildings";
import { minutesBetween } from "@/time/toronto";

/**
 * Campus knowledge in a planned week: a leg to PAC goes in through SLC wherever the plan routes it,
 * and a leg Google already walks best is left exactly as it was.
 */

const MONDAY = "2026-09-14";
const SLC_PAC = "c34ea719b8b9dee5";

/** Google-shaped walks for every pair, timed from the distance, with a record of what was asked. */
class GoogleLike implements RoutingProvider {
  readonly id = "google-routes";
  readonly asked: string[] = [];
  /** Seconds for a pair, keyed as `asked` records it, where the distance should not decide. */
  constructor(private readonly times: Record<string, number> = {}) {}
  async getWalkingRoute(from: LatLng, to: LatLng): Promise<RouteOption> {
    const key = `${from.latitude.toFixed(5)},${from.longitude.toFixed(5)}->${to.latitude.toFixed(5)},${to.longitude.toFixed(5)}`;
    this.asked.push(key);
    const metres = haversineMeters(from, to) * 1.3;
    const seconds = this.times[key] ?? metres / 1.33;
    return { mode: "WALK", durationMinutes: Math.max(1, Math.ceil(seconds / 60)), durationSeconds: Math.round(seconds), distanceMeters: Math.round(metres), polyline: encode([[from.latitude, from.longitude], [to.latitude, to.longitude]]), provider: "google-routes", computedAt: "", isEstimate: false };
  }
  async getTransitRoute(): Promise<RouteOption | undefined> {
    return undefined;
  }
}

const meeting = (id: string, building: string, room: string, start: number, end: number): CourseMeeting => ({
  id, university: "UW", courseCode: `CS ${id}`, component: "LEC", days: ["T"], start, end,
  location: { kind: "ROOM", buildingCode: building, roomNumber: room }, source: "MANUAL", includeInPlan: true,
});

describe("campus knowledge in the weekly plan", () => {
  it("routes the end-of-day leg to the gym in through SLC, and the timeline shows that walk's own times", async () => {
    const plan = await buildWeekPlan({
      meetings: [meeting("mc", "MC", "2065", 14 * 60, 15 * 60)],
      mondayISO: MONDAY, config: CFG, days: ["T"], endOfDay: "GYM",
    }, new GoogleLike());
    const leg = plan.days.T!.transitions.at(-1)!;
    expect(leg.to.buildingCode).toBe("PAC");
    expect(leg.walkingRoute!.provider).toBe("google-routes");
    expect(leg.campus!.outcome).toBe("CORRECTED");
    const route = leg.recommendedRoute!;
    expect(route.provider).toBe("uw-campus");
    expect(route.indoorEdgeIds!.at(-1)).toBe(SLC_PAC);
    expect(minutesBetween(leg.recommendedDeparture!, leg.expectedArrival!)).toBe(route.durationMinutes);
    // The winter route is still offered alongside, as before.
    expect(leg.indoorRoute).toBeDefined();
  });

  it("leaves an MC to DC leg on Google's walk when that is fastest, and records that it looked", async () => {
    const mc = findBuilding("UW", "MC")!;
    const dc = findBuilding("UW", "DC")!;
    // A one-minute walk between the map points: nothing through a building or by another door can beat it.
    const google = new GoogleLike({ [`${mc.latitude!.toFixed(5)},${mc.longitude!.toFixed(5)}->${dc.latitude!.toFixed(5)},${dc.longitude!.toFixed(5)}`]: 60 });
    const plan = await buildWeekPlan({
      meetings: [meeting("mc", "MC", "2065", 9 * 60, 9 * 60 + 50), meeting("dc", "DC", "1350", 10 * 60, 10 * 60 + 50)],
      mondayISO: MONDAY, config: CFG, days: ["T"],
    }, google);
    const leg = plan.days.T!.transitions.find((t) => t.from.buildingCode === "MC" && t.to.buildingCode === "DC")!;
    expect(leg.campus?.outcome).toBe("KEPT_GOOGLE");
    // Google's walk, timed and planned floor to floor: out from room 2065 to the door, and in from the door to room 1350.
    const route = leg.recommendedRoute!;
    expect(route).toBe(leg.campusWalk);
    expect(route.provider).toBe("google-routes");
    expect(route.campus).toBeUndefined();
    expect(route.durationSeconds).toBe(leg.campus!.googleTotalSeconds);
    expect(route.durationSeconds!).toBeGreaterThan(leg.walkingRoute!.durationSeconds!);
    expect(minutesBetween(leg.recommendedDeparture!, leg.expectedArrival!)).toBe(route.durationMinutes);
  });

  it("prices a workout between classes on the walk into PAC through SLC, and the window's arithmetic holds on that walk", async () => {
    const wednesday = (m: CourseMeeting): CourseMeeting => ({ ...m, days: ["W"] });
    const plan = await buildWeekPlan({
      meetings: [wednesday(meeting("mc", "MC", "2065", 9 * 60, 10 * 60)), wednesday(meeting("dc", "DC", "1350", 11 * 60 + 30, 12 * 60 + 20))],
      mondayISO: MONDAY, config: CFG, days: ["W"], gym: { enabled: true, durationMinutes: 60, preferredTime: "NONE" },
    }, new GoogleLike());
    const between = plan.days.W!.gym.find((w) => w.slot === "BETWEEN")!;
    expect(between).toBeDefined();
    expect(between.routeIn.provider).toBe("uw-campus");
    expect(between.routeIn.indoorEdgeIds!.at(-1)).toBe(SLC_PAC);
    // Leaving PAC by its exit-only doors is allowed, so the walk out may simply be Google's.
    expect(between.usableMinutes).toBe(90 - between.routeIn.durationMinutes - between.routeOut.durationMinutes - CFG.arrivalBufferMinutes);
    expect(minutesBetween(between.leaveAt, between.arrivePacAt)).toBe(between.routeIn.durationMinutes);
  });

  it("judges building hours when the walk is made: a trip from home to an afternoon class is never refused as if it were midnight", async () => {
    const plan = await buildWeekPlan({
      meetings: [meeting("mc", "MC", "2065", 14 * 60, 15 * 60)],
      home: { name: "UW Place", latitude: 43.4708351, longitude: -80.53525, preset: { university: "UW", buildingCode: "UWP" } },
      mondayISO: MONDAY, config: CFG, days: ["T"],
    }, new GoogleLike());
    const fromHome = plan.days.T!.transitions.find((t) => t.from.kind === "HOME")!;
    expect(fromHome.to.buildingCode).toBe("MC");
    expect(fromHome.campus).toBeDefined();
    expect(fromHome.campus!.rejected.filter((r) => /hours/.test(r.because))).toEqual([]);
  });

  it("with campus routing switched off, plans Google's walks exactly as they come", async () => {
    const plan = await buildWeekPlan({
      meetings: [meeting("mc", "MC", "2065", 14 * 60, 15 * 60)],
      mondayISO: MONDAY, config: CFG, days: ["T"], endOfDay: "GYM", campus: false,
    }, new GoogleLike());
    const leg = plan.days.T!.transitions.at(-1)!;
    expect(leg.recommendedRoute).toBe(leg.walkingRoute);
    expect(leg.campus).toBeUndefined();
  });

  it("asks Google for a door walk once for the whole week, however many legs need it", async () => {
    const provider = new GoogleLike();
    await buildWeekPlan({
      meetings: [
        { ...meeting("a", "MC", "2065", 14 * 60, 15 * 60), days: ["M", "T", "W", "Th", "F"] },
      ],
      mondayISO: MONDAY, config: CFG, endOfDay: "GYM",
    }, provider);
    const repeats = provider.asked.filter((k, i) => provider.asked.indexOf(k) !== i);
    expect(repeats).toEqual([]);
  });

});
