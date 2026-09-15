"use client";
import { ChevronDown, Compass, Loader2, LocateFixed } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ModeIcon } from "@/components/plan/ModeIcon";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { APIProvider, AdvancedMarker, Map, Pin, useAdvancedMarkerRef, useMap } from "@vis.gl/react-google-maps";
import { decode } from "@googlemaps/polyline-codec";
import { animate } from "animejs";
import type { CampusLocation, RouteOption, RoutePreference } from "@/domain/types";
import { formatClock, formatDuration } from "@/time/toronto";
import { rerouteFrom, resolveTripRoute, type TripRouteStatus } from "@/lib/tripRoute";
import { TripRerouter } from "@/lib/tripReroute";
import { useClosures } from "@/lib/ClosuresProvider";
import { CONSUME_MAX_OFF_METERS, advanceProgress, pathMetrics, projectOntoPath, remainingPath, type PathMetrics, type Point, type Projection } from "@/lib/routeProgress";
import { liveHeadline, plannedHeadline, sameHeadline, tripInstruction, type TripHeadline } from "@/lib/tripDisplay";
import { currentHeading, useDeviceHeading, type HeadingSample } from "@/lib/useDeviceHeading";
import { headingDelta, smoothHeading } from "@/lib/deviceHeading";
import { NAV_ZOOM, centreShiftMeters, comfortablyVisible, navigationPose, poseSettled, stepPose, visibleBounds, type CameraPose, type Insets } from "@/lib/tripCamera";
import { DURATION, EASE_OUT } from "@/lib/motion";
import { cn } from "@/lib/utils";

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
  /** Metres of the current route already walked: where the drawn line now starts. */
  along: number;
  /** Direction of travel from the GPS itself, smoothed, when the phone is moving; the compass's stand-in. */
  course?: number;
}

/** How fast the camera closes on its target each frame; smaller is smoother, larger is snappier. */
const EASE = 0.18;
/** How fast the marker glides to a new fix: about half a second, so it walks rather than hops. */
const MARKER_EASE = 0.22;
/** A fix further than this from where the marker is drawn is a jump, not a step, and the marker jumps with it. */
const MARKER_SNAP_METERS = 60;
/** Camera work is capped at about this many frames a second; the map does not need more. */
const FRAME_MS = 33;
/** Slower than this and the GPS course is noise, not a direction of travel. */
const COURSE_MIN_SPEED = 0.7;
/** A raster map (no WebGL) snaps to whole zoom levels, so aiming between two of them would never settle. */
const RASTER_NAV_ZOOM = 17;
/** Side room when the whole trip is framed, so neither end sits against the edge of the screen. */
const FRAME_SIDE_PX = 48;

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** One-frame scale between two points in metres, good enough to tell a step from a jump. */
function metresApart(a: Point, b: Point): number {
  return Math.hypot((a.lat - b.lat) * 111_320, (a.lng - b.lng) * 111_320 * Math.cos((a.lat * Math.PI) / 180));
}

/**
 * Draws the route, the student's marker and drives the flat navigation camera. The loop reads
 * the sensor refs directly: no React state is touched on a GPS or compass event, only the
 * map, the line and the marker are.
 */
function TripCamera({ metrics, live, heading, headingUp, follow, hasPos, insets, onUserGesture }: {
  metrics: PathMetrics;
  live: RefObject<Live>;
  heading: RefObject<HeadingSample>;
  /** Turn the map so the way the phone faces is up. Needs a trustworthy heading and a vector map. */
  headingUp: boolean;
  follow: boolean;
  hasPos: boolean;
  /** Pixels of map covered by the trip's own panels, top and bottom. */
  insets: Insets;
  onUserGesture: () => void;
}) {
  const map = useMap();
  const lineRef = useRef<google.maps.Polyline | undefined>(undefined);
  const [markerRef, marker] = useAdvancedMarkerRef();
  const coneRef = useRef<HTMLDivElement | null>(null);
  const followRef = useRef(follow);
  useEffect(() => { followRef.current = follow; }, [follow]);
  const insetsRef = useRef(insets);
  useEffect(() => { insetsRef.current = insets; }, [insets]);

  // The line is the part of the route still ahead. A new route (a reroute) replaces it at once
  // and fades in, so the old route never flashes whole and the new one does not pop.
  useEffect(() => {
    if (!map || metrics.path.length < 2) return;
    lineRef.current?.setMap(null);
    const fade = { o: reducedMotion() ? 0.95 : 0 };
    const line = new google.maps.Polyline({
      path: remainingPath(metrics, live.current.along), strokeColor: "#1d4ed8", strokeOpacity: fade.o, strokeWeight: 8, map,
      icons: [{ icon: { path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW, scale: 3, strokeColor: "#fff", fillColor: "#fff", fillOpacity: 1 }, offset: "0", repeat: "90px" }],
    });
    lineRef.current = line;
    const anim = fade.o < 0.95 ? animate(fade, { o: 0.95, duration: 280, ease: "out(3)", onUpdate: () => line.setOptions({ strokeOpacity: fade.o }) }) : undefined;
    return () => { anim?.cancel(); line.setMap(null); lineRef.current = undefined; };
  }, [map, metrics, live]);

  // Frame the whole trip, flat and north-up, clear of the panels. The fullscreen panel settles
  // its layout after the map mounts, so re-fit once the container has its real size and again
  // whenever it changes (rotation, keyboard), unless the camera is busy following the student.
  useEffect(() => {
    if (!map || metrics.path.length < 2) return;
    const frame = () => {
      if (followRef.current && live.current.fix) return;
      const bounds = new google.maps.LatLngBounds();
      for (const p of metrics.path) bounds.extend(p);
      const i = insetsRef.current;
      map.fitBounds(bounds, { top: i.topPx + 24, bottom: i.bottomPx + 24, left: FRAME_SIDE_PX, right: FRAME_SIDE_PX });
    };
    frame();
    const settle = setTimeout(frame, 350);
    let debounce: ReturnType<typeof setTimeout> | undefined;
    const ro = new ResizeObserver(() => { clearTimeout(debounce); debounce = setTimeout(frame, 200); });
    ro.observe(map.getDiv());
    return () => { clearTimeout(settle); clearTimeout(debounce); ro.disconnect(); };
  }, [map, metrics, live]);

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

  // The one animation loop: marker glide, viewfinder rotation, the trimmed line and the follow camera.
  useEffect(() => {
    if (!map || !hasPos) return;
    let raf = 0;
    let last = 0;
    let shown: Point | undefined;
    let appliedCone: string | undefined;
    let appliedAlong = -1;
    let recentering = false;
    const vector = map.getRenderingType?.() === google.maps.RenderingType.VECTOR;
    const navZoom = vector ? NAV_ZOOM : RASTER_NAV_ZOOM;
    const glide = !reducedMotion();
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      if (t - last < FRAME_MS) return;
      last = t;
      const fix = live.current.fix;
      if (!fix) return;
      const mapHeading = vector ? (map.getHeading() ?? 0) : 0;
      const h = currentHeading(heading.current) ?? live.current.course;

      // The marker walks to each fix rather than hopping, unless the fix is a jump.
      if (marker) {
        const target = { lat: fix.lat, lng: fix.lng };
        if (!shown || !glide || metresApart(shown, target) > MARKER_SNAP_METERS) shown = target;
        else if (metresApart(shown, target) > 0.15) shown = { lat: shown.lat + (target.lat - shown.lat) * MARKER_EASE, lng: shown.lng + (target.lng - shown.lng) * MARKER_EASE };
        else shown = target;
        marker.position = shown;
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
      // The line starts where the student has got to; the part behind them is gone.
      const line = lineRef.current;
      if (line && Math.abs(live.current.along - appliedAlong) > 0.5) {
        appliedAlong = live.current.along;
        line.setPath(remainingPath(metrics, appliedAlong));
      }

      if (!follow) return;
      const compass = currentHeading(heading.current);
      const rotate = headingUp && vector && compass !== undefined;
      const insetsNow = insetsRef.current;
      const shift = centreShiftMeters(fix.lat, navZoom, insetsNow);
      const target: CameraPose = navigationPose(fix, rotate ? compass : undefined, navZoom, shift);
      const centre = map.getCenter();
      const zoom = map.getZoom();
      if (!centre || zoom === undefined) return;
      const current: CameraPose = { center: centre.toJSON(), heading: mapHeading, zoom };
      if (!rotate && !recentering) {
        // North-up: leave the map alone while the student is comfortably in view at the navigation zoom.
        const b = map.getBounds()?.toJSON();
        const height = map.getDiv().clientHeight || 1;
        const settled = b && comfortablyVisible(visibleBounds(b, insetsNow.topPx / height, insetsNow.bottomPx / height), fix)
          && Math.abs(zoom - navZoom) < 0.01 && Math.abs(headingDelta(mapHeading, 0)) < 0.5;
        if (settled) return;
        recentering = true;
      }
      if (poseSettled(current, target)) { recentering = false; return; }
      const next = stepPose(current, target, EASE);
      // A raster map rounds zoom to whole levels, so an eased zoom would round back to where it started every frame.
      map.moveCamera({ center: next.center, heading: rotate || vector ? next.heading : undefined, zoom: vector ? next.zoom : target.zoom, tilt: 0 });
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [map, hasPos, follow, headingUp, marker, live, heading, metrics]);

  if (!hasPos) return null;
  return (
    <AdvancedMarker ref={markerRef} position={null} title="You">
      {/* Position comes from GPS and is set by the loop above; the cone is the compass (or the direction of travel) and hides when there is no trustworthy heading. */}
      <div className="relative h-4 w-4">
        <div ref={coneRef} aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 h-16 w-16 -translate-x-1/2 -translate-y-1/2 opacity-0 transition-opacity duration-300">
          <svg viewBox="0 0 64 64" className="h-16 w-16">
            <defs>
              <linearGradient id="uwgo-cone" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="rgb(29 78 216)" stopOpacity="0.45" />
                <stop offset="1" stopColor="rgb(29 78 216)" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d="M32 32 L14 4 A34 34 0 0 1 50 4 Z" fill="url(#uwgo-cone)" />
          </svg>
        </div>
        <div className="relative h-4 w-4 rounded-full border-2 border-white bg-brand shadow-[0_0_0_6px_rgb(29_78_216/0.22)]" />
      </div>
    </AdvancedMarker>
  );
}

/** Fades and lifts the panel's content in whenever `phase` changes after the first render; nothing under reduced motion. */
function usePhaseEntrance(ref: RefObject<HTMLElement | null>, phase: string) {
  const first = useRef(true);
  useLayoutEffect(() => {
    // The panels' own entrance covers the first phase.
    if (first.current) { first.current = false; return; }
    const el = ref.current;
    if (!el || reducedMotion()) return;
    const anim = animate(el, { opacity: [0, 1], translateY: [6, 0], duration: DURATION.base, ease: EASE_OUT });
    return () => { anim.cancel(); el.style.opacity = ""; el.style.transform = ""; };
  }, [ref, phase]);
}

/** The bottom panel's height and the top bar's, so the map can keep the route and the student clear of them. */
function useInsets(top: RefObject<HTMLElement | null>, bottom: RefObject<HTMLElement | null>): Insets {
  const [insets, setInsets] = useState<Insets>({ topPx: 0, bottomPx: 0 });
  useEffect(() => {
    const measure = () => {
      const next = { topPx: Math.round(top.current?.getBoundingClientRect().height ?? 0), bottomPx: Math.round(bottom.current?.getBoundingClientRect().height ?? 0) };
      setInsets((p) => (p.topPx === next.topPx && p.bottomPx === next.bottomPx ? p : next));
    };
    const ro = new ResizeObserver(measure);
    if (top.current) ro.observe(top.current);
    if (bottom.current) ro.observe(bottom.current);
    measure();
    return () => ro.disconnect();
  }, [top, bottom]);
  return insets;
}

/**
 * Back ends the trip rather than leaving the planner. The trip keeps a history entry of its own while it
 * runs: pressing back pops it, and ending the trip from the screen goes back through it too, so nothing is
 * left behind. `finish` runs `onEnd` exactly once whichever way the trip ends, including under React's
 * development double effects, which find the entry already there and do not stack a second.
 */
function useBackEndsTrip(onEnd: () => void): () => void {
  const onEndRef = useRef(onEnd);
  const finished = useRef(false);
  useEffect(() => { onEndRef.current = onEnd; });
  const finish = useCallback(() => {
    if (finished.current) return;
    finished.current = true;
    onEndRef.current();
  }, []);
  useEffect(() => {
    if (!(window.history.state as { uwgoTrip?: boolean } | null)?.uwgoTrip) {
      window.history.pushState({ ...(window.history.state ?? {}), uwgoTrip: true }, "");
    }
    const onPop = () => { if (!(window.history.state as { uwgoTrip?: boolean } | null)?.uwgoTrip) finish(); };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [finish]);
  return useCallback(() => {
    if ((window.history.state as { uwgoTrip?: boolean } | null)?.uwgoTrip) {
      window.history.back();
      // If the browser declines to go back, the trip still ends.
      setTimeout(finish, 400);
    } else {
      finish();
    }
  }, [finish]);
}

export function TripMode({ trip, onEnd }: { trip: Trip; onEnd: () => void }) {
  const [resolved, setResolved] = useState<{ route: RouteOption; status: TripRouteStatus; note?: string }>({ route: trip.route, status: "PLANNED" });
  const [checking, setChecking] = useState(trip.route.mode === "TRANSIT");
  const hasGeolocation = typeof navigator !== "undefined" && "geolocation" in navigator;
  const [geoState, setGeoState] = useState<"asking" | "on" | "denied" | "unavailable">(hasGeolocation ? "asking" : "denied");
  const [follow, setFollow] = useState(true);
  const [showDetails, setShowDetails] = useState(false);
  const [headline, setHeadline] = useState<TripHeadline | undefined>();
  const [rerouting, setRerouting] = useState(false);
  // A "route updated" note is worth a few seconds, not the rest of the trip; which route it was about is remembered so it is not shown twice.
  const [noteDismissedFor, setNoteDismissedFor] = useState<RouteOption | undefined>();
  const live = useRef<Live>({ along: 0 });
  const compass = useDeviceHeading();
  const topRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const sheetContentRef = useRef<HTMLDivElement>(null);
  const insets = useInsets(topRef, sheetRef);
  const end = useBackEndsTrip(onEnd);
  // The trip replaces the planner: focus starts on where the student is going, so a screen reader
  // announces the new screen and a keyboard starts from its top.
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { headingRef.current?.focus({ preventScroll: true }); }, []);
  // Closures are read through a ref, not a dependency: a background refresh of the tallies must
  // not rebuild the rerouter and restart its off-route evidence mid-trip. The getter is called at
  // the moment a reroute happens, so a closure confirmed during the walk is still honoured.
  const closures = useClosures();
  // One rerouter per trip: the destination and the preference are fixed for its whole life, so
  // a reroute can never quietly change where the student is going or how they want to get there.
  const rerouter = useMemo(() => new TripRerouter(trip.to, trip.preference ?? "FASTEST", rerouteFrom, { onBusy: setRerouting }), [trip.to, trip.preference]);
  const closedRef = useRef<ReadonlySet<string>>(closures.closed);
  useEffect(() => { closedRef.current = closures.closed; }, [closures.closed]);

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

  /** Recomputes what is left from the latest fix; sets state only if a shown number changed. */
  const commitProgress = useCallback((now: Date) => {
    const fix = live.current.fix;
    if (!fix) return;
    const m = metricsRef.current;
    const proj = projectOntoPath(m, fix, live.current.proj);
    if (!proj) return;
    live.current.proj = proj;
    // The drawn line only ever advances, and only on a fix that believably sits on the route;
    // the countdown follows the student wherever they are, even beside it.
    live.current.along = advanceProgress(live.current.along, proj, fix.accuracy);
    const along = proj.offRouteMeters > CONSUME_MAX_OFF_METERS ? proj.alongMeters : live.current.along;
    const h = liveHeadline(routeRef.current, m, { alongMeters: along, offRouteMeters: proj.offRouteMeters }, now);
    setHeadline((p) => (sameHeadline(p, h) ? p : h));

    // Judging whether the student has left the route runs on every fix: it is only arithmetic.
    // Asking for a new one is rationed by the rerouter, which picks it through the same
    // selection the plan uses, so an outdoor trip can become a winter one and a winter one can
    // go back outside, whichever is now the better way to the same destination. A failed or
    // refused reroute returns nothing and the route already on screen simply stays.
    rerouter.consider(
      { at: { latitude: fix.lat, longitude: fix.lng }, offRouteMeters: proj.offRouteMeters, accuracyMeters: fix.accuracy, timestamp: fix.at, routeBearing: proj.bearing },
      routeRef.current,
      now,
      closedRef.current,
    ).then((r) => { if (r) setResolved(r); });
  }, [rerouter]);

  // A new route (refreshed transit, or a reroute) restarts progress from scratch: the line is
  // whole again from where the student is, and the numbers are the new route's at once.
  useEffect(() => {
    metricsRef.current = metrics;
    routeRef.current = route;
    live.current.proj = undefined;
    live.current.along = 0;
    commitProgress(new Date());
  }, [metrics, route, commitProgress]);

  // Location is requested only here, when the student actually starts a trip. GPS fixes go
  // into a ref; the only state touched is the status and the remaining numbers on screen.
  useEffect(() => {
    if (!hasGeolocation) return;
    const id = navigator.geolocation.watchPosition(
      (p) => {
        live.current.fix = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, at: p.timestamp };
        const course = p.coords.heading;
        const speed = p.coords.speed ?? 0;
        live.current.course = course !== null && Number.isFinite(course) && speed >= COURSE_MIN_SPEED ? smoothHeading(live.current.course, course, 0.35) : undefined;
        setGeoState("on");
        commitProgress(new Date());
      },
      (err) => setGeoState(err.code === err.PERMISSION_DENIED ? "denied" : "unavailable"),
      { enableHighAccuracy: true, maximumAge: 1_000, timeout: 15_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [hasGeolocation, commitProgress]);

  // The arrival clock moves with the clock even while the student stands still, and on transit
  // the remaining time is time to arrival, which passes at a stop too.
  useEffect(() => {
    const id = setInterval(() => commitProgress(new Date()), 30_000);
    return () => clearInterval(id);
  }, [commitProgress]);

  // The panels arrive once, the instruction from above and the numbers from below.
  useLayoutEffect(() => {
    if (reducedMotion()) return;
    const panels = [topRef.current?.firstElementChild, sheetRef.current?.firstElementChild].filter((el): el is HTMLElement => el instanceof HTMLElement);
    const anims = panels.map((el, i) => animate(el, { opacity: [0, 1], translateY: [i === 0 ? -8 : 8, 0], duration: DURATION.base, ease: EASE_OUT }));
    return () => {
      for (const a of anims) a.cancel();
      for (const el of panels) { el.style.opacity = ""; el.style.transform = ""; }
    };
  }, []);

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

  const live_ = geoState === "on" ? headline : undefined;
  const shown = live_ ?? plannedHeadline(route);
  const arrived = Boolean(live_?.arrived);
  const phase = arrived ? "arrived" : rerouting ? "rerouting" : live_ ? "live" : geoState;
  usePhaseEntrance(sheetContentRef, phase === "rerouting" || phase === "live" ? "live" : phase);

  // A reroute's note shows for a few seconds; notes about a bus that has gone stay, they matter until the student reads them.
  const note = resolved.status === "REROUTED" && noteDismissedFor === resolved.route ? undefined : resolved.note;
  useEffect(() => {
    if (resolved.status !== "REROUTED" || !resolved.note) return;
    const r = resolved.route;
    const id = setTimeout(() => setNoteDismissedFor(r), 8_000);
    return () => clearTimeout(id);
  }, [resolved]);

  const instruction = checking ? "Checking the bus…" : tripInstruction(route, trip.to);

  /** What to know right now, under the numbers: a reroute in progress, a change, or the state of the GPS. */
  const status: { text: string; tone: "muted" | "warn" | "busy" } | undefined = rerouting
    ? { text: "Finding a better route from here…", tone: "busy" }
    : note
      ? { text: note, tone: "warn" }
      : geoState === "asking"
        ? { text: "Finding your location…", tone: "busy" }
        : geoState === "denied"
          ? { text: "Location is off, so this is the planned route without your position.", tone: "muted" }
          : geoState === "unavailable"
            ? { text: "Can’t get your location right now, so this is the planned route.", tone: "muted" }
            : undefined;

  const map = KEY ? (
    <APIProvider apiKey={KEY}>
      <Map
        defaultCenter={pt(trip.from)}
        defaultZoom={16}
        defaultTilt={0}
        defaultHeading={0}
        mapId={MAP_ID}
        gestureHandling="greedy"
        disableDefaultUI
        clickableIcons={false}
        tiltInteractionEnabled={false}
        headingInteractionEnabled={false}
        style={{ width: "100%", height: "100%" }}
      >
        <AdvancedMarker position={pt(trip.to)} title={trip.to.name}>
          <Pin background="#1d4ed8" borderColor="#ffffff" glyphColor="#fff" />
        </AdvancedMarker>
        <TripCamera
          metrics={metrics}
          live={live}
          heading={compass.sample}
          headingUp={compass.status === "on"}
          follow={follow}
          hasPos={geoState === "on"}
          insets={insets}
          onUserGesture={onUserGesture}
        />
      </Map>
    </APIProvider>
  ) : (
    <div className="flex h-full items-center justify-center p-6 text-center text-sm text-ink-muted">The map isn&rsquo;t available right now.</div>
  );

  return (
    <div className="fixed inset-0 z-40 overflow-hidden bg-map-ground text-ink" data-testid="trip-mode">
      {/* The map is the screen. Everything else floats over it and stays as small as it can. */}
      <div className="absolute inset-0">{map}</div>

      {/* One instruction: where to go and the next thing to do. */}
      <div ref={topRef} className="pointer-events-none absolute inset-x-0 top-0 z-10 pt-[max(0.625rem,env(safe-area-inset-top))] pr-[max(0.75rem,env(safe-area-inset-right))] pl-[max(0.75rem,env(safe-area-inset-left))]">
        <div className="pointer-events-auto mx-auto max-w-xl rounded-2xl bg-ink px-4 py-3 text-white shadow-float">
          <div className="flex items-start gap-3">
            <ModeIcon route={route} className="mt-1 size-6 text-white/80" />
            <div className="min-w-0 flex-1">
              <h1 ref={headingRef} tabIndex={-1} className="truncate text-[18px] font-semibold leading-6 outline-none">{trip.to.name}</h1>
              <p className="mt-0.5 text-[15px] leading-[22px] text-white/80">{instruction}</p>
            </div>
            {hasDetails && (
              <button
                type="button"
                onClick={() => setShowDetails((v) => !v)}
                aria-expanded={showDetails}
                aria-label="Bus details"
                className="-my-1 -mr-2 grid size-11 shrink-0 touch-manipulation place-items-center rounded-full text-white/80 outline-none transition-colors hover:bg-white/10 focus-visible:ring-[3px] focus-visible:ring-white/40"
              >
                <ChevronDown className={cn("size-5 transition-transform duration-150", showDetails && "rotate-180")} />
              </button>
            )}
          </div>
          {showDetails && (
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-t border-white/15 pt-3 text-[14px] leading-5 text-white/70">
              <dt>From</dt><dd className="text-white">{trip.from.name}</dd>
              {board && <><dt>Board at</dt><dd className="text-white">{board.departureStop} · {formatClock(board.departureTime)}</dd></>}
              {board?.line && board.line !== board.lineShort && <><dt>Line</dt><dd className="text-white">{board.line}{board.headsign ? ` toward ${board.headsign}` : ""}</dd></>}
              {lastLeg && <><dt>Get off</dt><dd className="text-white">{lastLeg.arrivalStop} {formatClock(lastLeg.arrivalTime)}</dd></>}
              {route.transferCount ? <><dt>Transfers</dt><dd className="text-white">{route.transferCount}</dd></> : null}
              {walkBefore > 0 && <><dt>Walk first</dt><dd className="text-white">{formatDuration(walkBefore)}</dd></>}
              {walkAfter > 0 && <><dt>Walk after</dt><dd className="text-white">{formatDuration(walkAfter)}</dd></>}
            </dl>
          )}
        </div>
      </div>

      {/* Map controls, thumb height, clear of the bar. Only what is needed right now. */}
      {geoState === "on" && (compass.status === "needs-permission" || !follow) && (
        <div className="absolute z-10 flex flex-col items-end gap-2 right-[max(0.75rem,env(safe-area-inset-right))]" style={{ bottom: insets.bottomPx + 12 }}>
          {compass.status === "needs-permission" && (
            // iOS only grants the compass from a tap, so it is asked for here rather than at Start Trip.
            <Button onClick={compass.request} variant="float" size="touch" className="rounded-full">
              <Compass /> Use compass
            </Button>
          )}
          {!follow && (
            <Button onClick={recenter} variant="float" size="touch" className="rounded-full">
              <LocateFixed /> Recenter
            </Button>
          )}
        </div>
      )}

      {/* How long, how far, when, and the way out. Held clear of Google's logo and terms along the map's bottom edge (DESIGN.md §2). */}
      <div ref={sheetRef} className="absolute inset-x-0 bottom-0 z-10 pr-[max(0.75rem,env(safe-area-inset-right))] pb-[max(2.25rem,env(safe-area-inset-bottom))] pl-[max(0.75rem,env(safe-area-inset-left))]">
        <div className="mx-auto max-w-xl rounded-3xl bg-surface p-4 shadow-sheet">
          <div ref={sheetContentRef}>
            {arrived ? (
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[28px] font-semibold leading-8 tracking-[-0.02em]">You&rsquo;re here</p>
                  <p className="mt-1 truncate text-[15px] leading-[22px] text-ink-muted">{trip.to.name}</p>
                </div>
                <Button onClick={end} size="primary" className="shrink-0 rounded-full px-6">Done</Button>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1" aria-live="polite" data-testid="trip-summary">
                    <p className="text-[28px] font-semibold leading-8 tracking-[-0.02em] tabular-nums">{shown.time}</p>
                    <p className="mt-0.5 text-[15px] leading-[22px] text-ink-muted tabular-nums">
                      {[shown.distance, shown.arrival && `arrive ${shown.arrival}`].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <Button onClick={end} variant="secondary" size="primary" className="shrink-0 rounded-full px-5">End trip</Button>
                </div>
                {status && (
                  <p role="status" className={cn("mt-3 flex items-start gap-2 text-[14px] leading-5", status.tone === "warn" ? "text-warn" : status.tone === "busy" ? "text-ink" : "text-ink-muted")}>
                    {status.tone === "busy" && <Loader2 className="mt-0.5 size-4 shrink-0 motion-safe:animate-spin" aria-hidden="true" />}
                    <span>{status.text}</span>
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
