import type { CampusLocation, LatLng, RouteOption, RouteStep } from "@/domain/types";
import type { PlannerConfig } from "@/domain/config";
import { findBuilding } from "@/data/buildings";
import { decode, encode } from "@googlemaps/polyline-codec";
import { haversineMeters } from "@/routing/EstimateRoutingProvider";
import { INDOOR_PACE, anchorsOf, isOnIndoorNetwork, nearestEntrances, routeBetweenNodes, type AccessNeeds, type CampusConstraints, type IndoorGraphRoute, type IndoorSegment, type RouteOptions } from "./indoorGraph";
import type { IndoorNode } from "@/data/indoor/network";

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
}

/** A place further than this from any network door gets no winter route: it would be mostly outdoors anyway. */
export const CONNECTOR_MAX_METRES = 400;
/** Doors tried for an off-network end; each costs one (cached) walking-route lookup. */
export const CONNECTOR_CANDIDATES = 2;

/**
 * The doors a place off the network is joined to it by, and the walk each join is priced as: from
 * the place to the door, whichever end of the journey it is. The winter route and the campus-aware
 * fastest walk both join through here, so a door one has already priced costs the other nothing.
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
  /** The way from the place to those nodes, when it is not simply inside the building. */
  connector?: { route: RouteOption; to: IndoorNode; polyline: Point[] };
  /** Straight-line cost of the connector, for choosing between candidates; 0 when inside. */
  minutes: number;
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
    return [{ nodes: anchorsOf(loc.buildingCode!).map((n) => n.id), minutes: 0 }];
  }
  if (!fetcher) return [];
  const ends: End[] = [];
  // The walk is always priced from the place to the door, whichever end of the journey it is;
  // the two directions differ by nothing worth a second lookup, and one key serves both.
  for (const e of connectorDoors(loc, direction, search)) {
    const route = await fetcher.walk(loc, nodeLatLng(e.node));
    if (!route || route.isEstimate) continue; // a guessed straight line is exactly what this must not draw
    const polyline: Point[] = route.polyline ? decode(route.polyline).map(([lat, lng]) => [lat, lng] as Point) : [toPoint(loc), [e.node.lat, e.node.lng]];
    ends.push({ nodes: [e.node.id], connector: { route, to: e.node, polyline }, minutes: route.durationMinutes });
  }
  return ends;
}

/** Metres of a polyline. */
function length(path: Point[]): number {
  let m = 0;
  for (let i = 1; i < path.length; i++) m += haversineMeters({ latitude: path[i - 1][0], longitude: path[i - 1][1] }, { latitude: path[i][0], longitude: path[i][1] });
  return m;
}

const KIND_WORD: Record<IndoorSegment["kind"], string> = { TUNNEL: "tunnel", BRIDGE: "bridge", OUTDOOR: "outside", HALLWAY: "inside", DOOR: "door", OPEN: "inside", STAIRS: "stairs" };

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
    const floors = s.kind === "STAIRS" && s.floors ? ` (${s.floors > 0 ? "up" : "down"} ${Math.abs(s.floors)} floor${Math.abs(s.floors) === 1 ? "" : "s"})` : "";
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
      const total = route.cost + (start.minutes + end.minutes) * 60;
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

  // The whole journey as one line: the way in, the network, the way out. Inside a building
  // the way in is the short walk from where the map places the building to where the
  // network does; it is drawn because it is under the same roof.
  const first = route.segments[0]?.from ?? (start.connector?.to);
  const last = route.segments[route.segments.length - 1]?.to ?? end.connector?.to;
  if (!first || !last) return undefined;
  const lead: Point[] = start.connector ? start.connector.polyline : [toPoint(from), [first.lat, first.lng]];
  const tail: Point[] = end.connector ? [...end.connector.polyline].reverse() : [[last.lat, last.lng], toPoint(to)];
  const line: Point[] = [...lead];
  for (const s of route.segments) for (const p of s.path) { const prev = line[line.length - 1]; if (!prev || prev[0] !== p[0] || prev[1] !== p[1]) line.push(p); }
  for (const p of tail) { const prev = line[line.length - 1]; if (!prev || prev[0] !== p[0] || prev[1] !== p[1]) line.push(p); }

  const leadMetres = start.connector ? (start.connector.route.distanceMeters ?? length(lead)) : length(lead);
  const tailMetres = end.connector ? (end.connector.route.distanceMeters ?? length(tail)) : length(tail);
  const leadMinutes = start.connector ? start.connector.route.durationMinutes : leadMetres / INDOOR_PACE.indoorMetresPerSecond / 60;
  const tailMinutes = end.connector ? end.connector.route.durationMinutes : tailMetres / INDOOR_PACE.indoorMetresPerSecond / 60;
  const totalMetres = leadMetres + route.metres + tailMetres;
  const outdoorMetres = route.outdoorMetres + (start.connector ? leadMetres : 0) + (end.connector ? tailMetres : 0);
  const indoorShare = totalMetres > 0 ? 1 - outdoorMetres / totalMetres : 0;
  if (route.buildings.length < 2 || indoorShare < MIN_INDOOR_SHARE) return undefined;

  const steps: RouteStep[] = [];
  if (start.connector) steps.push({ mode: "WALK", durationMinutes: start.connector.route.durationMinutes, distanceMeters: start.connector.route.distanceMeters, instruction: `Walk to the ${start.connector.to.building} entrance` });
  steps.push(...stepsFor(route));
  if (end.connector) steps.push({ mode: "WALK", durationMinutes: end.connector.route.durationMinutes, distanceMeters: end.connector.route.distanceMeters, instruction: `Walk from the ${end.connector.to.building} entrance` });

  const kinds = new Set(route.segments.map((s) => s.kind));
  const how = kinds.has("TUNNEL") && !kinds.has("BRIDGE") ? "tunnel" : kinds.has("BRIDGE") && !kinds.has("TUNNEL") ? "bridge" : "link";
  return {
    mode: "WALK",
    durationMinutes: Math.max(1, Math.ceil(leadMinutes + route.seconds / 60 + tailMinutes)),
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
