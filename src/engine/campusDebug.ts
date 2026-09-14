/**
 * Developer inspection of the campus graph as routing sees it: every segment with its evidence, its
 * activation, where what is known about it comes from, and whether each direction may be used right now,
 * and every door with its rules. As GeoJSON, so it can be dropped on geojson.io or a map's data layer;
 * nothing here is shown to students.
 */
import { CAMPUS_KNOWLEDGE } from "@/data/campus";
import { findBuilding } from "@/data/buildings";
import { edgeLabel } from "@/data/indoor/edgeId";
import { REFUSAL_TEXT, campusGraph, evidenceFor, refusalFor, type AccessNeeds, type IndoorGraph, type RouteOptions } from "./indoorGraph";
import { buildingRuleProvenance, segmentProvenance } from "./campusProvenance";

export interface GraphInspection {
  /** When to judge opening hours; without it, hours are not judged. */
  at?: Date;
  closedEdgeIds?: ReadonlySet<string>;
  access?: AccessNeeds;
  experimental?: boolean;
}

interface Feature {
  type: "Feature";
  geometry: { type: "LineString"; coordinates: [number, number][] } | { type: "Point"; coordinates: [number, number] };
  properties: Record<string, unknown>;
}

export interface FeatureCollection {
  type: "FeatureCollection";
  features: Feature[];
}

const lngLat = ([lat, lng]: [number, number]): [number, number] => [lng, lat];

export function campusGraphGeoJSON(inspect: GraphInspection = {}, g: IndoorGraph = campusGraph()): FeatureCollection {
  const opts: RouteOptions = { closedEdgeIds: inspect.closedEdgeIds, constraints: { at: inspect.at, access: inspect.access, experimental: inspect.experimental } };
  const atMs = inspect.at?.getTime();
  const experimental = Boolean(inspect.experimental);
  const features: Feature[] = [];
  g.net.edges.forEach((edge, index) => {
    const a = g.net.nodes[edge.a];
    const b = g.net.nodes[edge.b];
    const fact = g.facts[index];
    const forward = g.adj[edge.a].find((arc) => arc.index === index)!;
    const backward = g.adj[edge.b].find((arc) => arc.index === index)!;
    const refusedForward = refusalFor(g, forward, opts, atMs);
    const refusedBackward = refusalFor(g, backward, opts, atMs);
    const path = edge.path.length > 1 ? edge.path : [edge.path[0], edge.path[0]];
    const provenance = segmentProvenance(g, index, experimental);
    features.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates: path.map(lngLat) },
      properties: {
        id: g.ids[index],
        kind: edge.kind,
        label: fact?.label ?? edgeLabel(g.net, edge),
        from: `${a.building}/${a.floor}`,
        to: `${b.building}/${b.floor}`,
        evidence: evidenceFor(g, index, experimental),
        activation: g.historical[index] ? "HISTORICAL" : fact?.activation ?? "ACTIVE",
        provenance: provenance.from,
        field: provenance.field ?? [],
        forward: refusedForward ? REFUSAL_TEXT[refusedForward] : "usable",
        backward: refusedBackward ? REFUSAL_TEXT[refusedBackward] : "usable",
        disabled: Boolean(refusedForward && refusedBackward),
        access: fact?.access ?? null,
        vertical: fact?.vertical ?? null,
        research: fact?.research ?? null,
        sources: fact?.sourceIds ?? [],
        basis: fact?.basis ?? null,
        // Styling hints for a quick look: grey when unusable both ways, amber when one way only.
        stroke: refusedForward && refusedBackward ? "#9ca3af" : refusedForward || refusedBackward ? "#d97706" : edge.kind === "OUTDOOR" ? "#16a34a" : "#1d4ed8",
      },
    });
  });
  for (const door of g.exteriorDoors) {
    const node = g.net.nodes[door.inside];
    const inward = g.adj[door.outside].find((arc) => arc.index === door.index)!;
    const outward = g.adj[door.inside].find((arc) => arc.index === door.index)!;
    const refusedIn = refusalFor(g, inward, opts, atMs);
    const refusedOut = refusalFor(g, outward, opts, atMs);
    const fact = g.facts[door.index];
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [node.lng, node.lat] },
      properties: {
        id: g.ids[door.index],
        kind: "DOOR",
        building: door.building,
        floor: node.floor,
        label: fact?.label ?? `${door.building} door`,
        in: refusedIn ? REFUSAL_TEXT[refusedIn] : "usable",
        out: refusedOut ? REFUSAL_TEXT[refusedOut] : "usable",
        direction: refusedIn && !refusedOut ? "exit only" : refusedOut && !refusedIn ? "entrance only" : refusedIn && refusedOut ? "unusable" : "both ways",
        evidence: evidenceFor(g, door.index, experimental),
        provenance: segmentProvenance(g, door.index, experimental).from,
        research: fact?.research?.portals ?? [],
        access: fact?.access ?? null,
        "marker-color": refusedIn && refusedOut ? "#9ca3af" : refusedIn || refusedOut ? "#d97706" : "#1d4ed8",
      },
    });
  }
  for (const fact of (g.knowledge ?? CAMPUS_KNOWLEDGE).buildingFacts.values()) {
    const b = findBuilding("UW", fact.code);
    if (!fact.exterior || b?.latitude === undefined || b.longitude === undefined) continue;
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [b.longitude, b.latitude] },
      properties: {
        kind: "BUILDING_EXTERIOR",
        building: fact.code,
        label: `${fact.code} map point (what a walk to the building arrives at)`,
        in: fact.exterior.in,
        out: fact.exterior.out,
        portals: fact.exterior.portalIds,
        evidence: fact.exterior.evidence,
        provenance: buildingRuleProvenance(g, fact.code)?.from ?? [],
        advice: fact.exterior.arrivalAdvice,
        "marker-color": "#dc2626",
      },
    });
  }
  return { type: "FeatureCollection", features };
}
