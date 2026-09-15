import { describe, expect, it } from "vitest";
import type { RouteOption } from "@/domain/types";
import { pathMetrics, projectOntoPath, type Point } from "./routeProgress";
import type { CampusLocation } from "@/domain/types";
import { distanceLabel, liveHeadline, modeLabel, plannedHeadline, sameHeadline, tripInstruction } from "./tripDisplay";

describe("the one instruction at the top of a trip", () => {
  const mc: CampusLocation = { id: "UW:MC", name: "Mathematics & Computer Building", latitude: 43.472, longitude: -80.544, kind: "BUILDING", buildingCode: "MC" };
  const base: RouteOption = { mode: "WALK", durationMinutes: 8, provider: "google-routes", computedAt: "", isEstimate: false };

  it("says where to board a bus, and when", () => {
    const leave = new Date("2026-09-15T14:05:00Z"); // 10:05 AM in Waterloo
    const bus: RouteOption = {
      ...base, mode: "TRANSIT",
      steps: [{ mode: "WALK", durationMinutes: 3 }, { mode: "TRANSIT", durationMinutes: 9, transit: { line: "University", lineShort: "201", vehicle: "Bus", departureStop: "UW Station", arrivalStop: "Laurier", departureTime: leave, arrivalTime: leave } }],
    };
    expect(tripInstruction(bus, mc)).toBe("Board 201 at UW Station · 10:05 AM");
  });

  it("names the buildings an indoor route goes through before any campus note", () => {
    expect(tripInstruction({ ...base, indoorPath: ["STC", "B2", "QNC", "MC"] }, mc)).toBe("Indoors via STC → B2 → QNC → MC");
  });

  it("gives the campus note that explains a walk, or else just where to walk", () => {
    const campus = { ...base, campus: { summary: "Enter PAC through SLC's ground-floor link", via: [], evidence: "CORROBORATED" } } as unknown as RouteOption;
    expect(tripInstruction(campus, mc)).toBe("Enter PAC through SLC's ground-floor link");
    expect(tripInstruction(base, mc)).toBe("Walk to MC");
    expect(tripInstruction(base, { ...mc, id: "home", name: "Village 1", kind: "HOME", buildingCode: undefined })).toBe("Walk to home");
  });
});

/** East along one street, then north: about 400 m. */
const ROUTE: Point[] = [
  { lat: 43.4710, lng: -80.5450 },
  { lat: 43.4710, lng: -80.5430 },
  { lat: 43.4730, lng: -80.5430 },
];
const m = pathMetrics(ROUTE);
const NOW = new Date("2026-09-14T18:30:00Z"); // 2:30 PM in Waterloo
const walk: RouteOption = { mode: "WALK", durationMinutes: 6, distanceMeters: 400, provider: "google-routes", computedAt: NOW.toISOString(), isEstimate: false };

describe("what the trip screen says", () => {
  it("before a position, shows the trip as planned and when it would end", () => {
    expect(plannedHeadline(walk, NOW)).toEqual({ time: "6 min", distance: "400 m", arrival: "2:36 PM", arrived: false });
    const bus: RouteOption = { ...walk, mode: "TRANSIT", durationMinutes: 19, arrivalTime: new Date(NOW.getTime() + 19 * 60_000) };
    expect(plannedHeadline(bus, NOW).arrival).toBe("2:49 PM");
  });

  it("with a position, counts down along the route and moves the arrival clock with it", () => {
    const half = liveHeadline(walk, m, { alongMeters: m.total / 2, offRouteMeters: 3 }, NOW);
    expect(half).toEqual({ time: "3 min", distance: "200 m", arrival: "2:33 PM", arrived: false });
    const later = liveHeadline(walk, m, { alongMeters: m.total / 2, offRouteMeters: 3 }, new Date(NOW.getTime() + 2 * 60_000));
    expect(later.arrival).toBe("2:35 PM"); // the same distance left, two minutes later
  });

  it("knows when the student has arrived, and only when they are actually at the end", () => {
    const end = projectOntoPath(m, { lat: 43.47305, lng: -80.5430 })!;
    expect(liveHeadline(walk, m, end, NOW).arrived).toBe(true);
    expect(liveHeadline(walk, m, end, NOW).time).toBe("0 min");
    // A few metres short of the door is there too.
    expect(liveHeadline(walk, m, projectOntoPath(m, { lat: 43.47295, lng: -80.5430 })!, NOW).arrived).toBe(true);
    // Level with the end but 40 m to one side: not there yet.
    expect(liveHeadline(walk, m, { alongMeters: m.total, offRouteMeters: 40 }, NOW).arrived).toBe(false);
    // Near the end along the route, but not near enough.
    expect(liveHeadline(walk, m, { alongMeters: m.total - 40, offRouteMeters: 2 }, NOW).arrived).toBe(false);
  });

  it("only changes when a shown value changes, so a GPS fix rarely re-renders anything", () => {
    const a = liveHeadline(walk, m, { alongMeters: 100, offRouteMeters: 2 }, NOW);
    const b = liveHeadline(walk, m, { alongMeters: 101, offRouteMeters: 5 }, NOW);
    expect(sameHeadline(a, b)).toBe(true);
    expect(sameHeadline(undefined, b)).toBe(false);
    expect(sameHeadline(a, liveHeadline(walk, m, { alongMeters: 200, offRouteMeters: 2 }, NOW))).toBe(false);
  });

  it("labels modes and distances the way the plan does", () => {
    expect(modeLabel(walk)).toBe("Walking");
    expect(modeLabel({ ...walk, indoorPath: ["MC", "DC"] })).toBe("Indoors");
    expect(modeLabel({ ...walk, mode: "TRANSIT", steps: [{ mode: "TRANSIT", durationMinutes: 10, transit: { line: "202", vehicle: "Bus", departureStop: "A", arrivalStop: "B", departureTime: NOW, arrivalTime: NOW } }] })).toBe("Bus");
    expect(distanceLabel(980)).toBe("980 m");
    expect(distanceLabel(1480)).toBe("1.5 km");
    expect(distanceLabel(undefined)).toBeUndefined();
  });
});
