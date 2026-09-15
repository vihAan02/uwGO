"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ClassTransition, DayPlan, WeekPlan } from "@/domain/types";
import { DAYS_IN_ORDER } from "@/domain/types";
import { dueReminders, loadReminders, reminderFor, remindableLegs, saveReminders, syncReminders, type Reminder } from "./reminders";
import type { RouteChoice } from "./routeChoices";

export type NotifyPermission = "unsupported" | "default" | "granted" | "denied";

interface RemindersApi {
  permission: NotifyPermission;
  /** Reminder set for this leg, made the plan's way or the way the student chose, if any. */
  get(day: DayPlan, t: ClassTransition, choice?: RouteChoice): Reminder | undefined;
  /** Set or clear a reminder for a leg or one way to make it. Asks for notification permission the first time. */
  toggle(day: DayPlan, t: ClassTransition, choice?: RouteChoice): Promise<void>;
  /** The latest in-page reminder, for browsers where a system notification cannot be shown. */
  banner?: Reminder;
  dismissBanner(): void;
}

const Ctx = createContext<RemindersApi | undefined>(undefined);

function currentPermission(): NotifyPermission {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission as NotifyPermission;
}

/**
 * Show a notification. Through the service worker when there is one (that is what works
 * while the tab is in the background or the app is installed), otherwise straight from the
 * page. Returns false when nothing could be shown, so the caller can fall back to the page.
 */
async function showNotification(r: Reminder): Promise<boolean> {
  if (currentPermission() !== "granted") return false;
  const opts: NotificationOptions = { body: r.body, tag: r.id, icon: "/icon.svg", badge: "/icon.svg", requireInteraction: true };
  try {
    const reg = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
    if (reg?.showNotification) { await reg.showNotification(r.title, opts); return true; }
  } catch { /* fall through to a page notification */ }
  try {
    const n = new Notification(r.title, opts);
    n.onclick = () => { window.focus(); n.close(); };
    return true;
  } catch {
    return false;
  }
}

const TICK_MS = 15_000;

export function RemindersProvider({ plan, bufferMinutes, children }: {
  plan: WeekPlan | undefined;
  /** The arrival buffer the plan's other ways to go are timed with, so their reminders follow the plan too. */
  bufferMinutes?: number;
  children: React.ReactNode;
}) {
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [permission, setPermission] = useState<NotifyPermission>("default");
  const [banner, setBanner] = useState<Reminder | undefined>();
  const loaded = useRef(false);

  useEffect(() => {
    // Read localStorage after mount, in a callback, the way the store does.
    const id = setTimeout(() => { setReminders(loadReminders()); setPermission(currentPermission()); loaded.current = true; }, 0);
    return () => clearTimeout(id);
  }, []);

  useEffect(() => {
    if (loaded.current) saveReminders(reminders);
  }, [reminders]);

  // Follow the plan: a refreshed bus or a changed buffer moves the departure, and the reminder with it.
  useEffect(() => {
    if (!plan) return;
    const id = setTimeout(() => {
      const current = remindableLegs(DAYS_IN_ORDER.map((d) => plan.days[d]), bufferMinutes);
      setReminders((list) => {
        const { reminders: next, changed } = syncReminders(list, current, new Date());
        return changed ? next : list;
      });
    }, 0);
    return () => clearTimeout(id);
  }, [plan, bufferMinutes]);

  // The scheduler. A timer while the page is open, plus a check whenever the tab comes back.
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      const now = new Date();
      const { due, expired } = dueReminders(loadReminders(), now);
      if (!due.length && !expired.length) return;
      const firedIds = new Set<string>(expired.map((r) => r.id));
      for (const r of due) {
        const shown = await showNotification(r);
        if (!shown && !cancelled) setBanner(r);
        firedIds.add(r.id);
        try { navigator.vibrate?.([200, 100, 200]); } catch { /* not supported */ }
      }
      if (cancelled) return;
      setReminders((list) => list.map((r) => (firedIds.has(r.id) ? { ...r, firedAt: now.toISOString() } : r)));
    };
    void check();
    const id = setInterval(check, TICK_MS);
    const onVisible = () => { if (document.visibilityState === "visible") void check(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { cancelled = true; clearInterval(id); document.removeEventListener("visibilitychange", onVisible); };
  }, []);

  const get = useCallback((day: DayPlan, t: ClassTransition, choice?: RouteChoice) => {
    const r = reminderFor(day, t, choice);
    return r ? reminders.find((x) => x.id === r.id) : undefined;
  }, [reminders]);

  const toggle = useCallback(async (day: DayPlan, t: ClassTransition, choice?: RouteChoice) => {
    const r = reminderFor(day, t, choice);
    if (!r) return;
    const existing = reminders.find((x) => x.id === r.id);
    if (existing) { setReminders((list) => list.filter((x) => x.id !== r.id)); return; }
    // Permission is asked for here, on the first "Remind me", never on page load.
    let perm = currentPermission();
    if (perm === "default") {
      try { perm = (await Notification.requestPermission()) as NotifyPermission; } catch { perm = "denied"; }
      setPermission(perm);
    }
    setReminders((list) => [...list.filter((x) => x.id !== r.id), r]);
  }, [reminders]);

  const api = useMemo<RemindersApi>(() => ({ permission, get, toggle, banner, dismissBanner: () => setBanner(undefined) }), [permission, get, toggle, banner]);
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useReminders(): RemindersApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("useReminders must be used inside RemindersProvider");
  return v;
}
