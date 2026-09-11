"use client";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { compassHeading, smoothHeading, type HeadingStatus, type OrientationReading } from "./deviceHeading";

/** The latest smoothed compass heading and when it arrived. Read from animation loops, never from render. */
export interface HeadingSample {
  value?: number;
  at: number;
}

/** A heading older than this is not trusted: the sensor has gone quiet. */
export const HEADING_STALE_MS = 3000;

/** The usable heading right now, or undefined when there is none or it has gone stale. */
export function currentHeading(s: HeadingSample, now = Date.now()): number | undefined {
  return s.value !== undefined && now - s.at <= HEADING_STALE_MS ? s.value : undefined;
}

type RequestPermission = () => Promise<"granted" | "denied">;

function requestFn(): RequestPermission | undefined {
  if (typeof window === "undefined" || !("DeviceOrientationEvent" in window)) return undefined;
  const fn = (DeviceOrientationEvent as unknown as { requestPermission?: RequestPermission }).requestPermission;
  return typeof fn === "function" ? fn : undefined;
}

/**
 * Listens to the phone's orientation sensor and keeps the smoothed compass heading in a
 * ref, so the tens of readings a second never re-render anything. The status changes a
 * handful of times in a trip at most. On iOS the sensor needs permission and the browser
 * only grants it from a tap, so `request` must be called from a click handler.
 */
export function useDeviceHeading(): { status: HeadingStatus; request: () => void; sample: RefObject<HeadingSample> } {
  const supported = typeof window !== "undefined" && "DeviceOrientationEvent" in window;
  const needsPermission = supported && requestFn() !== undefined;
  const [status, setStatus] = useState<HeadingStatus>(!supported ? "unsupported" : needsPermission ? "needs-permission" : "waiting");
  const [granted, setGranted] = useState(supported && !needsPermission);
  const sample = useRef<HeadingSample>({ at: 0 });
  const seen = useRef(false);

  useEffect(() => {
    if (!granted) return;
    const eventName = "ondeviceorientationabsolute" in window ? "deviceorientationabsolute" : "deviceorientation";
    const onEvent = (e: Event) => {
      const angle = typeof screen !== "undefined" && screen.orientation ? screen.orientation.angle : 0;
      const h = compassHeading(e as unknown as OrientationReading, angle);
      if (h === undefined) {
        sample.current = { value: undefined, at: Date.now() };
        return;
      }
      sample.current = { value: smoothHeading(sample.current.value, h), at: Date.now() };
      if (!seen.current) { seen.current = true; setStatus("on"); }
    };
    window.addEventListener(eventName, onEvent);
    return () => window.removeEventListener(eventName, onEvent);
  }, [granted]);

  const request = useCallback(() => {
    const fn = requestFn();
    if (!fn) return;
    fn().then((r) => { if (r === "granted") setGranted(true); else setStatus("unavailable"); }).catch(() => setStatus("unavailable"));
  }, []);

  return { status, request, sample };
}
