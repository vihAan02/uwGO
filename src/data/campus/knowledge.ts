/**
 * The research and UW Go's reviewed decisions, indexed for routing, plus the checks that keep the
 * two honest against the surveyed network.
 *
 * Type-only imports: scripts/audit-campus-routing.mjs loads this file directly with Node.
 */
import type { IndoorEdge, IndoorEdgeKind, IndoorNetwork } from "../indoor/network";
import type {
  BuildingFact,
  CampusOverlay,
  CampusResearch,
  EdgeFact,
  Evidence,
  HistoricalLink,
  ResearchConnection,
  ResearchPortal,
  ResearchSource,
} from "./types";

export interface CampusKnowledge {
  research: CampusResearch;
  overlay: CampusOverlay;
  edgeFacts: ReadonlyMap<string, EdgeFact>;
  buildingFacts: ReadonlyMap<string, BuildingFact>;
  historical: readonly HistoricalLink[];
  sources: ReadonlyMap<string, ResearchSource>;
  portals: ReadonlyMap<string, ResearchPortal>;
  connections: ReadonlyMap<string, ResearchConnection>;
}

export function compileKnowledge(research: CampusResearch, overlay: CampusOverlay): CampusKnowledge {
  return {
    research,
    overlay,
    edgeFacts: new Map(overlay.edges.map((f) => [f.ref.edgeId, f])),
    buildingFacts: new Map(overlay.buildings.map((b) => [b.code, b])),
    historical: overlay.historical,
    sources: new Map(research.sources.map((s) => [s.id, s])),
    portals: new Map(research.portals.map((p) => [p.id, p])),
    connections: new Map(research.connections.map((c) => [c.id, c])),
  };
}

/** Knowledge with nothing in it: the surveyed network exactly as it routed before this layer existed. */
export function emptyKnowledge(research: CampusResearch): CampusKnowledge {
  return compileKnowledge(research, { reviewedAt: "", edges: [], historical: [], buildings: [], conflicts: [], fieldChecks: [] });
}

/**
 * Whether the claims a fact attaches (which door it is, which way it may be used, its access) may
 * be relied on. Official and corroborated claims always; anecdotal and inferred ones only when a
 * caller explicitly asks for experimental data; unresolved ones never.
 */
export function claimsUsable(evidence: Evidence, experimental: boolean): boolean {
  if (evidence === "OFFICIAL" || evidence === "CORROBORATED") return true;
  if (evidence === "ANECDOTAL" || evidence === "INFERRED") return experimental;
  return false;
}

/** What a caller knows about each surveyed segment, for checking references against. */
export interface SurveyedEdge {
  kind: IndoorEdgeKind;
  /** Building codes at the two ends ("OUT" outside). */
  between: readonly [string, string];
}

/** Every surveyed segment by canonical id. The id function is passed in so Node can load this file without resolving imports. */
export function surveyedEdges(net: IndoorNetwork, idOf: (net: IndoorNetwork, edge: IndoorEdge) => string): Map<string, SurveyedEdge> {
  return new Map(net.edges.map((e) => [idOf(net, e), { kind: e.kind, between: [net.nodes[e.a].building, net.nodes[e.b].building] as const }]));
}

const samePair = (a: readonly [string, string], b: readonly [string, string]) =>
  (a[0] === b[0] && a[1] === b[1]) || (a[0] === b[1] && a[1] === b[0]);

/**
 * Everything wrong with the knowledge as it stands, as sentences. Empty means every reference
 * resolves: each fact's segment exists with the kind and buildings it claims, each research id
 * and source exists, and no historical link has reappeared as a live segment.
 */
export function validateKnowledge(k: CampusKnowledge, surveyed: ReadonlyMap<string, SurveyedEdge>): string[] {
  const problems: string[] = [];
  const r = k.research;
  const buildingIds = new Set(r.buildings.map((b) => b.id));
  const ruleIds = new Set(r.rules.map((x) => x.id));
  const candidateIds = new Set(r.routeCandidates.map((x) => x.id));
  const checkSources = (ids: readonly string[], where: string) => {
    for (const id of ids) if (!k.sources.has(id)) problems.push(`${where}: unknown source ${id}`);
  };
  const checkResearch = (ref: { portals?: readonly string[]; connection?: string; connections?: readonly string[]; rules?: readonly string[]; candidates?: readonly string[] } | undefined, where: string) => {
    if (!ref) return;
    for (const id of ref.portals ?? []) if (!k.portals.has(id)) problems.push(`${where}: unknown portal ${id}`);
    for (const id of [...(ref.connection ? [ref.connection] : []), ...(ref.connections ?? [])]) if (!k.connections.has(id)) problems.push(`${where}: unknown connection ${id}`);
    for (const id of ref.rules ?? []) if (!ruleIds.has(id)) problems.push(`${where}: unknown rule ${id}`);
    for (const id of ref.candidates ?? []) if (!candidateIds.has(id)) problems.push(`${where}: unknown route candidate ${id}`);
  };
  const checkEdgeIds = (ids: readonly string[] | undefined, where: string) => {
    for (const id of ids ?? []) if (!surveyed.has(id)) problems.push(`${where}: no surveyed segment ${id}`);
  };

  const seenEdges = new Set<string>();
  for (const f of k.overlay.edges) {
    const where = `edge fact "${f.label}" (${f.ref.edgeId})`;
    if (seenEdges.has(f.ref.edgeId)) problems.push(`${where}: listed twice`);
    seenEdges.add(f.ref.edgeId);
    const s = surveyed.get(f.ref.edgeId);
    if (!s) problems.push(`${where}: no surveyed segment has this id`);
    else {
      if (s.kind !== f.ref.kind) problems.push(`${where}: surveyed as ${s.kind}, not ${f.ref.kind}`);
      if (!samePair(s.between, f.ref.between)) problems.push(`${where}: surveyed between ${s.between.join(" and ")}, not ${f.ref.between.join(" and ")}`);
    }
    checkSources(f.sourceIds, where);
    checkResearch(f.research, where);
    for (const key of Object.keys(f.passage ?? {})) {
      const [from, to] = key.split(">");
      if (!from || !to || !samePair([from, to], f.ref.between)) problems.push(`${where}: passage "${key}" is not a direction of this segment`);
    }
    // A door matched to a research description has to be a door of that description's building.
    for (const id of f.research?.portals ?? []) {
      const p = k.portals.get(id);
      if (p && f.ref.kind === "DOOR" && f.ref.between.includes("OUT") && !f.ref.between.includes(p.buildingId)) problems.push(`${where}: portal ${id} is in ${p.buildingId}`);
    }
  }

  for (const h of k.overlay.historical) {
    const where = `historical ${h.kind} ${h.between.join("–")}`;
    checkSources(h.sourceIds, where);
    if (h.connectionId && !k.connections.has(h.connectionId)) problems.push(`${where}: unknown connection ${h.connectionId}`);
    for (const [id, s] of surveyed) {
      if (s.kind === h.kind && samePair(s.between, h.between)) problems.push(`${where}: the surveyed network has one (${id}); it will never be routed`);
    }
  }

  for (const b of k.overlay.buildings) {
    const where = `building fact ${b.code}`;
    if (!buildingIds.has(b.code)) problems.push(`${where}: not a research building`);
    if (b.exterior) {
      checkSources(b.exterior.sourceIds, where);
      for (const id of b.exterior.portalIds) {
        const p = k.portals.get(id);
        if (!p) problems.push(`${where}: unknown portal ${id}`);
        else if (p.buildingId !== b.code) problems.push(`${where}: portal ${id} is in ${p.buildingId}`);
        else {
          // The exterior rule must say what the research says about those doors, not something stronger.
          if (b.exterior.in === "PROHIBITED" && p.entry !== "PROHIBITED") problems.push(`${where}: research does not prohibit entry through ${id}`);
          if (b.exterior.out === "ALLOWED" && p.exit !== "ALLOWED") problems.push(`${where}: research does not allow exit through ${id}`);
        }
      }
    }
    if (b.availability) {
      checkSources(b.availability.sourceIds, where);
      if (b.availability.ruleId && !ruleIds.has(b.availability.ruleId)) problems.push(`${where}: unknown rule ${b.availability.ruleId}`);
    }
  }

  const ids = new Set<string>();
  for (const c of k.overlay.conflicts) {
    if (ids.has(c.id)) problems.push(`conflict ${c.id}: listed twice`);
    ids.add(c.id);
    for (const p of c.positions) checkSources(p.sourceIds, `conflict ${c.id}`);
    checkResearch(c.research, `conflict ${c.id}`);
    checkEdgeIds(c.edgeIds, `conflict ${c.id}`);
  }
  for (const f of k.overlay.fieldChecks) {
    if (ids.has(f.id)) problems.push(`field check ${f.id}: listed twice`);
    ids.add(f.id);
    checkResearch(f.research, `field check ${f.id}`);
    checkEdgeIds(f.edgeIds, `field check ${f.id}`);
  }
  return problems;
}
