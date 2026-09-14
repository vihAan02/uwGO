/**
 * The fastest walk, knowing the campus.
 *
 * Google's walking route runs from one building's campus-map point to another's. It cannot know
 * that PAC's corner doors are exit-only and the way to the gym is in through the Student Life Centre,
 * that a door has been reported locked, or that cutting through a building beats walking round it.
 * This asks the campus network those questions, prices the doors Google cannot see, and decides
 * whether the answer is better enough to take.
 *
 * Every way of making the trip is measured from the same place, floor to floor. A campus route
 * starts at the floor's own point on the network; Google's walk starts at the map point, so it is
 * charged the way from the floor to the surveyed door nearest where its line begins (corridors and
 * stairs, timed over the network), and the same at the far end. Without that, every campus route
 * carried the inside of the building and Google's walk carried nothing, and no shortcut could win.
 *
 * The ways considered:
 * - over the network from floor to floor;
 * - a Google-priced walk from the origin to a door, then the network to the destination's floor
 *   (a nearer door of the destination, or a way in through a neighbouring building);
 * - the network from the origin's floor to a door, then a Google-priced walk to the destination;
 * - a Google-priced walk to a door, through the network, and a Google-priced walk on from another
 *   door: the cut through a building that Google never sees.
 *
 * A door on Google's own line needs no walk of its own: the way to it is Google's walk as far as the
 * door. The other door walks are asked for most promising first, a couple per trip and a few more only
 * while one still looks well worth it, and never when nothing Google could say would change the
 * answer; the memo caches every one for thirty days. When Google's own walk relies on a way in or
 * out that may not be used, or on a door or path reported closed, the best allowed route is taken
 * whatever it costs; if none can be routed, Google's walk stays, with a warning, rather than an
 * invented way in. Otherwise a campus route replaces Google's only when it saves the margin its
 * complexity asks for (`campusShortcutMargin`) and still wins once uncertain doors and links are
 * charged for. A route that only follows the survey's outdoor walkways is a less precise copy of
 * Google's, not a shortcut, and is never taken.
 *
 * Every decision says what activated it and where each door and link it uses comes from (official
 * research, UW Go's review, the WATIsGrass survey, a visit on the ground), so a route can be traced to
 * the evidence it turned on.
 */
import { decode, encode } from "@googlemaps/polyline-codec";
import type { CampusChoice, CampusDecision, CampusInside, CampusLocation, CampusOutcome, CampusProvenance, CampusRejection, LatLng, RouteOption, RouteStep } from "@/domain/types";
import type { PlannerConfig } from "@/domain/config";
import type { BuildingFact, Evidence, Passage } from "@/data/campus";
import { weakerEvidence } from "@/data/campus/types";
import type { IndoorNode } from "@/data/indoor/network";
import { edgeId, edgeLabel } from "@/data/indoor/edgeId";
import { findBuilding } from "@/data/buildings";
import { haversineMeters } from "@/routing/EstimateRoutingProvider";
import { closuresOnRoute, projectOntoPath, type LatLngTuple, type PathProjection } from "./closureGeometry";
import {
  INDOOR_PACE,
  OUTSIDE,
  REFUSAL_TEXT,
  anchorsOf,
  arcsOf,
  campusGraph,
  cheapestReached,
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
  type Search,
} from "./indoorGraph";
import type { ConnectorFetcher } from "./indoorRoute";
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

/**
 * Door walks Google is asked for per trip, beyond its own walk. A door on Google's own line needs none
 * (`ALONG_GOOGLE_METRES`). The rest are asked for most promising first: `calls` of them, and up to
 * `highValueCalls` more while one still looks at least `highValueSeconds` better than anything found, or
 * while correcting a walk that may not be used, which is taken whatever it costs. Each is one cached
 * lookup, priced once for a whole week however many legs consider it.
 */
export const CAMPUS_LOOKUPS = { calls: 2, highValueCalls: 2, highValueSeconds: 60 } as const;

/**
 * A door this near Google's line is on Google's way, and the walk to it is Google's walk as far as the
 * nearest point, then across. Read that way, 2,429 of Google's own door walks came out within 9 s in half
 * the cases and 19 s in nine of ten (September 2026): as close as Google's two directions of a walk agree.
 */
export const ALONG_GOOGLE_METRES = 15;

/**
 * Guessing a door walk before asking Google for it. Within `lineMetres` of Google's line the guess is read
 * off the line, as a walk along it would be (within 25 s in nine of ten cases up to 30 m off); further away
 * it is the straight line `detour` times longer at Google's pace, the median over 2,021 real door walks and
 * far less sure. `slack` is how far a guess may miss what a candidate needs and still be worth a call: set
 * against a search that asks for every door walk that could matter, these keep 93% of the seconds it saves
 * for 1.3 door walks a trip, where a slack of 30 s off the line kept 90%. No door walk came in under the
 * straight line less `floor.metres` (Google's line can stop short of a door) at `floor.metresPerSecond`:
 * what a door walk is sure never to beat.
 */
export const DOOR_WALK_GUESS = {
  lineMetres: 60,
  detour: 1.3,
  slack: { line: 60, far: 90 },
  floor: { metres: 60, metresPerSecond: 1.4 },
} as const;

/** Google's walking pace on campus, the median over 2,021 of its door walks: for the few metres between its line and a door. */
export const GOOGLE_WALK_METRES_PER_SECOND = 1.22;

/** A surveyed door of the building this near where Google's line starts or ends is the door that walk uses. */
export const GOOGLE_DOOR_METRES = 80;

/** Doors this close to the destination are named in the explanation when they could not be used. */
const NEARBY_DOOR_METRES = 200;

/** Reasons worth naming even when Google's walk stood: a restriction or a closure, not a door merely outside routing hours. */
const RESTRICTIONS: ReadonlySet<Refusal> = new Set<Refusal>(["CLOSED", "DIRECTION", "CREDENTIAL", "EMERGENCY_ONLY", "QUARANTINED", "HISTORICAL", "NOT_STEP_FREE", "NOT_INDEPENDENT", "STAIRS", "VERTICAL_UNCONFIRMED"]);

/**
 * What makes Google's walk unusable when it is the door Google's walk uses that is refused: a closure, a
 * direction, a credential, or access the student needs. Not hours (a trip's own ends are never refused
 * by hours), and not doubt about a fact (quarantine or experiment), which is about UW Go's claim, not
 * about the door students walk through today.
 */
const GOOGLE_DOOR_REFUSALS: ReadonlySet<Refusal> = new Set<Refusal>(["CLOSED", "DIRECTION", "CREDENTIAL", "EMERGENCY_ONLY", "NOT_STEP_FREE", "NOT_INDEPENDENT"]);

/**
 * The survey's outdoor walkways are drawn straighter than the paths they follow, so a campus route
 * times them as Google would time the straight line between their ends: Google's walking pace over
 * its usual detour (about 1.4 m/s over 1.3 times the distance). A route that only looks shorter because
 * of how a line was drawn should not beat Google's walk, and a stretch outside that Google could have
 * priced should not beat the walk Google did price.
 */
export const CAMPUS_PACE: Pace = { ...INDOOR_PACE, outdoorMetresPerSecond: 1.05 };

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

/** How hard to look. `exhaustive` asks Google for every door walk that could change the answer: for benchmarks, never for students. */
export interface CampusSearchOptions {
  exhaustive?: boolean;
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
  point: Point;
  building?: string;
  /** The building's points on the network: on the trip's floor when that is known, otherwise every floor. */
  nodes: number[];
  /** The surveyed door Google's walk leaves or arrives by: the building's door nearest that end of Google's line. */
  door?: ExteriorDoor;
}

function tripEnd(loc: CampusLocation, g: IndoorGraph, lineEnd: Point | undefined): TripEnd {
  const point = pointOf(loc);
  if (loc.university !== "UW" || !isOnIndoorNetwork(loc.buildingCode, g)) return { loc, point, nodes: [] };
  const anchors = anchorsOf(loc.buildingCode!, g);
  const onFloor = loc.floor ? anchors.filter((a) => a.floor === loc.floor) : [];
  const near = lineEnd ?? point;
  const door = g.exteriorDoors
    .filter((d) => d.building === loc.buildingCode)
    .map((d) => ({ d, metres: metresBetween(near, nodePoint(g.net.nodes[d.inside])) }))
    .filter((x) => x.metres <= GOOGLE_DOOR_METRES)
    .sort((x, y) => x.metres - y.metres || x.d.inside - y.d.inside)[0]?.d;
  return { loc, point, building: loc.buildingCode, nodes: (onFloor.length ? onFloor : anchors).map((n) => n.id), door };
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
const doorLabel = (g: IndoorGraph, d: ExteriorDoor) => crossingLabel(g, arcInto(g, d));

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

type CandidateKind = "NETWORK" | "ENTRY" | "EXIT" | "THROUGH";

interface Candidate {
  kind: CandidateKind;
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
  /** From where the candidate itself starts. */
  seconds: number;
  /** Floor to floor: `seconds` plus what a start or end at the map point is charged for the inside of the building. */
  total: number;
  /** `total` plus the penalties for uncertain crossings. */
  cost: number;
}

/** Totals for one way of making the trip. */
function candidate(g: IndoorGraph, opts: RouteOptions, inside: { origin: number; destination: number }, parts: Omit<Candidate, "route" | "seconds" | "total" | "cost">, route: IndoorGraphRoute = routeOf(parts.arcs, opts, g, parts.startNode)): Candidate {
  const pace = opts.pace ?? INDOOR_PACE;
  const doors = [parts.lead, parts.tail].filter((c): c is Connector => Boolean(c));
  const outside = doors.reduce((n, c) => n + c.seconds, 0);
  const fixed = outside + doors.length * pace.secondsPerDoor;
  const seconds = fixed + route.seconds;
  // A Google-priced leg starts or ends at the map point, so it carries the same charge for the inside of the building as Google's walk.
  const allowance = (parts.lead ? inside.origin : 0) + (parts.tail ? inside.destination : 0);
  return {
    ...parts,
    route,
    seconds,
    total: seconds + allowance,
    cost: fixed + route.cost + doors.reduce((n, c) => n + crossingCost(g, c.doorIndex, opts), 0) + allowance,
  };
}

/** The edge ids a candidate travels, joining doors included. */
function edgeIdsOf(g: IndoorGraph, c: Candidate): string[] {
  return [...(c.lead ? [g.ids[c.lead.doorIndex]] : []), ...c.route.edgeIds, ...(c.tail ? [g.ids[c.tail.doorIndex]] : [])];
}

/**
 * Buildings a route walks through on the way, other than the ones it starts and ends in: it has a
 * corridor, stairwell or open join inside them, not merely a door touched on the way past.
 */
function passesThrough(route: IndoorGraphRoute, ends: readonly (string | undefined)[]): string[] {
  const inside: string[] = [];
  for (const seg of route.segments) {
    const b = seg.from.building;
    if (b === OUTSIDE || b !== seg.to.building || ends.includes(b)) continue;
    if (inside[inside.length - 1] !== b) inside.push(b);
  }
  return [...new Set(inside)];
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
  return { via: viaOf(g, c), seconds: Math.round(c.seconds), totalSeconds: Math.round(c.total), cost: Math.round(c.cost), evidence, edgeIds: edgeIdsOf(g, c), timing, provenance, surveyedSegments };
}

/**
 * The way in to tell the student: the last door the route goes in by from outside (the one on the
 * final approach, whatever buildings it cut through on the way), or the link it enters the destination
 * by when it never comes outside; the Google-priced door when that is the only door.
 */
function entryLabel(g: IndoorGraph, c: Candidate, building: string | undefined): string | undefined {
  const door = [...c.arcs].reverse().find((a) => g.net.nodes[a.from].building === OUTSIDE && g.net.nodes[a.to].building !== OUTSIDE);
  if (door) return crossingLabel(g, door);
  if (c.lead) return c.lead.doorLabel;
  const link = [...c.arcs].reverse().find((a) => isCrossing(g, a.edge) && g.net.nodes[a.to].building === building);
  return link ? crossingLabel(g, link) : undefined;
}

/** The door a candidate last goes out by, for telling the student. */
function exitLabel(g: IndoorGraph, c: Candidate): string | undefined {
  if (c.tail) return c.tail.doorLabel;
  const door = [...c.arcs].reverse().find((a) => g.net.nodes[a.to].building === OUTSIDE && g.net.nodes[a.from].building !== OUTSIDE);
  return door ? crossingLabel(g, door) : undefined;
}

function stepsOf(g: IndoorGraph, c: Candidate, toName: string): RouteStep[] {
  const steps: RouteStep[] = [];
  const minutes = (s: number) => Math.round(s / 60);
  if (c.lead) steps.push({ mode: "WALK", durationMinutes: minutes(c.lead.seconds), distanceMeters: c.lead.route.distanceMeters, instruction: `Walk to the ${c.lead.doorLabel}` });
  let metres = 0;
  let seconds = 0;
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
    steps.push({ mode: "WALK", durationMinutes: minutes(seconds), distanceMeters: Math.round(metres), instruction: `Walk to ${toName}` });
  }
  return steps;
}

function routeFor(g: IndoorGraph, c: Candidate, req: CampusWalkRequest, decision: CampusDecision, choice: CampusChoice, now: Date): RouteOption {
  // The line: Google's walk to the door, every surveyed segment, Google's walk from the door. A start or
  // end on the network is joined to the building's map point by a straight line inside the building.
  const line: Point[] = [];
  const add = (p: Point) => { const last = line[line.length - 1]; if (!last || last[0] !== p[0] || last[1] !== p[1]) line.push(p); };
  if (c.lead) for (const p of c.lead.line) add(p); else add(c.start);
  if (c.route.segments.length) for (const s of c.route.segments) for (const p of s.path) add(p);
  else add(nodePoint(g.net.nodes[c.startNode]));
  if (c.tail) for (const p of [...c.tail.line].reverse()) add(p); else add(c.end);

  const outsideMetres = (c.lead?.route.distanceMeters ?? 0) + (c.tail?.route.distanceMeters ?? 0) + c.route.outdoorMetres;
  const total = outsideMetres + (c.route.metres - c.route.outdoorMetres);
  return {
    mode: "WALK",
    durationMinutes: Math.max(1, Math.ceil(c.seconds / 60)),
    durationSeconds: Math.round(c.seconds),
    distanceMeters: Math.round(total),
    steps: stepsOf(g, c, req.to.name),
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
async function connector(g: IndoorGraph, fetcher: ConnectorFetcher, place: CampusLocation, door: ExteriorDoor, closed: ReadonlySet<string> | undefined, rejected: CampusRejection[]): Promise<Connector | undefined> {
  const node = g.net.nodes[door.inside];
  const label = doorLabel(g, door);
  // Priced from the place to the door whichever end of the trip it is: one cached walk serves both.
  const route = await fetcher.walk(place, nodeLatLng(node));
  // A straight-line estimate is exactly what a door-level route must never be built on.
  if (!route || route.isEstimate) return undefined;
  const line: Point[] = route.polyline ? decode(route.polyline).map(([lat, lng]) => [lat, lng] as Point) : [pointOf(place), nodePoint(node)];
  if (closed?.size && route.polyline && closuresOnRoute(g.net, line as LatLngTuple[], closed).length) {
    rejected.push({ label: `Walking to the ${label}`, because: "runs along a path reported closed" });
    return undefined;
  }
  return { route, seconds: secondsOf(route), door: node, doorIndex: door.index, doorLabel: label, line };
}

/**
 * A walk to a door on Google's own line, read off Google's walk for the trip rather than asked for: its
 * line as far as the point nearest the door, then across to the door, timed as that share of Google's
 * walk and the metres across at Google's pace. From the place to the door, as every connector runs: a
 * lead is the start of Google's line, a tail the rest of it walked back from the destination.
 */
function alongGoogle(g: IndoorGraph, google: RouteOption, line: Point[], at: PathProjection, door: ExteriorDoor, side: "lead" | "tail"): Connector {
  const node = g.net.nodes[door.inside];
  const share = at.metres > 0 ? at.along / at.metres : 0;
  const seconds = secondsOf(google) * (side === "lead" ? share : 1 - share) + at.off / GOOGLE_WALK_METRES_PER_SECOND;
  const way: Point[] = side === "lead" ? [...line.slice(0, at.segment + 1), at.point] : [...line.slice(at.segment + 1).reverse(), at.point];
  way.push(nodePoint(node));
  const metres = (side === "lead" ? at.along : at.metres - at.along) + at.off;
  return {
    route: { mode: "WALK", durationMinutes: Math.max(1, Math.ceil(seconds / 60)), durationSeconds: Math.round(seconds), distanceMeters: Math.round(metres), polyline: encode(way), provider: google.provider, computedAt: google.computedAt, isEstimate: false },
    seconds,
    door: node,
    doorIndex: door.index,
    doorLabel: doorLabel(g, door),
    line: way,
  };
}

/** Seconds from a trip end's floor to a door of its building (or from the door to the floor), over the network. */
function insideSeconds(search: Search | undefined, door: ExteriorDoor | undefined, pace: Pace): number {
  if (!search || !door) return 0;
  const s = search.seconds.get(door.inside);
  return s === undefined ? 0 : s + pace.secondsPerDoor;
}

/** One door walk of a candidate: known when read off Google's line, otherwise a guess, a floor it cannot beat, and how far the guess may be out. */
interface Leg {
  door: ExteriorDoor;
  known?: Connector;
  guess: number;
  floor: number;
  slack: number;
}

/** A way of making the trip whose door walks may still have to be asked for. */
interface Pending {
  kind: CandidateKind;
  startNode: number;
  endNode: number;
  arcs: Arc[];
  route: IndoorGraphRoute;
  lead?: Leg;
  tail?: Leg;
  through: number;
  eligible: boolean;
  /** Seconds and cost without the door walks still to be asked for. */
  seconds: number;
  cost: number;
  /** Those door walks: guessed, at least, and how far the guess may be out. */
  guess: number;
  floor: number;
  slack: number;
}

/**
 * The campus-aware answer to one walking trip, given Google's walk for it. Undefined when the campus
 * network has nothing to say (the same place or building, or no Google walk to compare with, in which
 * case there is honestly no route to improve on).
 */
export async function campusWalk(req: CampusWalkRequest, google: RouteOption | undefined, fetcher: ConnectorFetcher, cfg: PlannerConfig, now: Date = new Date(), g: IndoorGraph = campusGraph(), search: CampusSearchOptions = {}): Promise<CampusWalk | undefined> {
  if (!google || req.from.id === req.to.id) return undefined;
  const googleLine = google.polyline ? (decode(google.polyline) as Point[]) : undefined;
  const O = tripEnd(req.from, g, googleLine?.[0]);
  const D = tripEnd(req.to, g, googleLine?.[googleLine.length - 1]);
  // Two places off the network can still be joined by a way through a building; the same building is a walk inside it.
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
  const pace = opts.pace ?? INDOOR_PACE;
  const at = req.at.getTime();
  const googleSeconds = secondsOf(google);
  const rejected: CampusRejection[] = [];
  const start = O.point;
  const end = D.point;
  const ends = [O.building, D.building];

  const fromO = O.building ? searchFrom(O.nodes, opts, g) : undefined;
  const toD = D.building ? searchTo(D.nodes, opts, g) : undefined;

  // What Google's walk is charged for the inside of the buildings at its ends, so every way is compared floor to floor.
  const inside: CampusInside = {
    originSeconds: Math.round(insideSeconds(fromO, O.door, pace)),
    destinationSeconds: Math.round(insideSeconds(toD, D.door, pace)),
    ...(O.door ? { originDoor: doorLabel(g, O.door) } : {}),
    ...(D.door ? { destinationDoor: doorLabel(g, D.door) } : {}),
  };
  const insideOf = { origin: inside.originSeconds, destination: inside.destinationSeconds };
  const googleTotal = googleSeconds + inside.originSeconds + inside.destinationSeconds;
  const m = cfg.campusShortcutMargin;
  const marginFor = (through: number) => m.baseSeconds + m.shareOfGoogle * googleSeconds + m.perBuildingSeconds * through;

  // Can Google's walk be used as it is?
  const noEntry = exteriorRestriction(g, D.building, "in");
  const noExit = exteriorRestriction(g, O.building, "out");
  const closedAlong = googleLine && req.closedEdgeIds?.size ? closuresOnRoute(g.net, googleLine as LatLngTuple[], req.closedEdgeIds) : [];
  const doorWhy = (door: ExteriorDoor | undefined, arc: (d: ExteriorDoor) => Arc): Refusal | undefined => {
    const why = door ? refusalFor(g, arc(door), joins, at) : undefined;
    return why && GOOGLE_DOOR_REFUSALS.has(why) ? why : undefined;
  };
  const entryDoorWhy = noEntry ? undefined : doorWhy(D.door, (d) => arcInto(g, d));
  const exitDoorWhy = noExit ? undefined : doorWhy(O.door, (d) => arcOutOf(g, d));
  if (noEntry) rejected.push({ label: `Google's walk to ${D.building}`, because: noEntry.arrivalAdvice, sourceIds: [...noEntry.sourceIds] });
  if (noExit) rejected.push({ label: `Google's walk from ${O.building}`, because: noExit.basis, sourceIds: [...noExit.sourceIds] });
  if (closedAlong.length) rejected.push({ label: "Google's walk", because: "runs along a path reported closed" });
  if (entryDoorWhy) rejected.push({ label: `Google's walk to ${D.building}`, because: `arrives by the ${doorLabel(g, D.door!)}, ${REFUSAL_TEXT[entryDoorWhy]}`, sourceIds: [...(g.facts[D.door!.index]?.sourceIds ?? [])] });
  if (exitDoorWhy) rejected.push({ label: `Google's walk from ${O.building}`, because: `leaves by the ${doorLabel(g, O.door!)}, ${REFUSAL_TEXT[exitDoorWhy]}`, sourceIds: [...(g.facts[O.door!.index]?.sourceIds ?? [])] });
  const googleUsable = !noEntry && !noExit && closedAlong.length === 0 && !entryDoorWhy && !exitDoorWhy;
  // Only a real walk can be beaten by a margin: against a straight-line estimate the numbers mean nothing.
  const bound = googleUsable ? (google.isEstimate ? -Infinity : googleTotal - marginFor(0)) : Infinity;

  const candidates: Candidate[] = [];
  const make = (kind: CandidateKind, parts: Omit<Candidate, "kind" | "start" | "end" | "route" | "seconds" | "total" | "cost">, route?: IndoorGraphRoute) => {
    const c = candidate(g, opts, insideOf, { kind, start, end, ...parts }, route);
    candidates.push(c);
    return c;
  };
  const eligibleRoute = (route: IndoorGraphRoute, arcs: readonly Arc[]) => passesThrough(route, ends).length > 0 || !arcs.some((a) => a.edge.kind === "OUTDOOR");
  // What would be taken, and the cheapest of it so far: nothing a door walk could add has to beat more than that.
  const takeable = (c: Candidate, through: number, eligible: boolean) => !googleUsable || (eligible && googleTotal - c.total >= marginFor(through) && c.cost < googleTotal);
  let cheapestTaken = Infinity;
  const consider = (c: Candidate) => {
    if (takeable(c, passesThrough(c.route, ends).length, eligibleRoute(c.route, c.arcs))) cheapestTaken = Math.min(cheapestTaken, c.cost);
  };

  // Over the network from floor to floor.
  if (fromO && D.building) {
    const target = cheapestReached(D.nodes, fromO.cost);
    if (target !== undefined) {
      const arcs = arcsOf(fromO, target);
      consider(make("NETWORK", { startNode: arcs.length ? arcs[0].from : target, endNode: target, arcs }));
    }
  }

  const usableIn = (d: ExteriorDoor) => !refusalFor(g, arcInto(g, d), joins, at);
  const usableOut = (d: ExteriorDoor) => !refusalFor(g, arcOutOf(g, d), joins, at);
  const doorPoint = (d: ExteriorDoor) => nodePoint(g.net.nodes[d.inside]);

  // Where doors lie against Google's line, when the line can be walked as Google priced it: a real walk, not along a closure.
  const readable = googleLine && googleLine.length >= 2 && !google.isEstimate && closedAlong.length === 0 ? googleLine : undefined;
  const projections = new Map<number, PathProjection>();
  const projection = (d: ExteriorDoor) => {
    if (!readable) return undefined;
    let p = projections.get(d.index);
    if (!p) projections.set(d.index, (p = projectOntoPath(doorPoint(d), readable as LatLngTuple[])));
    return p;
  };
  const legFor = (d: ExteriorDoor, side: "lead" | "tail"): Leg => {
    const straight = metresBetween(side === "lead" ? start : end, doorPoint(d));
    const floor = Math.max(0, straight - DOOR_WALK_GUESS.floor.metres) / DOOR_WALK_GUESS.floor.metresPerSecond;
    const p = projection(d);
    if (p && p.metres > 0 && p.off <= DOOR_WALK_GUESS.lineMetres) {
      if (p.off <= ALONG_GOOGLE_METRES) {
        const known = alongGoogle(g, google, readable!, p, d, side);
        return { door: d, known, guess: known.seconds, floor: known.seconds, slack: 0 };
      }
      const share = side === "lead" ? p.along / p.metres : 1 - p.along / p.metres;
      return { door: d, guess: googleSeconds * share + p.off / GOOGLE_WALK_METRES_PER_SECOND, floor, slack: DOOR_WALK_GUESS.slack.line };
    }
    return { door: d, guess: (straight * DOOR_WALK_GUESS.detour) / GOOGLE_WALK_METRES_PER_SECOND, floor, slack: DOOR_WALK_GUESS.slack.far };
  };

  const pending: Pending[] = [];
  const pend = (kind: CandidateKind, parts: { startNode: number; endNode: number; arcs: Arc[]; lead?: Leg; tail?: Leg }) => {
    const route = routeOf(parts.arcs, opts, g, parts.startNode);
    const legs = [parts.lead, parts.tail].filter((l): l is Leg => Boolean(l));
    const unknown = legs.filter((l) => !l.known);
    const fixed = legs.length * pace.secondsPerDoor + (parts.lead ? insideOf.origin : 0) + (parts.tail ? insideOf.destination : 0) + legs.reduce((n, l) => n + (l.known?.seconds ?? 0), 0);
    pending.push({
      kind,
      ...parts,
      route,
      through: passesThrough(route, ends).length,
      eligible: eligibleRoute(route, parts.arcs),
      seconds: fixed + route.seconds,
      cost: fixed + route.cost + legs.reduce((n, l) => n + crossingCost(g, l.door.index, opts), 0),
      guess: unknown.reduce((n, l) => n + l.guess, 0),
      floor: unknown.reduce((n, l) => n + l.floor, 0),
      slack: unknown.reduce((n, l) => n + l.slack, 0),
    });
  };

  // A Google-priced walk from the origin to a door, then the network to the destination's floor: a nearer
  // door of the destination (Google's walk to the map point may go round the building to reach it), or a
  // way in through a neighbouring building. Doors of the origin's own building are not walked to from
  // outside it. Never when leaving by the origin's map point is what may not be done.
  if (toD && !noExit && !exitDoorWhy) {
    for (const d of g.exteriorDoors) {
      if (d.building === O.building || !toD.seconds.has(d.inside) || !usableIn(d)) continue;
      const arcs = arcsOf(toD, d.inside, true);
      if (arcs[0]?.index === d.index) continue; // in by the door and straight back out: Google's walk with a detour
      pend("ENTRY", { startNode: d.inside, endNode: arcs.length ? arcs[arcs.length - 1].to : d.inside, arcs, lead: legFor(d, "lead") });
    }
  }

  // The network from the origin's floor to a door, then a Google-priced walk to the destination. Never
  // when arriving at the destination's map point is what may not be done: that walk ends at the very
  // doors Google's does.
  if (fromO && !noEntry && !entryDoorWhy) {
    for (const e of g.exteriorDoors) {
      if (e.building === D.building || !fromO.seconds.has(e.inside) || !usableOut(e)) continue;
      const arcs = arcsOf(fromO, e.inside);
      if (arcs[arcs.length - 1]?.index === e.index) continue; // in by the door only to leave by it
      pend("EXIT", { startNode: arcs.length ? arcs[0].from : e.inside, endNode: e.inside, arcs, tail: legFor(e, "tail") });
    }
  }

  // A Google-priced walk to a door, through the network, and a Google-priced walk on from another door:
  // the cut through a building. A pair of doors is searched between only if its door walks, at their
  // floors, could still come in under Google's walk.
  if (!noExit && !exitDoorWhy && !noEntry && !entryDoorWhy && bound > -Infinity) {
    const ins = g.exteriorDoors.filter((d) => d.building !== O.building && d.building !== D.building && usableIn(d)).map((d) => legFor(d, "lead"));
    const outs = g.exteriorDoors.filter((e) => e.building !== O.building && e.building !== D.building && usableOut(e)).map((e) => legFor(e, "tail"));
    const least = (l: Leg) => l.known?.seconds ?? l.floor;
    const leastOut = Math.min(Infinity, ...outs.map(least));
    for (const lead of ins) {
      const before = insideOf.origin + pace.secondsPerDoor + least(lead);
      if (before + pace.secondsPerDoor + leastOut + insideOf.destination > bound) continue;
      const net = searchFrom([lead.door.inside], opts, g);
      for (const tail of outs) {
        if (tail.door.inside === lead.door.inside) continue;
        const through = net.seconds.get(tail.door.inside);
        if (through === undefined || before + through + pace.secondsPerDoor + least(tail) + insideOf.destination > bound) continue;
        const arcs = arcsOf(net, tail.door.inside);
        if (arcs[0]?.index === lead.door.index || arcs[arcs.length - 1]?.index === tail.door.index) continue; // touches a door without going through
        pend("THROUGH", { startNode: lead.door.inside, endNode: tail.door.inside, arcs, lead, tail });
      }
    }
  }

  // Door walks read off Google's line cost nothing: those ways are priced first. The rest are asked for
  // most promising first, and only while one could still be taken: never when even its door walks'
  // floors could not beat what it has to, not when its guesses miss by more than they could be out, and
  // not beyond the calls a trip is allowed unless one still looks well worth it.
  const walks = new Map<string, Promise<Connector | undefined>>();
  const walk = (leg: Leg, side: "lead" | "tail") => {
    const key = `${side}:${leg.door.index}`;
    let w = walks.get(key);
    if (!w) walks.set(key, (w = connector(g, fetcher, side === "lead" ? O.loc : D.loc, leg.door, req.closedEdgeIds, rejected)));
    return w;
  };
  const toAsk = (p: Pending) => [p.lead && !p.lead.known ? `lead:${p.lead.door.index}` : undefined, p.tail && !p.tail.known ? `tail:${p.tail.door.index}` : undefined].filter((k): k is string => Boolean(k) && !walks.has(k!));
  const readOff = (x: Pending) => (!x.lead || Boolean(x.lead.known)) && (!x.tail || Boolean(x.tail.known));
  pending.sort((x, y) => x.cost + x.guess - (y.cost + y.guess) || x.startNode - y.startNode || x.endNode - y.endNode);
  for (const p of pending.filter(readOff)) {
    consider(make(p.kind, { startNode: p.startNode, endNode: p.endNode, arcs: p.arcs, lead: p.lead?.known, tail: p.tail?.known }, p.route));
  }
  if (bound > -Infinity) {
    for (const p of pending.filter((x) => !readOff(x))) {
      if (googleUsable && !p.eligible) continue;
      const need = googleUsable ? googleTotal - marginFor(p.through) : Infinity;
      const under = Math.min(googleUsable ? googleTotal : Infinity, cheapestTaken);
      if (p.seconds + p.floor > need || p.cost + p.floor >= under) continue;
      const calls = toAsk(p);
      if (!search.exhaustive) {
        const room = Math.min(need - (p.seconds + p.guess), under - (p.cost + p.guess));
        if (room < -p.slack) continue;
        // A walk that has to be corrected is taken whatever it costs, so the best allowed way is always worth the extra calls.
        const allowed = CAMPUS_LOOKUPS.calls + (!googleUsable || room >= CAMPUS_LOOKUPS.highValueSeconds ? CAMPUS_LOOKUPS.highValueCalls : 0);
        if (walks.size + calls.length > allowed) continue;
      }
      const lead = p.lead ? (p.lead.known ?? (await walk(p.lead, "lead"))) : undefined;
      const tail = p.tail ? (p.tail.known ?? (await walk(p.tail, "tail"))) : undefined;
      if ((p.lead && !lead) || (p.tail && !tail)) continue;
      consider(make(p.kind, { startNode: p.startNode, endNode: p.endNode, arcs: p.arcs, lead, tail }, p.route));
    }
  }

  // Say which ways in to the destination could not be used, and why. Only doors that would have led
  // there, and, when Google's walk stood anyway, only restrictions and closures: a door that is
  // merely outside routing hours is not news on a trip that did not need it.
  const worthSaying = (why: Refusal) => !googleUsable || RESTRICTIONS.has(why);
  if (toD) {
    const refusedNearby = new Set<string>();
    for (const d of g.exteriorDoors) {
      if (!toD.cost.has(d.inside) || metresBetween(end, doorPoint(d)) > NEARBY_DOOR_METRES) continue;
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
      if (!rejected.some((r) => r.label === label && r.because === because)) rejected.push({ label, because, ...(sources ? { sourceIds: sources.split(",") } : {}) });
    }
  }

  // A shortcut Google cannot see passes through a building, or stays under cover (a bridge or tunnel
  // between the two buildings, a door walk Google priced and the survey only inside); a route that
  // follows the survey's outdoor walkways without passing through anything is Google's walk redrawn.
  const eligible = (c: Candidate) => eligibleRoute(c.route, c.arcs);
  const ranked = candidates
    .map((c) => ({ c, choice: choiceOf(g, c, experimental) }))
    .sort((x, y) => x.c.cost - y.c.cost || x.c.total - y.c.total || x.choice.via.join("|").localeCompare(y.choice.via.join("|")));

  let outcome: CampusOutcome;
  let summary: string;
  let pick: (typeof ranked)[number] | undefined;
  let marginSeconds = Math.round(marginFor(0));
  const warnings: string[] = [];
  if (!googleUsable) {
    pick = ranked[0];
    if (pick) {
      outcome = "CORRECTED";
      const way = entryLabel(g, pick.c, D.building);
      summary = noEntry
        ? `${noEntry.arrivalAdvice.split(". ")[0].replace(/\.$/, "")}.${way ? ` This way goes in through the ${way}.` : ""}`
        : noExit ? `${noExit.basis.split(". ")[0].replace(/\.$/, "")}.`
        : entryDoorWhy ? `The ${doorLabel(g, D.door!)} ${entryDoorWhy === "CLOSED" ? "are reported closed" : `cannot be used to go in (${REFUSAL_TEXT[entryDoorWhy]})`}.${way ? ` This way goes in through the ${way}.` : ""}`
        : exitDoorWhy ? `The ${doorLabel(g, O.door!)} ${exitDoorWhy === "CLOSED" ? "are reported closed" : `cannot be used to go out (${REFUSAL_TEXT[exitDoorWhy]})`}.${exitLabel(g, pick.c) ? ` This way leaves through the ${exitLabel(g, pick.c)}.` : ""}`
        : "Google's walk runs along a path reported closed, so this goes round it.";
    } else {
      outcome = "NO_USABLE_ROUTE";
      summary = "No route through an allowed way in could be found, so this is Google's walk.";
      warnings.push(
        noEntry?.arrivalAdvice
          ?? (closedAlong.length ? "This walk runs along a path reported closed."
          : entryDoorWhy ? `This walk arrives by the ${doorLabel(g, D.door!)}, ${REFUSAL_TEXT[entryDoorWhy]}.`
          : exitDoorWhy ? `This walk leaves by the ${doorLabel(g, O.door!)}, ${REFUSAL_TEXT[exitDoorWhy]}.`
          : noExit!.basis),
      );
    }
  } else {
    outcome = "KEPT_GOOGLE";
    summary = "Google's walk is the fastest way.";
    let best: (typeof ranked)[number] | undefined;
    if (!google.isEstimate) {
      for (const x of ranked) {
        if (!eligible(x.c)) continue;
        const through = passesThrough(x.c.route, ends);
        const margin = marginFor(through.length);
        const benefit = googleTotal - x.c.total;
        best ??= x;
        if (benefit >= margin && x.c.cost < googleTotal) {
          pick = x;
          marginSeconds = Math.round(margin);
          // Through a building, or under cover by a link between the two: a way Google cannot see. Otherwise a
          // door Google priced the walk to: a better way in or out of the same buildings.
          const link = !x.c.lead && !x.c.tail ? x.c.arcs.find((a) => isCrossing(g, a.edge) && g.net.nodes[a.from].building !== OUTSIDE && g.net.nodes[a.to].building !== OUTSIDE) : undefined;
          outcome = through.length || link ? "SHORTCUT" : "BETTER_ENTRANCE";
          summary = through.length
            ? `Through ${through.join(" and ")}: ${formatSeconds(benefit)} quicker than walking round.`
            : link ? `By the ${crossingLabel(g, link)}: ${formatSeconds(benefit)} quicker than walking outside.`
            : x.c.lead && !x.c.tail ? `By the ${entryLabel(g, x.c, D.building) ?? "nearer door"}: ${formatSeconds(benefit)} quicker than Google's walk.`
            : `By the ${exitLabel(g, x.c) ?? "nearer door"}: ${formatSeconds(benefit)} quicker than Google's walk.`;
          break;
        }
      }
    }
    if (!pick && best) {
      const margin = marginFor(passesThrough(best.c.route, ends).length);
      const benefit = googleTotal - best.c.total;
      marginSeconds = Math.round(margin);
      rejected.push({
        label: best.choice.via.join(" → "),
        because: benefit >= margin ? "not better once its uncertain doors and links are counted"
          : benefit > 0 ? `saves only ${formatSeconds(benefit)}, under the ${formatSeconds(margin)} it has to save`
          : `${formatSeconds(-benefit)} slower than Google's walk`,
        seconds: Math.round(best.c.total),
      });
    }
    if (!pick) {
      for (const x of ranked) {
        if (eligible(x.c) || googleTotal - x.c.total < marginFor(0)) continue;
        rejected.push({ label: x.choice.via.join(" → "), because: "follows the survey's outdoor walkways without passing through a building, so it is not a shortcut Google cannot see", seconds: Math.round(x.c.total) });
      }
    }
  }

  // What made Google's walk unusable (the rule, the door, or the closures, also when nothing allowed could be
  // routed and the walk is kept with a warning), or the doors and links of the shortcut. Nothing when
  // Google's walk was usable and kept.
  const activatedBy: CampusProvenance[] = [];
  if (!googleUsable) {
    const noEntryRule = noEntry && D.building ? buildingRuleProvenance(g, D.building) : undefined;
    const noExitRule = noExit && O.building ? buildingRuleProvenance(g, O.building) : undefined;
    if (noEntryRule) activatedBy.push(noEntryRule);
    if (noExitRule) activatedBy.push(noExitRule);
    if (entryDoorWhy) activatedBy.push(segmentProvenance(g, D.door!.index, experimental, doorLabel(g, D.door!)));
    if (exitDoorWhy) activatedBy.push(segmentProvenance(g, O.door!.index, experimental, doorLabel(g, O.door!)));
    if (closedAlong.length || entryDoorWhy === "CLOSED" || exitDoorWhy === "CLOSED") {
      const ids = closedAlong.map((e) => edgeId(g.net, e));
      if (entryDoorWhy === "CLOSED") ids.push(g.ids[D.door!.index]);
      if (exitDoorWhy === "CLOSED") ids.push(g.ids[O.door!.index]);
      activatedBy.push(closuresProvenance([...new Set(ids)]));
    }
  } else if (pick) activatedBy.push(...pick.choice.provenance);

  const decision: CampusDecision = {
    outcome,
    summary,
    marginSeconds,
    googleSeconds: Math.round(googleSeconds),
    inside,
    googleUsable,
    activatedBy,
    chosen: pick?.choice,
    alternatives: ranked.filter((x) => x !== pick).slice(0, 3).map((x) => x.choice),
    rejected,
    warnings,
  };
  return { route: pick ? routeFor(g, pick.c, req, decision, pick.choice, now) : undefined, decision };
}

/** A decision as plain text, for developers: what was taken, what activated it, what it rests on, what was not taken and why. */
export function explainCampusDecision(d: CampusDecision): string {
  const lines: string[] = [];
  const insideTotal = d.inside.originSeconds + d.inside.destinationSeconds;
  const google = d.googleSeconds === undefined ? "" : ` (${formatSeconds(d.googleSeconds)}${insideTotal ? `, ${formatSeconds(d.googleSeconds + insideTotal)} floor to floor` : ""})`;
  const fromFloor = (c: CampusChoice) => (c.totalSeconds !== c.seconds ? ` (${formatSeconds(c.totalSeconds)} floor to floor)` : "");
  if (d.chosen) {
    lines.push("Selected:", ...d.chosen.via.map((v, i) => `${i === 0 ? "  " : "  → "}${v}`));
    lines.push(`because: ${d.summary} Estimated ${formatSeconds(d.chosen.seconds)}${fromFloor(d.chosen)}; weakest evidence ${d.chosen.evidence.toLowerCase().replace(/_/g, " ")}.`);
  } else {
    lines.push(`Selected: Google's walk${google}`, `because: ${d.summary}`);
  }
  if (d.chosen && d.googleUsable) lines.push(`Instead of: Google's walk${google}`);
  if (insideTotal) {
    const parts = [
      d.inside.originSeconds ? `${formatSeconds(d.inside.originSeconds)} to the ${d.inside.originDoor ?? "door"}` : "",
      d.inside.destinationSeconds ? `${formatSeconds(d.inside.destinationSeconds)} from the ${d.inside.destinationDoor ?? "door"}` : "",
    ].filter(Boolean);
    lines.push(`Inside the buildings, charged to Google's walk: ${parts.join(", ")}.`);
  }
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
