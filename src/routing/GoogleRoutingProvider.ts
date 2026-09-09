/**
 * Google Routes API (computeRoutes, REST) — server-side only. Requires GOOGLE_MAPS_SERVER_KEY.
 * Both WALK and TRANSIT requests bill at Compute Routes Essentials (no Pro/Enterprise features are used).
 * Google's response types stay inside this file; the rest of the app sees RouteOption.
 */
import type { LatLng, RouteOption, RouteStep } from "@/domain/types";
import type { RoutingProvider, TransitOptions } from "./RoutingProvider";

const ENDPOINT = "https://routes.googleapis.com/directions/v2:computeRoutes";
const FIELD_MASK = [
  "routes.duration",
  "routes.staticDuration",
  "routes.distanceMeters",
  "routes.polyline.encodedPolyline",
  "routes.legs.startTime",
  "routes.legs.endTime",
  "routes.legs.steps.travelMode",
  "routes.legs.steps.staticDuration",
  "routes.legs.steps.distanceMeters",
  "routes.legs.steps.navigationInstruction.instructions",
  "routes.legs.steps.transitDetails",
].join(",");

// Minimal shapes of the fields we request.
interface GStop { name?: string; location?: { latLng?: { latitude: number; longitude: number } } }
interface GTransitDetails {
  stopDetails?: { arrivalStop?: GStop; arrivalTime?: string; departureStop?: GStop; departureTime?: string };
  headsign?: string;
  stopCount?: number;
  transitLine?: { name?: string; nameShort?: string; color?: string; vehicle?: { type?: string; name?: { text?: string } } };
}
interface GStep { travelMode?: string; staticDuration?: string; distanceMeters?: number; navigationInstruction?: { instructions?: string }; transitDetails?: GTransitDetails }
interface GRoute { duration?: string; staticDuration?: string; distanceMeters?: number; polyline?: { encodedPolyline?: string }; legs?: { startTime?: string; endTime?: string; steps?: GStep[] }[] }
interface GResponse { routes?: GRoute[]; error?: { message?: string; status?: string } }

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

function seconds(s: string | undefined): number {
  if (!s) return 0;
  const m = /^(\d+(?:\.\d+)?)s$/.exec(s);
  return m ? Number(m[1]) : 0;
}

function toMinutes(s: string | undefined): number {
  return Math.ceil(seconds(s) / 60);
}

export class GoogleRoutingProvider implements RoutingProvider {
  readonly id = "google-routes";
  constructor(private readonly apiKey: string, private readonly fetchImpl: FetchLike = fetch, private readonly now: () => Date = () => new Date()) {}

  private async compute(body: Record<string, unknown>): Promise<GRoute | undefined> {
    const res = await this.fetchImpl(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": this.apiKey, "X-Goog-FieldMask": FIELD_MASK },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as GResponse;
    if (!res.ok) throw new Error(`Routes API ${res.status}: ${json.error?.message ?? json.error?.status ?? "unknown error"}`);
    return json.routes?.[0];
  }

  async getWalkingRoute(from: LatLng, to: LatLng): Promise<RouteOption | undefined> {
    const route = await this.compute({
      origin: { location: { latLng: from } },
      destination: { location: { latLng: to } },
      travelMode: "WALK",
      polylineQuality: "HIGH_QUALITY",
      languageCode: "en-CA",
      units: "METRIC",
    });
    if (!route) return undefined;
    const steps: RouteStep[] = (route.legs?.[0]?.steps ?? []).map((s) => ({
      mode: "WALK",
      durationMinutes: toMinutes(s.staticDuration),
      distanceMeters: s.distanceMeters,
      instruction: s.navigationInstruction?.instructions,
    }));
    return {
      mode: "WALK",
      durationMinutes: toMinutes(route.staticDuration ?? route.duration),
      distanceMeters: route.distanceMeters,
      polyline: route.polyline?.encodedPolyline,
      steps: steps.length ? steps : undefined,
      provider: this.id,
      computedAt: this.now().toISOString(),
      isEstimate: false,
    };
  }

  async getTransitRoute(from: LatLng, to: LatLng, opts: TransitOptions): Promise<RouteOption | undefined> {
    const body: Record<string, unknown> = {
      origin: { location: { latLng: from } },
      destination: { location: { latLng: to } },
      travelMode: "TRANSIT",
      polylineQuality: "HIGH_QUALITY",
      languageCode: "en-CA",
      units: "METRIC",
      transitPreferences: { allowedTravelModes: ["BUS", "LIGHT_RAIL", "RAIL"] },
    };
    if (opts.arrivalTime) body.arrivalTime = opts.arrivalTime.toISOString();
    else if (opts.departureTime) body.departureTime = opts.departureTime.toISOString();
    const route = await this.compute(body);
    const leg = route?.legs?.[0];
    if (!route || !leg) return undefined;

    const steps: RouteStep[] = (leg.steps ?? []).map((s) => {
      const td = s.transitDetails;
      if (s.travelMode === "TRANSIT" && td) {
        return {
          mode: "TRANSIT",
          durationMinutes: toMinutes(s.staticDuration),
          distanceMeters: s.distanceMeters,
          transit: {
            line: td.transitLine?.name ?? td.transitLine?.nameShort ?? "Transit",
            lineShort: td.transitLine?.nameShort,
            vehicle: td.transitLine?.vehicle?.name?.text ?? td.transitLine?.vehicle?.type ?? "TRANSIT",
            headsign: td.headsign,
            departureStop: td.stopDetails?.departureStop?.name ?? "",
            arrivalStop: td.stopDetails?.arrivalStop?.name ?? "",
            departureTime: new Date(td.stopDetails?.departureTime ?? leg.startTime ?? 0),
            arrivalTime: new Date(td.stopDetails?.arrivalTime ?? leg.endTime ?? 0),
            stopCount: td.stopCount,
            color: td.transitLine?.color,
          },
        };
      }
      return { mode: "WALK", durationMinutes: toMinutes(s.staticDuration), distanceMeters: s.distanceMeters, instruction: s.navigationInstruction?.instructions };
    });
    const transitSteps = steps.filter((s) => s.mode === "TRANSIT");
    if (transitSteps.length === 0) return undefined; // Google returned a walking-only itinerary; not a transit option.
    const departureTime = leg.startTime ? new Date(leg.startTime) : undefined;
    const arrivalTime = leg.endTime ? new Date(leg.endTime) : undefined;
    return {
      mode: "TRANSIT",
      durationMinutes: departureTime && arrivalTime ? Math.ceil((arrivalTime.getTime() - departureTime.getTime()) / 60000) : toMinutes(route.duration),
      distanceMeters: route.distanceMeters,
      departureTime,
      arrivalTime,
      steps,
      polyline: route.polyline?.encodedPolyline,
      transferCount: Math.max(0, transitSteps.length - 1),
      provider: this.id,
      computedAt: this.now().toISOString(),
      isEstimate: false,
    };
  }
}
