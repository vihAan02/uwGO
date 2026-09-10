"use client";
import { useEffect, useState } from "react";
import type { PacReading, PacSample } from "@/data/pac/crowd";
import type { PacLiveResponse } from "@/app/api/pac/route";
import { minutesOfDay, weekdayOf, formatISODate } from "@/time/toronto";

const SAMPLES_KEY = "uwgo.pac.samples.v1";
const REFRESH_MS = 5 * 60_000;
const MAX_SAMPLES = 2000;

function loadSamples(): PacSample[] {
  try {
    const raw = localStorage.getItem(SAMPLES_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? (list as PacSample[]) : [];
  } catch { return []; }
}

function keepSample(s: PacSample): PacSample[] {
  const list = loadSamples();
  list.push(s);
  const trimmed = list.slice(-MAX_SAMPLES);
  try { localStorage.setItem(SAMPLES_KEY, JSON.stringify(trimmed)); } catch { /* ignore */ }
  return trimmed;
}

export interface PacLiveState {
  reading?: PacReading;
  samples: PacSample[];
  /** The portal's own "results from" clock, for display. */
  resultsFrom?: string;
  error?: string;
}

/**
 * Live PAC occupancy from /api/pac, refreshed while the page is visible. Every reading is
 * also kept as a sample so the app's picture of "usual for Tuesday at 4" improves with use.
 */
export function usePacLive(enabled: boolean): PacLiveState {
  const [state, setState] = useState<PacLiveState>({ samples: [] });

  useEffect(() => {
    if (!enabled) return;
    setState((s) => ({ ...s, samples: loadSamples() }));
    let cancelled = false;
    let lastSampledMinute = -1;
    const fetchOnce = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch("/api/pac");
        const json = (await res.json()) as PacLiveResponse;
        if (cancelled) return;
        if (!json.live) { setState((s) => ({ ...s, error: json.error ?? "PAC data unavailable" })); return; }
        const at = new Date(json.live.fetchedAt);
        const reading: PacReading = { occupancyPct: json.live.pacPct, at };
        // One sample per 10-minute bucket, so a page left open does not flood the history.
        const bucket = Math.floor(minutesOfDay(at) / 10);
        let samples: PacSample[] | undefined;
        if (bucket !== lastSampledMinute) {
          lastSampledMinute = bucket;
          samples = keepSample({ day: weekdayOf(formatISODate(at)), minutes: minutesOfDay(at), pct: json.live.pacPct });
        }
        setState((s) => ({ reading, resultsFrom: json.live?.resultsFrom, samples: samples ?? s.samples, error: undefined }));
      } catch (err) {
        if (!cancelled) setState((s) => ({ ...s, error: err instanceof Error ? err.message : String(err) }));
      }
    };
    void fetchOnce();
    const id = setInterval(fetchOnce, REFRESH_MS);
    const onVisible = () => { if (document.visibilityState === "visible") void fetchOnce(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { cancelled = true; clearInterval(id); document.removeEventListener("visibilitychange", onVisible); };
  }, [enabled]);

  return state;
}
