"use client";
import { useEffect, useMemo, useState } from "react";
import type { CourseMeeting, GymPreferences, RoutePreference, UserHome, WeekPlan } from "@/domain/types";
import type { GapChoices } from "@/domain/gapChoices";
import type { PlannerConfig } from "@/domain/config";
import type { PacReading, PacSample } from "@/data/pac/crowd";
import { buildWeekPlan } from "@/engine/planner";
import { CachedRoutingProvider } from "@/routing/CachedRoutingProvider";
import { HttpRoutingProvider } from "@/routing/HttpRoutingProvider";
import type { RoutingProvider } from "@/routing/RoutingProvider";
import { LocalStorageRouteCacheStore } from "./routeCacheStore";
import { mondayOfWeek, todayISO } from "@/time/toronto";

let clientProvider: RoutingProvider | undefined;
function getClientProvider(): RoutingProvider {
  if (!clientProvider) clientProvider = new CachedRoutingProvider(new HttpRoutingProvider(), new LocalStorageRouteCacheStore());
  return clientProvider;
}

/** The week to show by default: this week if the schedule covers it, otherwise the first week of the term. */
export function defaultWeekStart(meetings: CourseMeeting[], now = new Date()): string {
  const thisMonday = mondayOfWeek(todayISO(now));
  const starts = meetings.map((m) => m.startDate).filter((d): d is string => Boolean(d)).sort();
  const ends = meetings.map((m) => m.endDate).filter((d): d is string => Boolean(d)).sort();
  if (!starts.length || !ends.length) return thisMonday;
  const first = starts[0];
  const last = ends[ends.length - 1];
  const today = todayISO(now);
  if (today >= first && today <= last) return thisMonday;
  return mondayOfWeek(first);
}

export interface PlanExtras {
  gym?: GymPreferences;
  gapChoices?: GapChoices;
  routePreference?: RoutePreference;
  pacLive?: PacReading;
  pacSamples?: readonly PacSample[];
}

export function usePlan(meetings: CourseMeeting[] | undefined, home: UserHome | undefined, config: PlannerConfig, mondayISO: string, extras: PlanExtras = {}) {
  const [result, setResult] = useState<{ key: string; plan?: WeekPlan; error?: string } | undefined>();
  // Live PAC readings drift by the minute; the plan only needs rebuilding when the picture
  // of "how busy" actually moves (a 10-point step), and only if the gym is in play at all.
  const liveKey = extras.gym?.enabled && extras.pacLive ? `${Math.round(extras.pacLive.occupancyPct / 10)}@${Math.floor(extras.pacLive.at.getTime() / 900_000)}` : "";
  // Sorted, so a store update that rebuilds the same answers into a new object does not read
  // as a change and trigger a pointless rebuild of the whole week.
  const gapChoiceKey = useMemo(() => {
    const gc = extras.gapChoices;
    if (!gc) return "";
    const flat = [...Object.entries(gc.byDate ?? {}), ...Object.entries(gc.byClass ?? {})];
    return flat.map(([k, v]) => `${k}=${v.kind}${v.gymThen ?? ""}`).sort().join(",");
  }, [extras.gapChoices]);

  const key = useMemo(
    () => JSON.stringify({ m: meetings?.map((x) => [x.id, x.includeInPlan]), h: home, c: config, w: mondayISO, g: extras.gym, r: extras.routePreference ?? "FASTEST", l: liveKey, gc: gapChoiceKey }),
    [meetings, home, config, mondayISO, extras.gym, extras.routePreference, liveKey, gapChoiceKey],
  );

  useEffect(() => {
    if (!meetings) return;
    let cancelled = false;
    buildWeekPlan({ meetings, home, mondayISO, config, gym: extras.gym, routePreference: extras.routePreference, gapChoices: extras.gapChoices, pacLive: extras.pacLive, pacSamples: extras.pacSamples }, getClientProvider())
      .then((plan) => { if (!cancelled) setResult({ key, plan }); })
      .catch((e: unknown) => { if (!cancelled) setResult({ key, error: e instanceof Error ? e.message : String(e) }); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const loading = Boolean(meetings) && result?.key !== key;
  // Keep showing the previous plan while a new one is computed.
  return { plan: result?.plan, loading, error: result?.key === key ? result?.error : undefined };
}
