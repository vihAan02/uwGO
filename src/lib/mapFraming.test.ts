import { describe, expect, it } from "vitest";
import { encode } from "@googlemaps/polyline-codec";
import type { CampusLocation, RouteOption } from "@/domain/types";
import type { MapSelection } from "./mapSelection";
import { allInside, centreFor, framePadding, framePoints, insetResponse, lineKey, placeKey, uncovered, type MapInset } from "./mapFraming";
import { metersPerPixel } from "./tripCamera";

const place = (id: string, latitude: number, longitude: number): CampusLocation => ({ id, name: id, latitude, longitude, kind: "BUILDING" });
const MC = place("MC", 43.47212, -80.54392);
const DC = place("DC", 43.47282, -80.54216);
const line = (points: [number, number][], minutes = 6): RouteOption => ({ mode: "WALK", durationMinutes: minutes, polyline: encode(points), provider: "google-routes", computedAt: "", isEstimate: false });
const outdoor = line([[43.47212, -80.54392], [43.4725, -80.5430], [43.47282, -80.54216]]);
const tunnel = line([[43.47212, -80.54392], [43.4722, -80.5428], [43.47282, -80.54216]], 8);

describe("what the planner map frames", () => {
  it("frames a leg by its drawn line, or by its ends when it has no line", () => {
    expect(framePoints({ kind: "LEG", label: "", from: MC, to: DC, route: outdoor })).toHaveLength(3);
    expect(framePoints({ kind: "LEG", label: "", from: MC, to: DC })).toEqual([{ lat: MC.latitude, lng: MC.longitude }, { lat: DC.latitude, lng: DC.longitude }]);
    expect(framePoints({ kind: "PLACE", label: "", at: DC })).toEqual([{ lat: DC.latitude, lng: DC.longitude }]);
    expect(framePoints({ kind: "DAY", label: "", stops: [{ at: MC, label: "a" }, { at: DC, label: "b" }] })).toHaveLength(2);
  });

  it("keeps the camera through a rebuilt plan that names the same places", () => {
    const before: MapSelection = { kind: "DAY", label: "Tue · 2 places", stops: [{ at: MC, label: "MATH 137" }, { at: DC, label: "CS 135" }] };
    const rebuilt: MapSelection = { kind: "DAY", label: "Tue · 2 places", stops: [{ at: { ...MC }, label: "MATH 137" }, { at: { ...DC }, label: "CS 135" }] };
    expect(placeKey(rebuilt)).toBe(placeKey(before));
    expect(placeKey({ ...before, stops: before.stops.slice(0, 1) })).not.toBe(placeKey(before));
  });

  it("tells another way between the same places from another trip", () => {
    const best: MapSelection = { kind: "LEG", label: "", from: MC, to: DC, route: outdoor };
    const indoors: MapSelection = { ...best, route: tunnel };
    expect(placeKey(indoors)).toBe(placeKey(best));
    expect(lineKey(indoors)).not.toBe(lineKey(best));
    expect(placeKey({ ...best, to: MC })).not.toBe(placeKey(best));
  });
});

describe("framing around the header and the sheet", () => {
  const bounds = { north: 10, south: 0, east: 20, west: 10 };

  it("takes the strips under the layers off the map's bounds", () => {
    const inset: MapInset = { top: 100, right: 0, bottom: 400, left: 50 };
    expect(uncovered(bounds, inset, 500, 1000)).toEqual({ north: 9, south: 4, west: 11, east: 20 });
  });

  it("knows when a line is already in view and needs no camera move", () => {
    const visible = uncovered(bounds, { top: 100, right: 0, bottom: 400, left: 0 }, 500, 1000);
    expect(allInside(visible, [{ lat: 5, lng: 15 }, { lat: 8.5, lng: 12 }])).toBe(true);
    expect(allInside(visible, [{ lat: 5, lng: 15 }, { lat: 3, lng: 12 }])).toBe(false);
  });

  it("pads by the layers, and shrinks the padding when there is too little map to fit into", () => {
    expect(framePadding({ top: 60, right: 0, bottom: 400, left: 0 }, 390, 844)).toEqual({ top: 100, right: 32, bottom: 428, left: 32 });
    const squeezed = framePadding({ top: 0, right: 0, bottom: 300, left: 0 }, 844, 390);
    expect(squeezed.top + squeezed.bottom).toBeLessThanOrEqual(390 - 64);
    expect(squeezed.bottom).toBeGreaterThan(squeezed.top);
  });

  it("centres a single place in the middle of what the student can see", () => {
    const at = { lat: 43.472, lng: -80.544 };
    const zoom = 17;
    const c = centreFor(at, { top: 0, right: 0, bottom: 400, left: 0 }, zoom);
    // 200px below the map's centre is the middle of the map above a 400px sheet: the centre sits south of the place.
    expect(c.lng).toBeCloseTo(at.lng, 9);
    expect((at.lat - c.lat) * 111_320).toBeCloseTo(200 * metersPerPixel(at.lat, zoom), 3);
    expect(centreFor(at, { top: 0, right: 0, bottom: 0, left: 0 }, zoom)).toEqual(at);
  });

  it("re-frames when the sheet settles somewhere new, and only pans a map the student has moved", () => {
    const mid: MapInset = { top: 60, right: 0, bottom: 265, left: 0 };
    const peek: MapInset = { ...mid, bottom: 0 };
    expect(insetResponse(mid, { ...mid }, false)).toEqual({ kind: "none" });
    // Down to peek, the route pinned under the header is framed into the taller map.
    expect(insetResponse(mid, peek, false)).toEqual({ kind: "frame" });
    // A student's own view moves up by half of what the sheet uncovered, so it stays in the middle.
    expect(insetResponse(mid, peek, true)).toEqual({ kind: "pan", dx: 0, dy: -132.5 });
  });
});
