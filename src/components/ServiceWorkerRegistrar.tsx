"use client";
import { useEffect } from "react";

/** Registers the minimal service worker that makes the app installable (Add to Home Screen). */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => { /* not critical */ });
  }, []);
  return null;
}
