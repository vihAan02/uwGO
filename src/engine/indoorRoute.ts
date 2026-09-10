import type { CampusLocation, RouteOption } from "@/domain/types";
import type { PlannerConfig } from "@/domain/config";
import { findBuilding } from "@/data/buildings";
import { indoorNeighbours, type IndoorConnection } from "@/data/indoor/connections";
import { encode } from "@googlemaps/polyline-codec";

/** Indoor walking is slower than Google's pavement pace: corridors, doors, stairs, people. */
const INDOOR_METRES_PER_MINUTE = 70;
const PER_BUILDING_MINUTES = 0.5;
const NEIGHBOURS = indoorNeighbours();

function metres(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

function edgeMinutes(from: string, to: string, edge: IndoorConnection): number | undefined {
  const a = findBuilding("UW", from);
  const b = findBuilding("UW", to);
  if (a?.latitude === undefined || a.longitude === undefined || b?.latitude === undefined || b.longitude === undefined) return undefined;
  return metres({ latitude: a.latitude, longitude: a.longitude }, { latitude: b.latitude, longitude: b.longitude }) / INDOOR_METRES_PER_MINUTE + PER_BUILDING_MINUTES + (edge.penaltyMinutes ?? 0);
}

export interface IndoorPath { codes: string[]; minutes: number; edges: IndoorConnection[] }

/** Shortest indoor path between two building codes over the verified graph (Dijkstra; the graph is tiny). */
export function shortestIndoorPath(fromCode: string, toCode: string): IndoorPath | undefined {
  if (fromCode === toCode) return { codes: [fromCode], minutes: 0, edges: [] };
  if (!NEIGHBOURS.has(fromCode) || !NEIGHBOURS.has(toCode)) return undefined;
  const dist = new Map<string, number>([[fromCode, 0]]);
  const prev = new Map<string, { from: string; edge: IndoorConnection }>();
  const open = new Set<string>([fromCode]);
  while (open.size) {
    let cur = "";
    let best = Infinity;
    for (const c of open) { const d = dist.get(c)!; if (d < best) { best = d; cur = c; } }
    open.delete(cur);
    if (cur === toCode) break;
    for (const { to, edge } of NEIGHBOURS.get(cur) ?? []) {
      const m = edgeMinutes(cur, to, edge);
      if (m === undefined) continue;
      const nd = best + m;
      if (nd < (dist.get(to) ?? Infinity)) { dist.set(to, nd); prev.set(to, { from: cur, edge }); open.add(to); }
    }
  }
  if (!dist.has(toCode)) return undefined;
  const codes: string[] = [toCode];
  const edges: IndoorConnection[] = [];
  let c = toCode;
  while (c !== fromCode) { const p = prev.get(c)!; edges.unshift(p.edge); c = p.from; codes.unshift(c); }
  return { codes, minutes: dist.get(toCode)!, edges };
}

/**
 * An indoor alternative to a Google walk, when both ends are UW buildings on the graph.
 * Duration is an estimate from centroid distances at an indoor pace; the polyline joins the
 * buildings passed through so the map shows the way, not the corridors.
 */
export function indoorRouteBetween(from: CampusLocation, to: CampusLocation, now = new Date()): RouteOption | undefined {
  if (from.university !== "UW" || to.university !== "UW" || !from.buildingCode || !to.buildingCode) return undefined;
  if (from.buildingCode === to.buildingCode) return undefined;
  const path = shortestIndoorPath(from.buildingCode, to.buildingCode);
  if (!path || path.codes.length < 2) return undefined;
  const points = path.codes.map((c) => findBuilding("UW", c)).map((b) => [b!.latitude!, b!.longitude!] as [number, number]);
  const distance = points.slice(1).reduce((n, p, i) => n + metres({ latitude: points[i][0], longitude: points[i][1] }, { latitude: p[0], longitude: p[1] }), 0);
  const kinds = new Set(path.edges.map((e) => e.kind));
  const how = kinds.has("TUNNEL") && kinds.size === 1 ? "tunnel" : kinds.has("BRIDGE") && kinds.size === 1 ? "bridge" : "indoor link";
  return {
    mode: "WALK",
    durationMinutes: Math.ceil(path.minutes),
    distanceMeters: Math.round(distance),
    steps: path.edges.map((e, i) => ({ mode: "WALK", durationMinutes: Math.round(edgeMinutes(path.codes[i], path.codes[i + 1], e) ?? 0), instruction: `${path.codes[i]} → ${path.codes[i + 1]}: ${e.note}` })),
    polyline: encode(points),
    indoorPath: path.codes,
    indoorShare: 1,
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
