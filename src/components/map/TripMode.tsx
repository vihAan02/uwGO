"use client";
import { ArrowLeft, ChevronDown, Compass, Locate } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { APIProvider, AdvancedMarker, Map, Pin, useAdvancedMarkerRef, useMap } from "@vis.gl/react-google-maps";
import { decode } from "@googlemaps/polyline-codec";
import type { CampusLocation, RouteOption, RoutePreference } from "@/domain/types";
import { formatClock, formatDuration } from "@/time/toronto";
import { rerouteFrom, resolveTripRoute, type TripRouteStatus } from "@/lib/tripRoute";
import { TripRerouter } from "@/lib/tripReroute";
import { ARRIVED_METERS, formatRemaining, pathMetrics, projectOntoPath, remainingFrom, type PathMetrics, type Point, type Projection } from "@/lib/routeProgress";
import { currentHeading, useDeviceHeading, type HeadingSample } from "@/lib/useDeviceHeading";
import { headingDelta } from "@/lib/deviceHeading";
import { NAV_ZOOM, comfortablyVisible, navigationPose, poseSettled, stepPose, type CameraPose } from "@/lib/tripCamera";

const KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY;
const MAP_ID = process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID || "DEMO_MAP_ID";

export interface Trip {
  label: string;
  from: CampusLocation;
  to: CampusLocation;
  route: RouteOption;
  /** Used if the transit option turns out to have gone. */
  walkFallback?: RouteOption;
  /** The student's route preference, so a reroute is chosen by the same rule that chose this route. */
  preference?: RoutePreference;
}

const pt = (l: { latitude: number; longitude: number }): Point => ({ lat: l.latitude, lng: l.longitude });

/** The latest GPS fix. Lives in a ref: it changes every second and only the map needs to know. */
interface Fix extends Point {
  accuracy: number;
  at: number;
}

/** Everything the sensors know, shared by the GPS handler, the compass and the camera loop. */
interface Live {
  fix?: Fix;
  proj?: Projection;
}

/** How fast the camera closes on its target each frame; smaller is smoother, larger is snappier. */
const EASE = 0.18;
/** Camera work is capped at about this many frames a second; the map does not need more. */
const FRAME_MS = 33;

/**
 * Draws the route, the student's marker and drives the flat navigation camera. The loop reads
 * the sensor refs directly: no React state is touched on a GPS or compass event, only the
 * map and the marker are.
 */
function TripCamera({ path, live, heading, headingUp, follow, hasPos, onUserGesture }: {
  path: Point[];
  live: RefObject<Live>;
  heading: RefObject<HeadingSample>;
  /** Turn the map so the way the phone faces is up. Needs a trustworthy heading and a vector map. */
  headingUp: boolean;
  follow: boolean;
  hasPos: boolean;
  onUserGesture: () => void;
}) {
  const map = useMap();
  const lineRef = useRef<google.maps.Polyline | undefined>(undefined);
  const [markerRef, marker] = useAdvancedMarkerRef();
  const coneRef = useRef<HTMLDivElement | null>(null);
  const followRef = useRef(follow);
  useEffect(() => { followRef.current = follow; }, [follow]);

  useEffect(() => {
    if (!map || path.length < 2) return;
    lineRef.current?.setMap(null);
    lineRef.current = new google.maps.Polyline({
      path, strokeColor: "#1d4ed8", strokeOpacity: 0.95, strokeWeight: 8, map,
      icons: [{ icon: { path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW, scale: 3, strokeColor: "#fff", fillColor: "#fff", fillOpacity: 1 }, offset: "0", repeat: "90px" }],
    });
    return () => { lineRef.current?.setMap(null); lineRef.current = undefined; };
  }, [map, path]);

  // Frame the whole trip, flat and north-up. The fullscreen panel settles its layout after
  // the map mounts, so re-fit once the container has its real size and again whenever it
  // changes (rotation, keyboard), unless the camera is busy following the student.
  useEffect(() => {
    if (!map || path.length < 2) return;
    const frame = () => {
      if (followRef.current && live.current.fix) return;
      const bounds = new google.maps.LatLngBounds();
      for (const p of path) bounds.extend(p);
      map.fitBounds(bounds, 80);
    };
    frame();
    const settle = setTimeout(frame, 350);
    let debounce: ReturnType<typeof setTimeout> | undefined;
    const ro = new ResizeObserver(() => { clearTimeout(debounce); debounce = setTimeout(frame, 200); });
    ro.observe(map.getDiv());
    return () => { clearTimeout(settle); clearTimeout(debounce); ro.disconnect(); };
  }, [map, path, live]);

  // A pan, pinch, wheel or double-tap is the student taking over; stop moving the map under them.
  useEffect(() => {
    if (!map) return;
    const div = map.getDiv();
    const onTouch = (e: TouchEvent) => { if (e.touches.length >= 2) onUserGesture(); };
    const onWheel = () => onUserGesture();
    const listeners = [map.addListener("dragstart", onUserGesture), map.addListener("dblclick", onUserGesture)];
    div.addEventListener("touchstart", onTouch, { passive: true });
    div.addEventListener("wheel", onWheel, { passive: true });
    return () => {
      for (const l of listeners) l.remove();
      div.removeEventListener("touchstart", onTouch);
      div.removeEventListener("wheel", onWheel);
    };
  }, [map, onUserGesture]);

  // The one animation loop: marker position, viewfinder rotation and the follow camera.
  useEffect(() => {
    if (!map || !hasPos) return;
    let raf = 0;
    let last = 0;
    let applied: Point | undefined;
    let appliedCone: string | undefined;
    let recentering = false;
    const vector = map.getRenderingType?.() === google.maps.RenderingType.VECTOR;
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      if (t - last < FRAME_MS) return;
      last = t;
      const fix = live.current.fix;
      if (!fix) return;
      const mapHeading = vector ? (map.getHeading() ?? 0) : 0;
      const h = currentHeading(heading.current);

      if (marker && (!applied || applied.lat !== fix.lat || applied.lng !== fix.lng)) {
        marker.position = { lat: fix.lat, lng: fix.lng };
        applied = { lat: fix.lat, lng: fix.lng };
      }
      // The marker is drawn screen-aligned, so the cone turns by the heading relative to the map's own rotation.
      const cone = coneRef.current;
      if (cone) {
        const want = h === undefined ? "" : `rotate(${Math.round(headingDelta(mapHeading, h))}deg)`;
        if (want !== appliedCone) {
          cone.style.transform = want;
          cone.style.opacity = h === undefined ? "0" : "1";
          appliedCone = want;
        }
      }

      if (!follow) return;
      const rotate = headingUp && vector && h !== undefined;
      const target: CameraPose = navigationPose(fix, rotate ? h : undefined);
      const centre = map.getCenter();
      const zoom = map.getZoom();
      if (!centre || zoom === undefined) return;
      const current: CameraPose = { center: centre.toJSON(), heading: mapHeading, zoom };
      if (!rotate && !recentering) {
        // North-up: leave the map alone while the student is comfortably on screen at the navigation zoom.
        const b = map.getBounds()?.toJSON();
        const settled = b && comfortablyVisible(b, fix) && Math.abs(zoom - NAV_ZOOM) < 0.01 && Math.abs(headingDelta(mapHeading, 0)) < 0.5;
        if (settled) return;
        recentering = true;
      }
      if (poseSettled(current, target)) { recentering = false; return; }
      const next = stepPose(current, target, EASE);
      map.moveCamera({ center: next.center, heading: rotate || vector ? next.heading : undefined, zoom: next.zoom, tilt: 0 });
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [map, hasPos, follow, headingUp, marker, live, heading]);

  if (!hasPos) return null;
  return (
    <AdvancedMarker ref={markerRef} position={null} title="You">
      {/* Position comes from GPS and is set by the loop above; the cone is the compass and hides when there is no trustworthy heading. */}
      <div className="relative h-4 w-4">
        <div ref={coneRef} aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 h-16 w-16 -translate-x-1/2 -translate-y-1/2 opacity-0 transition-opacity duration-300">
          <svg viewBox="0 0 64 64" className="h-16 w-16">
            <defs>
              <linearGradient id="uwgo-cone" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="rgb(56 189 248)" stopOpacity="0.55" />
                <stop offset="1" stopColor="rgb(56 189 248)" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d="M32 32 L14 4 A34 34 0 0 1 50 4 Z" fill="url(#uwgo-cone)" />
          </svg>
        </div>
        <div className="relative h-4 w-4 rounded-full border-2 border-white bg-sky-400 shadow-[0_0_0_6px_rgba(56,189,248,0.35)]" />
      </div>
    </AdvancedMarker>
  );
}

function modeLabel(r: RouteOption): string {
  if (r.indoorPath) return "Indoors";
  if (r.mode === "WALK") return "Walking";
  const first = r.steps?.find((s) => s.mode === "TRANSIT")?.transit;
  const vehicle = (first?.vehicle ?? "").toLowerCase();
  if (vehicle.includes("light rail") || vehicle.includes("tram")) return "ION light rail";
  return vehicle.includes("bus") ? "Bus" : "Transit";
}

/** What the header shows about the rest of the trip; only changes when a shown number changes. */
interface Progress {
  time: string;
  distance: string;
  arrived: boolean;
}

export function TripMode({ trip, onEnd }: { trip: Trip; onEnd: () => void }) {
  const [resolved, setResolved] = useState<{ route: RouteOption; status: TripRouteStatus; note?: string }>({ route: trip.route, status: "PLANNED" });
  const [checking, setChecking] = useState(trip.route.mode === "TRANSIT");
  const hasGeolocation = typeof navigator !== "undefined" && "geolocation" in navigator;
  const [geoState, setGeoState] = useState<"asking" | "on" | "denied" | "unavailable">(hasGeolocation ? "asking" : "denied");
  const [follow, setFollow] = useState(true);
  const [showDetails, setShowDetails] = useState(false);
  const [progress, setProgress] = useState<Progress | undefined>();
  const live = useRef<Live>({});
  const compass = useDeviceHeading();
  // One rerouter per trip: the destination and the preference are fixed for its whole life, so
  // a reroute can never quietly change where the student is going or how they want to get there.
  const rerouter = useMemo(() => new TripRerouter(trip.to, trip.preference ?? "FASTEST", rerouteFrom), [trip.to, trip.preference]);

  // A trip that starts now must not show a bus that has already left.
  useEffect(() => {
    let cancelled = false;
    resolveTripRoute(trip.route, trip.walkFallback, trip.from, trip.to)
      .then((r) => { if (!cancelled) { setResolved(r); setChecking(false); } })
      .catch(() => { if (!cancelled) setChecking(false); });
    return () => { cancelled = true; };
  }, [trip]);

  const route = resolved.route;
  const path = useMemo<Point[]>(
    () => (route.polyline ? decode(route.polyline).map(([lat, lng]) => ({ lat, lng })) : [pt(trip.from), pt(trip.to)]),
    [route, trip.from, trip.to],
  );
  const metrics = useMemo<PathMetrics>(() => pathMetrics(path), [path]);
  const metricsRef = useRef(metrics);
  const routeRef = useRef(route);
  // A new route (refreshed transit, or a reroute) restarts progress from scratch.
  useEffect(() => { metricsRef.current = metrics; routeRef.current = route; live.current.proj = undefined; }, [metrics, route]);

  /** Recomputes what is left from the latest fix; sets state only if a shown number changed. */
  const commitProgress = useCallback((now: Date) => {
    const fix = live.current.fix;
    if (!fix) return;
    const m = metricsRef.current;
    const proj = projectOntoPath(m, fix, live.current.proj);
    if (!proj) return;
    live.current.proj = proj;
    const r = remainingFrom(routeRef.current, m, proj, now);
    const f = formatRemaining(r);
    const arrived = m.total - proj.alongMeters <= ARRIVED_METERS && proj.offRouteMeters <= ARRIVED_METERS * 2;
    setProgress((p) => (p && p.time === f.time && p.distance === f.distance && p.arrived === arrived ? p : { ...f, arrived }));

    // Judging whether the student has left the route runs on every fix: it is only arithmetic.
    // Asking for a new one is rationed by the rerouter, which picks it through the same
    // selection the plan uses, so an outdoor trip can become a winter one and a winter one can
    // go back outside, whichever is now the better way to the same destination. A failed or
    // refused reroute returns nothing and the route already on screen simply stays.
    rerouter.consider({ at: { latitude: fix.lat, longitude: fix.lng }, offRouteMeters: proj.offRouteMeters, accuracyMeters: fix.accuracy }, routeRef.current, now)
      .then((r) => { if (r) setResolved(r); });
  }, [rerouter]);

  // Location is requested only here, when the student actually starts a trip. GPS fixes go
  // into a ref; the only state touched is the status and the remaining numbers on screen.
  useEffect(() => {
    if (!hasGeolocation) return;
    const id = navigator.geolocation.watchPosition(
      (p) => {
        live.current.fix = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, at: p.timestamp };
        setGeoState("on");
        commitProgress(new Date());
      },
      (err) => setGeoState(err.code === err.PERMISSION_DENIED ? "denied" : "unavailable"),
      { enableHighAccuracy: true, maximumAge: 1_000, timeout: 15_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [hasGeolocation, commitProgress]);

  // On transit the remaining time is time to arrival, which passes even while standing at a stop.
  useEffect(() => {
    if (route.mode !== "TRANSIT" || !route.arrivalTime) return;
    const id = setInterval(() => commitProgress(new Date()), 30_000);
    return () => clearInterval(id);
  }, [route, commitProgress]);

  const onUserGesture = useCallback(() => setFollow(false), []);
  const recenter = () => setFollow(true);

  const board = route.steps?.find((s) => s.mode === "TRANSIT")?.transit;
  const transitLegs = (route.steps ?? []).filter((s) => s.mode === "TRANSIT");
  const lastLeg = transitLegs[transitLegs.length - 1]?.transit;
  const steps = route.steps ?? [];
  const firstAt = steps.findIndex((s) => s.mode === "TRANSIT");
  const lastAt = steps.length - 1 - [...steps].reverse().findIndex((s) => s.mode === "TRANSIT");
  const sumWalk = (a: number, b: number) => steps.slice(a, b).reduce((n, s) => n + s.durationMinutes, 0);
  const walkBefore = firstAt > 0 ? sumWalk(0, firstAt) : 0;
  const walkAfter = firstAt >= 0 ? sumWalk(lastAt + 1, steps.length) : 0;
  const hasDetails = Boolean(board);
  const distanceText = route.distanceMeters === undefined ? undefined : route.distanceMeters < 1000 ? `${route.distanceMeters} m` : `${(route.distanceMeters / 1000).toFixed(1)} km`;
  const remaining = geoState === "on" ? progress : undefined;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-ink text-white">
      {/*
        Kept deliberately short: on a phone every line here is a line of map the student
        does not get. Destination, time, mode and boarding time earn their place; the
        stop names, line name and walking legs sit behind Details.
      */}
      <header className="px-4 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
        <div className="flex items-center gap-2">
          <Button onClick={onEnd} aria-label="End trip" variant="inverse-soft" size="icon" className="-ml-1 shrink-0 rounded-full"><ArrowLeft /></Button>
          <h1 className="min-w-0 flex-1 truncate text-lg font-bold">{trip.to.name}</h1>
          {hasDetails && (
            <Button onClick={() => setShowDetails((v) => !v)} aria-expanded={showDetails} variant="ghost" size="sm" className="shrink-0 text-white/70 hover:bg-white/10 hover:text-white">
              Details <ChevronDown className={showDetails ? "rotate-180 transition-transform" : "transition-transform"} />
            </Button>
          )}
        </div>

        {/* With a live position the numbers are what is left along the route; without one they are the whole trip. */}
        <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 pl-10 text-sm" aria-live="polite" data-testid="trip-summary">
          {remaining ? (
            remaining.arrived ? (
              <span className="text-2xl font-bold">You&rsquo;re here</span>
            ) : (
              <>
                <span className="text-2xl font-bold">{remaining.time}</span>
                <span className="text-white/80">{"· "}{remaining.distance} remaining</span>
              </>
            )
          ) : (
            <>
              <span className="text-2xl font-bold">{formatDuration(route.durationMinutes)}</span>
              {route.mode === "TRANSIT" && route.arrivalTime && <span className="text-white/80">Arrive {formatClock(route.arrivalTime)}</span>}
              {route.mode === "WALK" && distanceText && <span className="text-white/80">{distanceText}</span>}
            </>
          )}
          <span className="text-white/70">
            {"· "}
            {checking ? "checking…" : board ? `${modeLabel(route)} ${board.lineShort ?? board.line}` : modeLabel(route)}
          </span>
          {board && <span className="font-semibold text-white">Board {formatClock(board.departureTime)}</span>}
        </div>

        {resolved.note && <p className="mt-1 pl-10 text-sm text-amber-200">{resolved.note}</p>}

        {showDetails && (
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 pl-10 text-sm text-white/70">
            <dt>From</dt><dd className="text-white/90">{trip.from.name}</dd>
            {board && <><dt>Board at</dt><dd className="text-white/90">{board.departureStop}</dd></>}
            {board?.line && board.line !== board.lineShort && <><dt>Line</dt><dd className="text-white/90">{board.line}{board.headsign ? ` toward ${board.headsign}` : ""}</dd></>}
            {lastLeg && <><dt>Get off</dt><dd className="text-white/90">{lastLeg.arrivalStop} {formatClock(lastLeg.arrivalTime)}</dd></>}
            {route.transferCount ? <><dt>Transfers</dt><dd className="text-white/90">{route.transferCount}</dd></> : null}
            {walkBefore > 0 && <><dt>Walk first</dt><dd className="text-white/90">{formatDuration(walkBefore)}</dd></>}
            {walkAfter > 0 && <><dt>Walk after</dt><dd className="text-white/90">{formatDuration(walkAfter)}</dd></>}
          </dl>
        )}
      </header>

      <div className="relative min-h-0 flex-1">
        {KEY ? (
          <APIProvider apiKey={KEY}>
            <Map
              defaultCenter={pt(trip.from)}
              defaultZoom={16}
              defaultTilt={0}
              defaultHeading={0}
              mapId={MAP_ID}
              gestureHandling="greedy"
              disableDefaultUI
              tiltInteractionEnabled={false}
              headingInteractionEnabled={false}
              style={{ width: "100%", height: "100%" }}
            >
              <AdvancedMarker position={pt(trip.to)} title={trip.to.name}>
                <Pin background="#1d4ed8" borderColor="#1d4ed8" glyphColor="#fff" glyph="B" />
              </AdvancedMarker>
              <TripCamera
                path={path}
                live={live}
                heading={compass.sample}
                headingUp={compass.status === "on"}
                follow={follow}
                hasPos={geoState === "on"}
                onUserGesture={onUserGesture}
              />
            </Map>
          </APIProvider>
        ) : (
          <div className="flex h-full items-center justify-center p-6 text-center text-sm text-white/70">Map unavailable: no browser map key.</div>
        )}

        {geoState === "on" && (
          <div className="absolute right-3 bottom-9 flex flex-col items-end gap-2">
            {compass.status === "needs-permission" && (
              // iOS only grants the compass from a tap, so it is asked for here rather than at Start Trip.
              <Button onClick={compass.request} variant="inverse-soft" size="lg" className="rounded-full bg-ink/85 shadow-lg hover:bg-ink">
                <Compass /> Use compass
              </Button>
            )}
            <Button
              onClick={follow ? () => setFollow(false) : recenter}
              aria-pressed={follow}
              variant="inverse"
              size="lg"
              className={`rounded-full shadow-lg ${follow ? "" : "bg-ink/85 text-white hover:bg-ink"}`}
            >
              <Locate /> {follow ? "Following" : "Recenter"}
            </Button>
          </div>
        )}
      </div>

      <footer className="px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
        {geoState === "denied" && <p className="mb-2 text-center text-xs text-white/60">Location is off, so the planned route is shown without your position.</p>}
        {geoState === "unavailable" && <p className="mb-2 text-center text-xs text-white/60">Can&rsquo;t get your location right now, so the planned route is shown without it.</p>}
        <Button onClick={onEnd} variant="inverse" size="xl" className="w-full rounded-2xl font-bold">End Trip</Button>
      </footer>
    </div>
  );
}
