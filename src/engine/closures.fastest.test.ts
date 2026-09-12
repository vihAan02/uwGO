import { describe, expect, it, vi } from "vitest";
import { encode } from "@googlemaps/polyline-codec";
import type { RouteOption } from "@/domain/types";
import { DEFAULT_PLANNER_CONFIG as CFG } from "@/domain/config";
import { UW_INDOOR_NETWORK as NET } from "@/data/indoor/uw-indoor-network.generated";
import { edgeId } from "@/data/indoor/edgeId";
import { networkBuildingLocation } from "./indoorRoute";
import { selectRoute, type SelectionDeps } from "./selectRoute";
import type { BestRoute } from "./bestRoute";

/**
 * The fastest route is Google's, and Google cannot be told to avoid a footpath. So a closed path
 * outside is detected on the line it drew, said out loud, and routed around using the campus
 * network when that is possible.
 */
const MC = networkBuildingLocation("MC")!;
const DC = networkBuildingLocation("DC")!;
const NOW = new Date("2026-01-20T15:00:00Z");

/** A walkway outside that the network knows about; we pretend Google's route runs along it. */
const OUTDOOR = NET.edges.find((e) => e.kind === "OUTDOOR" && e.path.length >= 2)!;
const OUTDOOR_ID = edgeId(NET, OUTDOOR);

const walkAlongClosedPath: RouteOption = {
  mode: "WALK", durationMinutes: 3, distanceMeters: 220,
  polyline: encode(OUTDOOR.path),
  provider: "google-routes", computedAt: NOW.toISOString(), isEstimate: false,
};

function deps(walking: RouteOption): SelectionDeps {
  const best: BestRoute = {
    recommended: walking, walking, transit: undefined,
    consideredModes: ["WALK"], reason: "Walking is the only option.",
    departure: NOW, arrival: new Date(NOW.getTime() + walking.durationMinutes * 60_000),
  };
  return { best: async () => best, connector: { walk: vi.fn(async () => undefined) } };
}

const select = (closed: string[], preference: "FASTEST" | "INDOORS" = "FASTEST") =>
  selectRoute(
    { from: MC, to: DC, departAfter: NOW, preference, closedEdgeIds: new Set(closed) },
    deps(walkAlongClosedPath), CFG, NOW,
  );

describe("a fastest route that runs along a closed path", () => {
  it("is marked as using it, rather than quietly pretending otherwise", async () => {
    const s = await select([OUTDOOR_ID]);
    expect(s.walking!.blockedBy).toContain(OUTDOOR_ID);
  });

  it("gives way to an indoor route that goes round it, even when the student asked for fastest", async () => {
    const s = await select([OUTDOOR_ID]);
    expect(s.recommended!.indoorPath).toEqual(["MC", "C2", "DC"]);
    expect(s.reason).toMatch(/reported closed/);
  });

  it("leaves the fastest walk alone when nothing it uses is closed", async () => {
    const s = await select([]);
    expect(s.recommended!.indoorPath).toBeUndefined();
    expect(s.walking!.blockedBy).toBeUndefined();
    expect(s.recommended).toBe(s.walking);
  });

  it("ignores a closure on a path the route never touches", async () => {
    const elsewhere = NET.edges.find((e) => e.kind === "OUTDOOR" && e !== OUTDOOR
      && Math.abs(e.path[0][1] - OUTDOOR.path[0][1]) > 0.002)!;
    const s = await select([edgeId(NET, elsewhere)]);
    expect(s.walking!.blockedBy).toBeUndefined();
    expect(s.recommended).toBe(s.walking);
  });

  it("says nothing about a closed corridor, which a walk outside cannot be using", async () => {
    const hallway = NET.edges.find((e) => e.kind === "HALLWAY")!;
    const s = await select([edgeId(NET, hallway)]);
    expect(s.walking!.blockedBy).toBeUndefined();
  });
});
