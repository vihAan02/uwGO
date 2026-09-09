"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { APIProvider, AdvancedMarker, Map, Pin, useMap } from "@vis.gl/react-google-maps";
import { decode } from "@googlemaps/polyline-codec";
import type { CampusLocation, RouteOption } from "@/domain/types";
import { formatClock, formatDuration } from "@/time/toronto";
import { bearing, resolveTripRoute, type TripRouteStatus } from "@/lib/tripRoute";

const KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY;
const MAP_ID = process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID || "DEMO_MAP_ID";

export interface Trip {
  label: string;
  from: CampusLocation;
  to: CampusLocation;
  route: RouteOption;
  /** Used if the transit option turns out to have gone. */
  walkFallback?: RouteOption;
}

type Point = { lat: number; lng: number };
const pt = (l: { latitude: number; longitude: number }): Point => ({ lat: l.latitude, lng: l.longitude });

/** Draws the route and drives a tilted, route-aligned camera. */
function TripCamera({ path, to, userPos, follow }: { path: Point[]; to: CampusLocation; userPos: Point | undefined; follow: boolean }) {
  const map = useMap();
  const lineRef = useRef<google.maps.Polyline | undefined>(undefined);

  useEffect(() => {
    if (!map || path.length < 2) return;
    lineRef.current?.setMap(null);
    lineRef.current = new google.maps.Polyline({
      path, strokeColor: "#1d4ed8", strokeOpacity: 0.95, strokeWeight: 8, map,
      icons: [{ icon: { path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW, scale: 3, strokeColor: "#fff", fillColor: "#fff", fillOpacity: 1 }, offset: "0", repeat: "90px" }],
    });
    return () => { lineRef.current?.setMap(null); lineRef.current = undefined; };
  }, [map, path]);

  // Frame the whole trip, tilted and aimed along the route. Re-runs on container resize:
  // the fullscreen panel settles its layout after the map mounts, and a map that missed
  // that change paints tiles for its old, smaller box and leaves the rest blank.
  useEffect(() => {
    if (!map || path.length < 2) return;
    const frame = () => {
      google.maps.event.trigger(map, "resize");
      const bounds = new google.maps.LatLngBounds();
      for (const p of path) bounds.extend(p);
      map.fitBounds(bounds, 80);
      // Tilt and heading are vector-only; on a raster map id these are no-ops, not errors.
      if (map.getRenderingType?.() === google.maps.RenderingType.VECTOR) {
        map.setTilt(55);
        map.setHeading(bearing({ latitude: path[0].lat, longitude: path[0].lng }, to));
      }
    };
    frame();
    const settle = setTimeout(frame, 350);
    const ro = new ResizeObserver(frame);
    ro.observe(map.getDiv());
    return () => { clearTimeout(settle); ro.disconnect(); };
  }, [map, path, to]);

  // Follow mode: sit behind the student, pointed at the destination.
  useEffect(() => {
    if (!map || !follow || !userPos) return;
    const vector = map.getRenderingType?.() === google.maps.RenderingType.VECTOR;
    map.moveCamera({
      center: userPos,
      zoom: 18,
      ...(vector ? { tilt: 60, heading: bearing({ latitude: userPos.lat, longitude: userPos.lng }, to) } : {}),
    });
  }, [map, follow, userPos, to]);

  return null;
}

function modeLabel(r: RouteOption): string {
  if (r.mode === "WALK") return "Walking";
  const first = r.steps?.find((s) => s.mode === "TRANSIT")?.transit;
  const vehicle = (first?.vehicle ?? "").toLowerCase();
  if (vehicle.includes("light rail") || vehicle.includes("tram")) return "ION light rail";
  return vehicle.includes("bus") ? "Bus" : "Transit";
}

export function TripMode({ trip, onEnd }: { trip: Trip; onEnd: () => void }) {
  const [resolved, setResolved] = useState<{ route: RouteOption; status: TripRouteStatus; note?: string }>({ route: trip.route, status: "PLANNED" });
  const [checking, setChecking] = useState(trip.route.mode === "TRANSIT");
  const [userPos, setUserPos] = useState<Point | undefined>();
  const hasGeolocation = typeof navigator !== "undefined" && "geolocation" in navigator;
  const [geoState, setGeoState] = useState<"asking" | "on" | "denied">(hasGeolocation ? "asking" : "denied");
  const [follow, setFollow] = useState(true);

  // A trip that starts now must not show a bus that has already left.
  useEffect(() => {
    let cancelled = false;
    resolveTripRoute(trip.route, trip.walkFallback, trip.from, trip.to)
      .then((r) => { if (!cancelled) { setResolved(r); setChecking(false); } })
      .catch(() => { if (!cancelled) setChecking(false); });
    return () => { cancelled = true; };
  }, [trip]);

  // Location is requested only here, when the student actually starts a trip.
  useEffect(() => {
    if (!hasGeolocation) return;
    const id = navigator.geolocation.watchPosition(
      (p) => { setUserPos({ lat: p.coords.latitude, lng: p.coords.longitude }); setGeoState("on"); },
      () => setGeoState("denied"),
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 15_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [hasGeolocation]);

  const route = resolved.route;
  const path = useMemo<Point[]>(
    () => (route.polyline ? decode(route.polyline).map(([lat, lng]) => ({ lat, lng })) : [pt(trip.from), pt(trip.to)]),
    [route, trip.from, trip.to],
  );
  const board = route.steps?.find((s) => s.mode === "TRANSIT")?.transit;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-ink text-white">
      <header className="flex items-start gap-3 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <button onClick={onEnd} aria-label="End trip" className="mt-0.5 shrink-0 rounded-full bg-white/15 px-3 py-2 text-lg leading-none">&larr;</button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-bold">{trip.to.name}</h1>
          <div className="mt-0.5 flex flex-wrap items-baseline gap-x-3 text-sm">
            <span className="text-2xl font-bold">{formatDuration(route.durationMinutes)}</span>
            {route.mode === "TRANSIT" && route.arrivalTime && <span className="text-white/80">Arrive {formatClock(route.arrivalTime)}</span>}
            {route.mode === "WALK" && route.distanceMeters !== undefined && (
              <span className="text-white/80">{route.distanceMeters < 1000 ? `${route.distanceMeters} m` : `${(route.distanceMeters / 1000).toFixed(1)} km`}</span>
            )}
          </div>
          <div className="mt-1 text-sm text-white/70">
            {checking ? "Checking for a fresh departure…" : modeLabel(route)}
            {board && <> · Route {board.lineShort ?? board.line}{board.lineShort && board.line && board.line !== board.lineShort ? ` · ${board.line}` : ""}</>}
          </div>
          {board && <div className="text-sm text-white/70">Board {board.departureStop} {formatClock(board.departureTime)}</div>}
          {resolved.note && <p className="mt-2 rounded-lg bg-amber-400/20 px-2 py-1 text-sm text-amber-100">{resolved.note}</p>}
        </div>
      </header>

      <div className="relative min-h-0 flex-1">
        {KEY ? (
          <APIProvider apiKey={KEY}>
            <Map
              defaultCenter={pt(trip.from)}
              defaultZoom={16}
              mapId={MAP_ID}
              gestureHandling="greedy"
              disableDefaultUI
              tilt={55}
              style={{ width: "100%", height: "100%" }}
            >
              <AdvancedMarker position={pt(trip.to)} title={trip.to.name}>
                <Pin background="#1d4ed8" borderColor="#1d4ed8" glyphColor="#fff" glyph="B" />
              </AdvancedMarker>
              {userPos && (
                <AdvancedMarker position={userPos} title="You">
                  <div className="h-4 w-4 rounded-full border-2 border-white bg-sky-400 shadow-[0_0_0_6px_rgba(56,189,248,0.35)]" />
                </AdvancedMarker>
              )}
              <TripCamera path={path} to={trip.to} userPos={userPos} follow={follow && geoState === "on"} />
            </Map>
          </APIProvider>
        ) : (
          <div className="flex h-full items-center justify-center p-6 text-center text-sm text-white/70">Map unavailable: no browser map key.</div>
        )}

        {geoState === "on" && (
          <button
            onClick={() => setFollow((f) => !f)}
            className={`absolute right-3 top-3 rounded-full px-3 py-2 text-sm font-semibold shadow ${follow ? "bg-white text-ink" : "bg-ink/80 text-white"}`}
          >
            {follow ? "Following" : "Follow me"}
          </button>
        )}
      </div>

      <footer className="px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
        {geoState === "denied" && <p className="mb-2 text-center text-xs text-white/60">Location is off, so the planned route is shown without your position.</p>}
        <button onClick={onEnd} className="w-full rounded-2xl bg-white py-4 text-base font-bold text-ink">End Trip</button>
      </footer>
    </div>
  );
}
