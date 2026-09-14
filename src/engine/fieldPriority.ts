/**
 * Which field checks to walk first, ranked from what UW Go actually routes rather than from a hunch.
 *
 * Three kinds of routing are measured, each trip weighted by how busy the two places are:
 *
 * - campus: the campus-aware walk decision itself (campusRoute.ts), for every pair of network buildings and
 *   residences, against a stand-in for Google's walk. It records where UW Go sends students somewhere other than
 *   Google's walk (today, every trip into PAC) and what that depends on.
 * - winter: the winter route between every pair of network buildings.
 * - stepFree: the step-free winter route between every pair of network buildings.
 *
 * For every target that gives:
 * - routing: how much weighted routing relies on it, and what losing it would cost those trips;
 * - traffic: how much weighted demand starts or ends at the buildings it touches;
 * - shortcut: what confirming it could open up (a quarantined link that is really usable);
 * - accessibility: what it means for step-free trips (a change of floor nobody has confirmed step-free, a door
 *   or link on a step-free route whose access nobody has recorded);
 * - uncertainty: how weak what UW Go believes about it is, for using it and for its access separately.
 *
 * Every figure is kept with the target, so the ranking can be argued with. `npm run campus:field` writes it to
 * src/data/campus/field/priorities.generated.json with a fingerprint of everything it was computed from; a test
 * fails when the fingerprint is stale.
 */
import { encode } from "@googlemaps/polyline-codec";
import type { CampusLocation, CampusOutcome, LatLng, RouteOption } from "@/domain/types";
import { DEFAULT_PLANNER_CONFIG, type PlannerConfig } from "@/domain/config";
import { compileKnowledge, CAMPUS_KNOWLEDGE, type CampusKnowledge, type Evidence, type FieldPromotion } from "@/data/campus";
import { buildingLocation, findBuilding, residencePresets } from "@/data/buildings";
import { floorPlansFor } from "@/data/floorplans";
import { STUDY_SPOTS } from "@/data/study";
import { haversineMeters } from "@/routing/EstimateRoutingProvider";
import { torontoDate } from "@/time/toronto";
import { OUTSIDE, INDOOR_PACE, OUTDOOR_PENALTY, UNKNOWN_HOURS_PASS_THROUGH, arcsOf, campusGraph, cheapestReached, graphOver, searchFrom, usableAccess, type IndoorGraph, type RouteOptions } from "./indoorGraph";
import { ALONG_GOOGLE_METRES, CAMPUS_LOOKUPS, CAMPUS_PACE, CAMPUS_UNCERTAINTY_SECONDS, DOOR_WALK_GUESS, GOOGLE_DOOR_METRES, GOOGLE_WALK_METRES_PER_SECOND, UNKNOWN_ACCESS_SECONDS, campusWalk, secondsOf } from "./campusRoute";
import { CONNECTOR_CANDIDATES, CONNECTOR_MAX_METRES } from "./indoorRoute";
import type { FieldTarget } from "./fieldTargets";

export type Tier = "P0" | "P1" | "P2" | "P3";
export const TIERS: readonly Tier[] = ["P0", "P1", "P2", "P3"];

export type AnalysisMode = "campus" | "winter" | "stepFree";
export const ANALYSIS_MODES: readonly AnalysisMode[] = ["campus", "winter", "stepFree"];

export interface BuildingDemand {
  code: string;
  weight: number;
  /** On the surveyed network. Places off it only take part in the campus decisions. */
  onNetwork: boolean;
  reasons: string[];
}

export interface ModeMetrics {
  /** Trips whose route uses it. For campus, trips UW Go sends through it instead of Google's walk. */
  usedBy: number;
  /** Their share of all weighted demand, 0 to 1. */
  share: number;
  /**
   * If it could not be used: how much worse those trips become, averaged over all weighted demand, in the routing's
   * own measure. For campus decisions that is seconds; for winter and step-free routes it is seconds with each second
   * outside counted OUTDOOR_PENALTY times, which is what those routes minimise. A lost trip counts LOST_SECONDS.
   */
  detour: number;
  /** The same, per trip that relies on it. */
  extraPerTrip: number;
  /** Trips left without it: no winter or step-free route, or for campus no allowed way in at all. */
  lost: number;
  lostShare: number;
  /** If it were confirmed usable (or step-free): trips that would gain a route. */
  gained: number;
  /** ...and how much better trips become, averaged over all weighted demand, in the same measure. A gained route counts GAINED_SECONDS. */
  gain: number;
}

export interface TargetPriority {
  tier: Tier;
  /** 0 to 100. */
  score: number;
  /** A rule that corrects walks, or something without which a corrected trip has no allowed way in. */
  critical: boolean;
  /** 0 to 1: how weak what UW Go believes is, about using it and about its access. */
  uncertainty: { routing: number; access: number };
  /** Each 0 to 1, relative to the target that scores highest on it. */
  factors: { routing: number; traffic: number; shortcut: number; accessibility: number };
  metrics: Partial<Record<AnalysisMode, ModeMetrics>> & {
    /** For a rule about a building's way in or out: the share of weighted demand whose walk UW Go corrects on its word. */
    correctedShare?: number;
    /** ...and which way those walks go. */
    correctedDirections?: ("into" | "out of")[];
    /** For a building's hours: the share of weighted demand whose campus decision or winter route passes through it. */
    passThroughShare?: number;
    /** Share of weighted demand starting or ending at any building it touches. */
    buildingShare?: number;
    /** Nobody has recorded whether its segments are step-free. */
    accessUnknown?: boolean;
  };
  /** The busiest trips between network buildings that rely on it, to show on a map. */
  routes: { from: string; to: string; mode: AnalysisMode }[];
}

export interface FieldPriorities {
  fingerprint: string;
  generatedFrom: { knowledgeReviewedAt: string; promotions: number; networkCommit: string; places: number; campusTrips: number; networkTrips: number };
  demand: BuildingDemand[];
  targets: Record<string, TargetPriority>;
}

/** What a trip left without a route counts as: about the time to walk round outside instead. */
export const LOST_SECONDS = 300;
/** What a trip that gains a route counts as. */
export const GAINED_SECONDS = 300;

/** A stand-in for Google's walk, shaped like one: the straight line, 30% longer, at 1.33 m/s. The ranking asks no routing API. */
export const STAND_IN_WALK = { detour: 1.3, metresPerSecond: 1.33 } as const;

/** A Tuesday at noon in term: inside every opening window, so the ranking is about the network rather than the clock. */
export const RANKING_AT = torontoDate("2026-09-15", 12 * 60);

/**
 * How busy a place is, beyond its size. UW Go has no campus-wide timetable of rooms, so these are the roles its
 * own data gives a building; each multiplies its weight.
 */
export const DEMAND_ROLES: readonly { factor: number; applies: (code: string) => boolean; reason: string }[] = [
  { factor: 2, applies: (c) => c === "PAC", reason: "the gym UW Go plans workouts around" },
  { factor: 1.5, applies: (c) => c === "SLC", reason: "the Student Life Centre: open all hours, and the way into PAC" },
  { factor: 1.5, applies: (c) => STUDY_SPOTS.some((s) => s.university === "UW" && s.buildingCode === c), reason: "a library UW Go offers for gaps between classes" },
  { factor: 1.5, applies: (c) => findBuilding("UW", c)?.residenceLabel !== undefined, reason: "a residence or college residence, where students' days start and end" },
  { factor: 1.25, applies: (c) => floorPlansFor(c).length > 0, reason: "classrooms UW Go has floor-plan room positions for" },
];

/** How weak each kind of evidence leaves what UW Go believes, 0 to 1. Official statements still go stale. */
export const EVIDENCE_UNCERTAINTY: Readonly<Record<Evidence, number>> = {
  OFFICIAL: 0.3,
  FIELD_VERIFIED: 0.05,
  CORROBORATED: 0.45,
  SURVEYED: 0.6,
  ANECDOTAL: 0.75,
  INFERRED: 0.8,
  UNRESOLVED: 1,
};

/** How the factors combine into a score, and where the tiers start. */
export const RANKING = {
  weights: { routing: 0.5, traffic: 0.1, shortcut: 0.2, accessibility: 0.2 },
  /** How much each kind of routing's reliance counts. Campus decisions override Google's walk, so they count most. */
  modeWeights: { campus: 1, winter: 0.5, stepFree: 0.3 } as Record<AnalysisMode, number>,
  /** Added to routing uncertainty for each disagreement between sources, and for a reviewer's priority-1 check. */
  conflictUncertainty: 0.15,
  urgentCheckUncertainty: 0.1,
  /** A surveyed stairwell rarely turns out not to be there; what nobody knows is whether there is an elevator. */
  surveyedStairwellUncertainty: 0.3,
  /** The access of a door or link nobody has recorded. */
  unknownAccessUncertainty: 0.8,
  /** Unknown hours only change routes before 07:00 and after 22:00, when few trips are made. */
  hoursRoutingScale: 0.25,
  p0Score: 30,
  /** Campus reliance at least this share, on something a reviewer flagged, disputed or never corroborated, is P0. */
  p0CampusShare: 0.003,
  p1Score: 12,
  p1Factor: 0.3,
  p2Score: 4,
  /** Reliance on less than this share of weighted demand does not by itself lift a target out of P3. */
  p2Share: 0.002,
} as const;

const round = (n: number, places = 4) => Number(n.toFixed(places));
const unique = <T>(xs: readonly T[]): T[] => [...new Set(xs)];

/** The places trips are made between: every building on the network, and every residence off it. */
function placeCodes(g: IndoorGraph): string[] {
  const network = [...g.anchorsByBuilding.keys()].sort();
  const residences = residencePresets("UW").filter((b) => !g.anchorsByBuilding.has(b.code) && b.latitude !== undefined && b.longitude !== undefined).map((b) => b.code).sort();
  return [...network, ...residences];
}

/** The weight of every place: its size by surveyed corridor (×1 off the network), times the roles that apply. */
export function buildingDemand(g: IndoorGraph): BuildingDemand[] {
  const corridor = new Map<string, number>();
  for (const e of g.net.edges) {
    const b = g.net.nodes[e.a].building;
    if (e.kind !== "HALLWAY" || b === OUTSIDE || b !== g.net.nodes[e.b].building) continue;
    corridor.set(b, (corridor.get(b) ?? 0) + e.metres);
  }
  const network = [...g.anchorsByBuilding.keys()].sort();
  const sorted = network.map((c) => corridor.get(c) ?? 0).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] || 1;
  return placeCodes(g).map((code) => {
    const onNetwork = g.anchorsByBuilding.has(code);
    const metres = corridor.get(code) ?? 0;
    const size = onNetwork ? Math.min(2, Math.max(0.5, Math.sqrt(metres / median))) : 1;
    const reasons = [onNetwork ? `${Math.round(metres)} m of surveyed corridor: size ×${size.toFixed(2)}` : "off the surveyed network: size ×1"];
    let weight = size;
    for (const role of DEMAND_ROLES) {
      if (!role.applies(code)) continue;
      weight *= role.factor;
      reasons.push(`${role.reason}: ×${role.factor}`);
    }
    return { code, weight: round(weight, 3), onNetwork, reasons };
  });
}

export function analysisOptions(mode: "winter" | "stepFree"): RouteOptions {
  return mode === "winter" ? {} : { constraints: { access: { stepFree: true } } };
}

/** The stand-in walk: a Google-shaped route that costs no API call. */
export const standInWalks = {
  async walk(from: LatLng, to: LatLng): Promise<RouteOption> {
    const metres = haversineMeters(from, to) * STAND_IN_WALK.detour;
    const seconds = metres / STAND_IN_WALK.metresPerSecond;
    return {
      mode: "WALK", durationMinutes: Math.max(1, Math.ceil(seconds / 60)), durationSeconds: Math.round(seconds), distanceMeters: Math.round(metres),
      polyline: encode([[from.latitude, from.longitude], [to.latitude, to.longitude]]), provider: "ranking-stand-in", computedAt: "", isEstimate: false,
    };
  },
};

interface Trip {
  /** In the routing's own measure: seconds for a campus decision, the search's cost for a winter or step-free route. */
  cost: number;
  edges: number[];
  /** Buildings passed through on the way, not counting the two ends. */
  through: string[];
  outcome?: CampusOutcome;
  /** Buildings whose rule about their map point activated the decision. */
  rules?: string[];
}

const throughOf = (g: IndoorGraph, edges: readonly number[], from: string, to: string) =>
  unique(edges.flatMap((i) => [g.net.nodes[g.net.edges[i].a].building, g.net.nodes[g.net.edges[i].b].building])).filter((b) => b !== OUTSIDE && b !== from && b !== to);

/** Every winter or step-free trip from one network building, with the segments each route uses. */
function networkTripsFrom(g: IndoorGraph, from: string, opts: RouteOptions): Map<string, Trip | null> {
  const search = searchFrom(g.anchorsByBuilding.get(from)!, opts, g);
  const out = new Map<string, Trip | null>();
  for (const [to, ends] of g.anchorsByBuilding) {
    if (to === from) continue;
    const target = cheapestReached(ends, search.cost);
    if (target === undefined) { out.set(to, null); continue; }
    const edges = arcsOf(search, target).map((a) => a.index);
    out.set(to, { cost: search.cost.get(target) ?? 0, edges, through: throughOf(g, edges, from, to) });
  }
  return out;
}

/** The cost of every winter or step-free trip from one network building, or null where there is none. */
function networkCostsFrom(g: IndoorGraph, from: string, opts: RouteOptions): Map<string, number | null> {
  const search = searchFrom(g.anchorsByBuilding.get(from)!, opts, g);
  const out = new Map<string, number | null>();
  for (const [to, ends] of g.anchorsByBuilding) {
    if (to === from) continue;
    const target = cheapestReached(ends, search.cost);
    out.set(to, target === undefined ? null : search.cost.get(target) ?? 0);
  }
  return out;
}

/** The campus-aware decision for one trip, against the stand-in for Google's walk. Undefined where the campus has nothing to say. */
async function campusTrip(g: IndoorGraph, cfg: PlannerConfig, from: CampusLocation, to: CampusLocation, closed?: ReadonlySet<string>): Promise<Trip | undefined> {
  const google = await standInWalks.walk(from, to);
  const r = await campusWalk({ from, to, at: RANKING_AT, closedEdgeIds: closed }, google, standInWalks, cfg, RANKING_AT, g);
  if (!r) return undefined;
  const edges = (r.route?.indoorEdgeIds ?? []).map((id) => g.indexById.get(id)).filter((i): i is number => i !== undefined);
  const rules = r.decision.activatedBy.filter((p) => p.subject.startsWith("building:")).map((p) => p.subject.slice("building:".length));
  return { cost: r.route?.durationSeconds ?? secondsOf(google), edges, through: throughOf(g, edges, from.buildingCode ?? "", to.buildingCode ?? ""), outcome: r.decision.outcome, rules };
}

/**
 * What confirming a target on the ground could change about routing, written as the promotion that would record
 * it: a quarantined or restricted link found usable both ways, or a change of floor found to have a step-free
 * elevator. Undefined when confirming it would only confirm what routing already does.
 */
function openingOf(g: IndoorGraph, t: FieldTarget): { promotion: FieldPromotion; modes: readonly ("winter" | "stepFree")[] } | undefined {
  const indices = t.edgeIds.map((id) => g.indexById.get(id)).filter((i): i is number => i !== undefined);
  if (!indices.length) return undefined;
  const edges = indices.map((i) => {
    const e = g.net.edges[i];
    return { edgeId: g.ids[i], kind: e.kind, between: [g.net.nodes[e.a].building, g.net.nodes[e.b].building] as const };
  });
  const base = { id: `IF_CONFIRMED_${t.id}`, observationIds: [], subject: { edges }, observedOn: "", verifiedBy: [], reviewedAt: "", reviewedBy: "", basis: "" };
  if (t.kind === "VERTICAL") {
    if (indices.every((i) => usableAccess(g.facts[i], false)?.stepFree === true)) return undefined;
    return { promotion: { ...base, claims: { access: { stepFree: true }, vertical: ["ELEVATOR"] } }, modes: ["stepFree"] };
  }
  if ((t.kind === "LINK" || t.kind === "DOOR") && t.entry && t.exit) {
    const restricted = indices.some((i) => {
      const f = g.facts[i];
      return f?.activation === "QUARANTINED" || f?.activation === "EXPERIMENTAL" || Object.values(f?.passage ?? {}).some((p) => p !== "ALLOWED" && p !== "UNKNOWN");
    });
    if (!restricted) return undefined;
    const passage = { [`${t.entry.from}>${t.entry.to}`]: "ALLOWED", [`${t.exit.from}>${t.exit.to}`]: "ALLOWED" } as const;
    return { promotion: { ...base, claims: { activation: "ACTIVE", passage } }, modes: ["winter", "stepFree"] };
  }
  return undefined;
}

/** FNV-1a over a string, twice, as hex: a fingerprint, not a secret. */
function fingerprintOf(text: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b1;
  for (let i = 0; i < text.length; i++) {
    h1 = Math.imul(h1 ^ text.charCodeAt(i), 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ text.charCodeAt(i), 0x01000193) >>> 0;
  }
  return `${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}`;
}

/**
 * Everything the ranking depends on, fingerprinted: the network's segments with their lengths, climbs and
 * geometry and its entry points, the knowledge, the targets, the places, and the constants routing and the
 * ranking use.
 */
export function fieldFingerprint(targets: readonly FieldTarget[], g: IndoorGraph = campusGraph(), cfg: PlannerConfig = DEFAULT_PLANNER_CONFIG): string {
  const k = g.knowledge ?? CAMPUS_KNOWLEDGE;
  const byKey = <V>(m: ReadonlyMap<string, V>) => [...m.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return fingerprintOf(JSON.stringify({
    network: {
      commit: g.net.source.commit,
      edges: g.net.edges.map((e, i) => [g.ids[i], e.kind, e.metres, e.floors, e.path]),
      anchors: g.net.anchors.map((a) => [a.building, a.floor, g.net.nodes[a.node].lat, g.net.nodes[a.node].lng]),
    },
    facts: byKey(k.edgeFacts),
    buildings: byKey(k.buildingFacts),
    historical: k.historical,
    targets: targets.map((t) => [t.id, t.kind, t.building, t.edgeIds, t.nodes.map((n) => n.building), t.entry, t.exit, t.shown.evidence, t.shown.activation, t.current, t.why, t.checks.map((c) => [c.id, c.priority]), t.conflicts.map((c) => c.id)]),
    demand: buildingDemand(g),
    places: placeCodes(g).map((c) => { const b = findBuilding("UW", c); return [c, b?.latitude, b?.longitude]; }),
    constants: {
      LOST_SECONDS, GAINED_SECONDS, STAND_IN_WALK, RANKING_AT: RANKING_AT.toISOString(), EVIDENCE_UNCERTAINTY, RANKING,
      INDOOR_PACE, OUTDOOR_PENALTY, UNKNOWN_HOURS_PASS_THROUGH, CAMPUS_PACE, CAMPUS_UNCERTAINTY_SECONDS, UNKNOWN_ACCESS_SECONDS, CAMPUS_LOOKUPS, GOOGLE_DOOR_METRES, CONNECTOR_CANDIDATES, CONNECTOR_MAX_METRES,
      ALONG_GOOGLE_METRES, DOOR_WALK_GUESS, GOOGLE_WALK_METRES_PER_SECOND,
      margin: cfg.campusShortcutMargin,
    },
  }));
}

/** The buildings a target touches: every building its segments reach, or the one building it is about. */
function buildingsOf(t: FieldTarget): string[] {
  const touched = unique(t.nodes.map((n) => n.building)).filter((b) => b !== OUTSIDE);
  return touched.length ? touched.sort() : t.building ? [t.building] : [];
}

export async function analyseFieldPriorities(targets: readonly FieldTarget[], g: IndoorGraph = campusGraph(), cfg: PlannerConfig = DEFAULT_PLANNER_CONFIG): Promise<FieldPriorities> {
  const k: CampusKnowledge = g.knowledge ?? CAMPUS_KNOWLEDGE;
  const demand = buildingDemand(g);
  const weight = new Map(demand.map((d) => [d.code, d.weight]));
  const places = demand.map((d) => d.code);
  const network = demand.filter((d) => d.onNetwork).map((d) => d.code);
  const location = new Map(places.map((c) => [c, buildingLocation(findBuilding("UW", c)!)!]));
  let total = 0;
  for (const a of places) for (const b of places) if (a !== b) total += weight.get(a)! * weight.get(b)!;
  const tripShare = (a: string, b: string) => (weight.get(a)! * weight.get(b)!) / total;
  const touching = new Map<string, number>();
  /** The share of weighted demand starting or ending at any of these places. */
  const touchingShare = (codes: readonly string[]) => {
    const key = codes.join(",");
    if (!touching.has(key)) {
      const set = new Set(codes);
      let n = 0;
      for (const a of places) for (const b of places) if (a !== b && (set.has(a) || set.has(b))) n += tripShare(a, b);
      touching.set(key, n);
    }
    return touching.get(key)!;
  };

  // Every trip in every kind of routing, and which trips use each segment.
  const base: Record<AnalysisMode, Map<string, Trip | null>> = { campus: new Map(), winter: new Map(), stepFree: new Map() };
  for (const a of places) {
    for (const b of places) {
      if (a === b) continue;
      const trip = await campusTrip(g, cfg, location.get(a)!, location.get(b)!);
      if (trip) base.campus.set(`${a}>${b}`, trip);
    }
  }
  for (const mode of ["winter", "stepFree"] as const) {
    for (const a of network) for (const [b, trip] of networkTripsFrom(g, a, analysisOptions(mode))) base[mode].set(`${a}>${b}`, trip);
  }
  const relied = (mode: AnalysisMode, trip: Trip | null): trip is Trip => Boolean(trip) && !(mode === "campus" && trip!.outcome === "KEPT_GOOGLE");
  const users = {} as Record<AnalysisMode, Map<number, string[]>>;
  for (const mode of ANALYSIS_MODES) {
    users[mode] = new Map();
    for (const [key, trip] of base[mode]) {
      if (!relied(mode, trip)) continue;
      for (const i of unique(trip.edges)) users[mode].set(i, [...(users[mode].get(i) ?? []), key]);
    }
  }
  const pairOf = (key: string) => key.split(">") as [string, string];
  const shareOf = (key: string) => tripShare(...pairOf(key));
  const busiestFirst = (keys: readonly string[]) => [...keys].sort((x, y) => shareOf(y) - shareOf(x) || (x < y ? -1 : 1));
  // Trips that pass through each building, counted once each, with the heavier of the routing kinds that do.
  const passingThrough = new Map<string, Map<string, number>>();
  for (const mode of ["campus", "winter"] as const) {
    for (const [key, trip] of base[mode]) {
      if (!relied(mode, trip)) continue;
      for (const b of trip.through) {
        const trips = passingThrough.get(b) ?? new Map<string, number>();
        trips.set(key, Math.max(trips.get(key) ?? 0, RANKING.modeWeights[mode]));
        passingThrough.set(b, trips);
      }
    }
  }

  interface Raw { t: FieldTarget; metrics: TargetPriority["metrics"]; throughWeighted: number; uRouting: number; uAccess: number; critical: boolean; urgent: boolean; routes: TargetPriority["routes"] }
  const raws: Raw[] = [];
  for (const t of targets) {
    const indices = t.edgeIds.map((id) => g.indexById.get(id)).filter((i): i is number => i !== undefined);
    const closed = new Set(t.edgeIds);
    const metrics: TargetPriority["metrics"] = {};
    const touched = buildingsOf(t).filter((b) => weight.has(b));
    if (touched.length) metrics.buildingShare = round(touchingShare(touched));
    const routes: TargetPriority["routes"] = [];
    let noAllowedWayIn = false;
    if (indices.length) {
      for (const mode of ANALYSIS_MODES) {
        const using = busiestFirst(unique(indices.flatMap((i) => users[mode].get(i) ?? [])));
        for (const key of using) {
          const [from, to] = pairOf(key);
          if (routes.length < 3 && network.includes(from) && network.includes(to) && !routes.some((r) => r.from === from && r.to === to)) routes.push({ from, to, mode });
        }
        const m: ModeMetrics = { usedBy: using.length, share: 0, detour: 0, extraPerTrip: 0, lost: 0, lostShare: 0, gained: 0, gain: 0 };
        const after = new Map<string, Map<string, number | null>>();
        for (const key of using) {
          const [from, to] = pairOf(key);
          const share = shareOf(key);
          m.share += share;
          const was = base[mode].get(key)!;
          let now: number | null;
          if (mode === "campus") {
            const trip = await campusTrip(g, cfg, location.get(from)!, location.get(to)!, closed);
            if (trip?.outcome === "NO_USABLE_ROUTE") noAllowedWayIn = true;
            now = !trip || trip.outcome === "NO_USABLE_ROUTE" ? null : trip.cost;
          } else {
            if (!after.has(from)) after.set(from, networkCostsFrom(g, from, { ...analysisOptions(mode), closedEdgeIds: closed }));
            now = after.get(from)!.get(to) ?? null;
          }
          if (now === null) { m.lost++; m.lostShare += share; m.detour += share * LOST_SECONDS; }
          else m.detour += share * Math.max(0, now - was.cost);
        }
        m.extraPerTrip = m.share > 0 ? round(m.detour / m.share, 1) : 0;
        metrics[mode] = m;
      }
      const opening = openingOf(g, t);
      if (opening) {
        const variant = graphOver(g.net, compileKnowledge(k.research, k.overlay, [...k.promotions, opening.promotion]));
        for (const mode of opening.modes) {
          const m = metrics[mode]!;
          for (const from of network) {
            for (const [to, now] of networkCostsFrom(variant, from, analysisOptions(mode))) {
              if (now === null) continue;
              const was = base[mode].get(`${from}>${to}`);
              const share = tripShare(from, to);
              if (!was) { m.gained++; m.gain += share * GAINED_SECONDS; }
              else if (now < was.cost - 0.5) m.gain += share * (was.cost - now);
            }
          }
        }
      }
      // Known only on evidence routing relies on: a guessed door's catalogue entry does not count.
      metrics.accessUnknown = !indices.some((i) => {
        const access = usableAccess(g.facts[i], false);
        return typeof access?.stepFree === "boolean" || access?.accessibleDesignation === true;
      });
    }
    if (t.kind === "RULE" && t.building) {
      const corrected = [...base.campus].filter(([, trip]) => trip?.outcome === "CORRECTED" && trip.rules?.includes(t.building!)).map(([key]) => key);
      metrics.correctedShare = round(corrected.reduce((n, key) => n + shareOf(key), 0));
      const directions = new Set<"into" | "out of">();
      for (const key of corrected) {
        const [from, to] = pairOf(key);
        if (to === t.building) directions.add("into");
        if (from === t.building) directions.add("out of");
      }
      metrics.correctedDirections = [...directions].sort();
      for (const key of busiestFirst(corrected)) {
        const [from, to] = pairOf(key);
        if (routes.length < 3 && network.includes(from) && network.includes(to)) routes.push({ from, to, mode: "campus" });
      }
    }
    let throughWeighted = 0;
    if (t.kind === "HOURS" && t.building) {
      const trips = [...(passingThrough.get(t.building) ?? new Map<string, number>())];
      metrics.passThroughShare = round(trips.reduce((n, [key]) => n + shareOf(key), 0));
      throughWeighted = trips.reduce((n, [key, w]) => n + shareOf(key) * w, 0);
    }
    for (const mode of ANALYSIS_MODES) {
      const m = metrics[mode];
      if (m) metrics[mode] = { ...m, share: round(m.share), detour: round(m.detour, 3), lostShare: round(m.lostShare), gain: round(m.gain, 3) };
    }
    const urgent = t.checks.some((c) => c.priority === 1);
    const stairwell = t.kind === "VERTICAL" && t.shown.evidence === "SURVEYED";
    const uRouting = Math.min(1, (stairwell ? RANKING.surveyedStairwellUncertainty : EVIDENCE_UNCERTAINTY[t.shown.evidence]) + RANKING.conflictUncertainty * t.conflicts.length + (urgent ? RANKING.urgentCheckUncertainty : 0));
    const confirmedStepFree = indices.length > 0 && indices.every((i) => usableAccess(g.facts[i], false)?.stepFree === true);
    const uAccess = t.kind === "VERTICAL" ? (confirmedStepFree ? EVIDENCE_UNCERTAINTY.FIELD_VERIFIED : 1) : metrics.accessUnknown ? RANKING.unknownAccessUncertainty : EVIDENCE_UNCERTAINTY[t.shown.evidence];
    const critical = (t.kind === "RULE" && (metrics.correctedShare ?? 0) > 0) || noAllowedWayIn;
    raws.push({ t, metrics, throughWeighted, uRouting, uAccess, critical, urgent, routes });
  }

  // Each factor relative to the target that scores highest on it.
  const maxOf = (f: (r: Raw) => number) => Math.max(1e-9, ...raws.map(f));
  const share = (r: Raw, mode: AnalysisMode) => r.metrics[mode]?.share ?? 0;
  const detour = (r: Raw, mode: AnalysisMode) => r.metrics[mode]?.detour ?? 0;
  const maxShare = Object.fromEntries(ANALYSIS_MODES.map((mode) => [mode, maxOf((r) => share(r, mode))])) as Record<AnalysisMode, number>;
  const maxDetour = Object.fromEntries(ANALYSIS_MODES.map((mode) => [mode, maxOf((r) => detour(r, mode))])) as Record<AnalysisMode, number>;
  const maxCorrected = maxOf((r) => r.metrics.correctedShare ?? 0);
  const maxThrough = maxOf((r) => r.throughWeighted);
  const maxBuilding = maxOf((r) => r.metrics.buildingShare ?? 0);
  const gain = (r: Raw) => r.metrics.winter?.gain ?? 0;
  const maxGain = maxOf(gain);
  const stepFreeGain = (r: Raw) => r.metrics.stepFree?.gain ?? 0;
  const maxStepFreeGain = maxOf(stepFreeGain);
  const stepFreeRisk = (r: Raw) => (r.metrics.accessUnknown && r.t.kind !== "VERTICAL" ? share(r, "stepFree") : 0);
  const maxStepFreeRisk = maxOf(stepFreeRisk);

  const out: Record<string, TargetPriority> = {};
  for (const r of raws) {
    const t = r.t;
    const routing = Math.max(
      ...ANALYSIS_MODES.map((mode) => RANKING.modeWeights[mode] * (0.5 * share(r, mode) / maxShare[mode] + 0.5 * detour(r, mode) / maxDetour[mode])),
      (r.metrics.correctedShare ?? 0) / maxCorrected,
      RANKING.hoursRoutingScale * r.throughWeighted / maxThrough,
    );
    const factors = {
      routing: round(routing, 3),
      traffic: round((r.metrics.buildingShare ?? 0) / maxBuilding, 3),
      shortcut: round(gain(r) / maxGain, 3),
      accessibility: round(Math.max(stepFreeGain(r) / maxStepFreeGain, 0.5 * stepFreeRisk(r) / maxStepFreeRisk), 3),
    };
    const w = RANKING.weights;
    const score = round(100 * (w.routing * factors.routing * r.uRouting + w.traffic * factors.traffic * r.uRouting + w.shortcut * factors.shortcut + w.accessibility * factors.accessibility * r.uAccess), 1);
    const unverified = t.shown.evidence !== "FIELD_VERIFIED";
    const interventions = share(r, "campus");
    const flagged = r.urgent || t.conflicts.length > 0 || EVIDENCE_UNCERTAINTY[t.shown.evidence] >= EVIDENCE_UNCERTAINTY.SURVEYED;
    const tier: Tier =
      unverified && (r.critical || (interventions >= RANKING.p0CampusShare && flagged) || score >= RANKING.p0Score) ? "P0"
      : score >= RANKING.p1Score || (unverified && (interventions > 0 || Math.max(factors.routing * r.uRouting, factors.accessibility * r.uAccess, factors.shortcut) >= RANKING.p1Factor)) ? "P1"
      : score >= RANKING.p2Score || share(r, "campus") + share(r, "winter") >= RANKING.p2Share || t.conflicts.length > 0 || t.checks.some((c) => c.priority <= 2) ? "P2"
      : "P3";
    out[t.id] = { tier, score, critical: r.critical, uncertainty: { routing: round(r.uRouting, 2), access: round(r.uAccess, 2) }, factors, metrics: r.metrics, routes: r.routes };
  }

  return {
    fingerprint: fieldFingerprint(targets, g, cfg),
    generatedFrom: { knowledgeReviewedAt: k.overlay.reviewedAt, promotions: k.promotions.length, networkCommit: g.net.source.commit, places: places.length, campusTrips: base.campus.size, networkTrips: base.winter.size },
    demand,
    targets: out,
  };
}

const pct = (x: number) => `${(x * 100).toFixed(x < 0.01 ? 2 : 1)}%`;
const lower = (s: string) => s.toLowerCase().replace(/_/g, " ");
/** Seconds for a sentence: never "0 s" for something that is not nothing. */
const seconds = (x: number) => (x >= 1 ? `${Math.round(x)} s` : x >= 0.05 ? `${x.toFixed(1)} s` : "under 0.1 s");
const joinNames = (names: readonly string[]) => (names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);

/** Why a target ranks where it does, in sentences, from its figures. */
export function priorityReasons(t: FieldTarget, p: TargetPriority): string[] {
  const reasons: string[] = [];
  const m = p.metrics;
  if (m.correctedShare) reasons.push(`UW Go corrects every walk ${joinNames(m.correctedDirections ?? ["into"])} ${t.building} on this rule's word: ${pct(m.correctedShare)} of weighted demand.`);
  const c = m.campus;
  if (c?.usedBy) {
    const without = c.lost ? ` Without it, ${c.lost} of those trips would have no allowed way in, and would fall back to Google's walk with a warning.` : c.extraPerTrip >= 1 ? ` Without it, those trips take ${seconds(c.extraPerTrip)} longer on average.` : " Without it, they have an equally quick way.";
    reasons.push(`UW Go sends ${c.usedBy} trips through it instead of Google's walk (${pct(c.share)} of weighted demand).${without}`);
  }
  const winter = m.winter;
  if (winter?.usedBy) {
    const without = winter.lost ? ` Without it, ${winter.lost} of those trips would have no winter route.` : winter.extraPerTrip >= 1 ? ` Without it, those trips are ${seconds(winter.extraPerTrip)} worse on average, counting each second outside ${OUTDOOR_PENALTY} times.` : " Without it, they have a way round as good.";
    reasons.push(`Winter routes use it for ${winter.usedBy} trips between buildings (${pct(winter.share)} of weighted demand).${without}`);
  }
  if (m.stepFree?.usedBy) reasons.push(`Step-free routes use it for ${m.stepFree.usedBy} trips (${pct(m.stepFree.share)} of weighted demand)${m.accessUnknown && t.kind !== "VERTICAL" ? ", and nothing routing relies on says whether it is step-free" : ""}.`);
  const sf = m.stepFree;
  const averaged = (x: number) => `${seconds(x)} on average over all weighted demand, counting each second outside ${OUTDOOR_PENALTY} times`;
  if (t.kind === "VERTICAL" && sf && (sf.gained || sf.gain)) {
    reasons.push(`If a step-free way between these floors is confirmed here, ${sf.gained ? `${sf.gained} step-free trips with no route today would have one, and ` : ""}step-free routes would improve by ${averaged(sf.gain)}.`);
  }
  if (t.kind !== "VERTICAL" && winter && (winter.gained || winter.gain)) {
    reasons.push(`If it turns out usable, ${winter.gained ? `${winter.gained} trips gain a winter route, and ` : ""}winter routes would improve by ${averaged(winter.gain)}.`);
  }
  if (m.passThroughShare) reasons.push(`Campus decisions or winter routes pass through ${t.building} on ${pct(m.passThroughShare)} of weighted demand.`);
  if (m.buildingShare) reasons.push(`Trips to and from ${joinNames(buildingsOf(t))}: ${pct(m.buildingShare)} of weighted demand.`);
  const urgent = t.checks.filter((x) => x.priority === 1).map((x) => x.id);
  reasons.push(`What UW Go believes rests on ${lower(t.shown.evidence)} evidence${t.conflicts.length ? `, and sources disagree about it (${t.conflicts.map((x) => x.id).join(", ")})` : ""}${urgent.length ? `; a reviewer marked it urgent (${urgent.join(", ")})` : ""}.`);
  return reasons;
}
