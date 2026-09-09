"use client";
import { useEffect, useMemo } from "react";
import { APIProvider, AdvancedMarker, Map, Pin, useMap } from "@vis.gl/react-google-maps";
import { decode } from "@googlemaps/polyline-codec";
import type { CampusLocation, RouteOption } from "@/domain/types";

const KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY;
const MAP_ID = process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID || "DEMO_MAP_ID";

export type MapSelection =
  | { kind: "LEG"; label: string; from: CampusLocation; to: CampusLocation; route?: RouteOption; /** Used by Trip Mode when a transit option has gone. */ walkFallback?: RouteOption }
  | { kind: "PLACE"; label: string; at: CampusLocation }
  | { kind: "DAY"; label: string; stops: { at: CampusLocation; label: string }[] };

type Point = { lat: number; lng: number };
const pt = (l: CampusLocation): Point => ({ lat: l.latitude, lng: l.longitude });

/** Draws the route line and keeps the viewport framed on whatever is currently selected. */
function Overlay({ selection }: { selection: MapSelection }) {
  const map = useMap();
  const path = useMemo<Point[]>(() => {
    if (selection.kind !== "LEG") return [];
    if (selection.route?.polyline) return decode(selection.route.polyline).map(([lat, lng]) => ({ lat, lng }));
    return [pt(selection.from), pt(selection.to)];
  }, [selection]);
  const isEstimate = selection.kind === "LEG" && !selection.route?.polyline;
  const color = selection.kind === "LEG" && selection.route?.mode === "TRANSIT" ? "#6d28d9" : "#1d4ed8";

  useEffect(() => {
    if (!map) return;
    const line = path.length >= 2
      ? new google.maps.Polyline({
          path,
          strokeColor: color,
          strokeOpacity: isEstimate ? 0 : 0.9,
          strokeWeight: 5,
          icons: isEstimate ? [{ icon: { path: "M 0,-1 0,1", strokeOpacity: 0.85, strokeColor: color, scale: 3 }, offset: "0", repeat: "14px" }] : undefined,
          map,
        })
      : undefined;

    const frame: Point[] = path.length >= 2 ? path
      : selection.kind === "PLACE" ? [pt(selection.at)]
      : selection.kind === "DAY" ? selection.stops.map((s) => pt(s.at))
      : [];
    if (frame.length === 1) {
      map.setCenter(frame[0]);
      map.setZoom(17);
    } else if (frame.length > 1) {
      const bounds = new google.maps.LatLngBounds();
      for (const p of frame) bounds.extend(p);
      map.fitBounds(bounds, 56);
    }
    return () => line?.setMap(null);
  }, [map, path, color, isEstimate, selection]);

  return null;
}

function markersFor(selection: MapSelection) {
  switch (selection.kind) {
    case "LEG": return [
      { at: selection.from, label: "A", color: "#0f172a" },
      { at: selection.to, label: "B", color: selection.route?.mode === "TRANSIT" ? "#6d28d9" : "#1d4ed8" },
    ];
    case "PLACE": return [{ at: selection.at, label: "", color: "#1d4ed8" }];
    case "DAY": {
      // Classes are numbered 1..n in the order they happen; home is always "H", not a number.
      let n = 0;
      return selection.stops.map((s) => {
        const isHome = s.at.kind === "HOME";
        return { at: s.at, label: isHome ? "H" : String(++n), color: isHome ? "#0f172a" : "#1d4ed8" };
      });
    }
  }
}

/** The single interactive Google map. Whatever the student taps in the timeline lands here. */
export function MapPanel({ selection, heightClass }: { selection: MapSelection; heightClass: string }) {
  if (!KEY) {
    return (
      <div className="flex items-center justify-center rounded-xl border border-dashed border-line bg-surface p-4 text-center text-sm text-ink-muted">
        <span className="max-w-full break-words">Map hidden: add <code className="break-all font-mono text-xs">NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY</code> to <code className="font-mono text-xs">.env.local</code>.</span>
      </div>
    );
  }
  const markers = markersFor(selection);
  return (
    <div className={`${heightClass} overflow-hidden rounded-xl border border-line`}>
      <APIProvider apiKey={KEY}>
        <Map
          defaultCenter={pt(markers[0]?.at ?? { latitude: 43.4723, longitude: -80.5449 } as CampusLocation)}
          defaultZoom={15}
          mapId={MAP_ID}
          gestureHandling="greedy"
          disableDefaultUI
          zoomControl
          style={{ width: "100%", height: "100%" }}
        >
          {markers.map((m, i) => (
            <AdvancedMarker key={`${m.at.id}-${i}`} position={pt(m.at)} title={m.at.name}>
              <Pin background={m.color} borderColor={m.color} glyphColor="#fff" glyph={m.label || undefined} />
            </AdvancedMarker>
          ))}
          <Overlay selection={selection} />
        </Map>
      </APIProvider>
    </div>
  );
}
