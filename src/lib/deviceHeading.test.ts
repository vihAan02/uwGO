import { describe, expect, it } from "vitest";
import { compassHeading, headingDelta, smoothHeading } from "./deviceHeading";
import { comfortablyVisible, navigationPose, offsetPoint, poseSettled, stepPose } from "./tripCamera";
import { haversineMeters } from "@/routing/EstimateRoutingProvider";

describe("compass heading from the orientation sensor", () => {
  it("uses Safari's compass field as the heading of the top of the phone", () => {
    expect(compassHeading({ alpha: 123, webkitCompassHeading: 90 })).toBe(90);
    // Sideways: the top of the screen is a quarter turn from the top of the device.
    expect(compassHeading({ alpha: null, webkitCompassHeading: 350 }, 90)).toBe(80);
  });

  it("refuses a Safari reading the compass says is not calibrated", () => {
    expect(compassHeading({ alpha: null, webkitCompassHeading: 90, webkitCompassAccuracy: -1 })).toBeUndefined();
    expect(compassHeading({ alpha: null, webkitCompassHeading: 90, webkitCompassAccuracy: 120 })).toBeUndefined();
    expect(compassHeading({ alpha: null, webkitCompassHeading: 90, webkitCompassAccuracy: 15 })).toBe(90);
  });

  it("turns an absolute alpha (counter-clockwise from north) into a compass heading", () => {
    expect(compassHeading({ alpha: 0, absolute: true })).toBe(0);
    expect(compassHeading({ alpha: 90, absolute: true })).toBe(270);
    expect(compassHeading({ alpha: 270, absolute: true }, 90)).toBe(180);
  });

  it("gives nothing at all for a relative reading or a missing one, rather than a made-up heading", () => {
    expect(compassHeading({ alpha: 90, absolute: false })).toBeUndefined();
    expect(compassHeading({ alpha: 90 })).toBeUndefined();
    expect(compassHeading({ alpha: null, absolute: true })).toBeUndefined();
  });

  it("smooths across north without spinning the long way round", () => {
    expect(headingDelta(350, 10)).toBe(20);
    expect(headingDelta(10, 350)).toBe(-20);
    const h = smoothHeading(350, 10, 0.5);
    expect(h).toBe(0);
    expect(smoothHeading(undefined, -30)).toBe(330);
  });
});

describe("the flat navigation camera", () => {
  const user = { lat: 43.4715, lng: -80.5440 };

  it("centres on the student with north up when there is no heading", () => {
    expect(navigationPose(user, undefined)).toEqual({ center: user, heading: 0, zoom: 17.5 });
  });

  it("looks a little ahead of the student along their heading when heading-up", () => {
    const pose = navigationPose(user, 90);
    expect(pose.heading).toBe(90);
    const d = haversineMeters({ latitude: user.lat, longitude: user.lng }, { latitude: pose.center.lat, longitude: pose.center.lng });
    expect(d).toBeCloseTo(45, 0);
    expect(pose.center.lng).toBeGreaterThan(user.lng); // east
    expect(pose.center.lat).toBeCloseTo(user.lat, 6);
  });

  it("offsets a point by metres and bearing", () => {
    const north = offsetPoint(user, 100, 0);
    expect(haversineMeters({ latitude: user.lat, longitude: user.lng }, { latitude: north.lat, longitude: north.lng })).toBeCloseTo(100, 0);
    expect(north.lat).toBeGreaterThan(user.lat);
  });

  it("only calls for a re-centre once the student leaves the middle of the screen", () => {
    const b = { north: 43.4720, south: 43.4710, east: -80.5430, west: -80.5450 };
    expect(comfortablyVisible(b, { lat: 43.4715, lng: -80.5440 })).toBe(true);
    expect(comfortablyVisible(b, { lat: 43.4717, lng: -80.5436 })).toBe(true);
    expect(comfortablyVisible(b, { lat: 43.4719, lng: -80.5440 })).toBe(false);
    expect(comfortablyVisible(b, { lat: 43.4715, lng: -80.5449 })).toBe(false);
  });

  it("eases towards the target pose and knows when it has arrived", () => {
    const from = { center: user, heading: 350, zoom: 16 };
    const to = { center: { lat: 43.4716, lng: -80.5441 }, heading: 10, zoom: 17.5 };
    const mid = stepPose(from, to, 0.5);
    expect(mid.heading).toBe(0);
    expect(mid.zoom).toBe(16.75);
    expect(mid.center.lat).toBeCloseTo(43.47155, 6);
    expect(poseSettled(from, to)).toBe(false);
    let p = from;
    for (let i = 0; i < 60; i++) p = stepPose(p, to, 0.25);
    expect(poseSettled(p, to)).toBe(true);
  });
});
