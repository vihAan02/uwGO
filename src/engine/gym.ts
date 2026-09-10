/**
 * Every realistic workout in a day, ranked for this student's day. Pure: routes come in
 * through `resolve`, crowding through `crowdAt`, so the planner decides what those are.
 *
 * A window is never "the gap is 60 minutes, so a 60-minute workout fits". It is:
 *   leave previous place -> travel to PAC -> workout -> travel to next place -> arrival buffer.
 */
import type { CampusLocation, CrowdEstimate, GymPreferences, GymSlot, GymWindow, RouteOption, ScheduledClass } from "@/domain/types";
import type { PlannerConfig } from "@/domain/config";
import { addMin, minutesBetween, minutesOfDay, torontoDate } from "@/time/toronto";
import { pacHoursOn } from "@/data/pac/hours";
import type { ResolvedLeg } from "./homeReturn";

export interface GymInput {
  classes: ScheduledClass[];
  home: CampusLocation | undefined;
  pac: CampusLocation;
  dateISO: string;
  prefs: GymPreferences;
  cfg: PlannerConfig;
  /** Best route between two places, leaving after `departAfter`, arriving by `arriveBy` when given. */
  resolve: (from: CampusLocation, to: CampusLocation, departAfter: Date, arriveBy?: Date) => Promise<ResolvedLeg | undefined>;
  crowdAt: (at: Date) => CrowdEstimate;
}

/** Scoring weights, in one place. Fit is a gate, not a weight: a window that does not fit is never listed. */
export const GYM_SCORING = {
  preferredTimeMatch: 25,
  crowd: { QUIET: 30, BEARABLE: 18, BUSY: 6, VERY_BUSY: 0 } as Record<CrowdEstimate["level"], number>,
  /** Multiplier on the crowd score when the student asked for the least busy time: then a quiet hour outweighs a 25-minute trip. */
  leastBusyBoost: 3,
  /** Per minute of travel to and from PAC. */
  travelPerMinute: -0.8,
  /** Being on campus already is worth a lot more than a separate trip from home. */
  slot: { BETWEEN: 15, AFTER_LAST: 8, BEFORE_FIRST: 0 } as Record<GymSlot, number>,
  /** A little spare time is nice; a lot is not worth more. */
  slackPerMinute: 0.25,
  slackCap: 10,
} as const;

function periodOf(at: Date): "MORNING" | "AFTERNOON" | "EVENING" {
  const m = minutesOfDay(at);
  return m < 12 * 60 ? "MORNING" : m < 17 * 60 ? "AFTERNOON" : "EVENING";
}

function label(loc: CampusLocation, cls?: ScheduledClass): string {
  if (loc.kind === "HOME") return "home";
  return cls ? `${cls.meeting.courseCode} (${loc.buildingCode ?? loc.name})` : loc.buildingCode ?? loc.name;
}

function score(w: Omit<GymWindow, "score" | "reasons">, prefs: GymPreferences, slack: number): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let s = 0;
  const mid = new Date((w.start.getTime() + w.end.getTime()) / 2);
  const period = periodOf(mid);
  if (prefs.preferredTime === period) { s += GYM_SCORING.preferredTimeMatch; reasons.push(`${period.toLowerCase()}, like you prefer`); }
  const crowdScore = GYM_SCORING.crowd[w.crowd.level] * (prefs.preferredTime === "LEAST_BUSY" ? GYM_SCORING.leastBusyBoost : 1);
  s += crowdScore;
  const travel = w.routeIn.durationMinutes + w.routeOut.durationMinutes;
  s += travel * GYM_SCORING.travelPerMinute;
  s += GYM_SCORING.slot[w.slot];
  if (w.slot === "BETWEEN") reasons.push("between classes, already on campus");
  if (w.slot === "AFTER_LAST") reasons.push("after your last class");
  if (w.slot === "BEFORE_FIRST") reasons.push("separate trip before your first class");
  s += Math.min(GYM_SCORING.slackCap, slack * GYM_SCORING.slackPerMinute);
  return { score: Math.round(s * 10) / 10, reasons };
}

export async function findGymWindows(input: GymInput): Promise<GymWindow[]> {
  const { classes, home, pac, dateISO, prefs, resolve, crowdAt } = input;
  if (!prefs.enabled || classes.length === 0) return [];
  const hours = pacHoursOn(dateISO);
  if (!hours) return [];
  const open = torontoDate(dateISO, hours.open);
  const close = torontoDate(dateISO, hours.close);
  const duration = prefs.durationMinutes;
  const out: GymWindow[] = [];

  const push = (slot: GymSlot, classIndex: number, from: CampusLocation, fromCls: ScheduledClass | undefined, to: CampusLocation, toCls: ScheduledClass | undefined, inLeg: ResolvedLeg, outLeg: ResolvedLeg) => {
    // The workout can start when the student is at PAC and PAC is open, and must end before
    // the trip out has to start and before PAC closes.
    const arrive = inLeg.arrival.getTime() < open.getTime() ? open : inLeg.arrival;
    const mustLeave = outLeg.departure.getTime() < close.getTime() ? outLeg.departure : close;
    const usable = minutesBetween(arrive, mustLeave);
    if (usable < duration) return;
    const start = arrive;
    const end = addMin(start, duration);
    const base: Omit<GymWindow, "score" | "reasons"> = {
      id: `gym-${dateISO}-${slot}-${classIndex}`,
      slot,
      classIndex,
      start,
      end,
      workoutMinutes: duration,
      usableMinutes: usable,
      from, to,
      fromLabel: label(from, fromCls),
      toLabel: label(to, toCls),
      routeIn: inLeg.route,
      routeOut: outLeg.route,
      leaveAt: inLeg.departure,
      arrivePacAt: inLeg.arrival,
      leavePacBy: mustLeave,
      crowd: crowdAt(new Date((start.getTime() + end.getTime()) / 2)),
    };
    const { score: s, reasons } = score(base, prefs, usable - duration);
    out.push({ ...base, score: s, reasons });
  };

  // Between consecutive classes.
  for (let i = 0; i < classes.length - 1; i++) {
    const a = classes[i];
    const b = classes[i + 1];
    if (minutesBetween(a.end, b.start) < duration) continue;
    const inLeg = await resolve(a.location, pac, a.end);
    if (!inLeg) continue;
    const outLeg = await resolve(pac, b.location, inLeg.arrival, b.start);
    if (!outLeg) continue;
    push("BETWEEN", i, a.location, a, b.location, b, inLeg, outLeg);
  }

  // After the last class, then home (or just PAC, if no home is set).
  {
    const last = classes[classes.length - 1];
    const inLeg = await resolve(last.location, pac, last.end);
    if (inLeg) {
      const workoutEnd = addMin(inLeg.arrival.getTime() < open.getTime() ? open : inLeg.arrival, duration);
      const outLeg = home ? await resolve(pac, home, workoutEnd) : { route: { mode: "WALK", durationMinutes: 0, provider: "none", computedAt: "", isEstimate: false } as RouteOption, departure: close, arrival: close };
      if (outLeg) push("AFTER_LAST", classes.length - 1, last.location, last, home ?? pac, undefined, inLeg, outLeg);
    }
  }

  // Before the first class, from home: the workout ends when the trip to class has to start.
  if (home) {
    const first = classes[0];
    const outLeg = await resolve(pac, first.location, open, first.start);
    if (outLeg) {
      const workoutStart = addMin(outLeg.departure, -duration);
      if (workoutStart.getTime() >= open.getTime()) {
        const inLeg = await resolve(home, pac, torontoDate(dateISO, 0), workoutStart);
        if (inLeg) {
          // The in-leg was asked for by arrival; the workout starts when it lands.
          push("BEFORE_FIRST", 0, home, undefined, first.location, first, inLeg, outLeg);
        }
      }
    }
  }

  return out.sort((x, y) => y.score - x.score || x.start.getTime() - y.start.getTime());
}

/** The window that goes with a given gap (the one that follows class `i`), if any. */
export function gymForGap(windows: GymWindow[], classIndex: number): GymWindow | undefined {
  return windows.find((w) => w.slot === "BETWEEN" && w.classIndex === classIndex);
}

