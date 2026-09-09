"use client";
import { useEffect, useMemo } from "react";
import { APIProvider, AdvancedMarker, Map, Pin, useMap } from "@vis.gl/react-google-maps";
import { decode } from "@googlemaps/polyline-codec";
import type { CampusLocation, RouteOption } from "@/domain/types";

const KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY;
const MAP_ID = process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID || "DEMO_MAP_ID";

type Point = { lat: number; lng: number };

/** Draws the route geometry. A real route is a solid line; a straight-line estimate is dashed. */
function RoutePath({ path, color, dashed }: { path: Point[]; color: string; dashed: boolean }) {
  const map = useMap();
  useEffect(() => {
    if (!map || path.length < 2) return;
    const line = new google.maps.Polyline({
      path,
      geodesic: dashed,
      strokeColor: color,
      strokeOpacity: dashed ? 0 : 0.9,
      strokeWeight: 5,
      icons: dashed ? [{ icon: { path: "M 0,-1 0,1", strokeOpacity: 0.8, strokeColor: color, scale: 3 }, offset: "0", repeat: "14px" }] : undefined,
      map,
    });
    const bounds = new google.maps.LatLngBounds();
    for (const p of path) bounds.extend(p);
    map.fitBounds(bounds, 48);
    return () => line.setMap(null);
  }, [map, path, color, dashed]);
  return null;
}

export interface LegMapProps {
  from: CampusLocation;
  to: CampusLocation;
  /** The route to draw. When it has no polyline (estimate mode) a dashed straight line is drawn instead. */
  route?: RouteOption;
  heightClass?: string;
}

/** One map per trip leg: origin pin, destination pin, and the pathway between them. */
export function LegMap({ from, to, route, heightClass = "h-64" }: LegMapProps) {
  const path = useMemo<Point[]>(() => {
    if (route?.polyline) return decode(route.polyline).map(([lat, lng]) => ({ lat, lng }));
    return [{ lat: from.latitude, lng: from.longitude }, { lat: to.latitude, lng: to.longitude }];
  }, [route, from, to]);
  const dashed = !route?.polyline;
  if (!KEY) return null;
  const center = { lat: (from.latitude + to.latitude) / 2, lng: (from.longitude + to.longitude) / 2 };
  const color = route?.mode === "TRANSIT" ? "#6d28d9" : "#1d4ed8";
  return (
    <div className={`${heightClass} overflow-hidden rounded-xl border border-line`}>
      <APIProvider apiKey={KEY}>
        <Map defaultCenter={center} defaultZoom={15} mapId={MAP_ID} gestureHandling="cooperative" disableDefaultUI style={{ width: "100%", height: "100%" }}>
          <AdvancedMarker position={{ lat: from.latitude, lng: from.longitude }} title={from.name}>
            <Pin background="#0f172a" borderColor="#0f172a" glyphColor="#fff" glyph="A" />
          </AdvancedMarker>
          <AdvancedMarker position={{ lat: to.latitude, lng: to.longitude }} title={to.name}>
            <Pin background={color} borderColor={color} glyphColor="#fff" glyph="B" />
          </AdvancedMarker>
          <RoutePath path={path} color={color} dashed={dashed} />
        </Map>
      </APIProvider>
    </div>
  );
}
