import type { LatLng, RouteOption } from "@/domain/types";

/** True when the browser Maps JavaScript key is configured (inlined at build time). */
export const MAPS_AVAILABLE = Boolean(process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY);

export type MapsTravelMode = "walking" | "transit";

/**
 * Google Maps URLs (Maps URLs API) directions link. Needs no API key, opens the
 * Google Maps app on phones and maps.google.com on desktop. Only coordinates are
 * placed in the URL; no schedule text ever leaves the device this way.
 * Docs: https://developers.google.com/maps/documentation/urls/get-started#directions-action
 */
export function googleMapsDirectionsUrl(from: LatLng, to: LatLng, mode: MapsTravelMode): string {
  const p = new URLSearchParams({
    api: "1",
    origin: `${from.latitude.toFixed(6)},${from.longitude.toFixed(6)}`,
    destination: `${to.latitude.toFixed(6)},${to.longitude.toFixed(6)}`,
    travelmode: mode,
  });
  return `https://www.google.com/maps/dir/?${p.toString()}`;
}

export function travelModeFor(route: RouteOption | undefined): MapsTravelMode {
  return route?.mode === "TRANSIT" ? "transit" : "walking";
}
