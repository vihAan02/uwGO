/**
 * The fastest walk, knowing the campus.
 *
 * Google's walking route runs from one building's campus-map point to another's. It cannot know
 * that PAC's corner doors are exit-only and the way to the gym is in through the Student Life Centre,
 * or that cutting through a building beats walking round it. This asks the campus network those
 * questions, prices the doors Google cannot see, and decides whether the answer is better enough to
 * take:
 *
 * - When Google's walk relies on a way in or out that may not be used, or runs along a path reported
 *   closed, the best allowed route is taken whatever it costs. If none can be routed, Google's walk
 *   stays, with a warning, rather than an invented way in.
 * - Otherwise a campus route replaces Google's only when it saves at least
 *   `campusShortcutMinBenefitSeconds` and still wins once uncertain doors and links are charged for.
 *   It must pass through a building on the way, or use a different door of the destination with
 *   Google timing the whole walk outside: a route that only follows the survey's outdoor walkways is
 *   a less precise copy of Google's, not a shortcut.
 *
 * Google is only asked for walks the winter route already prices (so a cached one costs nothing),
 * and, when Google's own walk cannot be used, for a few walks to allowed entrances. Neither is asked
 * for unless a straight-line lower bound says the answer could matter.
 *
 * Every decision says what activated it and where each door and link it uses comes from (official
 * research, UW Go's review, the WATIsGrass survey, a visit on the ground), so a route can be traced to
 * the evidence it turned on.
 */
import { decode, encode } from "@googlemaps/polyline-codec";
import type { CampusChoice, CampusDecision, CampusLocation, CampusOutcome, CampusProvenance, CampusRejection, LatLng, RouteOption, RouteStep } from "@/domain/types";
import type { PlannerConfig } from "@/domain/config";
import type { BuildingFact, Evidence, Passage } from "@/data/campus";
import { weakerEvidence } from "@/data/campus/types";
import type { IndoorNode } from "@/data/indoor/network";
import { edgeId, edgeLabel } from "@/data/indoor/edgeId";
import { findBuilding } from "@/data/buildings";
import { haversineMeters } from "@/routing/EstimateRoutingProvider";
import { closuresOnRoute, type LatLngTuple } from "./closureGeometry";
import {
  INDOOR_PACE,
  OUTSIDE,
  REFUSAL_TEXT,
  anchorsOf,
  arcsOf,
  campusGraph,
  crossingCost,
  evidenceFor,
  isCrossing,
  isOnIndoorNetwork,
  refusalFor,
  routeOf,
  searchFrom,
  searchTo,
  type AccessNeeds,
  type Arc,
  type ExteriorDoor,
  type IndoorGraph,
  type IndoorGraphRoute,
  type Pace,
  type Refusal,
  type RouteOptions,
} from "./indoorGraph";
import { connectorDoors, type ConnectorFetcher } from "./indoorRoute";
import { PROVENANCE_WORDS, buildingRuleProvenance, closuresProvenance, describeProvenance, provenanceKinds, segmentProvenance } from "./campusProvenance";

/** Seconds charged at each crossing into, out of or between buildings, by how well it is evidenced. */
export const CAMPUS_UNCERTAINTY_SECONDS: Record<Evidence, number> = {
  OFFICIAL: 0,
  FIELD_VERIFIED: 0,
  CORROBORATED: 0,
  SURVEYED: 10,
  INFERRED: 30,
  ANECDOTAL: 45,
  UNRESOLVED: 120,
};

/** Seconds charged at a crossing whose accessibility is undocumented, when the student has access needs. */
export const UNKNOWN_ACCESS_SECONDS = 60;

/** Walks to allowed entrances priced when Google's walk cannot be used as it is. */
export const ENTRANCE_LOOKUPS = 3;

/** Doors this close to the destination are named in the explanation when they could not be used. */
const NEARBY_DOOR_METRES = 200;

/** Reasons worth naming even when Google's walk stood: a restriction or a closure, not a door merely outside routing hours. */
const RESTRICTIONS: ReadonlySet<Refusal> = new Set<Refusal>(["CLOSED", "DIRECTION", "CREDENTIAL", "EMERGENCY_ONLY", "QUARANTINED", "HISTORICAL", "NOT_STEP_FREE", "NOT_INDEPENDENT", "STAIRS", "VERTICAL_UNCONFIRMED"]);

/**
 * The survey's outdoor walkways are drawn straighter than the paths they follow, so a campus route
 * times them at indoor pace rather than a pavement's. A route that only looks shorter because of how
 * a line was drawn should not beat Google's walk.
 */
export const CAMPUS_PACE: Pace = { ...INDOOR_PACE, outdoorMetresPerSecond: INDOOR_PACE.indoorMetresPerSecond };

/** Nothing walks faster than a straight line at a brisk pace: the lower bound for a walk not yet priced. */
const LOWER_BOUND_METRES_PER_SECOND = INDOOR_PACE.outdoorMetresPerSecond;

export interface CampusWalkRequest {
  from: CampusLocation;
  to: CampusLocation;
  /**
   * When the walk is made, which is when the hours of buildings along it matter. For a trip with
   * a deadline that is just before the deadline, not the earliest the student could leave.
   */
  at: Date;
  closedEdgeIds?: ReadonlySet<string>;
  access?: AccessNeeds;
  experimental?: boolean;
}

export interface CampusWalk {
  /** The walk to take instead of Google's. Absent when Google's walk stands. */
  route?: RouteOption;
  decision: CampusDecision;
}

type Point = [number, number];

export const secondsOf = (r: RouteOption): number => r.durationSeconds ?? r.durationMinutes * 60;
const pointOf = (p: { latitude: number; longitude: number }): Point => [p.latitude, p.longitude];
const nodePoint = (n: IndoorNode): Point => [n.lat, n.lng];
const nodeLatLng = (n: IndoorNode): LatLng => ({ latitude: n.lat, longitude: n.lng });
const metresBetween = (a: Point, b: Point) => haversineMeters({ latitude: a[0], longitude: a[1] }, { latitude: b[0], longitude: b[1] });

export function formatSeconds(seconds: number): string {
  const s = Math.round(seconds);
  if (s < 90) return `${s} s`;
  const rest = s % 60;
  return rest ? `${Math.floor(s / 60)} min ${rest} s` : `${s / 60} min`;
}

/** One end of the trip, placed on the campus network when it is inside a building the network has. */
interface TripEnd {
  loc: CampusLocation;
  building?: string;
  /** The building's entry points: on the trip's floor when that is known, otherwise every floor. */
  nodes: number[];
}

function tripEnd(loc: CampusLocation, g: IndoorGraph): TripEnd {
  if (loc.university !== "UW" || !isOnIndoorNetwork(loc.buildingCode, g)) return { loc, nodes: [] };
  const anchors = anchorsOf(loc.buildingCode!, g);
  const onFloor = loc.floor ? anchors.filter((a) => a.floor === loc.floor) : [];
  return { loc, building: loc.buildingCode, nodes: (onFloor.length ? onFloor : anchors).map((n) => n.id) };
}

const RESTRICTIVE: ReadonlySet<Passage> = new Set(["PROHIBITED", "CREDENTIAL", "EMERGENCY_ONLY"]);

/** A building's rule about its map point being used to go in (or out), when that rule forbids it. */
function exteriorRestriction(g: IndoorGraph, building: string | undefined, direction: "in" | "out"): NonNullable<BuildingFact["exterior"]> | undefined {
  const ext = building ? g.knowledge?.buildingFacts.get(building)?.exterior : undefined;
  return ext && RESTRICTIVE.has(ext[direction]) ? ext : undefined;
}

const SIDES = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];

/** Which side of its building a door is on, from the building's campus-map point. */
export function sideOf(node: IndoorNode): string | undefined {
  const b = findBuilding("UW", node.building);
  if (b?.latitude === undefined || b.longitude === undefined) return undefined;
  const dy = node.lat - b.latitude;
  const dx = (node.lng - b.longitude) * Math.cos((b.latitude * Math.PI) / 180);
  if (Math.hypot(dx, dy) < 1e-6) return undefined;
  const bearing = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
  return SIDES[Math.round(bearing / 45) % 8];
}

/** What to call a crossing: the reviewed label when there is one, otherwise what and where it is. */
export function crossingLabel(g: IndoorGraph, arc: Arc): string {
  const fact = g.facts[arc.index];
  if (fact) return fact.label;
  const a = g.net.nodes[arc.edge.a];
  const b = g.net.nodes[arc.edge.b];
  if (a.building === OUTSIDE || b.building === OUTSIDE) {
    const inside = a.building === OUTSIDE ? b : a;
    const side = sideOf(inside);
    return side ? `${inside.building} ${side} doors` : `${inside.building} doors`;
  }
  if (arc.edge.kind === "BRIDGE" || arc.edge.kind === "TUNNEL") return edgeLabel(g.net, arc.edge);
  return `${[a.building, b.building].sort().join("–")} link`;
}

const arcInto = (g: IndoorGraph, d: ExteriorDoor): Arc => g.adj[d.outside].find((a) => a.index === d.index)!;
const arcOutOf = (g: IndoorGraph, d: ExteriorDoor): Arc => g.adj[d.inside].find((a) => a.index === d.index)!;

/** A walk Google priced between a place and a door of the network. */
interface Connector {
  route: RouteOption;
  seconds: number;
  door: IndoorNode;
  doorIndex: number;
  doorLabel: string;
  /** From the place to the door. */
  line: Point[];
}

interface Candidate {
  kind: "NETWORK" | "JOIN" | "ENTRANCE";
  start: Point;
  end: Point;
  startNode: number;
  endNode: number;
  /** Walked before the network: from the start to a door. */
  lead?: Connector;
  /** Walked after the network: from a door to the destination. */
  tail?: Connector;
  arcs: Arc[];
  route: IndoorGraphRoute;
  seconds: number;
  cost: number;
}

/** Totals for one way of making the trip. */
function candidate(g: IndoorGraph, opts: RouteOptions, parts: Omit<Candidate, "route" | "seconds" | "cost">): Candidate {
  const pace = opts.pace ?? INDOOR_PACE;
  const route = routeOf(parts.arcs, opts, g, parts.startNode);
  const insideMetres = (parts.lead ? 0 : metresBetween(parts.start, nodePoint(g.net.nodes[parts.startNode])))
    + (parts.tail ? 0 : metresBetween(nodePoint(g.net.nodes[parts.endNode]), parts.end));
  const doors = [parts.lead, parts.tail].filter((c): c is Connector => Boolean(c));
  const outside = doors.reduce((n, c) => n + c.seconds, 0);
  const fixed = outside + insideMetres / pace.indoorMetresPerSecond + doors.length * pace.secondsPerDoor;
  return {
    ...parts,
    route,
    seconds: fixed + route.seconds,
    cost: fixed + route.cost + doors.reduce((n, c) => n + crossingCost(g, c.doorIndex, opts), 0),
  };
}

/** The edge ids a candidate travels, joining doors included. */
function edgeIdsOf(g: IndoorGraph, c: Candidate): string[] {
  return [...(c.lead ? [g.ids[c.lead.doorIndex]] : []), ...c.route.edgeIds, ...(c.tail ? [g.ids[c.tail.doorIndex]] : [])];
}

/** Buildings a candidate passes through on the way, other than the ones it starts and ends in. */
function passesThrough(c: Candidate, ends: readonly (string | undefined)[]): string[] {
  const inside = [...c.route.buildings];
  if (c.lead && inside[0] !== c.lead.door.building) inside.unshift(c.lead.door.building);
  if (c.tail && inside[inside.length - 1] !== c.tail.door.building) inside.push(c.tail.door.building);
  return inside.filter((b) => !ends.includes(b));
}

function viaOf(g: IndoorGraph, c: Candidate): string[] {
  const via: string[] = [];
  const push = (s: string) => { if (via[via.length - 1] !== s) via.push(s); };
  if (c.lead) { push("outside"); push(c.lead.doorLabel); }
  c.arcs.forEach((arc, i) => {
    const seg = c.route.segments[i];
    if (isCrossing(g, arc.edge)) push(crossingLabel(g, arc));
    else if (arc.edge.kind === "OUTDOOR") push("outside");
    else if (seg.from.building !== OUTSIDE) push(`through ${seg.from.building}`);
  });
  if (c.tail) { push(c.tail.doorLabel); push("outside"); }
  return via;
}

function choiceOf(g: IndoorGraph, c: Candidate, experimental: boolean): CampusChoice {
  const crossings = c.arcs.filter((a) => isCrossing(g, a.edge)).map((a) => a.index);
  for (const conn of [c.lead, c.tail]) if (conn) crossings.push(conn.doorIndex);
  const evidence = crossings.length ? crossings.map((i) => evidenceFor(g, i, experimental)).reduce(weakerEvidence, "OFFICIAL" as Evidence) : "SURVEYED";
  const timing: CampusChoice["timing"] = [];
  if (c.lead) timing.push("GOOGLE");
  if (c.arcs.length) timing.push("SURVEY_GEOMETRY");
  if (!c.lead || !c.tail) timing.push("ESTIMATED");
  if (c.tail) timing.push("GOOGLE");
  // Where each door, link and reviewed segment comes from, in the order walked. Everything else it uses
  // is a corridor or path only the survey describes.
  const provenance: CampusProvenance[] = [];
  const named = new Set<string>();
  const name = (index: number, label?: string) => {
    if (named.has(g.ids[index])) return;
    named.add(g.ids[index]);
    provenance.push(segmentProvenance(g, index, experimental, label));
  };
  if (c.lead) name(c.lead.doorIndex, c.lead.doorLabel);
  for (const arc of c.arcs) {
    if (isCrossing(g, arc.edge)) name(arc.index, crossingLabel(g, arc));
    else if (g.facts[arc.index]) name(arc.index);
  }
  if (c.tail) name(c.tail.doorIndex, c.tail.doorLabel);
  const surveyedSegments = new Set(c.arcs.map((a) => g.ids[a.index]).filter((id) => !named.has(id))).size;
  return { via: viaOf(g, c), seconds: Math.round(c.seconds), cost: Math.round(c.cost), evidence, edgeIds: edgeIdsOf(g, c), timing, provenance, surveyedSegments };
}

/** The door a candidate first goes in by, for telling the student. */
function entryLabel(g: IndoorGraph, c: Candidate, building: string | undefined): string | undefined {
  if (c.lead) return c.lead.doorLabel;
  const door = c.arcs.find((a) => g.net.nodes[a.from].building === OUTSIDE && g.net.nodes[a.to].building !== OUTSIDE);
  if (door) return crossingLabel(g, door);
  const link = [...c.arcs].reverse().find((a) => isCrossing(g, a.edge) && g.net.nodes[a.to].building === building);
  return link ? crossingLabel(g, link) : undefined;
}

function stepsOf(g: IndoorGraph, c: Candidate, toName: string, pace: Pace): RouteStep[] {
  const steps: RouteStep[] = [];
  const minutes = (s: number) => Math.round(s / 60);
  if (c.lead) steps.push({ mode: "WALK", durationMinutes: minutes(c.lead.seconds), distanceMeters: c.lead.route.distanceMeters, instruction: `Walk to the ${c.lead.doorLabel}` });
  let metres = c.lead ? 0 : metresBetween(c.start, nodePoint(g.net.nodes[c.startNode]));
  let seconds = metres / pace.indoorMetresPerSecond;
  c.arcs.forEach((arc, i) => {
    const seg = c.route.segments[i];
    metres += seg.metres;
    seconds += seg.seconds;
    if (!isCrossing(g, arc.edge)) return;
    const label = crossingLabel(g, arc);
    const instruction = seg.from.building === OUTSIDE ? `Go in through the ${label}`
      : seg.to.building === OUTSIDE ? `Leave through the ${label}`
      : `${seg.from.building} → ${seg.to.building}: ${label}`;
    steps.push({ mode: "WALK", durationMinutes: minutes(seconds), distanceMeters: Math.round(metres), instruction });
    metres = 0;
    seconds = 0;
  });
  if (c.tail) {
    if (metres > 0) steps.push({ mode: "WALK", durationMinutes: minutes(seconds), distanceMeters: Math.round(metres), instruction: `Walk to the ${c.tail.doorLabel}` });
    steps.push({ mode: "WALK", durationMinutes: minutes(c.tail.seconds), distanceMeters: c.tail.route.distanceMeters, instruction: `Walk from the ${c.tail.doorLabel} to ${toName}` });
  } else {
    const last = metresBetween(nodePoint(g.net.nodes[c.endNode]), c.end);
    steps.push({ mode: "WALK", durationMinutes: minutes(seconds + last / pace.indoorMetresPerSecond), distanceMeters: Math.round(metres + last), instruction: `Walk to ${toName}` });
  }
  return steps;
}

function routeFor(g: IndoorGraph, c: Candidate, req: CampusWalkRequest, decision: CampusDecision, choice: CampusChoice, pace: Pace, now: Date): RouteOption {
  const line: Point[] = [];
  const add = (p: Point) => { const last = line[line.length - 1]; if (!last || last[0] !== p[0] || last[1] !== p[1]) line.push(p); };
  if (c.lead) for (const p of c.lead.line) add(p); else add(c.start);
  if (c.route.segments.length) for (const s of c.route.segments) for (const p of s.path) add(p);
  else add(nodePoint(g.net.nodes[c.startNode]));
  if (c.tail) for (const p of [...c.tail.line].reverse()) add(p); else add(c.end);

  const insideMetres = (c.lead ? 0 : metresBetween(c.start, nodePoint(g.net.nodes[c.startNode]))) + (c.tail ? 0 : metresBetween(nodePoint(g.net.nodes[c.endNode]), c.end));
  const outsideMetres = (c.lead?.route.distanceMeters ?? 0) + (c.tail?.route.distanceMeters ?? 0) + c.route.outdoorMetres;
  const total = outsideMetres + (c.route.metres - c.route.outdoorMetres) + insideMetres;
  return {
    mode: "WALK",
    durationMinutes: Math.max(1, Math.ceil(c.seconds / 60)),
    durationSeconds: Math.round(c.seconds),
    distanceMeters: Math.round(total),
    steps: stepsOf(g, c, req.to.name, pace),
    polyline: encode(line),
    indoorEdgeIds: choice.edgeIds,
    indoorShare: total > 0 ? Math.round((1 - outsideMetres / total) * 100) / 100 : 0,
    campus: { summary: decision.summary, via: choice.via, evidence: choice.evidence, decision },
    provider: "uw-campus",
    computedAt: now.toISOString(),
    isEstimate: false,
  };
}

/** A walk Google prices from a place to a door, refused when it is a guess or runs along a closed path. */
async function connector(g: IndoorGraph, fetcher: ConnectorFetcher, place: CampusLocation, doorIndex: number, doorNode: IndoorNode, closed: ReadonlySet<string> | undefined, rejected: CampusRejection[]): Promise<Connector | undefined> {
  const door = g.adj[doorNode.id].find((a) => a.index === doorIndex) ?? g.radj[doorNode.id].find((a) => a.index === doorIndex)!;
  const doorLabel = crossingLabel(g, door);
  const route = await fetcher.walk(place, nodeLatLng(doorNode));
  // A straight-line estimate is exactly what a door-level route must never be built on.
  if (!route || route.isEstimate) return undefined;
  const line: Point[] = route.polyline ? decode(route.polyline).map(([lat, lng]) => [lat, lng] as Point) : [pointOf(place), nodePoint(doorNode)];
  if (closed?.size && route.polyline && closuresOnRoute(g.net, line as LatLngTuple[], closed).length) {
    rejected.push({ label: `Walking to the ${doorLabel}`, because: "runs along a path reported closed" });
    return undefined;
  }
  return { route, seconds: secondsOf(route), door: doorNode, doorIndex, doorLabel, line };
}

function cheapest(nodes: readonly number[], cost: ReadonlyMap<number, number>): number | undefined {
  let best: number | undefined;
  for (const n of [...nodes].sort((a, b) => a - b)) {
    const c = cost.get(n);
    if (c !== undefined && (best === undefined || c < cost.get(best)!)) best = n;
  }
  return best;
}

/**
 * The campus-aware answer to one walking trip, given Google's walk for it. Undefined when the campus
 * network has nothing to say (neither end is in a building it knows, the same building, or no Google
 * walk to compare with, in which case there is honestly no route to improve on).
 */
export async function campusWalk(req: CampusWalkRequest, google: RouteOption | undefined, fetcher: ConnectorFetcher, cfg: PlannerConfig, now: Date = new Date(), g: IndoorGraph = campusGraph()): Promise<CampusWalk | undefined> {
  if (!google || req.from.id === req.to.id) return undefined;
  const O = tripEnd(req.from, g);
  const D = tripEnd(req.to, g);
  if (!O.building && !D.building) return undefined;
  if (O.building && O.building === D.building) return undefined;

  const experimental = Boolean(req.experimental);
  const endpoints = [req.from.buildingCode, req.to.buildingCode].filter((b): b is string => Boolean(b));
  // The same filter the winter route joins through, so both price the same doors.
  const joins: RouteOptions = { closedEdgeIds: req.closedEdgeIds, constraints: { at: req.at, endpoints, access: req.access, experimental } };
  const opts: RouteOptions = {
    outdoorPenalty: 1,
    pace: CAMPUS_PACE,
    closedEdgeIds: req.closedEdgeIds,
    constraints: { ...joins.constraints, uncertaintySeconds: CAMPUS_UNCERTAINTY_SECONDS, unknownAccessSeconds: req.access ? UNKNOWN_ACCESS_SECONDS : undefined },
  };
  const at = req.at.getTime();
  const threshold = cfg.campusShortcutMinBenefitSeconds;
  const googleSeconds = secondsOf(google);
  const rejected: CampusRejection[] = [];

  // Can Google's walk be used as it is?
  const noEntry = exteriorRestriction(g, D.building, "in");
  const noExit = exteriorRestriction(g, O.building, "out");
  const closedAlong = google.polyline && req.closedEdgeIds?.size ? closuresOnRoute(g.net, decode(google.polyline) as LatLngTuple[], req.closedEdgeIds) : [];
  if (noEntry) rejected.push({ label: `Google's walk to ${D.building}`, because: noEntry.arrivalAdvice, sourceIds: [...noEntry.sourceIds] });
  if (noExit) rejected.push({ label: `Google's walk from ${O.building}`, because: noExit.basis, sourceIds: [...noExit.sourceIds] });
  if (closedAlong.length) rejected.push({ label: "Google's walk", because: "runs along a path reported closed" });
  const googleUsable = !noEntry && !noExit && closedAlong.length === 0;
  // Only a real walk can be beaten by a margin: against a straight-line estimate the numbers mean nothing.
  const bound = googleUsable ? (google.isEstimate ? -Infinity : googleSeconds - threshold) : Infinity;

  const toD = D.building ? searchTo(D.nodes, opts, g) : undefined;
  const fromO = O.building ? searchFrom(O.nodes, opts, g) : undefined;
  const candidates: Candidate[] = [];
  const start = pointOf(O.loc);
  const end = pointOf(D.loc);

  if (fromO && D.building) {
    const target = cheapest(D.nodes, fromO.cost);
    if (target !== undefined) {
      const arcs = arcsOf(fromO, target);
      candidates.push(candidate(g, opts, { kind: "NETWORK", start, end, startNode: arcs.length ? arcs[0].from : target, endNode: target, arcs }));
    }
  }

  // Joins from a place off the network, priced only where they could win.
  if (!O.building && toD) {
    for (const door of connectorDoors(O.loc, "IN", joins)) {
      const reach = toD.seconds.get(door.node.id);
      if (reach === undefined) continue;
      // A lower bound on the walk's seconds, since nothing reaches the door faster than a straight line.
      if (metresBetween(start, nodePoint(door.node)) / LOWER_BOUND_METRES_PER_SECOND + reach >= bound) continue;
      const lead = await connector(g, fetcher, O.loc, g.indexById.get(door.edgeId)!, door.node, req.closedEdgeIds, rejected);
      if (!lead) continue;
      const arcs = arcsOf(toD, door.node.id, true);
      candidates.push(candidate(g, opts, { kind: "JOIN", start, end, startNode: door.node.id, endNode: arcs.length ? arcs[arcs.length - 1].to : door.node.id, lead, arcs }));
    }
  }
  if (fromO && !D.building) {
    for (const door of connectorDoors(D.loc, "OUT", joins)) {
      const reach = fromO.seconds.get(door.node.id);
      if (reach === undefined) continue;
      if (reach + metresBetween(nodePoint(door.node), end) / LOWER_BOUND_METRES_PER_SECOND >= bound) continue;
      const tail = await connector(g, fetcher, D.loc, g.indexById.get(door.edgeId)!, door.node, req.closedEdgeIds, rejected);
      if (!tail) continue;
      const arcs = arcsOf(fromO, door.node.id);
      candidates.push(candidate(g, opts, { kind: "JOIN", start, end, startNode: arcs.length ? arcs[0].from : door.node.id, endNode: door.node.id, tail, arcs }));
    }
  }

  // Google's walk arrives by a way in that may not be used: price walks to the allowed entrances.
  if ((noEntry || closedAlong.length) && toD) {
    const priced = new Set(candidates.map((c) => c.lead?.door.id));
    const ranked = g.exteriorDoors
      .filter((d) => toD.cost.has(d.inside) && !priced.has(d.inside) && !refusalFor(g, arcInto(g, d), joins, at))
      .map((d) => ({ d, lower: metresBetween(start, nodePoint(g.net.nodes[d.inside])) / LOWER_BOUND_METRES_PER_SECOND + toD.cost.get(d.inside)! }))
      .sort((x, y) => x.lower - y.lower || x.d.inside - y.d.inside)
      .slice(0, ENTRANCE_LOOKUPS);
    for (const { d } of ranked) {
      const node = g.net.nodes[d.inside];
      const lead = await connector(g, fetcher, O.loc, d.index, node, req.closedEdgeIds, rejected);
      if (!lead) continue;
      const arcs = arcsOf(toD, d.inside, true);
      candidates.push(candidate(g, opts, { kind: "ENTRANCE", start, end, startNode: d.inside, endNode: arcs.length ? arcs[arcs.length - 1].to : d.inside, lead, arcs }));
    }
  }
  if ((noExit || closedAlong.length) && fromO) {
    const priced = new Set(candidates.map((c) => c.tail?.door.id));
    const ranked = g.exteriorDoors
      .filter((d) => fromO.cost.has(d.inside) && !priced.has(d.inside) && !refusalFor(g, arcOutOf(g, d), joins, at))
      .map((d) => ({ d, lower: fromO.cost.get(d.inside)! + metresBetween(nodePoint(g.net.nodes[d.inside]), end) / LOWER_BOUND_METRES_PER_SECOND }))
      .sort((x, y) => x.lower - y.lower || x.d.inside - y.d.inside)
      .slice(0, ENTRANCE_LOOKUPS);
    for (const { d } of ranked) {
      const node = g.net.nodes[d.inside];
      const tail = await connector(g, fetcher, D.loc, d.index, node, req.closedEdgeIds, rejected);
      if (!tail) continue;
      const arcs = arcsOf(fromO, d.inside);
      candidates.push(candidate(g, opts, { kind: "ENTRANCE", start, end, startNode: arcs.length ? arcs[0].from : d.inside, endNode: d.inside, tail, arcs }));
    }
  }

  // Say which ways in to the destination could not be used, and why. Only doors that would have led
  // there, and, when Google's walk stood anyway, only restrictions and closures: a door that is
  // merely outside routing hours is not news on a trip that did not need it.
  const worthSaying = (why: Refusal) => !googleUsable || RESTRICTIONS.has(why);
  if (toD) {
    const refusedNearby = new Set<string>();
    for (const d of g.exteriorDoors) {
      if (!toD.cost.has(d.inside) || metresBetween(end, nodePoint(g.net.nodes[d.inside])) > NEARBY_DOOR_METRES) continue;
      const arc = arcInto(g, d);
      const why = refusalFor(g, arc, opts, at);
      if (why && worthSaying(why)) refusedNearby.add(`${crossingLabel(g, arc)}|${REFUSAL_TEXT[why]}|${g.facts[d.index]?.sourceIds.join(",") ?? ""}`);
    }
    for (const n of g.net.nodes.filter((x) => x.building === D.building)) {
      for (const arc of g.radj[n.id]) {
        const from = g.net.nodes[arc.from];
        if (from.building === OUTSIDE || from.building === D.building) continue;
        const why = refusalFor(g, arc, opts, at);
        if (why && worthSaying(why)) refusedNearby.add(`${crossingLabel(g, arc)}|${REFUSAL_TEXT[why]}|${g.facts[arc.index]?.sourceIds.join(",") ?? ""}`);
      }
    }
    for (const entry of [...refusedNearby].sort()) {
      const [label, because, sources] = entry.split("|");
      rejected.push({ label, because, ...(sources ? { sourceIds: sources.split(",") } : {}) });
    }
  }

  const ends = [O.building, D.building];
  const eligible = (c: Candidate) => passesThrough(c, ends).length > 0 || (c.kind !== "NETWORK" && !c.arcs.some((a) => a.edge.kind === "OUTDOOR"));
  const ranked = candidates
    .map((c) => ({ c, choice: choiceOf(g, c, experimental) }))
    .sort((x, y) => x.c.cost - y.c.cost || x.c.seconds - y.c.seconds || x.choice.via.join("|").localeCompare(y.choice.via.join("|")));

  let outcome: CampusOutcome;
  let summary: string;
  let pick: (typeof ranked)[number] | undefined;
  const warnings: string[] = [];
  if (!googleUsable) {
    pick = ranked[0];
    if (pick) {
      outcome = "CORRECTED";
      const way = entryLabel(g, pick.c, D.building);
      summary = noEntry
        ? `${noEntry.arrivalAdvice.split(". ")[0].replace(/\.$/, "")}.${way ? ` This way goes in through the ${way}.` : ""}`
        : noExit ? `${noExit.basis.split(". ")[0].replace(/\.$/, "")}.` : "Google's walk runs along a path reported closed, so this goes round it.";
    } else {
      outcome = "NO_USABLE_ROUTE";
      summary = "No route through an allowed way in could be found, so this is Google's walk.";
      warnings.push(noEntry?.arrivalAdvice ?? (closedAlong.length ? "This walk runs along a path reported closed." : noExit!.basis));
    }
  } else {
    pick = google.isEstimate ? undefined : ranked.find((x) => eligible(x.c));
    const benefit = pick ? googleSeconds - pick.c.seconds : 0;
    if (pick && benefit >= threshold && pick.c.cost < googleSeconds) {
      const through = passesThrough(pick.c, ends);
      outcome = through.length ? "SHORTCUT" : "BETTER_ENTRANCE";
      summary = through.length
        ? `Through ${through.join(" and ")}: ${formatSeconds(benefit)} quicker than walking round.`
        : `By the ${entryLabel(g, pick.c, D.building) ?? "nearer door"}: ${formatSeconds(benefit)} quicker than Google's walk.`;
    } else {
      outcome = "KEPT_GOOGLE";
      summary = "Google's walk is the fastest way.";
      if (pick) {
        rejected.push({
          label: pick.choice.via.join(" → "),
          because: benefit >= threshold ? "not better once its uncertain doors and links are counted"
            : benefit > 0 ? `saves only ${formatSeconds(benefit)}, under the ${threshold} s it has to save`
            : `${formatSeconds(-benefit)} slower than Google's walk`,
          seconds: Math.round(pick.c.seconds),
        });
      }
      for (const x of ranked) {
        if (eligible(x.c) || googleSeconds - x.c.seconds < threshold) continue;
        rejected.push({ label: x.choice.via.join(" → "), because: "follows the survey's outdoor walkways without passing through a building, so it is not a shortcut Google cannot see", seconds: Math.round(x.c.seconds) });
      }
      pick = undefined;
    }
  }

  // What made Google's walk unusable (the rule or the closures, also when nothing allowed could be routed and
  // the walk is kept with a warning), or the doors and links of the shortcut. Nothing when Google's walk was
  // usable and kept.
  const activatedBy: CampusProvenance[] = [];
  if (!googleUsable) {
    const noEntryRule = noEntry && D.building ? buildingRuleProvenance(g, D.building) : undefined;
    const noExitRule = noExit && O.building ? buildingRuleProvenance(g, O.building) : undefined;
    if (noEntryRule) activatedBy.push(noEntryRule);
    if (noExitRule) activatedBy.push(noExitRule);
    if (closedAlong.length) activatedBy.push(closuresProvenance(closedAlong.map((e) => edgeId(g.net, e))));
  } else if (pick) activatedBy.push(...pick.choice.provenance);

  const decision: CampusDecision = {
    outcome,
    summary,
    thresholdSeconds: threshold,
    googleSeconds: Math.round(googleSeconds),
    googleUsable,
    activatedBy,
    chosen: pick?.choice,
    alternatives: ranked.filter((x) => x !== pick).slice(0, 3).map((x) => x.choice),
    rejected,
    warnings,
  };
  return { route: pick ? routeFor(g, pick.c, req, decision, pick.choice, opts.pace ?? INDOOR_PACE, now) : undefined, decision };
}

/** A decision as plain text, for developers: what was taken, what activated it, what it rests on, what was not taken and why. */
export function explainCampusDecision(d: CampusDecision): string {
  const lines: string[] = [];
  const google = d.googleSeconds === undefined ? "" : ` (${formatSeconds(d.googleSeconds)})`;
  if (d.chosen) {
    lines.push("Selected:", ...d.chosen.via.map((v, i) => `${i === 0 ? "  " : "  → "}${v}`));
    lines.push(`because: ${d.summary} Estimated ${formatSeconds(d.chosen.seconds)}; weakest evidence ${d.chosen.evidence.toLowerCase().replace(/_/g, " ")}.`);
  } else {
    lines.push(`Selected: Google's walk${google}`, `because: ${d.summary}`);
  }
  if (d.chosen && d.googleUsable) lines.push(`Instead of: Google's walk${google}`);
  if (d.activatedBy.length) {
    // With a route chosen this is what made UW Go take it; with Google's walk kept, why that walk comes with a warning.
    lines.push("", d.chosen ? "Activated by:" : "Google's walk could not be used because of:", ...d.activatedBy.map((p) => `  ${describeProvenance(p)}`));
  }
  if (d.chosen?.provenance.length) {
    lines.push("", "Resting on:", ...d.chosen.provenance.map((p) => `  ${describeProvenance(p)}`));
    if (d.chosen.surveyedSegments) lines.push(`  and ${d.chosen.surveyedSegments} corridor and path segment${d.chosen.surveyedSegments === 1 ? "" : "s"} only the WATIsGrass survey describes`);
  }
  if (d.chosen) {
    const kinds = provenanceKinds([...d.activatedBy, ...d.chosen.provenance]);
    if (kinds.length) lines.push(`Evidence from: ${kinds.map((k) => PROVENANCE_WORDS[k]).join(" + ")}`);
  }
  for (const r of d.rejected) {
    lines.push("", "Rejected:", `  ${r.label}`, `because: ${r.because}${r.seconds === undefined ? "" : ` (${formatSeconds(r.seconds)})`}${r.sourceIds?.length ? ` [${r.sourceIds.join(", ")}]` : ""}`);
  }
  for (const w of d.warnings) lines.push("", `Warning: ${w}`);
  return lines.join("\n");
}
