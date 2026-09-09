import type { LatLng, RouteOption } from "@/domain/types";
import type { RoutingProvider, TransitOptions } from "./RoutingProvider";
import { deserializeRoute, type RouteOptionJSON } from "./serialize";

export interface RoutesRequestBody {
  mode: "WALK" | "TRANSIT";
  from: LatLng;
  to: LatLng;
  departureTime?: string;
  arrivalTime?: string;
}

export interface RoutesResponseBody {
  route: RouteOptionJSON | null;
  error?: string;
}

/** Browser-side provider: talks to our own /api/routes handler, never to Google directly. */
export class HttpRoutingProvider implements RoutingProvider {
  readonly id = "http";
  constructor(private readonly endpoint = "/api/routes", private readonly fetchImpl: typeof fetch = (...a) => fetch(...a)) {}

  private async call(body: RoutesRequestBody): Promise<RouteOption | undefined> {
    const res = await this.fetchImpl(this.endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`Routing request failed (${res.status})`);
    const json = (await res.json()) as RoutesResponseBody;
    if (json.error) throw new Error(json.error);
    return json.route ? deserializeRoute(json.route) : undefined;
  }

  getWalkingRoute(from: LatLng, to: LatLng) {
    return this.call({ mode: "WALK", from, to });
  }

  getTransitRoute(from: LatLng, to: LatLng, opts: TransitOptions) {
    return this.call({ mode: "TRANSIT", from, to, departureTime: opts.departureTime?.toISOString(), arrivalTime: opts.arrivalTime?.toISOString() });
  }
}
