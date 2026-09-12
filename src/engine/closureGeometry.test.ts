import { describe, expect, it } from "vitest";
import { UW_INDOOR_NETWORK as NET } from "@/data/indoor/uw-indoor-network.generated";
import { edgeId } from "@/data/indoor/edgeId";
import { closuresOnRoute, distanceToSegment, routeRunsAlong, type LatLngTuple } from "./closureGeometry";

/** A short east-west path near the middle of campus. */
const A: LatLngTuple = [43.4720, -80.5440];
const B: LatLngTuple = [43.4720, -80.5430];
const east = (p: LatLngTuple, metres: number): LatLngTuple => [p[0], p[1] + metres / (111_320 * Math.cos((p[0] * Math.PI) / 180))];
const north = (p: LatLngTuple, metres: number): LatLngTuple => [p[0] + metres / 111_320, p[1]];

describe("measuring how near a route passes", () => {
  it("measures to the nearest point of a segment, not just its ends", () => {
    const mid: LatLngTuple = [43.4720, -80.5435];
    expect(distanceToSegment(north(mid, 10), A, B)).toBeCloseTo(10, 0);
    expect(distanceToSegment(mid, A, B)).toBeCloseTo(0, 1);
  });
});

describe("deciding whether a route uses a closed path", () => {
  const closed: LatLngTuple[] = [A, [43.4720, -80.5436], [43.4720, -80.5433], B];

  it("says yes when the route walks the length of it", () => {
    const along: LatLngTuple[] = [east(A, -20), A, B, east(B, 20)];
    expect(routeRunsAlong(along, closed)).toBe(true);
  });

  it("says no when the route merely crosses it", () => {
    // A north-south route through the middle: one point close, the rest far.
    const crossing: LatLngTuple[] = [north([43.4720, -80.5435], 60), [43.4720, -80.5435], north([43.4720, -80.5435], -60)];
    expect(routeRunsAlong(crossing, closed)).toBe(false);
  });

  it("says no when the route is nowhere near", () => {
    const away: LatLngTuple[] = [north(A, 200), north(B, 200)];
    expect(routeRunsAlong(away, closed)).toBe(false);
  });

  it("needs a real route, not a single point", () => {
    expect(routeRunsAlong([A], closed)).toBe(false);
    expect(routeRunsAlong([A, B], [])).toBe(false);
  });
});

describe("finding closures on an outdoor route", () => {
  const outdoor = NET.edges.find((e) => e.kind === "OUTDOOR" && e.path.length >= 2)!;
  const indoor = NET.edges.find((e) => e.kind === "HALLWAY" && e.path.length >= 2)!;

  it("spots a closed walkway the route runs along", () => {
    const path = outdoor.path as LatLngTuple[];
    const hits = closuresOnRoute(NET, path, new Set([edgeId(NET, outdoor)]));
    expect(hits).toHaveLength(1);
    expect(hits[0]).toBe(outdoor);
  });

  it("ignores closures indoors, which a Google walking route can say nothing about", () => {
    const hits = closuresOnRoute(NET, indoor.path as LatLngTuple[], new Set([edgeId(NET, indoor)]));
    expect(hits).toEqual([]);
  });

  it("finds nothing when nothing is closed", () => {
    expect(closuresOnRoute(NET, outdoor.path as LatLngTuple[], new Set())).toEqual([]);
  });

  it("does not flag a closed walkway somewhere else entirely", () => {
    const elsewhere = NET.edges.find((e) => e.kind === "OUTDOOR" && e !== outdoor
      && Math.abs(e.path[0][1] - outdoor.path[0][1]) > 0.002)!;
    const hits = closuresOnRoute(NET, outdoor.path as LatLngTuple[], new Set([edgeId(NET, elsewhere)]));
    expect(hits).toEqual([]);
  });
});
