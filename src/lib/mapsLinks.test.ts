import { describe, expect, it } from "vitest";
import { googleMapsDirectionsUrl, travelModeFor } from "./mapsLinks";
import type { RouteOption } from "@/domain/types";

const uwp = { latitude: 43.4718, longitude: -80.5259 };
const mc = { latitude: 43.47216, longitude: -80.54395 };

describe("googleMapsDirectionsUrl", () => {
  it("builds a keyless Maps URLs directions link from coordinates only", () => {
    const url = new URL(googleMapsDirectionsUrl(uwp, mc, "walking"));
    expect(url.origin + url.pathname).toBe("https://www.google.com/maps/dir/");
    expect(url.searchParams.get("api")).toBe("1");
    expect(url.searchParams.get("origin")).toBe("43.471800,-80.525900");
    expect(url.searchParams.get("destination")).toBe("43.472160,-80.543950");
    expect(url.searchParams.get("travelmode")).toBe("walking");
    expect(url.search).not.toMatch(/key=/);
  });

  it("supports transit mode", () => {
    expect(googleMapsDirectionsUrl(uwp, mc, "transit")).toContain("travelmode=transit");
  });
});

describe("travelModeFor", () => {
  const base = { durationMinutes: 10, provider: "estimate", computedAt: new Date().toISOString(), isEstimate: true } as const;
  it("maps route mode to a Maps travel mode, defaulting to walking", () => {
    expect(travelModeFor({ ...base, mode: "WALK" } as RouteOption)).toBe("walking");
    expect(travelModeFor({ ...base, mode: "TRANSIT" } as RouteOption)).toBe("transit");
    expect(travelModeFor(undefined)).toBe("walking");
  });
});
