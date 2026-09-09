import type { LatLng, RouteOption } from "@/domain/types";
import type { RoutingProvider, TransitOptions } from "./RoutingProvider";

/** Great-circle distance in metres. */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/**
 * Fallback used ONLY when no routing API key is configured. Straight-line distance × a street
 * detour factor at a planning walking speed. Every result is flagged `isEstimate` and the UI shows it.
 * Transit is never estimated.
 */
export class EstimateRoutingProvider implements RoutingProvider {
  readonly id = "estimate";
  constructor(private readonly detourFactor = 1.3, private readonly metresPerSecond = 1.35) {}

  async getWalkingRoute(from: LatLng, to: LatLng): Promise<RouteOption> {
    const distanceMeters = Math.round(haversineMeters(from, to) * this.detourFactor);
    const durationMinutes = Math.max(1, Math.ceil(distanceMeters / this.metresPerSecond / 60));
    return { mode: "WALK", durationMinutes: distanceMeters === 0 ? 0 : durationMinutes, distanceMeters, provider: this.id, computedAt: new Date().toISOString(), isEstimate: true };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async getTransitRoute(_from: LatLng, _to: LatLng, _opts: TransitOptions): Promise<RouteOption | undefined> {
    return undefined; // no schedule data without a real routing API
  }
}
