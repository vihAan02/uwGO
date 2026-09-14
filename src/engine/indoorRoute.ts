import type { CampusLocation, LatLng, RouteOption, RouteStep } from "@/domain/types";
import type { PlannerConfig } from "@/domain/config";
import { findBuilding } from "@/data/buildings";
import { decode, encode } from "@googlemaps/polyline-codec";
import { haversineMeters } from "@/routing/EstimateRoutingProvider";
import { anchorsOf, campusGraph, isOnIndoorNetwork, nearestEntrances, routeBetweenNodes, type AccessNeeds, type CampusConstraints, type IndoorGraphRoute, type IndoorSegment, type RouteOptions } from "./indoorGraph";
import { GOOGLE_WALK_METRES_PER_SECOND } from "./campusRoute";
import { edgesCut } from "./closureGeometry";
import { isVertical, type IndoorNode } from "@/data/indoor/network";

/**
 * The winter route: a walk that stays under a roof wherever the campus indoor network
 * allows. The network's own shortest path does the routing (indoorGraph.ts); this module
 * joins the student's actual origin and destination to it and turns the result into the
 * same RouteOption shape every other route has, so the timeline, the map and Trip Mode
 * need not know the difference.
 */

/** Something that can price an outdoor walk between two points; the planner's route memo does. */
export interface ConnectorFetcher {
  walk(from: LatLng, to: LatLng): Promise<RouteOption | undefined>;
  /** Whether a walk has been priced already, so asking for it again costs no call. Without it, every walk is taken to cost one. */
  priced?(from: LatLng, to: LatLng): boolean;
}

/** A place further than this from any network door gets no winter route: it would be mostly outdoors anyway. */
export const CONNECTOR_MAX_METRES = 400;
/** Doors tried for an off-network end; each costs one (cached) walking-route lookup. */
export const CONNECTOR_CANDIDATES = 2;

/**
 * The doors a place off the network is joined to it by. Each join is priced as the walk it is, from the place
 * to the door at the start of a journey and from the door to the place at the end; the winter route and the
 * campus-aware fastest walk price the same walks, so a door walk one has priced costs the other nothing.
 */
export function connectorDoors(loc: LatLng, direction: "IN" | "OUT", search: RouteOptions) {
  return nearestEntrances(loc, CONNECTOR_CANDIDATES, undefined, { direction, opts: search }).filter((e) => e.metres <= CONNECTOR_MAX_METRES);
}
/** A winter route must be at least this much under cover, or it is not one. */
export const MIN_INDOOR_SHARE = 0.5;

type Point = [number, number];

/** One end of the journey joined to the network. */
interface End {
  /** Nodes the indoor search may start from (or end at). */
  nodes: number[];
  /** The walk between the place and the door, its line in the direction walked, when the place is not inside the building. */
  connector?: { route: RouteOption; to: IndoorNode; polyline: Point[] };
  /** Seconds of that walk, the step between its line and the door included; 0 when inside. */
  seconds: number;
}

const toPoint = (p: { latitude: number; longitude: number }): Point => [p.latitude, p.longitude];
const nodeLatLng = (n: IndoorNode): LatLng => ({ latitude: n.lat, longitude: n.lng });

/**
 * Where the network is entered from a place: inside its own building, or by a short walk to the
 * nearest door. `direction` is how the walk uses that door: in at the start of a journey, out at
 * the end, so a door that may only be used one way is only offered that way.
 */
async function joinEnds(loc: CampusLocation, fetcher: ConnectorFetcher | undefined, direction: "IN" | "OUT", search: RouteOptions): Promise<End[]> {
  if (loc.university === "UW" && isOnIndoorNetwork(loc.buildingCode)) {
    // From the floor's own points on the network when the floor is known, where the campus-aware walk starts too.
    const anchors = anchorsOf(loc.buildingCode!);
    const onFloor = loc.floor ? anchors.filter((a) => a.floor === loc.floor) : [];
    return [{ nodes: (onFloor.length ? onFloor : anchors).map((n) => n.id), seconds: 0 }];
  }
  if (!fetcher) return [];
  const ends: End[] = [];
  // Each walk is priced in the direction it is walked: from the place to the door at the start of the
  // journey, from the door to the place at the end. Google's two directions of a walk can differ by a minute.
  for (const e of connectorDoors(loc, direction, search)) {
    const door = nodeLatLng(e.node);
    const route = direction === "IN" ? await fetcher.walk(loc, door) : await fetcher.walk(door, loc);
    if (!route || route.isEstimate) continue; // a guessed straight line is exactly what this must not draw
    const drawn = route.polyline ? decode(route.polyline).map(([lat, lng]) => [lat, lng] as Point) : undefined;
    const polyline: Point[] = drawn ?? (direction === "IN" ? [toPoint(loc), [e.node.lat, e.node.lng]] : [[e.node.lat, e.node.lng], toPoint(loc)]);
    // The step between where Google's line stops and the door is walked too, and may not cut a path or a building.
    const doorEnd = direction === "IN" ? polyline[polyline.length - 1] : polyline[0];
    if (drawn && edgesCut(campusGraph().net, doorEnd, [e.node.lat, e.node.lng]).length) continue;
    const across = haversineMeters({ latitude: doorEnd[0], longitude: doorEnd[1] }, door);
    ends.push({ nodes: [e.node.id], connector: { route, to: e.node, polyline }, seconds: (route.durationSeconds ?? route.durationMinutes * 60) + across / GOOGLE_WALK_METRES_PER_SECOND });
  }
  return ends;
}

/** Metres of a polyline. */
function length(path: Point[]): number {
  let m = 0;
  for (let i = 1; i < path.length; i++) m += haversineMeters({ latitude: path[i - 1][0], longitude: path[i - 1][1] }, { latitude: path[i][0], longitude: path[i][1] });
  return m;
}

const KIND_WORD: Record<IndoorSegment["kind"], string> = { TUNNEL: "tunnel", BRIDGE: "bridge", OUTDOOR: "outside", HALLWAY: "inside", DOOR: "door", OPEN: "inside", STAIRS: "stairs", ELEVATOR: "elevator", RAMP: "ramp", OTHER_VERTICAL: "change of floor" };

/** One step per building change, named for the way the boundary was crossed. */
function stepsFor(r: IndoorGraphRoute): RouteStep[] {
  const steps: RouteStep[] = [];
  let metres = 0;
  let seconds = 0;
  let since = r.segments[0]?.from.building;
  let outsideFrom: string | undefined;
  for (const s of r.segments) {
    metres += s.metres;
    seconds += s.seconds;
    const crossing = s.from.building !== s.to.building;
    if (!crossing) continue;
    if (s.to.building === "OUT") { outsideFrom = s.from.building; continue; }
    const from = outsideFrom ?? since;
    const how = outsideFrom ? "outside" : KIND_WORD[s.kind];
    const floors = isVertical(s.kind) && s.floors ? ` (${s.floors > 0 ? "up" : "down"} ${Math.abs(s.floors)} floor${Math.abs(s.floors) === 1 ? "" : "s"})` : "";
    steps.push({ mode: "WALK", durationMinutes: Math.round(seconds / 60), distanceMeters: Math.round(metres), instruction: `${from} → ${s.to.building}: ${how}${floors}` });
    metres = 0; seconds = 0; since = s.to.building; outsideFrom = undefined;
  }
  return steps;
}

/**
 * The winter route between two places, or undefined when the network offers nothing
 * worth calling one: no way at all, the same building, or a way that is mostly outdoors.
 * Both ends are joined to the network first; the indoor search runs between every pair
 * of joins and the cheapest whole journey wins.
 */
export interface IndoorRouteOptions {
  /** Canonical ids of segments reported shut; the search will not use them. */
  closedEdgeIds?: ReadonlySet<string>;
  /** When the trip happens. Opening hours of the buildings it passes through are only checked when this is given. */
  at?: Date;
  access?: AccessNeeds;
  /** Also use experimental campus data. */
  experimental?: boolean;
}

export async function indoorRouteBetween(from: CampusLocation, to: CampusLocation, fetcher?: ConnectorFetcher, now = new Date(), opts: IndoorRouteOptions = {}): Promise<RouteOption | undefined> {
  if (from.id === to.id) return undefined;
  if (from.buildingCode && from.buildingCode === to.buildingCode) return undefined;
  const constraints: CampusConstraints = {
    at: opts.at,
    endpoints: [from.buildingCode, to.buildingCode].filter((b): b is string => Boolean(b)),
    access: opts.access,
    experimental: opts.experimental,
  };
  const search: RouteOptions = { closedEdgeIds: opts.closedEdgeIds, constraints };
  const starts = await joinEnds(from, fetcher, "IN", search);
  if (!starts.length) return undefined;
  const ends = await joinEnds(to, fetcher, "OUT", search);
  if (!ends.length) return undefined;

  let best: { start: End; end: End; route: IndoorGraphRoute; total: number } | undefined;
  for (const start of starts) {
    for (const end of ends) {
      const route = routeBetweenNodes(start.nodes, end.nodes, search);
      if (!route) continue;
      const total = route.cost + start.seconds + end.seconds;
      if (!best || total < best.total) best = { start, end, route, total };
    }
  }
  if (!best) return undefined;
  const { start, end, route } = best;

  // Which closures actually changed this answer. Only worth asking when there are any: the
  // second search runs solely to find out what the student would otherwise have walked, so the
  // note can name the segment rather than vaguely announcing that something is shut.
  let avoidedClosures: string[] | undefined;
  if (opts.closedEdgeIds?.size) {
    const unclosed = routeBetweenNodes(start.nodes, end.nodes, { constraints });
    const blocked = unclosed?.edgeIds.filter((id) => opts.closedEdgeIds!.has(id)) ?? [];
    if (blocked.length) avoidedClosures = [...new Set(blocked)];
  }

  // The whole journey as one line: the walk to the door, the network, the walk from the door. Inside a
  // building the line starts on the floor's own point on the network: nothing is drawn to where the map
  // places the building, and nothing is timed for it.
  const first = route.segments[0]?.from ?? (start.connector?.to);
  const last = route.segments[route.segments.length - 1]?.to ?? end.connector?.to;
  if (!first || !last) return undefined;
  const line: Point[] = [];
  const add = (p: Point) => { const prev = line[line.length - 1]; if (!prev || prev[0] !== p[0] || prev[1] !== p[1]) line.push(p); };
  if (start.connector) for (const p of start.connector.polyline) add(p);
  add([first.lat, first.lng]);
  for (const s of route.segments) for (const p of s.path) add(p);
  add([last.lat, last.lng]);
  if (end.connector) for (const p of end.connector.polyline) add(p);

  const leadMetres = start.connector ? (start.connector.route.distanceMeters ?? length(start.connector.polyline)) : 0;
  const tailMetres = end.connector ? (end.connector.route.distanceMeters ?? length(end.connector.polyline)) : 0;
  const totalMetres = leadMetres + route.metres + tailMetres;
  const outdoorMetres = route.outdoorMetres + leadMetres + tailMetres;
  const indoorShare = totalMetres > 0 ? 1 - outdoorMetres / totalMetres : 0;
  if (route.buildings.length < 2 || indoorShare < MIN_INDOOR_SHARE) return undefined;
  const seconds = start.seconds + route.seconds + end.seconds;

  const steps: RouteStep[] = [];
  if (start.connector) steps.push({ mode: "WALK", durationMinutes: start.connector.route.durationMinutes, distanceMeters: start.connector.route.distanceMeters, instruction: `Walk to the ${start.connector.to.building} entrance` });
  steps.push(...stepsFor(route));
  if (end.connector) steps.push({ mode: "WALK", durationMinutes: end.connector.route.durationMinutes, distanceMeters: end.connector.route.distanceMeters, instruction: `Walk from the ${end.connector.to.building} entrance` });

  const kinds = new Set(route.segments.map((s) => s.kind));
  const how = kinds.has("TUNNEL") && !kinds.has("BRIDGE") ? "tunnel" : kinds.has("BRIDGE") && !kinds.has("TUNNEL") ? "bridge" : "link";
  return {
    mode: "WALK",
    durationMinutes: Math.max(1, Math.ceil(seconds / 60)),
    durationSeconds: Math.round(seconds),
    distanceMeters: Math.round(totalMetres),
    steps,
    polyline: encode(line),
    indoorPath: route.buildings,
    indoorEdgeIds: route.edgeIds,
    avoidedClosures,
    indoorShare: Math.round(indoorShare * 100) / 100,
    provider: `uw-indoor-${how}`,
    computedAt: now.toISOString(),
    isEstimate: true,
  };
}

/** Whether the indoor route is close enough to the fastest walk to be taken when the student prefers indoors. */
export function indoorIsReasonable(indoor: RouteOption, fastest: RouteOption, cfg: PlannerConfig): boolean {
  const extra = indoor.durationMinutes - fastest.durationMinutes;
  if (extra <= 0) return true;
  return extra <= cfg.indoorMaxExtraMinutes && extra <= fastest.durationMinutes * cfg.indoorMaxExtraRatio;
}

export function indoorPathLabel(r: RouteOption): string {
  return (r.indoorPath ?? []).join(" → ");
}

/** For tests and the audit: the UW building a code names, if the registry has it with coordinates. */
export function networkBuildingLocation(code: string): CampusLocation | undefined {
  const b = findBuilding("UW", code);
  if (!b || b.latitude === undefined || b.longitude === undefined) return undefined;
  return { id: `UW:${b.code}`, name: b.name, university: "UW", latitude: b.latitude, longitude: b.longitude, kind: "BUILDING", buildingCode: b.code };
}
