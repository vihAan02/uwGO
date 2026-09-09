import { NextResponse } from "next/server";
import { isInWaterlooRegion, WATERLOO_REGION_BOUNDS as B } from "@/routing/RoutingProvider";

export const runtime = "nodejs";

export interface GeocodeResponse {
  result?: { latitude: number; longitude: number; formattedAddress: string };
  error?: string;
}

/**
 * One-shot geocoding for a custom home address (Google Geocoding API, server key).
 * The address is forwarded to Google and the result returned to the browser; nothing is stored here.
 */
export async function POST(req: Request) {
  const key = process.env.GOOGLE_MAPS_SERVER_KEY;
  if (!key) return NextResponse.json({ error: "Address lookup is not configured on this server (no GOOGLE_MAPS_SERVER_KEY). Choose a residence preset instead." } satisfies GeocodeResponse, { status: 503 });
  let address = "";
  try {
    address = String(((await req.json()) as { address?: string }).address ?? "").trim();
  } catch { /* fallthrough */ }
  if (address.length < 4 || address.length > 200) return NextResponse.json({ error: "Enter a street address." } satisfies GeocodeResponse, { status: 400 });

  const params = new URLSearchParams({
    address,
    region: "ca",
    bounds: `${B.minLat},${B.minLng}|${B.maxLat},${B.maxLng}`,
    components: "country:CA",
    key,
  });
  const res = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?${params}`);
  const json = (await res.json()) as { status: string; results?: { formatted_address: string; geometry: { location: { lat: number; lng: number } } }[]; error_message?: string };
  if (json.status !== "OK" || !json.results?.length) {
    return NextResponse.json({ error: json.status === "ZERO_RESULTS" ? "No match for that address." : `Address lookup failed (${json.status}).` } satisfies GeocodeResponse, { status: 404 });
  }
  const first = json.results[0];
  const result = { latitude: first.geometry.location.lat, longitude: first.geometry.location.lng, formattedAddress: first.formatted_address };
  if (!isInWaterlooRegion(result)) return NextResponse.json({ error: "That address is outside Waterloo Region." } satisfies GeocodeResponse, { status: 400 });
  return NextResponse.json({ result } satisfies GeocodeResponse);
}
