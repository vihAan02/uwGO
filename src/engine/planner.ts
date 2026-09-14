/**
 * Async orchestrator: schedule + home + routing provider -> WeekPlan.
 * The only place that talks to a RoutingProvider. Every decision is delegated to the pure engines.
 */
import type { CampusLocation, ClassTransition, CourseMeeting, CrowdEstimate, DayOfWeek, DayPlan, DayPlanItem, EndOfDayDestination, GapOption, GapRecommendation, GapStop, GymPreferences, GymWindow, HomeReturnAnalysis, LatLng, RoutePreference, RouteOption, ScheduledClass, UserHome, WeekPlan } from "@/domain/types";
import { DAYS_IN_ORDER } from "@/domain/types";
import type { PlannerConfig } from "@/domain/config";
import type { RoutingProvider, TransitOptions } from "@/routing/RoutingProvider";
import { pairKey } from "@/routing/RoutingProvider";
import { addMin, dateForDay, minutesBetween } from "@/time/toronto";
import { normalizeWeek } from "./normalize";
import { buildItinerary, findContinuityBreaks, type LegSpec } from "./transitions";
import { resolveBestRoute, type BestRoute, type RouteFetcher, type RouteRequest } from "./bestRoute";
import { assessResolvedFeasibility } from "./feasibility";
import { analyzeHomeReturn, type ResolvedLeg } from "./homeReturn";
import { selectRoute } from "./selectRoute";
import { findGymWindows, gymForGap } from "./gym";
import { nearestSpot, priceGapOptions, recommendGapOption } from "./gapOptions";
import { resolveStudySpots } from "@/data/study";
import { chosenFor, type ChosenGap, type GapChoices } from "@/domain/gapChoices";
import { estimateCrowd, type PacReading, type PacSample } from "@/data/pac/crowd";
import { buildingLocation, findBuilding } from "@/data/buildings";
import type { AccessNeeds } from "./indoorGraph";

/** What every trip in a plan shares: the closures, the student's access needs, and whether experimental campus data is on. */
type TripContext = Pick<RouteRequest, "closedEdgeIds" | "access" | "experimentalCampus" | "campus">;

export interface PlanInput {
  meetings: CourseMeeting[];
  home?: UserHome;
  mondayISO: string;
  config: PlannerConfig;
  /** Days to plan; defaults to Mon–Fri plus any weekend day that has a class. */
  days?: DayOfWeek[];
  /** Gym preferences; windows are only searched for when enabled. */
  gym?: GymPreferences;
  /** FASTEST (default) or INDOORS: prefer UW tunnels/bridges when the cost is reasonable. */
  routePreference?: RoutePreference;
  /** What the student chose to do with each gap. An unanswered gap builds no trip at all. */
  gapChoices?: GapChoices;
  /** Where the day ends after the last class: HOME (default), GYM, or LIBRARY. */
  endOfDay?: EndOfDayDestination;
  /** Segments students have reported shut, by canonical id. Routing avoids them. */
  closedEdgeIds?: ReadonlySet<string>;
  /** What the student needs from doors, links and changes of floor. */
  access?: AccessNeeds;
  /** Also use campus data that is only experimental. Off in normal routing. */
  experimentalCampus?: boolean;
  /**
   * False plans every walk exactly as Google gives it, without campus knowledge: a switch for
   * comparing the two, and for turning campus routing off if it ever misleads.
   */
  campus?: boolean;
  /** Latest live PAC reading and the samples kept so far, for crowd estimates. */
  pacLive?: PacReading;
  pacSamples?: readonly PacSample[];
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
  /** The context is the plan's, so it is the same for every request and needs no place in the key. */
  constructor(private readonly memo: RouteMemo, private readonly cfg: PlannerConfig, private readonly context: TripContext = {}) {}

  resolve(req: RouteRequest): Promise<BestRoute> {
    const key = `${pairKey(req.from, req.to)}|${req.departAfter.getTime()}|${req.arriveBy?.getTime() ?? "open"}`;
    let p = this.cache.get(key);
    if (!p) {
      p = resolveBestRoute({ ...req, ...this.context }, this.memo, this.cfg);
      this.cache.set(key, p);
    }
    return p;
  }
}

function requestFor(t: ClassTransition): RouteRequest {
  return { from: t.from, to: t.to, departAfter: t.departAfter, arriveBy: t.hasDeadline ? t.arriveBy : undefined, crossCampus: t.crossCampus };
}

async function resolveTransition(t: ClassTransition, resolver: LegResolver, memo: RouteMemo, cfg: PlannerConfig, routePreference: RoutePreference, context: TripContext = {}): Promise<ClassTransition> {
  // Walking, transit and the winter route are all priced and chosen between by `selectRoute`,
  // the same function Trip Mode reroutes through. The leg resolver keeps its per-request cache
  // of the walk-vs-transit answer; the indoor joins are priced through the same memo as every
  // other walk. The winter route is always offered as the alternative; it is taken only when
  // asked for and not unreasonably slower than the fastest walk. A chosen bus is never
  // overridden: that decision was about time.
  const best = await selectRoute(
    { ...requestFor(t), preference: routePreference, ...context },
    { best: (req) => resolver.resolve(req), connector: memo },
    cfg,
  );
  const { recommended, departure, arrival, reason, indoor: indoorRoute } = best;

  let feasibility: ClassTransition["feasibility"] = "UNKNOWN";
  if (recommended && departure && arrival) {
    feasibility = t.hasDeadline
      ? assessResolvedFeasibility({ availableMinutes: t.availableMinutes, arriveBy: t.arriveBy, route: recommended, arrival }, cfg)
      : "COMFORTABLE";
  }
  return {
    ...t,
    walkingRoute: best.walking,
    transitRoute: best.transit,
    indoorRoute,
    campus: best.campus,
    campusWalk: best.campusWalk,
    recommendedRoute: recommended,
    recommendedDeparture: departure,
    expectedArrival: arrival,
    feasibility,
    reason,
    consideredModes: best.consideredModes,
  };
}

const legOf = (t: ClassTransition): ResolvedLeg | undefined =>
  t.recommendedRoute && t.recommendedDeparture && t.expectedArrival ? { route: t.recommendedRoute, departure: t.recommendedDeparture, arrival: t.expectedArrival } : undefined;

interface DayExtras {
  gym?: GymPreferences;
  gapChoices?: GapChoices;
  routePreference: RoutePreference;
  closedEdgeIds?: ReadonlySet<string>;
  access?: AccessNeeds;
  experimentalCampus?: boolean;
  campus?: boolean;
  endOfDay?: EndOfDayDestination;
  crowdAt: (at: Date) => CrowdEstimate;
}

const PAC_LOCATION: CampusLocation | undefined = (() => {
  const b = findBuilding("UW", "PAC");
  return b ? buildingLocation(b) : undefined;
})();

const STUDY_SPOTS = resolveStudySpots("UW");

async function buildDayPlan(day: DayOfWeek, dateISO: string, classes: ScheduledClass[], home: CampusLocation | undefined, memo: RouteMemo, cfg: PlannerConfig, extras: DayExtras): Promise<DayPlan> {
  const warnings: string[] = [];
  const context: TripContext = { closedEdgeIds: extras.closedEdgeIds, access: extras.access, experimentalCampus: extras.experimentalCampus, campus: extras.campus };
  const resolver = new LegResolver(memo, cfg, context);
  const cross = (a: CampusLocation, b: CampusLocation) => Boolean(a.university && b.university && a.university !== b.university);

  // One adapter for every engine that needs a route: the gym windows, the gap options and the
  // itinerary all go through this resolver, so they can never disagree about a trip.
  const resolveLeg = async (a: CampusLocation, b: CampusLocation, departAfter: Date, arriveBy?: Date): Promise<ResolvedLeg | undefined> => {
    const r = await resolver.resolve({ from: a, to: b, departAfter, arriveBy, crossCampus: cross(a, b) });
    return r.recommended && r.departure && r.arrival ? { route: r.recommended, departure: r.departure, arrival: r.arrival } : undefined;
  };

  // 1. Price every way to spend each gap, and say which one we would pick. The same resolver
  //    and the same clock as the itinerary, so an option the student picks costs no extra call
  //    and the numbers on the card stay the numbers on the timeline.
  const gapOptions = new Map<number, GapOption[]>();
  const gapAdvice = new Map<number, GapRecommendation>();
  for (let i = 0; i < classes.length - 1; i++) {
    const a = classes[i];
    const b = classes[i + 1];
    if (minutesBetween(a.end, b.start) < cfg.minGapForHomeAnalysisMinutes) continue;
    const options = await priceGapOptions({
      from: a, to: b, home, pac: PAC_LOCATION, studySpots: STUDY_SPOTS, dateISO,
      gym: extras.gym, cfg, resolve: resolveLeg,
    });
    gapAdvice.set(i, recommendGapOption(options, cfg));
    gapOptions.set(i, options);
  }

  // 1b. Take the student at their word. A gap they have not answered builds nothing: the plan
  //     offers, it does not commit them to a walk home they never asked for. Picking the gym
  //     without answering "and then where?" also builds nothing — that option carries no stops.
  const gapStops = new Map<number, readonly GapStop[]>();
  const gapChoice = new Map<number, ChosenGap>();
  for (const [i, options] of gapOptions) {
    const chosen = chosenFor(extras.gapChoices, dateISO, classes[i].id);
    if (!chosen) continue;
    gapChoice.set(i, chosen);
    const option = options.find((o) => o.kind === chosen.value.kind && o.gymThen === chosen.value.gymThen);
    if (option?.stops.length) gapStops.set(i, option.stops);
  }

  // 1c. Where the day ends. HOME (default) keeps the home bookend; GYM and LIBRARY route the last
  //     leg to the PAC or the nearest open library instead, resolved with the same shared resolver.
  let endDestination = home;
  if (classes.length && extras.endOfDay && extras.endOfDay !== "HOME") {
    const last = classes[classes.length - 1];
    if (extras.endOfDay === "GYM") {
      endDestination = PAC_LOCATION ?? home;
    } else if (extras.endOfDay === "LIBRARY") {
      const spot = await nearestSpot(STUDY_SPOTS, last.location, last.end, dateISO, resolveLeg);
      endDestination = spot?.spot.at ?? home;
    }
  }

  // 2. Build the chain of legs that follows from those decisions.
  const legs = buildItinerary(classes, home, gapStops, dateISO, endDestination);

  // 3. Resolve legs in order, carrying the running location and clock. A leg can never
  //    set off before the previous one has landed, and never from anywhere else. A stop the
  //    student owes time to (the workout) holds the clock before the next leg may depart.
  const transitions: ClassTransition[] = [];
  let readyAt: Date | undefined;
  for (const leg of legs) {
    const earliest = readyAt ? addMin(readyAt, leg.dwellMinutes ?? 0) : undefined;
    const spec: LegSpec = earliest && earliest.getTime() > leg.departAfter.getTime()
      ? { ...leg, departAfter: earliest, availableMinutes: leg.hasDeadline ? minutesBetween(earliest, leg.arriveBy) : 0 }
      : leg;
    const resolved = await resolveTransition(spec, resolver, memo, cfg, extras.routePreference, context);
    transitions.push(resolved);
    readyAt = resolved.expectedArrival ?? spec.arriveBy;
  }

  // Legs of each gap, in order, so the emitter never has to guess which leg is which.
  const gapLegs = new Map<number, ClassTransition[]>();
  for (const [k, leg] of legs.entries()) {
    if (leg.gapIndex === undefined) continue;
    const list = gapLegs.get(leg.gapIndex) ?? [];
    list[leg.gapLeg ?? 0] = transitions[k];
    gapLegs.set(leg.gapIndex, list);
  }

  const breaks = findContinuityBreaks(transitions);
  if (breaks.length) warnings.push(`Itinerary is inconsistent: ${breaks[0]}.`);

  // 3b. Workouts that fit around the same chain, priced with the same resolver.
  let gym: GymWindow[] = [];
  if (extras.gym?.enabled && PAC_LOCATION && classes.length) {
    gym = await findGymWindows({
      classes, home, pac: PAC_LOCATION, dateISO, prefs: extras.gym, cfg, crowdAt: extras.crowdAt,
      // A workout in the building you are already in is not a trip anywhere; the gap options
      // deliberately do allow a same-place stay, because a class inside the library is the best
      // case there rather than a degenerate one.
      resolve: async (from, to, departAfter, arriveBy) => (from.id === to.id ? undefined : resolveLeg(from, to, departAfter, arriveBy)),
    });
  }

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

    const inGap = gapLegs.get(i) ?? [];
    // The gap card reads the resolved legs. Normally these are the very resolutions the
    // decision was made on; if the chain had to shift a departure, the card follows the chain.
    // Only a single-stop trip home can be read this way: with two stops the leg pair no longer
    // spans the gap, and `analyzeHomeReturn`'s gapMinutes would mean something else.
    const goingHome = (gapStops.get(i) ?? []).length === 1 && gapStops.get(i)![0].purpose === "REZ";
    const outResolved = goingHome && inGap[0] && legOf(inGap[0]);
    const backResolved = goingHome && inGap[1] && legOf(inGap[1]);
    const homeReturn: HomeReturnAnalysis | undefined = outResolved && backResolved
      ? analyzeHomeReturn({ gapStart: c.end, nextClassStart: next.start, routeHome: outResolved, routeBack: backResolved }, cfg)
      : gapOptions.get(i)?.find((o) => o.id === "REZ")?.analysis;

    if (minutesBetween(c.end, next.start) >= cfg.minGapForHomeAnalysisMinutes) {
      items.push({
        kind: "GAP", from: c.end, to: next.start, minutes: minutesBetween(c.end, next.start),
        dateISO, classId: c.id,
        options: gapOptions.get(i) ?? [],
        recommendation: gapAdvice.get(i),
        choice: gapChoice.get(i),
        homeReturn, gym: gymForGap(gym, i),
      });
    }

    for (const t of inGap) pushLeg(t);
  }

  const afterLast = gym.find((w) => w.slot === "AFTER_LAST");
  if (afterLast) items.push({ kind: "GYM", window: afterLast });

  if (endDestination && classes.length) {
    pushLeg(legAt((l) => l.kind === "CLASS_TO_HOME" || l.kind === "CLASS_TO_END"));
  }

  for (const t of transitions) if (t.feasibility === "LIKELY_LATE") warnings.push(`${t.from.name} → ${t.to.name}: you will likely be late (${t.availableMinutes} min available).`);
  return { day, date: dateISO, classes, transitions, items, warnings, gym };
}

export async function buildWeekPlan(input: PlanInput, provider: RoutingProvider): Promise<WeekPlan> {
  const week = normalizeWeek(input.meetings, input.mondayISO);
  const home = input.home ? homeLocation(input.home) : undefined;
  const errors: string[] = [];
  const memo = new RouteMemo(provider, errors);
  const days = input.days ?? DAYS_IN_ORDER.filter((d) => ["M", "T", "W", "Th", "F"].includes(d) || week.byDay[d].length > 0);

  const extras: DayExtras = {
    gym: input.gym,
    routePreference: input.routePreference ?? "FASTEST",
    closedEdgeIds: input.closedEdgeIds,
    access: input.access,
    experimentalCampus: input.experimentalCampus,
    campus: input.campus,
    gapChoices: input.gapChoices,
    endOfDay: input.endOfDay,
    crowdAt: (at) => estimateCrowd(at, input.pacLive, input.pacSamples ?? []),
  };
  const plans = await Promise.all(days.map((d) => buildDayPlan(d, dateForDay(input.mondayISO, d), week.byDay[d], home, memo, input.config, extras)));
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
