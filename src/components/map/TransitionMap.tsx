"use client";
import { useEffect, useMemo } from "react";
import { APIProvider, AdvancedMarker, Map, Pin, useMap } from "@vis.gl/react-google-maps";
import { decode } from "@googlemaps/polyline-codec";
import type { ClassTransition } from "@/domain/types";

const KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY;
const MAP_ID = process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID || "DEMO_MAP_ID";

function Polyline({ path, color }: { path: { lat: number; lng: number }[]; color: string }) {
  const map = useMap();
  useEffect(() => {
    if (!map || path.length === 0) return;
    const line = new google.maps.Polyline({ path, strokeColor: color, strokeOpacity: 0.9, strokeWeight: 5, map });
    const bounds = new google.maps.LatLngBounds();
    for (const p of path) bounds.extend(p);
    map.fitBounds(bounds, 40);
    return () => line.setMap(null);
  }, [map, path, color]);
  return null;
}

/** Supporting visual for one transition: origin, destination, and the recommended route's geometry. */
export function TransitionMap({ transition: t }: { transition: ClassTransition }) {
  const route = t.recommendedRoute?.polyline ? t.recommendedRoute : t.walkingRoute?.polyline ? t.walkingRoute : t.transitRoute;
  const path = useMemo(() => (route?.polyline ? decode(route.polyline).map(([lat, lng]) => ({ lat, lng })) : []), [route]);
  if (!KEY) return <div className="rounded-xl bg-canvas p-3 text-sm text-ink-muted">Map unavailable: NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY is not configured.</div>;
  const center = { lat: (t.from.latitude + t.to.latitude) / 2, lng: (t.from.longitude + t.to.longitude) / 2 };
  return (
    <div className="h-64 overflow-hidden rounded-xl">
      <APIProvider apiKey={KEY}>
        <Map defaultCenter={center} defaultZoom={15} mapId={MAP_ID} gestureHandling="cooperative" disableDefaultUI style={{ width: "100%", height: "100%" }}>
          <AdvancedMarker position={{ lat: t.from.latitude, lng: t.from.longitude }} title={t.from.name}><Pin background="#0f172a" borderColor="#0f172a" glyphColor="#fff" /></AdvancedMarker>
          <AdvancedMarker position={{ lat: t.to.latitude, lng: t.to.longitude }} title={t.to.name}><Pin background="#1d4ed8" borderColor="#1d4ed8" glyphColor="#fff" /></AdvancedMarker>
          {path.length > 0 && <Polyline path={path} color={route?.mode === "TRANSIT" ? "#6d28d9" : "#1d4ed8"} />}
        </Map>
      </APIProvider>
    </div>
  );
}
