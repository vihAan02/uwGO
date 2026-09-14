/**
 * The fastest walk, knowing the campus.
 *
 * Google's walking route runs from one building's campus-map point to another's. It cannot know
 * that PAC's corner doors are exit-only and the way to the gym is in through the Student Life Centre,
 * that a door has been reported locked, or that cutting through a building beats walking round it.
 * This asks the campus network those questions, prices the doors Google cannot see, and decides
 * whether the answer is better enough to take.
 *
 * Every way of making the trip is timed the same way, floor to floor, and that time is what the leg
 * shows, what its departure is worked back from, and what it is chosen by (with uncertain doors and
 * links charged on top for choosing only). A campus route starts at the floor's own point on the
 * network. A walk Google priced from or to a building's map point is joined to the building: where one
 * of its usable doors lies within `ALONG_GOOGLE_METRES` of the walk's line, the student goes between the
 * floor and that door over the network, crosses to the line, and walks only the part of Google's walk
 * beyond that point; where none does, the walk is taken from its own end and the way inside is charged
 * from the door nearest that end, with no connection drawn that nothing describes. Google's own walk,
 * when it stands, is timed and drawn exactly so.
 *
 * The ways considered:
 * - over the network from floor to floor;
 * - a Google-priced walk from the origin to a door, then the network to the destination's floor
 *   (a nearer door of the destination, or a way in through a neighbouring building);
 * - the network from the origin's floor to a door, then a Google-priced walk on from that door;
 * - a Google-priced walk to a door, through the network, and a Google-priced walk on from another
 *   door: the cut through a building that Google never sees.
 *
 * Each door walk is priced in the direction it is walked. A door on Google's own line needs no walk of
 * its own: the way to it is Google's walk as far as the door. The other door walks are asked for most
 * promising first, a couple per trip and a few more only while one still looks well worth it, and never
 * when nothing Google could say would change the answer; the memo caches every one for thirty days.
 * When Google's own walk relies on a way in or out that may not be used, or on a door or path reported
 * closed, the best allowed route is taken whatever it costs, and every legal way in the floors leave in
 * the running is priced; if none can be routed, Google's walk stays, with a warning, rather than an
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
import { closuresOnRoute, edgesCut, projectOntoPath, type LatLngTuple, type PathProjection } from "./closureGeometry";
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
 * `highValueCalls` more while one still looks at least `highValueSeconds` better than anything found.
 * Correcting a walk that may not be used prices the legal ways in its floors leave in the running, however
 * their guesses look, up to `correctionCalls`: over the 47 corrections into PAC with Google's real walks
 * (September 2026) the way taken was never later than the third door walk asked for. Each is one cached
 * lookup, priced once for a whole week however many legs consider it.
 */
export const CAMPUS_LOOKUPS = { calls: 2, highValueCalls: 2, highValueSeconds: 60, correctionCalls: 4 } as const;

/**
 * A door this near a Google walk's line is on Google's way. The walk to it is Google's walk as far as the
 * nearest point, then across: read that way, 2,429 of Google's own door walks came out within 9 s in half
 * the cases and 19 s in nine of ten (September 2026), as close as Google's two directions of a walk agree.
 * It is also how near a building's own door must be to join the building to a walk from its map point.
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

/** A surveyed door of the building this near where Google's line starts or ends is the door that walk uses, when no door lies on the line. */
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

/**
 * A piece of the line drawn for a walk: the survey's corridors and paths, a door's own segment, part of a line
 * Google drew, or a straight step across between one of Google's lines and a door.
 */
export interface DrawnPiece {
  kind: "NETWORK" | "DOOR" | "GOOGLE" | "ACROSS";
  points: [number, number][];
  /** For a step across, the door it steps to or from, by the door segment's canonical id. */
  door?: string;
}

export interface CampusWalk {
  /**
   * The walk to take, timed floor to floor: a campus route, or Google's walk joined to its buildings when
   * that stands. Absent when there is nothing to add to Google's walk as Google gives it.
   */
  route?: RouteOption;
  decision: CampusDecision;
  /** The walk's line piece by piece, for checking that it is drawn only where the trip goes. */
  drawn?: DrawnPiece[];
}

/**
 * How hard to look. `exhaustive` asks Google for every door walk that could change the answer, for
 * benchmarks, never for students. `speculative` prices a trip only to weigh an option the student has not
 * chosen: it uses door walks already priced, and asks for new ones only to correct a walk that may not be used.
 */
export interface CampusSearchOptions {
  exhaustive?: boolean;
  speculative?: boolean;
}

type Point = [number, number];

export const secondsOf = (r: RouteOption): number => r.durationSeconds ?? r.durationMinutes * 60;
const pointOf = (p: { latitude: number; longitude: number }): Point => [p.latitude, p.longitude];
const nodePoint = (n: IndoorNode): Point => [n.lat, n.lng];
const nodeLatLng = (n: IndoorNode): LatLng => ({ latitude: n.lat, longitude: n.lng });
const metresBetween = (a: Point, b: Point) => haversineMeters({ latitude: a[0], longitude: a[1] }, { latitude: b[0], longitude: b[1] });
const lengthOf = (line: readonly Point[]) => line.slice(1).reduce((n, p, i) => n + metresBetween(line[i], p), 0);

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
  /** The surveyed door nearest where Google's line ends at this building: charged when no door lies on the line. */
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

/** Whether the straight step between a door's outside and a point on a line would cut a path, a corridor or a link. */
const stepCuts = (g: IndoorGraph, d: ExteriorDoor, point: Point) => edgesCut(g.net, nodePoint(g.net.nodes[d.outside]), point, new Set([d.index])).length > 0;

/**
 * How a walk Google priced from or to a building's map point meets that building: at a usable door within
 * `ALONG_GOOGLE_METRES` of its line, where the student crosses between the door and the line, or, when none
 * is that near, at the walk's own end, with the way inside charged from the door nearest that end.
 */
interface BuildingJoin {
  door?: ExteriorDoor;
  /** The network between the floor and the door, in the direction walked. Empty when the join is not drawn. */
  arcs: Arc[];
  /** Seconds between the floor and the line: the network, the door, and the metres across. */
  seconds: number;
  /** Where the line is joined; absent when the walk is taken from its own end. */
  at?: PathProjection;
}

/** A walk Google priced between a place and a door of the network, in the direction it is walked. */
interface Connector {
  route: RouteOption;
  /** Google's line for the walk, in the direction walked, and its seconds without any metres across to the door. */
  line: Point[];
  lineSeconds: number;
  /** Metres across between the line and the door: Google's line stops short of a door, or passes it by. */
  across: number;
  exterior: ExteriorDoor;
  doorLabel: string;
  /** How the walk meets the trip's own building at its other end, when that end is a network building's map point. */
  join?: BuildingJoin;
  /** Seconds walked: the join, the part of the line beyond it, and the metres across. */
  seconds: number;
}

type CandidateKind = "NETWORK" | "ENTRY" | "EXIT" | "THROUGH";

interface Candidate {
  kind: CandidateKind;
  startNode: number;
  endNode: number;
  /** Walked before the network: from the start to a door. */
  lead?: Connector;
  /** Walked after the network: from a door to the destination. */
  tail?: Connector;
  arcs: Arc[];
  route: IndoorGraphRoute;
  /** Floor to floor: what the leg shows. */
  seconds: number;
  /** `seconds` plus the penalties for uncertain crossings: what the choice minimises, never what is shown. */
  cost: number;
}

/** Totals for one way of making the trip. */
function candidate(g: IndoorGraph, opts: RouteOptions, parts: Omit<Candidate, "route" | "seconds" | "cost">, route: IndoorGraphRoute = routeOf(parts.arcs, opts, g, parts.startNode)): Candidate {
  const pace = opts.pace ?? INDOOR_PACE;
  const legs = [parts.lead, parts.tail].filter((c): c is Connector => Boolean(c));
  const fixed = legs.reduce((n, c) => n + c.seconds, 0) + legs.length * pace.secondsPerDoor;
  return {
    ...parts,
    route,
    seconds: fixed + route.seconds,
    cost: fixed + route.cost + legs.reduce((n, c) => n + crossingCost(g, c.exterior.index, opts), 0),
  };
}

/** The edge ids a candidate travels, joining doors included. */
function edgeIdsOf(g: IndoorGraph, c: Candidate): string[] {
  return [...(c.lead ? [g.ids[c.lead.exterior.index]] : []), ...c.route.edgeIds, ...(c.tail ? [g.ids[c.tail.exterior.index]] : [])];
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
  for (const conn of [c.lead, c.tail]) if (conn) crossings.push(conn.exterior.index);
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
  if (c.lead) name(c.lead.exterior.index, c.lead.doorLabel);
  for (const arc of c.arcs) {
    if (isCrossing(g, arc.edge)) name(arc.index, crossingLabel(g, arc));
    else if (g.facts[arc.index]) name(arc.index);
  }
  if (c.tail) name(c.tail.exterior.index, c.tail.doorLabel);
  const surveyedSegments = new Set(c.arcs.map((a) => g.ids[a.index]).filter((id) => !named.has(id))).size;
  return { via: viaOf(g, c), seconds: Math.round(c.seconds), cost: Math.round(c.cost), evidence, edgeIds: edgeIdsOf(g, c), timing, provenance, surveyedSegments };
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

/** The points of a line from one place on it to another, or from and to its ends. */
function between(line: readonly Point[], from?: PathProjection, to?: PathProjection): Point[] {
  const points: Point[] = from ? [from.point] : [];
  for (let i = from ? from.segment + 1 : 0; i <= (to ? to.segment : line.length - 1); i++) points.push(line[i]);
  if (to) points.push(to.point);
  return points;
}

/** The corridors and stairs of a way over the network, as points. */
const networkPoints = (g: IndoorGraph, opts: RouteOptions, arcs: readonly Arc[]): Point[] => routeOf(arcs, opts, g).segments.flatMap((s) => s.path);

/** A line built from pieces, without repeating a point where two pieces meet. */
function joinedLine(pieces: readonly DrawnPiece[]): Point[] {
  const line: Point[] = [];
  for (const piece of pieces) {
    for (const p of piece.points) {
      const last = line[line.length - 1];
      if (!last || last[0] !== p[0] || last[1] !== p[1]) line.push(p);
    }
  }
  return line;
}

const piece = (kind: DrawnPiece["kind"], points: readonly Point[], door?: string): DrawnPiece[] => (points.length ? [{ kind, points: [...points], ...(door ? { door } : {}) }] : []);

/** A door's own segment, walked out of its building or into it. */
function doorWay(g: IndoorGraph, d: ExteriorDoor, out: boolean): Point[] {
  const e = g.net.edges[d.index];
  const inToOut = (e.a === d.inside ? e.path : [...e.path].reverse()) as Point[];
  return out ? inToOut : [...inToOut].reverse();
}

/** From the floor out through a door of the trip's building and across to where a walk is joined; nothing when the walk is taken from its own start. */
function joinOut(g: IndoorGraph, opts: RouteOptions, join: BuildingJoin | undefined): DrawnPiece[] {
  if (!join?.at || !join.door) return [];
  const way = doorWay(g, join.door, true);
  return [...piece("NETWORK", networkPoints(g, opts, join.arcs)), ...piece("DOOR", way), ...piece("ACROSS", [way[way.length - 1], join.at.point], g.ids[join.door.index])];
}

/** From where a walk is joined across to a door of the trip's building and in to the floor; nothing when the walk is taken to its own end. */
function joinIn(g: IndoorGraph, opts: RouteOptions, join: BuildingJoin | undefined): DrawnPiece[] {
  if (!join?.at || !join.door) return [];
  const way = doorWay(g, join.door, false);
  return [...piece("ACROSS", [join.at.point, way[0]], g.ids[join.door.index]), ...piece("DOOR", way), ...piece("NETWORK", networkPoints(g, opts, join.arcs))];
}

/** A walk to a door of the network: out of the trip's building where it is joined, Google's line, across to the door, and in. */
function leadPieces(g: IndoorGraph, opts: RouteOptions, lead: Connector): DrawnPiece[] {
  const line = lead.join?.at ? between(lead.line, lead.join.at) : lead.line;
  const way = doorWay(g, lead.exterior, false);
  return [...joinOut(g, opts, lead.join), ...piece("GOOGLE", line), ...piece("ACROSS", [line[line.length - 1], way[0]], g.ids[lead.exterior.index]), ...piece("DOOR", way)];
}

/** A walk from a door of the network: out of the door, across to Google's line, and in to the trip's building where it is joined. */
function tailPieces(g: IndoorGraph, opts: RouteOptions, tail: Connector): DrawnPiece[] {
  const line = tail.join?.at ? between(tail.line, undefined, tail.join.at) : tail.line;
  const way = doorWay(g, tail.exterior, true);
  return [...piece("DOOR", way), ...piece("ACROSS", [way[way.length - 1], line[0]], g.ids[tail.exterior.index]), ...piece("GOOGLE", line), ...joinIn(g, opts, tail.join)];
}

/** The line of a campus route: out from the floor (over the network, or joined to the walk it starts with), every surveyed segment, and in to the floor. */
function candidatePieces(g: IndoorGraph, opts: RouteOptions, c: Candidate): DrawnPiece[] {
  return [
    ...(c.lead ? leadPieces(g, opts, c.lead) : []),
    ...piece("NETWORK", c.route.segments.length ? c.route.segments.flatMap((s) => s.path) : [nodePoint(g.net.nodes[c.startNode])]),
    ...(c.tail ? tailPieces(g, opts, c.tail) : []),
  ];
}

/** Google's own walk as the student makes it: out from the floor to where it is joined, Google's line between, and in to the floor. */
function googlePieces(g: IndoorGraph, opts: RouteOptions, line: readonly Point[] | undefined, origin: BuildingJoin | undefined, destination: BuildingJoin | undefined): DrawnPiece[] {
  if (!line || line.length < 2) return [];
  return [...joinOut(g, opts, origin), ...piece("GOOGLE", between(line, origin?.at, destination?.at)), ...joinIn(g, opts, destination)];
}

const joinMetres = (g: IndoorGraph, opts: RouteOptions, join: BuildingJoin | undefined) => (join?.at ? routeOf(join.arcs, opts, g).metres : 0);

function routeFor(g: IndoorGraph, opts: RouteOptions, c: Candidate, req: CampusWalkRequest, decision: CampusDecision, choice: CampusChoice, drawn: readonly DrawnPiece[], building: RouteOption["buildingSeconds"], now: Date): RouteOption {
  // The line is where the student walks. Nothing is drawn to a building's map point.
  const line = joinedLine(drawn);
  const metres = lengthOf(line);
  const insideMetres = c.route.metres - c.route.outdoorMetres + joinMetres(g, opts, c.lead?.join) + joinMetres(g, opts, c.tail?.join);
  return {
    mode: "WALK",
    durationMinutes: Math.max(1, Math.ceil(c.seconds / 60)),
    durationSeconds: Math.round(c.seconds),
    distanceMeters: Math.round(metres),
    steps: stepsOf(g, c, req.to.name),
    polyline: encode(line),
    indoorEdgeIds: choice.edgeIds,
    indoorShare: metres > 0 ? Math.round(Math.min(1, insideMetres / metres) * 100) / 100 : 0,
    campus: { summary: decision.summary, via: choice.via, evidence: choice.evidence, decision },
    buildingSeconds: building,
    provider: "uw-campus",
    computedAt: now.toISOString(),
    isEstimate: false,
  };
}

/**
 * Google's walk timed floor to floor, and drawn so. Its steps stay Google's, and it carries no campus note:
 * nothing about it is a way Google could not see.
 */
function googleRouteFor(google: RouteOption, drawn: readonly DrawnPiece[], seconds: number, building: RouteOption["buildingSeconds"]): RouteOption {
  const line = drawn.length ? joinedLine(drawn) : undefined;
  return {
    mode: "WALK",
    durationMinutes: Math.max(1, Math.ceil(seconds / 60)),
    durationSeconds: Math.round(seconds),
    distanceMeters: line ? Math.round(lengthOf(line)) : google.distanceMeters,
    steps: google.steps,
    polyline: line ? encode(line) : google.polyline,
    buildingSeconds: building,
    provider: google.provider,
    computedAt: google.computedAt,
    isEstimate: google.isEstimate,
  };
}

/**
 * A walk Google prices between a place and a door, in the direction it is walked: from the place to the
 * door going in, from the door to the place coming out. Refused when it is a guess or runs along a closed path.
 */
async function connector(g: IndoorGraph, fetcher: ConnectorFetcher, end: TripEnd, door: ExteriorDoor, side: "lead" | "tail", closed: ReadonlySet<string> | undefined, rejected: CampusRejection[]): Promise<Connector | undefined> {
  const node = g.net.nodes[door.inside];
  const label = doorLabel(g, door);
  const route = side === "lead" ? await fetcher.walk(end.loc, nodeLatLng(node)) : await fetcher.walk(nodeLatLng(node), end.loc);
  // A straight-line estimate is exactly what a door-level route must never be built on.
  if (!route || route.isEstimate) return undefined;
  const line: Point[] = route.polyline ? (decode(route.polyline) as Point[]) : side === "lead" ? [end.point, nodePoint(node)] : [nodePoint(node), end.point];
  if (closed?.size && route.polyline && closuresOnRoute(g.net, line as LatLngTuple[], closed).length) {
    rejected.push({ label: `Walking ${side === "lead" ? "to" : "from"} the ${label}`, because: "runs along a path reported closed" });
    return undefined;
  }
  // Google's line stops where its paths do, short of the door: the step between is walked, and timed, too. A
  // step that would cut a path or a building to reach the door is no way to it.
  const doorEnd = side === "lead" ? line[line.length - 1] : line[0];
  if (route.polyline && stepCuts(g, door, doorEnd)) return undefined;
  const across = metresBetween(doorEnd, nodePoint(node));
  return { route, line, lineSeconds: secondsOf(route), across, exterior: door, doorLabel: label, seconds: secondsOf(route) + across / GOOGLE_WALK_METRES_PER_SECOND };
}

/**
 * A walk to or from a door on Google's own line, read off Google's walk for the trip rather than asked for:
 * a lead is Google's line up to the point nearest the door, a tail Google's line on from that point, each
 * timed as that share of Google's walk, with the metres across to the door at Google's pace.
 */
function alongGoogle(g: IndoorGraph, google: RouteOption, line: readonly Point[], at: PathProjection, door: ExteriorDoor, side: "lead" | "tail"): Connector {
  const node = g.net.nodes[door.inside];
  const share = at.metres > 0 ? at.along / at.metres : 0;
  const lineSeconds = secondsOf(google) * (side === "lead" ? share : 1 - share);
  const part = side === "lead" ? between(line, undefined, at) : between(line, at);
  const seconds = lineSeconds + at.off / GOOGLE_WALK_METRES_PER_SECOND;
  const way = side === "lead" ? [...part, nodePoint(node)] : [nodePoint(node), ...part];
  const metres = (side === "lead" ? at.along : at.metres - at.along) + at.off;
  return {
    route: { mode: "WALK", durationMinutes: Math.max(1, Math.ceil(seconds / 60)), durationSeconds: Math.round(seconds), distanceMeters: Math.round(metres), polyline: encode(way), provider: google.provider, computedAt: google.computedAt, isEstimate: false },
    line: part,
    lineSeconds,
    across: at.off,
    exterior: door,
    doorLabel: doorLabel(g, door),
    seconds,
  };
}

/** Seconds from a trip end's floor to a door of its building (or from the door to the floor), over the network. */
function insideSeconds(search: Search | undefined, door: ExteriorDoor | undefined, pace: Pace): number {
  if (!search || !door) return 0;
  const s = search.seconds.get(door.inside);
  return s === undefined ? 0 : s + pace.secondsPerDoor;
}

/** A door of the trip's own building a walk can be joined at, and the seconds between it and the floor, the door included. */
interface OwnDoor {
  d: ExteriorDoor;
  inside: number;
}

/**
 * Where a walk meets the trip's building at one end of its line (the start at the origin, the end at the
 * destination), and the seconds of the line walked: from the join on, or the whole line when it is taken
 * from its own end.
 */
function joinBuilding(g: IndoorGraph, end: TripEnd, search: Search, doors: readonly OwnDoor[], line: readonly Point[] | undefined, side: "origin" | "destination", lineSeconds: number, pace: Pace): { join: BuildingJoin; walked: number } {
  let best: { own: OwnDoor; at: PathProjection; seconds: number; walked: number } | undefined;
  if (line && line.length >= 2) {
    for (const own of doors) {
      const at = projectOntoPath(nodePoint(g.net.nodes[own.d.inside]), line as LatLngTuple[]);
      if (at.off > ALONG_GOOGLE_METRES || at.metres <= 0 || stepCuts(g, own.d, at.point)) continue;
      const walked = lineSeconds * (side === "origin" ? 1 - at.along / at.metres : at.along / at.metres);
      const seconds = own.inside + at.off / GOOGLE_WALK_METRES_PER_SECOND;
      const better = !best || seconds + walked < best.seconds + best.walked || (seconds + walked === best.seconds + best.walked && own.d.inside < best.own.d.inside);
      if (better) best = { own, at, seconds, walked };
    }
  }
  if (!best) return { join: { door: end.door, arcs: [], seconds: insideSeconds(search, end.door, pace) }, walked: lineSeconds };
  const arcs = side === "origin" ? arcsOf(search, best.own.d.inside) : arcsOf(search, best.own.d.inside, true);
  return { join: { door: best.own.d, arcs, seconds: best.seconds, at: best.at }, walked: best.walked };
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
  /** Those door walks, with the trip's buildings at their other ends: guessed, at least, and how far the guess may be out. */
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
  const usableIn = (d: ExteriorDoor) => !refusalFor(g, arcInto(g, d), joins, at);
  const usableOut = (d: ExteriorDoor) => !refusalFor(g, arcOutOf(g, d), joins, at);
  const doorPoint = (d: ExteriorDoor) => nodePoint(g.net.nodes[d.inside]);

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

  // Where doors lie against Google's line, when the line can be walked as Google priced it: a real walk, not along a closure.
  const readable = googleLine && googleLine.length >= 2 && !google.isEstimate && closedAlong.length === 0 ? googleLine : undefined;

  // The trip's own buildings: the doors a walk from or to their map points can be joined at.
  const exits: OwnDoor[] = fromO ? g.exteriorDoors.filter((d) => d.building === O.building && fromO.seconds.has(d.inside) && usableOut(d)).map((d) => ({ d, inside: fromO.seconds.get(d.inside)! + pace.secondsPerDoor })) : [];
  const entries: OwnDoor[] = toD ? g.exteriorDoors.filter((d) => d.building === D.building && toD.seconds.has(d.inside) && usableIn(d)).map((d) => ({ d, inside: toD.seconds.get(d.inside)! + pace.secondsPerDoor })) : [];

  // Google's walk floor to floor: joined to both buildings on its own line. Two joins must leave some of the
  // walk between them; where they would cross, the end that gains less is taken from the line's own end.
  let googleOrigin = fromO ? joinBuilding(g, O, fromO, exits, readable, "origin", googleSeconds, pace).join : undefined;
  let googleDestination = toD ? joinBuilding(g, D, toD, entries, readable, "destination", googleSeconds, pace).join : undefined;
  const unjoined = (trip: TripEnd, s: Search | undefined): BuildingJoin => ({ door: trip.door, arcs: [], seconds: insideSeconds(s, trip.door, pace) });
  const lineShare = (o: BuildingJoin | undefined, d: BuildingJoin | undefined) => {
    const metres = o?.at?.metres ?? d?.at?.metres ?? 0;
    return metres > 0 ? ((d?.at?.along ?? metres) - (o?.at?.along ?? 0)) / metres : 1;
  };
  const googleTimed = (o: BuildingJoin | undefined, d: BuildingJoin | undefined) => (o?.seconds ?? 0) + googleSeconds * lineShare(o, d) + (d?.seconds ?? 0);
  if (googleOrigin?.at && googleDestination?.at && googleOrigin.at.along >= googleDestination.at.along) {
    if (googleTimed(googleOrigin, unjoined(D, toD)) <= googleTimed(unjoined(O, fromO), googleDestination)) googleDestination = unjoined(D, toD);
    else googleOrigin = unjoined(O, fromO);
  }
  const googleTotal = googleTimed(googleOrigin, googleDestination);
  const inside: CampusInside = {
    originSeconds: Math.round(googleOrigin?.seconds ?? 0),
    destinationSeconds: Math.round(googleDestination?.seconds ?? 0),
    ...(googleOrigin?.door ? { originDoor: doorLabel(g, googleOrigin.door) } : {}),
    ...(googleDestination?.door ? { destinationDoor: doorLabel(g, googleDestination.door) } : {}),
    ...(googleOrigin?.at ? { originJoined: true } : {}),
    ...(googleDestination?.at ? { destinationJoined: true } : {}),
  };
  const m = cfg.campusShortcutMargin;
  const marginFor = (through: number) => m.baseSeconds + m.shareOfGoogle * googleSeconds + m.perBuildingSeconds * Math.min(through, m.buildingsCharged);
  // Only a real walk can be beaten by a margin: against a straight-line estimate the numbers mean nothing.
  const bound = googleUsable ? (google.isEstimate ? -Infinity : googleTotal - marginFor(0)) : Infinity;

  const candidates: Candidate[] = [];
  const make = (kind: CandidateKind, parts: Omit<Candidate, "kind" | "route" | "seconds" | "cost">, route?: IndoorGraphRoute) => {
    const c = candidate(g, opts, { kind, ...parts }, route);
    candidates.push(c);
    return c;
  };
  const eligibleRoute = (route: IndoorGraphRoute, arcs: readonly Arc[]) => passesThrough(route, ends).length > 0 || !arcs.some((a) => a.edge.kind === "OUTDOOR");
  // What would be taken, and the cheapest of it so far: nothing a door walk could add has to beat more than that.
  const takeable = (c: Candidate, through: number, eligible: boolean) => !googleUsable || (eligible && googleTotal - c.seconds >= marginFor(through) && c.cost < googleTotal);
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

  // A walk read off Google's line or priced by Google, joined to the trip's building at its map-point end.
  const joined = (c: Connector, side: "lead" | "tail"): Connector => {
    const trip = side === "lead" ? O : D;
    const s = side === "lead" ? fromO : toD;
    if (!trip.building || !s) return c;
    // A walk Google drew no line for is not joined along a line nobody walks.
    const { join, walked } = joinBuilding(g, trip, s, side === "lead" ? exits : entries, c.route.polyline ? c.line : undefined, side === "lead" ? "origin" : "destination", c.lineSeconds, pace);
    return { ...c, join, seconds: join.seconds + walked + c.across / GOOGLE_WALK_METRES_PER_SECOND };
  };

  const projections = new Map<number, PathProjection>();
  const projection = (d: ExteriorDoor) => {
    if (!readable) return undefined;
    let p = projections.get(d.index);
    if (!p) {
      p = projectOntoPath(doorPoint(d), readable as LatLngTuple[]);
      projections.set(d.index, p);
    }
    return p;
  };
  const floorOf = (metres: number) => Math.max(0, metres - DOOR_WALK_GUESS.floor.metres) / DOOR_WALK_GUESS.floor.metresPerSecond;
  const legFor = (d: ExteriorDoor, side: "lead" | "tail"): Leg => {
    const place = side === "lead" ? start : end;
    const own = side === "lead" ? exits : entries;
    const allowance = side === "lead" ? insideSeconds(fromO, O.door, pace) : insideSeconds(toD, D.door, pace);
    const straight = metresBetween(place, doorPoint(d));
    // Never under the walk from the map point with nothing charged inside, nor under leaving by one of the building's own doors near the line.
    const floor = Math.min(floorOf(straight), ...own.map((x) => x.inside + floorOf(metresBetween(doorPoint(x.d), doorPoint(d)) - ALONG_GOOGLE_METRES)));
    const p = projection(d);
    if (p && p.metres > 0 && p.off <= DOOR_WALK_GUESS.lineMetres) {
      // Read off the line only where the step from the line to the door cuts nothing on the way.
      if (p.off <= ALONG_GOOGLE_METRES && !stepCuts(g, d, p.point)) {
        const known = joined(alongGoogle(g, google, readable!, p, d, side), side);
        return { door: d, known, guess: known.seconds, floor: known.seconds, slack: 0 };
      }
      const share = side === "lead" ? p.along / p.metres : 1 - p.along / p.metres;
      return { door: d, guess: allowance + googleSeconds * share + p.off / GOOGLE_WALK_METRES_PER_SECOND, floor, slack: DOOR_WALK_GUESS.slack.line };
    }
    return { door: d, guess: allowance + (straight * DOOR_WALK_GUESS.detour) / GOOGLE_WALK_METRES_PER_SECOND, floor, slack: DOOR_WALK_GUESS.slack.far };
  };

  const pending: Pending[] = [];
  const pend = (kind: CandidateKind, parts: { startNode: number; endNode: number; arcs: Arc[]; lead?: Leg; tail?: Leg }) => {
    const route = routeOf(parts.arcs, opts, g, parts.startNode);
    const legs = [parts.lead, parts.tail].filter((l): l is Leg => Boolean(l));
    const unknown = legs.filter((l) => !l.known);
    const fixed = legs.length * pace.secondsPerDoor + legs.reduce((n, l) => n + (l.known?.seconds ?? 0), 0);
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

  // The network from the origin's floor to a door, then a Google-priced walk on from it. Never when
  // arriving at the destination's map point is what may not be done: that walk ends at the very doors
  // Google's does.
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
      const before = pace.secondsPerDoor + least(lead);
      if (before + pace.secondsPerDoor + leastOut > bound) continue;
      const net = searchFrom([lead.door.inside], opts, g);
      for (const tail of outs) {
        if (tail.door.inside === lead.door.inside) continue;
        const through = net.seconds.get(tail.door.inside);
        if (through === undefined || before + through + pace.secondsPerDoor + least(tail) > bound) continue;
        const arcs = arcsOf(net, tail.door.inside);
        if (arcs[0]?.index === lead.door.index || arcs[arcs.length - 1]?.index === tail.door.index) continue; // touches a door without going through
        pend("THROUGH", { startNode: lead.door.inside, endNode: tail.door.inside, arcs, lead, tail });
      }
    }
  }

  // Door walks read off Google's line cost nothing: those ways are priced first. The rest are asked for
  // most promising first, and only while one could still be taken: never when even its door walks'
  // floors could not beat what it has to, not when its guesses miss by more than they could be out, and
  // not beyond the calls a trip is allowed unless one still looks well worth it. A walk that has to be
  // corrected prices every legal way in its floors leave in the running, whatever its guess, up to a limit.
  const walks = new Map<string, Promise<Connector | undefined>>();
  const walkKey = (leg: Leg, side: "lead" | "tail") => `${side}:${leg.door.index}`;
  const walk = (leg: Leg, side: "lead" | "tail") => {
    const key = walkKey(leg, side);
    let w = walks.get(key);
    if (!w) {
      w = connector(g, fetcher, side === "lead" ? O : D, leg.door, side, req.closedEdgeIds, rejected).then((c) => c && joined(c, side));
      walks.set(key, w);
    }
    return w;
  };
  // The door walks a candidate still needs, and whether each was priced before, for this trip or another.
  const toAsk = (p: Pending) => (["lead", "tail"] as const).flatMap((side) => {
    const leg = side === "lead" ? p.lead : p.tail;
    if (!leg || leg.known || walks.has(walkKey(leg, side))) return [];
    const door = nodeLatLng(g.net.nodes[leg.door.inside]);
    return [{ side, priced: Boolean(side === "lead" ? fetcher.priced?.(O.loc, door) : fetcher.priced?.(door, D.loc)) }];
  });
  let unpricedAsked = 0;
  let skipped = 0;
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
      if (search.speculative) {
        // An option the student has not chosen: a door walk priced before costs nothing, and a new one is asked
        // for only to correct a walk that may not be used, a couple at most.
        const unpriced = calls.filter((x) => !x.priced).length;
        if (unpriced && (googleUsable || unpricedAsked + unpriced > CAMPUS_LOOKUPS.calls)) {
          skipped += unpriced;
          continue;
        }
        unpricedAsked += unpriced;
      } else if (!search.exhaustive) {
        const room = Math.min(need - (p.seconds + p.guess), under - (p.cost + p.guess));
        if (googleUsable && room < -p.slack) continue;
        const allowed = googleUsable ? CAMPUS_LOOKUPS.calls + (room >= CAMPUS_LOOKUPS.highValueSeconds ? CAMPUS_LOOKUPS.highValueCalls : 0) : CAMPUS_LOOKUPS.correctionCalls;
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
    .sort((x, y) => x.c.cost - y.c.cost || x.c.seconds - y.c.seconds || x.choice.via.join("|").localeCompare(y.choice.via.join("|")));

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
        const benefit = googleTotal - x.c.seconds;
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
      const benefit = googleTotal - best.c.seconds;
      marginSeconds = Math.round(margin);
      rejected.push({
        label: best.choice.via.join(" → "),
        because: benefit >= margin ? "not better once its uncertain doors and links are counted"
          : benefit > 0 ? `saves only ${formatSeconds(benefit)}, under the ${formatSeconds(margin)} it has to save`
          : `${formatSeconds(-benefit)} slower than Google's walk`,
        seconds: Math.round(best.c.seconds),
      });
    }
    if (!pick) {
      for (const x of ranked) {
        if (eligible(x.c) || googleTotal - x.c.seconds < marginFor(0)) continue;
        rejected.push({ label: x.choice.via.join(" → "), because: "follows the survey's outdoor walkways without passing through a building, so it is not a shortcut Google cannot see", seconds: Math.round(x.c.seconds) });
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
    googleTotalSeconds: Math.round(googleTotal),
    ...(skipped ? { skippedDoorWalks: skipped } : {}),
    inside,
    googleUsable,
    activatedBy,
    chosen: pick?.choice,
    alternatives: ranked.filter((x) => x !== pick).slice(0, 3).map((x) => x.choice),
    rejected,
    warnings,
  };
  // What a route priced between the buildings' map points, as a bus is, adds to be timed floor to floor.
  const building = { origin: Math.round(unjoined(O, fromO).seconds), destination: Math.round(unjoined(D, toD).seconds) };
  if (pick) {
    const drawn = candidatePieces(g, opts, pick.c);
    return { route: routeFor(g, opts, pick.c, req, decision, pick.choice, drawn, building, now), decision, drawn };
  }
  // Google's walk stands, usable or kept with a warning: the leg shows it floor to floor and drawn from the
  // floors, whenever that differs from Google's walk as Google gives it.
  const drawn = googlePieces(g, opts, readable, googleOrigin, googleDestination);
  const differs = Boolean(googleOrigin?.at || googleDestination?.at) || Math.round(googleTotal) !== Math.round(googleSeconds);
  return differs ? { route: googleRouteFor(google, drawn, googleTotal, building), decision, drawn } : { decision, drawn };
}

/** A decision as plain text, for developers: what was taken, what activated it, what it rests on, what was not taken and why. */
export function explainCampusDecision(d: CampusDecision): string {
  const lines: string[] = [];
  const google = d.googleSeconds === undefined ? "" : ` (${formatSeconds(d.googleTotalSeconds ?? d.googleSeconds)} floor to floor; Google times its own walk at ${formatSeconds(d.googleSeconds)})`;
  if (d.chosen) {
    lines.push("Selected:", ...d.chosen.via.map((v, i) => `${i === 0 ? "  " : "  → "}${v}`));
    lines.push(`because: ${d.summary} Estimated ${formatSeconds(d.chosen.seconds)} floor to floor; weakest evidence ${d.chosen.evidence.toLowerCase().replace(/_/g, " ")}.`);
  } else {
    lines.push(`Selected: Google's walk${google}`, `because: ${d.summary}`);
  }
  if (d.chosen && d.googleUsable) lines.push(`Instead of: Google's walk${google}`);
  const ends = [
    d.inside.originSeconds ? `${formatSeconds(d.inside.originSeconds)} out by the ${d.inside.originDoor ?? "door"}${d.inside.originJoined ? ", joining its line" : ""}` : "",
    d.inside.destinationSeconds ? `${formatSeconds(d.inside.destinationSeconds)} in by the ${d.inside.destinationDoor ?? "door"}${d.inside.destinationJoined ? ", from its line" : ""}` : "",
  ].filter(Boolean);
  if (ends.length) lines.push(`Between the floors and Google's walk: ${ends.join("; ")}.`);
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
