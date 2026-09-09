/**
 * Async orchestrator: schedule + home + routing provider -> WeekPlan.
 * The only place that talks to a RoutingProvider. Every decision is delegated to the pure engines.
 */
import type { CampusLocation, ClassTransition, CourseMeeting, DayOfWeek, DayPlan, DayPlanItem, HomeReturnAnalysis, LatLng, RouteOption, ScheduledClass, UserHome, WeekPlan } from "@/domain/types";
import { DAYS_IN_ORDER } from "@/domain/types";
import type { PlannerConfig } from "@/domain/config";
import type { RoutingProvider, TransitOptions } from "@/routing/RoutingProvider";
import { pairKey } from "@/routing/RoutingProvider";
import { dateForDay, minutesBetween } from "@/time/toronto";
import { normalizeWeek } from "./normalize";
import { buildItinerary, findContinuityBreaks, type LegSpec } from "./transitions";
import { resolveBestRoute, type BestRoute, type RouteFetcher, type RouteRequest } from "./bestRoute";
import { assessResolvedFeasibility } from "./feasibility";
import { analyzeHomeReturn, type ResolvedLeg } from "./homeReturn";

export interface PlanInput {
  meetings: CourseMeeting[];
  home?: UserHome;
  mondayISO: string;
  config: PlannerConfig;
  /** Days to plan; defaults to Mon–Fri plus any weekend day that has a class. */
  days?: DayOfWeek[];
}

export function homeLocation(home: UserHome): CampusLocation {
  return { id: "home", name: home.name, latitude: home.latitude, longitude: home.longitude, kind: "HOME", university: home.preset?.university, buildingCode: home.preset?.buildingCode };
}

/**
 * Per-plan memo. Walking depends only on the pair, so it is fetched once even when the pair
 * occurs on several days. Transit is schedule-bound and is never memoised here by pair; the
 * provider's own cache keys it by requested minute.
 */
class RouteMemo implements RouteFetcher {
  private readonly walks = new Map<string, Promise<RouteOption | undefined>>();
  constructor(private readonly provider: RoutingProvider, readonly errors: string[]) {}

  private async guard<T>(label: string, p: Promise<T>): Promise<T | undefined> {
    try {
      return await p;
    } catch (err) {
      this.errors.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
      return undefined;
    }
  }

  walk(from: LatLng, to: LatLng): Promise<RouteOption | undefined> {
    const key = pairKey(from, to);
    let p = this.walks.get(key);
    if (!p) {
      p = this.guard("walking route", this.provider.getWalkingRoute(from, to));
      this.walks.set(key, p);
    }
    return p;
  }

  transit(from: LatLng, to: LatLng, opts: TransitOptions): Promise<RouteOption | undefined> {
    return this.guard("transit route", this.provider.getTransitRoute(from, to, opts));
  }
}

/**
 * One resolution per (origin, destination, window). The gap analysis and the itinerary walk
 * both come through here, so the routes a go-home decision was made on are, by identity,
 * the routes the timeline then shows.
 */
class LegResolver {
  private readonly cache = new Map<string, Promise<BestRoute>>();
  constructor(private readonly memo: RouteMemo, private readonly cfg: PlannerConfig) {}

  resolve(req: RouteRequest): Promise<BestRoute> {
    const key = `${pairKey(req.from, req.to)}|${req.departAfter.getTime()}|${req.arriveBy?.getTime() ?? "open"}`;
    let p = this.cache.get(key);
    if (!p) {
      p = resolveBestRoute(req, this.memo, this.cfg);
      this.cache.set(key, p);
    }
    return p;
  }
}

function requestFor(t: ClassTransition): RouteRequest {
  return { from: t.from, to: t.to, departAfter: t.departAfter, arriveBy: t.hasDeadline ? t.arriveBy : undefined, crossCampus: t.crossCampus };
}

async function resolveTransition(t: ClassTransition, resolver: LegResolver, cfg: PlannerConfig): Promise<ClassTransition> {
  const best = await resolver.resolve(requestFor(t));
  let feasibility: ClassTransition["feasibility"] = "UNKNOWN";
  if (best.recommended && best.departure && best.arrival) {
    feasibility = t.hasDeadline
      ? assessResolvedFeasibility({ availableMinutes: t.availableMinutes, arriveBy: t.arriveBy, route: best.recommended, arrival: best.arrival }, cfg)
      : "COMFORTABLE";
  }
  return {
    ...t,
    walkingRoute: best.walking,
    transitRoute: best.transit,
    recommendedRoute: best.recommended,
    recommendedDeparture: best.departure,
    expectedArrival: best.arrival,
    feasibility,
    reason: best.reason,
    consideredModes: best.consideredModes,
  };
}

const legOf = (t: ClassTransition): ResolvedLeg | undefined =>
  t.recommendedRoute && t.recommendedDeparture && t.expectedArrival ? { route: t.recommendedRoute, departure: t.recommendedDeparture, arrival: t.expectedArrival } : undefined;

/**
 * Decide, for each gap long enough to be worth analysing, whether going home is sensible.
 * The question is asked with the best route each way, not a walking estimate: fastest
 * practical route from the class to home leaving at the gap start, then fastest practical
 * route from home to the next class arriving before the buffer, setting off no earlier
 * than the arrival home. Those two resolutions are the legs the itinerary will show.
 */
async function analyseGaps(
  classes: ScheduledClass[],
  home: CampusLocation | undefined,
  resolver: LegResolver,
  cfg: PlannerConfig,
): Promise<Map<number, HomeReturnAnalysis>> {
  const out = new Map<number, HomeReturnAnalysis>();
  if (!home) return out;
  const cross = (a: CampusLocation, b: CampusLocation) => Boolean(a.university && b.university && a.university !== b.university);
  await Promise.all(
    classes.slice(0, -1).map(async (c, i) => {
      const next = classes[i + 1];
      if (minutesBetween(c.end, next.start) < cfg.minGapForHomeAnalysisMinutes) return;
      const toHome = await resolver.resolve({ from: c.location, to: home, departAfter: c.end, crossCampus: cross(c.location, home) });
      if (!toHome.recommended || !toHome.departure || !toHome.arrival) return;
      const back = await resolver.resolve({ from: home, to: next.location, departAfter: toHome.arrival, arriveBy: next.start, crossCampus: cross(home, next.location) });
      if (!back.recommended || !back.departure || !back.arrival) return;
      out.set(i, analyzeHomeReturn({
        gapStart: c.end,
        nextClassStart: next.start,
        routeHome: { route: toHome.recommended, departure: toHome.departure, arrival: toHome.arrival },
        routeBack: { route: back.recommended, departure: back.departure, arrival: back.arrival },
      }, cfg));
    }),
  );
  return out;
}

async function buildDayPlan(day: DayOfWeek, dateISO: string, classes: ScheduledClass[], home: CampusLocation | undefined, memo: RouteMemo, cfg: PlannerConfig): Promise<DayPlan> {
  const warnings: string[] = [];
  const resolver = new LegResolver(memo, cfg);

  // 1. Work out where the student will actually be, before working out any trip.
  const gapAnalysis = await analyseGaps(classes, home, resolver, cfg);
  const goHomeAfter = new Set(
    [...gapAnalysis].filter(([, a]) => a.recommendation === "WORTH_IT").map(([i]) => i),
  );

  // 2. Build the chain of legs that follows from those decisions.
  const legs = buildItinerary(classes, home, goHomeAfter, dateISO);

  // 3. Resolve legs in order, carrying the running location and clock. A leg can never
  //    set off before the previous one has landed, and never from anywhere else.
  const transitions: ClassTransition[] = [];
  let readyAt: Date | undefined;
  for (const leg of legs) {
    const spec: LegSpec = readyAt && readyAt.getTime() > leg.departAfter.getTime()
      ? { ...leg, departAfter: readyAt, availableMinutes: leg.hasDeadline ? minutesBetween(readyAt, leg.arriveBy) : 0 }
      : leg;
    const resolved = await resolveTransition(spec, resolver, cfg);
    transitions.push(resolved);
    readyAt = resolved.expectedArrival ?? spec.arriveBy;
  }

  const breaks = findContinuityBreaks(transitions);
  if (breaks.length) warnings.push(`Itinerary is inconsistent: ${breaks[0]}.`);

  // 4. Emit the timeline. Legs are consumed in order, so what the student reads is
  //    exactly the chain that was resolved above.
  const items: DayPlanItem[] = [];
  const pushLeg = (t: ClassTransition | undefined) => {
    if (!t) return;
    if (!t.recommendedRoute || !t.recommendedDeparture || !t.expectedArrival) {
      warnings.push(`No route found from ${t.from.name} to ${t.to.name}.`);
      items.push({ kind: "NOTE", text: `Route from ${t.from.name} to ${t.to.name} unavailable.` });
      return;
    }
    items.push({ kind: "LEAVE", at: t.recommendedDeparture, from: t.from, transition: t });
    items.push({ kind: "ARRIVE", at: t.expectedArrival, to: t.to, transition: t });
  };
  const legAt = (predicate: (l: LegSpec) => boolean) => {
    const at = legs.findIndex(predicate);
    return at < 0 ? undefined : transitions[at];
  };

  if (home && classes.length) pushLeg(legAt((l) => l.toClassIndex === 0 && l.from.kind === "HOME"));

  for (let i = 0; i < classes.length; i++) {
    const c = classes[i];
    items.push({ kind: "CLASS", scheduledClass: c });
    const next = classes[i + 1];
    if (!next) break;

    const goingHome = goHomeAfter.has(i);
    const outLeg = goingHome ? legAt((l) => l.midDayHomeReturn === true && l.fromClassIndex === i) : undefined;
    const backLeg = goingHome ? legAt((l) => l.midDayHomeReturn === true && l.toClassIndex === i + 1) : undefined;

    // The gap card reads the resolved legs. Normally these are the very resolutions the
    // decision was made on; if the chain had to shift a departure, the card follows the chain.
    const outResolved = outLeg && legOf(outLeg);
    const backResolved = backLeg && legOf(backLeg);
    const homeReturn: HomeReturnAnalysis | undefined = goingHome && outResolved && backResolved
      ? analyzeHomeReturn({ gapStart: c.end, nextClassStart: next.start, routeHome: outResolved, routeBack: backResolved }, cfg)
      : gapAnalysis.get(i);

    if (minutesBetween(c.end, next.start) >= cfg.minGapForHomeAnalysisMinutes) {
      items.push({ kind: "GAP", from: c.end, to: next.start, minutes: minutesBetween(c.end, next.start), homeReturn });
    }

    if (goingHome) {
      pushLeg(outLeg);
      pushLeg(backLeg);
    } else {
      pushLeg(legAt((l) => l.fromClassIndex === i && l.toClassIndex === i + 1));
    }
  }

  if (home && classes.length) {
    pushLeg(legAt((l) => l.kind === "CLASS_TO_HOME" && !l.midDayHomeReturn));
  }

  for (const t of transitions) if (t.feasibility === "LIKELY_LATE") warnings.push(`${t.from.name} → ${t.to.name}: you will likely be late (${t.availableMinutes} min available).`);
  return { day, date: dateISO, classes, transitions, items, warnings };
}

export async function buildWeekPlan(input: PlanInput, provider: RoutingProvider): Promise<WeekPlan> {
  const week = normalizeWeek(input.meetings, input.mondayISO);
  const home = input.home ? homeLocation(input.home) : undefined;
  const errors: string[] = [];
  const memo = new RouteMemo(provider, errors);
  const days = input.days ?? DAYS_IN_ORDER.filter((d) => ["M", "T", "W", "Th", "F"].includes(d) || week.byDay[d].length > 0);

  const plans = await Promise.all(days.map((d) => buildDayPlan(d, dateForDay(input.mondayISO, d), week.byDay[d], home, memo, input.config)));
  const result: WeekPlan = { generatedAt: new Date().toISOString(), weekStartDate: input.mondayISO, days: {}, skipped: week.skipped, usesEstimates: false };
  for (const p of plans) {
    result.days[p.day] = p;
    for (const t of p.transitions) if (t.walkingRoute?.isEstimate || t.transitRoute?.isEstimate) result.usesEstimates = true;
  }
  if (errors.length) {
    const first = result.days[days[0]];
    if (first) first.warnings.push(...Array.from(new Set(errors)).slice(0, 3));
  }
  return result;
}
