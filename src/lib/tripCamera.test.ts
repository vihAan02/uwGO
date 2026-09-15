import { describe, expect, it } from "vitest";
import { haversineMeters } from "@/routing/EstimateRoutingProvider";
import { LOOK_AHEAD_METERS, NAV_ZOOM, centreShiftMeters, comfortablyVisible, metersPerPixel, navigationPose, visibleBounds } from "./tripCamera";
import { bearingBetween } from "./routeProgress";

const user = { lat: 43.4720, lng: -80.5440 };
const metres = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => haversineMeters({ latitude: a.lat, longitude: a.lng }, { latitude: b.lat, longitude: b.lng });

describe("keeping the student clear of the trip's panels", () => {
  it("knows the ground a pixel covers at the navigation zoom", () => {
    const mpp = metersPerPixel(user.lat, NAV_ZOOM);
    expect(mpp).toBeGreaterThan(0.55);
    expect(mpp).toBeLessThan(0.65);
  });

  it("shifts the camera by half the difference between the bottom and top panels", () => {
    const shift = centreShiftMeters(user.lat, NAV_ZOOM, { topPx: 80, bottomPx: 200 });
    expect(shift).toBeCloseTo(60 * metersPerPixel(user.lat, NAV_ZOOM), 6);
    expect(centreShiftMeters(user.lat, NAV_ZOOM, undefined)).toBe(0);
  });

  it("north-up: puts the map centre below the student by the shift, so they sit mid-way up what is visible", () => {
    const pose = navigationPose(user, undefined, NAV_ZOOM, 36);
    expect(metres(user, pose.center)).toBeCloseTo(36, 0);
    expect(Math.round(bearingBetween(user, pose.center))).toBe(180);
    expect(pose.heading).toBe(0);
    expect(navigationPose(user, undefined).center).toEqual(user);
  });

  it("heading-up: looks ahead, less the shift", () => {
    const pose = navigationPose(user, 90, NAV_ZOOM, 20);
    expect(metres(user, pose.center)).toBeCloseTo(LOOK_AHEAD_METERS - 20, 0);
    expect(Math.round(bearingBetween(user, pose.center))).toBe(90);
    expect(pose.heading).toBe(90);
  });

  it("judges 'comfortably visible' against the part of the map not under a panel", () => {
    const b = { north: 43.4740, south: 43.4700, east: -80.5420, west: -80.5460 };
    // Near the bottom of the map: fine on a bare map, hidden under a sheet covering the lower 40%.
    const low = { lat: 43.4712, lng: -80.5440 };
    expect(comfortablyVisible(b, low, 0.5)).toBe(true);
    expect(comfortablyVisible(visibleBounds(b, 0, 0.4), low, 0.5)).toBe(false);
    const v = visibleBounds(b, 0.1, 0.4);
    expect(v.north).toBeCloseTo(43.4736, 9);
    expect(v.south).toBeCloseTo(43.4716, 9);
    expect([v.east, v.west]).toEqual([b.east, b.west]);
  });
});
