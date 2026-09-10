import type { CrowdEstimate, CrowdLevel, DayOfWeek } from "@/domain/types";
import { minutesBetween, minutesOfDay, weekdayOf, formatISODate } from "@/time/toronto";

/**
 * Everything that turns a PAC occupancy percentage into words and an equipment wait.
 * One file on purpose: these are product numbers to be tuned, not facts.
 *
 * Calibration (from the live portal, https://warrior.uwaterloo.ca/FacilityOccupancy, on
 * Wed 2026-09-09 at 10:02 PM): free weights 42/75 (56%), weight machines 30/40 (75%),
 * cardio 18/50 (36%), functional 9/25 (36%). Capacity-weighted that is 52%, a late-evening
 * reading that still felt "busy" on the machine floor. So 75% is squarely "very busy" and
 * the mid-30s reads as bearable.
 */
export const CROWD_THRESHOLDS: { level: CrowdLevel; minPct: number }[] = [
  { level: "VERY_BUSY", minPct: 70 },
  { level: "BUSY", minPct: 50 },
  { level: "BEARABLE", minPct: 30 },
  { level: "QUIET", minPct: 0 },
];

/** Estimated wait for a machine or rack, in minutes, by crowd level. A transparent heuristic, not a measurement. */
export const MACHINE_WAIT_BY_LEVEL: Record<CrowdLevel, { min: number; max: number }> = {
  QUIET: { min: 0, max: 2 },
  BEARABLE: { min: 2, max: 5 },
  BUSY: { min: 5, max: 10 },
  VERY_BUSY: { min: 8, max: 15 },
};

export const CROWD_LABELS: Record<CrowdLevel, string> = { QUIET: "Quiet", BEARABLE: "Bearable", BUSY: "Busy", VERY_BUSY: "Very busy" };

export function crowdLevelFor(pct: number): CrowdLevel {
  for (const t of CROWD_THRESHOLDS) if (pct >= t.minPct) return t.level;
  return "QUIET";
}

/**
 * Typical fitness-centre occupancy (% of capacity) by weekday and hour, on the hour.
 * The portal publishes live readings only, no history, so this curve is UW GO's own
 * baseline: it follows the shape every campus gym shows (quiet early, a lunch bump, a
 * 4-7 PM peak, tailing off late) and is anchored on the readings we have taken. It is
 * refined as the app collects samples: see `blendWithSamples`. Replace freely.
 */
const WEEKDAY_HOURLY: number[] = [
  /* 0-5  */ 0, 0, 0, 0, 0, 0,
  /* 6-11 */ 10, 15, 22, 28, 32, 38,
  /* 12-17*/ 45, 42, 40, 48, 62, 78,
  /* 18-23*/ 82, 72, 60, 50, 45, 30,
];
const WEEKEND_HOURLY: number[] = [
  /* 0-5  */ 0, 0, 0, 0, 0, 0,
  /* 6-11 */ 0, 0, 0, 12, 22, 34,
  /* 12-17*/ 42, 46, 46, 44, 42, 40,
  /* 18-23*/ 36, 32, 26, 18, 12, 6,
];

export function typicalOccupancy(day: DayOfWeek, minutes: number): number {
  const curve = day === "S" || day === "Su" ? WEEKEND_HOURLY : WEEKDAY_HOURLY;
  const h = Math.floor(minutes / 60) % 24;
  const next = (h + 1) % 24;
  const f = (minutes % 60) / 60;
  return Math.round(curve[h] * (1 - f) + curve[next] * f);
}

/** A reading of the fitness centre as a whole: capacity-weighted across the PAC zones. */
export interface PacReading { occupancyPct: number; at: Date }

/** A sample the app has kept from an earlier live reading. */
export interface PacSample { day: DayOfWeek; minutes: number; pct: number }

/**
 * Typical value for a moment, with the app's own samples mixed in once there are enough
 * of them for that weekday and hour (3+). Samples are kept by the client and are the only
 * "historical" data there is.
 */
export function blendWithSamples(day: DayOfWeek, minutes: number, samples: readonly PacSample[]): number {
  const base = typicalOccupancy(day, minutes);
  const hour = Math.floor(minutes / 60);
  const near = samples.filter((s) => s.day === day && Math.floor(s.minutes / 60) === hour);
  if (near.length < 3) return base;
  const mean = near.reduce((n, s) => n + s.pct, 0) / near.length;
  const w = Math.min(0.8, near.length / 10);
  return Math.round(base * (1 - w) + mean * w);
}

export function estimateFromPct(occupancyPct: number, source: CrowdEstimate["source"]): CrowdEstimate {
  const pct = Math.max(0, Math.min(100, Math.round(occupancyPct)));
  const level = crowdLevelFor(pct);
  const wait = MACHINE_WAIT_BY_LEVEL[level];
  return { level, occupancyPct: pct, estimatedMachineWaitMin: wait.min, estimatedMachineWaitMax: wait.max, source };
}

/** A live reading speaks for this long; after it the pattern takes over, nudged by how far off the reading was. */
export const LIVE_VALID_MINUTES = 45;
export const LIVE_INFLUENCE_MINUTES = 180;

/**
 * Crowd estimate for a moment. Live data is the main signal for the near term; the
 * weekday/time-of-day pattern is the context for everything further off. Deterministic.
 */
export function estimateCrowd(at: Date, live: PacReading | undefined, samples: readonly PacSample[] = []): CrowdEstimate {
  const day = weekdayOf(formatISODate(at));
  const minutes = minutesOfDay(at);
  const typical = blendWithSamples(day, minutes, samples);
  if (!live) return estimateFromPct(typical, "TYPICAL");
  const gap = Math.abs(minutesBetween(live.at, at));
  if (gap <= LIVE_VALID_MINUTES) return estimateFromPct(live.occupancyPct, "LIVE");
  if (gap <= LIVE_INFLUENCE_MINUTES) {
    const liveTypical = blendWithSamples(weekdayOf(formatISODate(live.at)), minutesOfDay(live.at), samples);
    const offset = live.occupancyPct - liveTypical;
    const decay = 1 - (gap - LIVE_VALID_MINUTES) / (LIVE_INFLUENCE_MINUTES - LIVE_VALID_MINUTES);
    return estimateFromPct(typical + offset * decay, "LIVE_ADJUSTED");
  }
  return estimateFromPct(typical, "TYPICAL");
}

export function waitLabel(c: CrowdEstimate): string {
  return `${c.estimatedMachineWaitMin}–${c.estimatedMachineWaitMax} min`;
}
