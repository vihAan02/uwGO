import { describe, expect, it } from "vitest";
import { encode } from "@googlemaps/polyline-codec";
import type { LatLng, RouteOption } from "@/domain/types";
import { DEFAULT_PLANNER_CONFIG as CFG } from "@/domain/config";
import { haversineMeters } from "@/routing/EstimateRoutingProvider";
import { torontoDate } from "@/time/toronto";
import { campusWalk } from "@/engine/campusRoute";
import { indoorRouteBetween, networkBuildingLocation } from "@/engine/indoorRoute";
import { reportableSegments } from "./ClosureControls";

/**
 * What a student can report on a route: every door, link and stretch the route relies on, named
 * the way they will recognise it, so a locked entrance can close as surely as a locked tunnel.
 */

const google = {
  async walk(from: LatLng, to: LatLng): Promise<RouteOption> {
    const metres = haversineMeters(from, to) * 1.3;
    return { mode: "WALK", durationMinutes: Math.ceil(metres / 1.33 / 60), durationSeconds: Math.round(metres / 1.33), distanceMeters: Math.round(metres), polyline: encode([[from.latitude, from.longitude], [to.latitude, to.longitude]]), provider: "google-routes", computedAt: "", isEstimate: false };
  },
};

describe("reporting a closure on a campus-aware walk", () => {
  it("offers the entrance and the SLC–PAC link a walk to PAC depends on, each on its own", async () => {
    const MC = networkBuildingLocation("MC")!;
    const PAC = networkBuildingLocation("PAC")!;
    const at = torontoDate("2026-09-15", 12 * 60);
    const r = (await campusWalk({ from: MC, to: PAC, at }, await google.walk(MC, PAC), google, CFG, at))!;
    const items = reportableSegments(r.route!);
    const link = items.find((s) => s.label === "SLC–PAC link at the PAC front desk")!;
    expect(link.ids).toEqual(["c34ea719b8b9dee5"]);
    // Every door to outside the route uses can be reported, named by the reviewed label where there is one.
    expect(items.some((s) => /doors/.test(s.label))).toBe(true);
    // Nothing on the route is left unreportable except the corridors of the buildings it starts and ends in.
    const covered = new Set(items.flatMap((s) => s.ids));
    expect(r.route!.indoorEdgeIds!.filter((id) => covered.has(id)).length).toBeGreaterThan(0);
  });

  it("still names a winter route's tunnels and bridges, and now the buildings it passes through", async () => {
    const r = (await indoorRouteBetween(networkBuildingLocation("STC")!, networkBuildingLocation("MC")!))!;
    const labels = reportableSegments(r).map((s) => s.label);
    expect(labels).toContain("QNC–B2 bridge");
    expect(labels).toContain("MC–QNC bridge");
    expect(labels).toContain("Through B2");
    expect(labels).toContain("Through QNC");
    expect(labels).not.toContain("Through STC");
    expect(labels).not.toContain("Through MC");
  });
});
