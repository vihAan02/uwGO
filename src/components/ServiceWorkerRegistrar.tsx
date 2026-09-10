"use client";
import { useEffect } from "react";

/**
 * Registers the minimal service worker: it makes the app installable (Add to Home Screen)
 * and lets leave-time reminders show as system notifications while the tab is in the
 * background. Registered in development too so reminders can be tried locally.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => { /* not critical */ });
  }, []);
  return null;
}
