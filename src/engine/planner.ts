/**
 * Async orchestrator: schedule + home + routing provider -> WeekPlan.
 * The only place that talks to a RoutingProvider. Every decision is delegated to the pure engines.
 */
import type { CampusLocation, ClassTransition, CourseMeeting, DayOfWeek, DayPlan, DayPlanItem, LatLng, RouteOption, ScheduledClass, UserHome, WeekPlan } from "@/domain/types";
import { DAYS_IN_ORDER } from "@/domain/types";
import type { PlannerConfig } from "@/domain/config";
import type { RoutingProvider, TransitOptions } from "@/routing/RoutingProvider";
import { pairKey } from "@/routing/RoutingProvider";
import { addMin, dateForDay, minutesBetween } from "@/time/toronto";
import { normalizeWeek } from "./normalize";
import { buildTransitions } from "./transitions";
import { chooseRoute, shouldConsiderTransit } from "./transitCompare";
import { assessFeasibility } from "./feasibility";
import { analyzeHomeReturn } from "./homeReturn";

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

/** Per-plan memo so the same building pair is fetched once even when it occurs on several days. */
class RouteMemo {
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

const SAME_PLACE: RouteOption = { mode: "WALK", durationMinutes: 0, distanceMeters: 0, provider: "same-building", computedAt: "", isEstimate: false };

async function resolveTransition(t: ClassTransition, memo: RouteMemo, cfg: PlannerConfig): Promise<ClassTransition> {
  if (t.from.id === t.to.id) {
    const departure = t.hasDeadline ? addMin(t.arriveBy, -cfg.arrivalBufferMinutes) : t.departAfter;
    return { ...t, walkingRoute: SAME_PLACE, recommendedRoute: SAME_PLACE, recommendedDeparture: departure.getTime() < t.departAfter.getTime() ? t.departAfter : departure, expectedArrival: departure.getTime() < t.departAfter.getTime() ? t.departAfter : departure, feasibility: t.hasDeadline ? assessFeasibility(t.availableMinutes, 0, cfg) : "COMFORTABLE", reason: "Same building." };
  }
  const walking = await memo.walk(t.from, t.to);
  let transit: RouteOption | undefined;
  if (shouldConsiderTransit(t.crossCampus, walking?.durationMinutes, cfg)) {
    const opts: TransitOptions = t.kind === "HOME_TO_CLASS" ? { arrivalTime: addMin(t.arriveBy, -cfg.arrivalBufferMinutes) } : { departureTime: addMin(t.departAfter, cfg.buildingExitMinutes) };
    transit = await memo.transit(t.from, t.to, opts);
  }
  const choice = chooseRoute({ departAfter: t.departAfter, arriveBy: t.arriveBy, hasDeadline: t.hasDeadline, walking, transit }, cfg);
  let feasibility: ClassTransition["feasibility"] = "UNKNOWN";
  if (choice.recommended && choice.departure && choice.arrival) {
    if (!t.hasDeadline) feasibility = "COMFORTABLE";
    else {
      const effectiveTravel = choice.recommended.mode === "WALK" ? choice.recommended.durationMinutes : minutesBetween(t.departAfter, choice.arrival);
      feasibility = assessFeasibility(t.availableMinutes, effectiveTravel, cfg);
    }
  }
  return { ...t, walkingRoute: walking, transitRoute: transit, recommendedRoute: choice.recommended, recommendedDeparture: choice.departure, expectedArrival: choice.arrival, feasibility, reason: choice.reason };
}

async function buildDayPlan(day: DayOfWeek, dateISO: string, classes: ScheduledClass[], home: CampusLocation | undefined, memo: RouteMemo, cfg: PlannerConfig): Promise<DayPlan> {
  const warnings: string[] = [];
  const skeleton = buildTransitions(classes, home, dateISO);
  const transitions = await Promise.all(skeleton.map((t) => resolveTransition(t, memo, cfg)));
  const byId = new Map(transitions.map((t) => [t.id, t]));

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

  if (home && classes.length) pushLeg(byId.get(`home->${classes[0].id}`));
  for (let i = 0; i < classes.length; i++) {
    const c = classes[i];
    items.push({ kind: "CLASS", scheduledClass: c });
    const next = classes[i + 1];
    if (next) {
      const gapMinutes = minutesBetween(c.end, next.start);
      const t = byId.get(`${c.id}->${next.id}`);
      if (gapMinutes >= cfg.minGapForHomeAnalysisMinutes) {
        let homeReturn;
        if (home) {
          const [routeHome, routeBack] = await Promise.all([memo.walk(c.location, home), memo.walk(home, next.location)]);
          if (routeHome && routeBack) homeReturn = analyzeHomeReturn({ gapStart: c.end, nextClassStart: next.start, routeHome, routeBack }, cfg);
        }
        items.push({ kind: "GAP", from: c.end, to: next.start, minutes: gapMinutes, homeReturn });
      }
      pushLeg(t);
    }
  }
  if (home && classes.length) pushLeg(byId.get(`${classes[classes.length - 1].id}->home`));

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
