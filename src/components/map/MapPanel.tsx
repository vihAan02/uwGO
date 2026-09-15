"use client";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { APIProvider, AdvancedMarker, Map, Pin, useMap } from "@vis.gl/react-google-maps";
import { animate } from "animejs";
import type { RouteOption } from "@/domain/types";
import type { MapSelection } from "@/lib/mapSelection";
import { NO_INSET, allInside, centreFor, framePadding, framePoints, insetResponse, lineKey, placeKey, pointOf, routePath, uncovered, type MapInset, type Point } from "@/lib/mapFraming";
import { DURATION, EASE_OUT, prefersReducedMotion } from "@/lib/motion";
import { cn } from "@/lib/utils";

export type { MapSelection } from "@/lib/mapSelection";
export type { MapInset } from "@/lib/mapFraming";

const KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY;
const MAP_ID = process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID || "DEMO_MAP_ID";

/** DESIGN.md §7: the route is brand blue whatever the mode; the rest of the map stays neutral. */
const ROUTE = "#1d4ed8";
const INK = "#0f172a";
const MUTED = "#64748b";
/** Waterloo's campus, for a day with nowhere to be. */
const CAMPUS: Point = { lat: 43.4723, lng: -80.5449 };
const PLACE_ZOOM = 17;

export interface YouAreHere { lat: number; lng: number; accuracy: number }

/** A marker's look, decided once per selection rather than on every render. */
function markersFor(selection: MapSelection) {
  switch (selection.kind) {
    case "LEG": return [
      { at: selection.from, label: selection.from.kind === "HOME" ? "H" : "", color: INK },
      { at: selection.to, label: selection.to.kind === "HOME" ? "H" : "", color: ROUTE },
    ];
    case "PLACE": return [{ at: selection.at, label: "", color: ROUTE }];
    case "DAY": {
      // Classes are numbered 1..n in the order they happen; home is always "H", not a number.
      let n = 0;
      return selection.stops.map((s) => {
        const isHome = s.at.kind === "HOME";
        return { at: s.at, label: isHome ? "H" : String(++n), color: isHome ? INK : ROUTE };
      });
    }
  }
}

function Stops({ selection }: { selection: MapSelection }) {
  const markers = useMemo(() => markersFor(selection).map((m) => ({ ...m, position: pointOf(m.at) })), [selection]);
  return markers.map((m, i) => (
    <AdvancedMarker key={`${m.at.id}-${i}`} position={m.position} title={m.at.name}>
      <Pin background={m.color} borderColor="#ffffff" glyphColor="#ffffff" glyph={m.label || undefined} />
    </AdvancedMarker>
  ));
}

function You({ you }: { you: YouAreHere }) {
  const position = useMemo(() => ({ lat: you.lat, lng: you.lng }), [you.lat, you.lng]);
  return (
    <AdvancedMarker position={position} title="Your location" zIndex={1000}>
      <span className="relative block size-5">
        <span aria-hidden className="absolute inset-0 rounded-full bg-brand/20" style={{ transform: "scale(2.2)" }} />
        <span aria-hidden className="absolute inset-0 rounded-full border-[3px] border-white bg-brand shadow-float" />
      </span>
    </AdvancedMarker>
  );
}

/**
 * Draws the selected line (and the other ways between the same places, faint beneath it) and frames
 * the selection into the part of the map the student can see. The camera moves for a selection about
 * different places, for an explicit recenter, when the layers settle somewhere new, and when a new line
 * is out of view; never for a rebuilt plan with the same stops, and never over a student's own pan.
 */
function Overlay({ selection, alternatives, inset, recenter, you, locate, onCameraTaken }: {
  selection: MapSelection;
  alternatives: readonly RouteOption[];
  inset: MapInset;
  recenter: number;
  you?: YouAreHere;
  locate: number;
  onCameraTaken?: (taken: boolean) => void;
}) {
  const map = useMap();
  const selectionRef = useRef(selection);
  const insetRef = useRef(inset);
  const youRef = useRef(you);
  const takenRef = useRef(onCameraTaken);
  const userMoved = useRef(false);
  const lastInset = useRef(inset);
  useEffect(() => { selectionRef.current = selection; insetRef.current = inset; youRef.current = you; takenRef.current = onCameraTaken; });
  const setTaken = (taken: boolean) => {
    if (userMoved.current !== taken) takenRef.current?.(taken);
    userMoved.current = taken;
  };

  const places = placeKey(selection);
  const drawn = lineKey(selection);
  const insetKey = `${inset.top},${inset.right},${inset.bottom},${inset.left}`;
  const altKey = alternatives.map((r) => r.polyline ?? "").join("|");

  // The selected line, on a white casing so it reads over any tiles. A new line fades in, which is the
  // visible confirmation that a route choice landed; an estimate is a dashed straight line.
  useEffect(() => {
    if (!map) return;
    const s = selectionRef.current;
    if (s.kind !== "LEG") return;
    const path = routePath(s.route, s.from, s.to);
    if (path.length < 2) return;
    const estimate = !s.route?.polyline;
    const reduce = prefersReducedMotion();
    const fade = { o: reduce || estimate ? 1 : 0 };
    const casing = new google.maps.Polyline({ path, map, strokeColor: "#ffffff", strokeOpacity: estimate ? 0 : 0.9 * fade.o, strokeWeight: 10, zIndex: 2, clickable: false });
    const line = new google.maps.Polyline({
      path, map, zIndex: 3, clickable: false,
      strokeColor: ROUTE, strokeOpacity: estimate ? 0 : fade.o, strokeWeight: 6,
      icons: estimate ? [{ icon: { path: "M 0,-1 0,1", strokeOpacity: 0.9, strokeColor: ROUTE, scale: 3 }, offset: "0", repeat: "14px" }] : undefined,
    });
    const anim = fade.o < 1
      ? animate(fade, { o: 1, duration: DURATION.base, ease: EASE_OUT, onUpdate: () => { line.setOptions({ strokeOpacity: fade.o }); casing.setOptions({ strokeOpacity: 0.9 * fade.o }); } })
      : undefined;
    return () => { anim?.cancel(); line.setMap(null); casing.setMap(null); };
  }, [map, drawn]);

  // The ways not taken, so "Indoors" or "Walk" means something on the map before it is tapped.
  useEffect(() => {
    if (!map) return;
    const s = selectionRef.current;
    if (s.kind !== "LEG") return;
    const lines = alternatives.filter((r) => r.polyline).map((r) => new google.maps.Polyline({
      path: routePath(r, s.from, s.to), map, zIndex: 1, clickable: false, strokeColor: MUTED, strokeOpacity: 0.45, strokeWeight: 5,
    }));
    return () => { for (const l of lines) l.setMap(null); };
    // The alternatives are keyed by their lines; the array itself is rebuilt with the plan.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, altKey, places]);

  // A pan, pinch, wheel or double-tap is the student taking the camera; stop re-framing under them.
  useEffect(() => {
    if (!map) return;
    const div = map.getDiv();
    const took = () => setTaken(true);
    const onTouch = (e: TouchEvent) => { if (e.touches.length >= 2) took(); };
    const listeners = [map.addListener("dragstart", took), map.addListener("dblclick", took)];
    div.addEventListener("touchstart", onTouch, { passive: true });
    div.addEventListener("wheel", took, { passive: true });
    return () => {
      for (const l of listeners) l.remove();
      div.removeEventListener("touchstart", onTouch);
      div.removeEventListener("wheel", took);
    };
  }, [map]);

  // Framing. "always" for a new place, a recenter or a settled sheet; "if-hidden" for a new line between
  // the same places or a resize, which move the camera only when the selection is out of view.
  useEffect(() => {
    if (!map) return;
    const frame = (mode: "always" | "if-hidden") => {
      const div = map.getDiv();
      const width = div.clientWidth;
      const height = div.clientHeight;
      if (!width || !height) return;
      const s = selectionRef.current;
      const i = insetRef.current;
      const points = framePoints(s);
      if (mode === "if-hidden") {
        if (userMoved.current) return;
        const b = map.getBounds()?.toJSON();
        if (b && allInside(uncovered(b, i, width, height), points)) return;
      }
      setTaken(false);
      if (points.length === 0) {
        map.moveCamera({ center: centreFor(CAMPUS, i, 15), zoom: 15 });
      } else if (points.length === 1) {
        map.moveCamera({ center: centreFor(points[0], i, PLACE_ZOOM), zoom: PLACE_ZOOM });
      } else {
        const bounds = new google.maps.LatLngBounds();
        for (const p of points) bounds.extend(p);
        map.fitBounds(bounds, framePadding(i, width, height));
      }
    };
    const api = { frame };
    frameApi.set(map, api);
    return () => { frameApi.delete(map); };
  }, [map]);

  useEffect(() => { if (map) frameApi.get(map)?.frame("always"); }, [map, places, recenter]);
  useEffect(() => { if (map) frameApi.get(map)?.frame("if-hidden"); }, [map, drawn]);

  // The sheet or header settled somewhere else (DESIGN.md §2): the selection is framed again into what is
  // now visible. Over a map the student has moved, what they were looking at stays in the middle of the
  // visible area instead, at their zoom.
  useEffect(() => {
    const prev = lastInset.current;
    const now = insetRef.current;
    lastInset.current = now;
    if (!map) return;
    const response = insetResponse(prev, now, userMoved.current);
    if (response.kind === "frame") frameApi.get(map)?.frame("always");
    else if (response.kind === "pan") map.panBy(response.dx, response.dy);
  }, [map, insetKey]);

  // Rotation, a keyboard, a breakpoint: the container changed size under the selection.
  useEffect(() => {
    if (!map) return;
    let debounce: ReturnType<typeof setTimeout> | undefined;
    const ro = new ResizeObserver(() => { clearTimeout(debounce); debounce = setTimeout(() => frameApi.get(map)?.frame("if-hidden"), 180); });
    ro.observe(map.getDiv());
    return () => { clearTimeout(debounce); ro.disconnect(); };
  }, [map]);

  // "Where am I": bring the student's position into the visible middle, and treat that as their own move.
  useEffect(() => {
    const at = youRef.current;
    if (!map || !locate || !at) return;
    const zoom = Math.max(map.getZoom() ?? PLACE_ZOOM, 16);
    map.moveCamera({ center: centreFor({ lat: at.lat, lng: at.lng }, insetRef.current, zoom), zoom });
    setTaken(true);
  }, [map, locate]);

  return null;
}

/** The planner's framing functions, per map, so the effects above share one implementation. */
const frameApi = new WeakMap<google.maps.Map, { frame: (mode: "always" | "if-hidden") => void }>();

export interface MapPanelProps {
  selection: MapSelection;
  /** Other ways between the same places, drawn faint under the selected one. */
  alternatives?: readonly RouteOption[];
  /** Settled pixels of map under the header and sheet. */
  inset?: MapInset;
  /** Bump to frame the selection again (the recenter control). */
  recenter?: number;
  you?: YouAreHere;
  /** Bump to bring `you` into view. */
  locate?: number;
  /** Google's +/- buttons: only where there is no pinch and no sheet over the corner. */
  zoomControl?: boolean;
  /** Told when the student takes the camera (pan, pinch, locate) and when framing takes it back. */
  onCameraTaken?: (taken: boolean) => void;
  className?: string;
}

const NO_ALTERNATIVES: readonly RouteOption[] = [];

/**
 * The single interactive planner map, mounted once for the life of the page (DESIGN.md §2). Memoised:
 * the header hiding, the sheet moving or a store save re-render the planner, not the map.
 */
export const MapPanel = memo(function MapPanel({ selection, alternatives = NO_ALTERNATIVES, inset = NO_INSET, recenter = 0, you, locate = 0, zoomControl = false, onCameraTaken, className }: MapPanelProps) {
  const [initialCenter] = useState<Point>(() => framePoints(selection)[0] ?? CAMPUS);
  if (!KEY) {
    return (
      <div className={cn("flex h-full w-full items-center justify-center bg-map-ground p-6 text-center text-sm text-ink-muted", className)}>
        {process.env.NODE_ENV === "production"
          ? "The map isn't available right now."
          : <span className="max-w-full break-words">Map hidden: add <code className="break-all font-mono text-xs">NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY</code> to <code className="font-mono text-xs">.env.local</code>.</span>}
      </div>
    );
  }
  return (
    <div className={cn("h-full w-full bg-map-ground", className)}>
      <APIProvider apiKey={KEY}>
        <Map
          defaultCenter={initialCenter}
          defaultZoom={15}
          mapId={MAP_ID}
          gestureHandling="greedy"
          disableDefaultUI
          zoomControl={zoomControl}
          clickableIcons={false}
          reuseMaps
          style={{ width: "100%", height: "100%" }}
        >
          <Stops selection={selection} />
          {you && <You you={you} />}
          <Overlay selection={selection} alternatives={alternatives} inset={inset} recenter={recenter} you={you} locate={locate} onCameraTaken={onCameraTaken} />
        </Map>
      </APIProvider>
    </div>
  );
});
