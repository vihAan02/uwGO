"use client";
import { useEffect, useMemo, useState } from "react";
import type { DayPlan, WeekPlan } from "@/domain/types";
import { findNextUp, type NextUp } from "./nextClass";

/**
 * The time, advanced on each minute boundary and whenever the tab comes back. What is "next" depends
 * on the clock as much as on the plan: without this the planner would keep showing a class that has
 * ended, or "Leave now" long after the student should have left.
 */
export function useMinuteClock(): Date {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let id: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      setNow(Date.now());
      id = setTimeout(tick, 60_000 - (Date.now() % 60_000) + 50);
    };
    id = setTimeout(tick, 60_000 - (Date.now() % 60_000) + 50);
    const onVisible = () => { if (document.visibilityState === "visible") setNow(Date.now()); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearTimeout(id); document.removeEventListener("visibilitychange", onVisible); };
  }, []);
  return useMemo(() => new Date(now), [now]);
}

/** The class that matters now, kept current as the minutes pass. */
export function useNextUp(plan: WeekPlan | undefined, previewDay: DayPlan | undefined, now: Date): NextUp {
  return useMemo(() => findNextUp(plan, now, previewDay), [plan, previewDay, now]);
}
