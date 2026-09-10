/**
 * Every way to spend one gap, priced, so the student can choose instead of being told.
 *
 * Pure: routes come in through `resolve`, so the planner decides what routing is. An option is
 * never "the gap is 90 minutes so a 60-minute workout fits" — it is the full chain,
 *   leave class -> travel -> stay (clamped to opening hours) -> travel -> arrival buffer -> next class,
 * and an option that does not fit says so with the numbers rather than being silently dropped.
 */
import type { CampusLocation, GapOption, GapOptionId, GapRecommendation, GapStop, GymPreferences, ScheduledClass } from "@/domain/types";
import type { PlannerConfig } from "@/domain/config";
import { addMin, formatDuration, minutesBetween, torontoDate } from "@/time/toronto";
import { pacHoursOn } from "@/data/pac/hours";
import { studyHoursOn } from "@/data/study/hours";
import type { ResolvedStudySpot } from "@/data/study";
import { analyzeHomeReturn, usableAt, type ResolvedLeg } from "./homeReturn";

export interface GapOptionsInput {
  from: ScheduledClass;
  to: ScheduledClass;
  home?: CampusLocation;
  pac?: CampusLocation;
  studySpots: readonly ResolvedStudySpot[];
  dateISO: string;
  gym?: GymPreferences;
  cfg: PlannerConfig;
  /** Best route between two places, leaving after `departAfter`, arriving by `arriveBy` when given. */
  resolve: (from: CampusLocation, to: CampusLocation, departAfter: Date, arriveBy?: Date) => Promise<ResolvedLeg | undefined>;
}

const travelOf = (...legs: ResolvedLeg[]) => legs.reduce((n, l) => n + minutesBetween(l.departure, l.arrival), 0);
const estimated = (...legs: ResolvedLeg[]) => legs.some((l) => l.route.isEstimate);

/** A window at a place that posts hours, as instants on the day. `undefined` = closed, so not offerable. */
function openWindow(dateISO: string, hours: { open: number; close: number } | undefined) {
  return hours ? { open: torontoDate(dateISO, hours.open), close: torontoDate(dateISO, hours.close) } : undefined;
}

/**
 * The nearest spot by real travel time, among those open for the whole stay. Hours first on
 * purpose: a library two minutes closer that shuts in twenty is the worse answer.
 * Costs one inbound leg per spot; only the winner's outbound leg is then priced.
 */
async function nearestSpot(
  spots: readonly ResolvedStudySpot[],
  from: CampusLocation,
  departAfter: Date,
  dateISO: string,
  resolve: GapOptionsInput["resolve"],
): Promise<{ spot: ResolvedStudySpot; leg: ResolvedLeg; open: Date; close: Date } | undefined> {
  let best: { spot: ResolvedStudySpot; leg: ResolvedLeg; open: Date; close: Date } | undefined;
  for (const spot of spots) {
    const w = openWindow(dateISO, studyHoursOn(spot.spot.id, dateISO));
    if (!w) continue;
    const leg = await resolve(from, spot.at, departAfter);
    if (!leg) continue;
    // No use arriving after they have shut.
    if (leg.arrival.getTime() >= w.close.getTime()) continue;
    const minutes = minutesBetween(leg.departure, leg.arrival);
    // Already in the building: no trip can be shorter than none, so stop looking rather than
    // paying to price the others. A class held in the Davis Centre is the common case.
    if (minutes === 0) return { spot, leg, ...w };
    if (!best || minutes < minutesBetween(best.leg.departure, best.leg.arrival)) best = { spot, leg, ...w };
  }
  return best;
}

export async function priceGapOptions(input: GapOptionsInput): Promise<GapOption[]> {
  const { from, to, home, pac, studySpots, dateISO, gym, cfg, resolve } = input;
  const gapMinutes = minutesBetween(from.end, to.start);
  const latestArrival = addMin(to.start, -cfg.arrivalBufferMinutes);
  const onTime = (leg: ResolvedLeg) => leg.arrival.getTime() <= latestArrival.getTime();
  const out: GapOption[] = [];

  out.push({
    id: "STAY", kind: "STAY", stops: [], fits: true,
    usableMinutes: gapMinutes, travelMinutes: 0,
    label: "Stay", detail: `${formatDuration(gapMinutes)} here`,
    reason: `Stay put: ${formatDuration(gapMinutes)} between classes, no travel.`,
    isEstimate: false, starred: false,
  });

  // --- Go home -------------------------------------------------------------------------------
  if (home) {
    const outLeg = await resolve(from.location, home, from.end);
    const backLeg = outLeg && (await resolve(home, to.location, outLeg.arrival, to.start));
    if (outLeg && backLeg) {
      const analysis = analyzeHomeReturn({ gapStart: from.end, nextClassStart: to.start, routeHome: outLeg, routeBack: backLeg }, cfg);
      const travel = travelOf(outLeg, backLeg);
      out.push({
        id: "REZ", kind: "REZ",
        stops: [{ purpose: "REZ", at: home, label: "home" }],
        fits: analysis.possible,
        usableMinutes: analysis.usableHomeMinutes,
        travelMinutes: travel,
        leaveAt: outLeg.departure, arriveBackAt: backLeg.arrival,
        label: "Rez", detail: `${formatDuration(analysis.usableHomeMinutes)} at home · ${formatDuration(travel)} travel`,
        reason: analysis.possible
          ? `${formatDuration(analysis.usableHomeMinutes)} at home after ${formatDuration(travel)} of travel.`
          : `Going home leaves ${formatDuration(Math.max(0, analysis.usableHomeMinutes))} there once travel and the ${cfg.arrivalBufferMinutes} min buffer are paid.`,
        isEstimate: estimated(outLeg, backLeg),
        starred: false,
        analysis,
      });
    }
  }

  // --- Go to a library -----------------------------------------------------------------------
  const study = await nearestSpot(studySpots, from.location, from.end, dateISO, resolve);
  if (study) {
    const backLeg = await resolve(study.spot.at, to.location, study.leg.arrival, to.start);
    if (backLeg) {
      const stay = usableAt({ arrival: study.leg.arrival, mustLeaveBy: backLeg.departure, open: study.open, close: study.close });
      const travel = travelOf(study.leg, backLeg);
      const fits = stay.minutes > 0 && onTime(backLeg);
      const known = studyHoursOn(study.spot.spot.id, dateISO)?.known;
      out.push({
        id: "STUDY", kind: "STUDY",
        stops: [{ purpose: "STUDY", at: study.spot.at, label: study.spot.spot.shortName }],
        fits,
        usableMinutes: Math.max(0, stay.minutes),
        travelMinutes: travel,
        leaveAt: study.leg.departure, arriveBackAt: backLeg.arrival,
        label: "Library",
        detail: `${study.spot.spot.shortName} · ${formatDuration(Math.max(0, stay.minutes))} to work`,
        reason: fits
          ? `${formatDuration(stay.minutes)} at ${study.spot.spot.name} after ${formatDuration(travel)} of travel.${known ? "" : " Hours are assumed, not posted for this date."}`
          : `${study.spot.spot.name} leaves ${formatDuration(Math.max(0, stay.minutes))} to work once travel and the ${cfg.arrivalBufferMinutes} min buffer are paid.`,
        isEstimate: estimated(study.leg, backLeg),
        starred: false,
      });
    }
  }

  // --- Go to the gym, then somewhere -----------------------------------------------------------
  const workout = gym?.durationMinutes ?? 0;
  const pacWindow = pac && gym?.enabled ? openWindow(dateISO, pacHoursOn(dateISO)) : undefined;
  // Arithmetic impossibility, checked before spending a route call. This reads raw gap length,
  // which the rest of this module refuses to do — but travel time is never negative, so a gap
  // that cannot hold the workout and the buffer alone can hold nothing that includes them. It
  // only ever produces true negatives. Do not extend it into judging real feasibility.
  const gymConceivable = Boolean(pacWindow) && gapMinutes >= workout + cfg.arrivalBufferMinutes;
  const secondStopConceivable = gymConceivable && gapMinutes >= workout + cfg.arrivalBufferMinutes + cfg.minPossibleHomeMinutes;

  if (pac && pacWindow && gymConceivable) {
    const inLeg = await resolve(from.location, pac, from.end);
    if (inLeg) {
      const gymStop = (dwell: number): GapStop => ({ purpose: "GYM", at: pac, label: "PAC", minDwellMinutes: dwell });
      const startsAt = inLeg.arrival.getTime() < pacWindow.open.getTime() ? pacWindow.open : inLeg.arrival;
      const workoutEnd = addMin(startsAt, workout);
      const beforeClose = workoutEnd.getTime() <= pacWindow.close.getTime();

      // Gym, then straight to class.
      const toClassLeg = await resolve(pac, to.location, workoutEnd, to.start);
      if (toClassLeg) {
        const stay = usableAt({ arrival: inLeg.arrival, mustLeaveBy: toClassLeg.departure, open: pacWindow.open, close: pacWindow.close });
        const travel = travelOf(inLeg, toClassLeg);
        const fits = stay.minutes >= workout && beforeClose && onTime(toClassLeg);
        out.push({
          id: "GYM_CLASS", kind: "GYM", gymThen: "CLASS",
          stops: [gymStop(workout)],
          fits,
          usableMinutes: Math.max(0, stay.minutes),
          travelMinutes: travel,
          leaveAt: inLeg.departure, arriveBackAt: toClassLeg.arrival,
          label: "Class", detail: `Straight to ${to.meeting.courseCode} after`,
          reason: fits
            ? `${formatDuration(workout)} workout fits: ${formatDuration(stay.minutes)} usable at PAC after ${formatDuration(travel)} of travel.`
            : `A ${formatDuration(workout)} workout needs more than the ${formatDuration(Math.max(0, stay.minutes))} usable at PAC here.`,
          isEstimate: estimated(inLeg, toClassLeg),
          starred: false,
        });
      }

      // Gym, then a second stop, then class. The stay is measured from the END of the workout —
      // not from arriving at PAC, which is the mistake that would make every one of these look
      // an hour more generous than it is.
      if (secondStopConceivable) {
        if (home) {
          const midLeg = await resolve(pac, home, workoutEnd);
          const backLeg = midLeg && (await resolve(home, to.location, midLeg.arrival, to.start));
          if (midLeg && backLeg) {
            const usable = minutesBetween(midLeg.arrival, backLeg.departure);
            const travel = travelOf(inLeg, midLeg, backLeg);
            const fits = beforeClose && usable > 0 && onTime(backLeg);
            out.push({
              id: "GYM_REZ", kind: "GYM", gymThen: "REZ",
              stops: [gymStop(workout), { purpose: "REZ", at: home, label: "home" }],
              fits,
              usableMinutes: Math.max(0, usable),
              travelMinutes: travel,
              leaveAt: inLeg.departure, arriveBackAt: backLeg.arrival,
              label: "Rez", detail: `Shower at home · ${formatDuration(Math.max(0, usable))} there`,
              reason: fits
                ? `${formatDuration(workout)} workout, then ${formatDuration(usable)} at home before you have to leave.`
                : `After a ${formatDuration(workout)} workout there is only ${formatDuration(Math.max(0, usable))} at home before you must set off.`,
              isEstimate: estimated(inLeg, midLeg, backLeg),
              starred: false,
            });
          }
        }

        const after = await nearestSpot(studySpots, pac, workoutEnd, dateISO, resolve);
        const backLeg = after && (await resolve(after.spot.at, to.location, after.leg.arrival, to.start));
        if (after && backLeg) {
          const stay = usableAt({ arrival: after.leg.arrival, mustLeaveBy: backLeg.departure, open: after.open, close: after.close });
          const travel = travelOf(inLeg, after.leg, backLeg);
          const fits = beforeClose && stay.minutes > 0 && onTime(backLeg);
          out.push({
            id: "GYM_STUDY", kind: "GYM", gymThen: "STUDY",
            stops: [gymStop(workout), { purpose: "STUDY", at: after.spot.at, label: after.spot.spot.shortName }],
            fits,
            usableMinutes: Math.max(0, stay.minutes),
            travelMinutes: travel,
            leaveAt: inLeg.departure, arriveBackAt: backLeg.arrival,
            label: "Library", detail: `${after.spot.spot.shortName} · ${formatDuration(Math.max(0, stay.minutes))} to work`,
            reason: fits
              ? `${formatDuration(workout)} workout, then ${formatDuration(stay.minutes)} at ${after.spot.spot.name}.`
              : `After a ${formatDuration(workout)} workout there is only ${formatDuration(Math.max(0, stay.minutes))} at ${after.spot.spot.name}.`,
            isEstimate: estimated(inLeg, after.leg, backLeg),
            starred: false,
          });
        }
      }
    }
  }

  // The top-level Gym button. It carries no stops on purpose: picking the gym without answering
  // "and then where?" commits nothing, so the student is never handed a workout to undo.
  const forks = out.filter((o) => o.kind === "GYM");
  if (forks.length) {
    const best = forks.find((o) => o.fits) ?? forks[0];
    out.push({
      id: "GYM", kind: "GYM", stops: [], fits: forks.some((o) => o.fits),
      usableMinutes: best.usableMinutes, travelMinutes: best.travelMinutes,
      leaveAt: best.leaveAt,
      label: "Gym", detail: `${formatDuration(workout)} workout at PAC`,
      reason: best.reason, isEstimate: best.isEstimate, starred: false,
    });
  }

  return out;
}

/**
 * Rungs in order; the first one that both exists and qualifies takes the star. Gym rungs are
 * simply absent when the student does not work out, so this needs no knowledge of that.
 */
export const GAP_LADDER: readonly GapOptionId[] = ["GYM_REZ", "GYM_STUDY", "GYM_CLASS", "REZ", "STUDY", "STAY"];

function qualifies(o: GapOption, cfg: PlannerConfig): { met: boolean; reason: string } {
  if (o.id === "STAY") return { met: true, reason: "Nothing else is worth the trip." };
  if (!o.fits) return { met: false, reason: o.reason };
  switch (o.id) {
    case "GYM_REZ":
    case "REZ":
      return o.usableMinutes >= cfg.minUsefulHomeMinutes
        ? { met: true, reason: o.reason }
        : { met: false, reason: `Only ${formatDuration(o.usableMinutes)} at home, under the ${formatDuration(cfg.minUsefulHomeMinutes)} that makes the trip worth it.` };
    case "GYM_STUDY":
    case "STUDY":
      return o.usableMinutes >= cfg.minUsefulStudyMinutes
        ? { met: true, reason: o.reason }
        : { met: false, reason: `Only ${formatDuration(o.usableMinutes)} to work, under the ${formatDuration(cfg.minUsefulStudyMinutes)} that makes the walk worth it.` };
    default:
      return { met: true, reason: o.reason };
  }
}

/** Pure and synchronous: the ladder over already-priced options. Sets `starred` on the winner. */
export function recommendGapOption(options: GapOption[], cfg: PlannerConfig): GapRecommendation {
  const considered: GapRecommendation["considered"] = [];
  let recommended: GapOptionId = "STAY";
  let reason = "Nothing else is worth the trip.";

  for (const id of GAP_LADDER) {
    const option = options.find((o) => o.id === id);
    if (!option) continue;
    const verdict = qualifies(option, cfg);
    considered.push({ id, met: verdict.met, reason: verdict.reason });
    if (verdict.met) {
      recommended = id;
      reason = verdict.reason;
      break;
    }
  }

  for (const o of options) {
    // The top-level Gym button wears the star its chosen fork earned, so the student sees where
    // to tap first without the component working anything out.
    o.starred = o.id === recommended || (o.id === "GYM" && recommended.startsWith("GYM_"));
  }
  return { recommended, reason, considered };
}
