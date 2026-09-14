/**
 * The research, UW Go's reviewed decisions and the field observations promoted into facts, indexed for
 * routing, plus the checks that keep all three honest against the surveyed network.
 *
 * Type-only imports: scripts/audit-campus-routing.mjs loads this file directly with Node.
 */
import type { IndoorEdge, IndoorEdgeKind, IndoorNetwork } from "../indoor/network";
import type {
  Access,
  BuildingFact,
  CampusOverlay,
  CampusResearch,
  EdgeFact,
  Evidence,
  FieldProvenance,
  HistoricalLink,
  NetworkEdgeRef,
  ResearchConnection,
  ResearchPortal,
  ResearchSource,
} from "./types";
import type { FieldPromotion } from "./field/types";

export interface CampusKnowledge {
  research: CampusResearch;
  overlay: CampusOverlay;
  /** Field observations promoted into facts, in the order they were applied. */
  promotions: readonly FieldPromotion[];
  edgeFacts: ReadonlyMap<string, EdgeFact>;
  buildingFacts: ReadonlyMap<string, BuildingFact>;
  historical: readonly HistoricalLink[];
  sources: ReadonlyMap<string, ResearchSource>;
  portals: ReadonlyMap<string, ResearchPortal>;
  connections: ReadonlyMap<string, ResearchConnection>;
}

/** Strongest first. The same as EVIDENCE_ORDER in types.ts, which Node cannot import from here at runtime; a test holds them equal. */
export const EVIDENCE_STRENGTH: readonly Evidence[] = ["OFFICIAL", "FIELD_VERIFIED", "CORROBORATED", "SURVEYED", "ANECDOTAL", "INFERRED", "UNRESOLVED"];
const stronger = (a: Evidence, b: Evidence): Evidence => (EVIDENCE_STRENGTH.indexOf(a) <= EVIDENCE_STRENGTH.indexOf(b) ? a : b);
const weaker = (a: Evidence, b: Evidence): Evidence => (EVIDENCE_STRENGTH.indexOf(a) >= EVIDENCE_STRENGTH.indexOf(b) ? a : b);

const VERTICAL: readonly IndoorEdgeKind[] = ["STAIRS", "ELEVATOR", "RAMP", "OTHER_VERTICAL"];

const samePair = (a: readonly [string, string], b: readonly [string, string]) =>
  (a[0] === b[0] && a[1] === b[1]) || (a[0] === b[1] && a[1] === b[0]);

/** Whether "FROM>TO" is a direction of a segment between these two buildings. */
const isDirectionOf = (key: string, between: readonly [string, string]) => {
  const [from, to] = key.split(">");
  return Boolean(from && to) && samePair([from, to], between);
};

const provenanceOf = (p: FieldPromotion): FieldProvenance => ({
  promotionId: p.id,
  observationIds: p.observationIds,
  observedOn: p.observedOn,
  verifiedBy: p.verifiedBy,
  reviewedAt: p.reviewedAt,
  claims: p.claims,
});

/**
 * A segment's fact with a promotion applied. Each kind of claim keeps its own evidence, so a visit vouches only
 * for what it claimed:
 * - which segment this is (`evidence`, and so what crossing it costs) rises to at least FIELD_VERIFIED when the
 *   visit found it where UW Go shows it, and falls to UNRESOLVED, with the segment quarantined, when it did not;
 * - a passage or access claim the visit confirmed keeps stronger evidence, one it added or changed rests on
 *   FIELD_VERIFIED, and one it did not check keeps the evidence it had. An old access claim routing could not rely
 *   on is set aside rather than vouched for, unless it is a restriction, which applies whatever its evidence;
 * - how a change of floor is made only ever gains kinds, since no visit can show an elevator is not there.
 */
function promoteEdge(existing: EdgeFact | undefined, ref: NetworkEdgeRef, p: FieldPromotion): EdgeFact {
  const c = p.claims;
  const base: EdgeFact = existing ?? { ref, label: p.label ?? `${ref.between.join("–")} ${ref.kind.toLowerCase()}`, activation: "ACTIVE", evidence: "SURVEYED", sourceIds: [], basis: "" };
  const claimedPassage = Object.fromEntries(Object.entries(c.passage ?? {}).filter(([key]) => isDirectionOf(key, ref.between)));
  const claimedAccess = Object.fromEntries(Object.entries(c.access ?? {}).filter(([, value]) => value !== undefined)) as Partial<Access>;
  const claimedVertical = c.vertical ?? [];
  const hasPassage = Object.keys(claimedPassage).length > 0;
  const hasAccess = Object.keys(claimedAccess).length > 0;
  const wrongPlace = c.placement === "WRONG";
  const confirmed = !wrongPlace && (c.placement === "CONFIRMED" || hasPassage || hasAccess || claimedVertical.length > 0 || c.activation === "ACTIVE");
  const notes: string[] = [];

  let passage = base.passage;
  let passageEvidence = base.passageEvidence;
  if (hasPassage) {
    const before = base.passageEvidence ?? base.evidence;
    passage = { ...base.passage, ...claimedPassage };
    const confirmsOnly = Object.entries(claimedPassage).every(([key, value]) => base.passage?.[key] === value);
    const allClaimed = Object.keys(passage).every((key) => key in claimedPassage);
    passageEvidence = confirmsOnly ? stronger(before, "FIELD_VERIFIED") : allClaimed ? "FIELD_VERIFIED" : weaker(before, "FIELD_VERIFIED");
  }

  let access = base.access;
  let accessEvidence = base.accessEvidence;
  const accessBefore = base.accessEvidence ?? base.evidence;
  const accessUsableBefore = claimsUsable(accessBefore, false);
  if (hasAccess) {
    const unchecked = Object.entries(base.access ?? {}).filter(([flag]) => !(flag in claimedAccess));
    const kept = unchecked.filter(([, value]) => accessUsableBefore || value === false);
    const setAside = unchecked.filter(([, value]) => !accessUsableBefore && value === true).map(([flag]) => flag);
    if (setAside.length) notes.push(`Set aside because nobody checked them and nothing routing relies on stated them: ${setAside.join(", ")}.`);
    access = { ...Object.fromEntries(kept), ...claimedAccess };
    const confirmsOnly = Object.entries(claimedAccess).every(([flag, value]) => base.access?.[flag as keyof Access] === value);
    const widerKept = kept.some(([, value]) => value !== false);
    accessEvidence = widerKept ? weaker(accessBefore, "FIELD_VERIFIED") : confirmsOnly && accessUsableBefore ? stronger(accessBefore, "FIELD_VERIFIED") : "FIELD_VERIFIED";
  } else if (base.access && (confirmed || wrongPlace)) {
    // The visit settled which segment this is, not what anyone said about its access.
    accessEvidence = wrongPlace ? "UNRESOLVED" : accessBefore;
  }

  let vertical = base.vertical;
  let verticalEvidence = base.verticalEvidence;
  if (claimedVertical.length) {
    vertical = [...new Set([...(base.vertical ?? []), ...claimedVertical])];
    verticalEvidence = base.vertical?.length ? weaker(base.verticalEvidence ?? base.evidence, "FIELD_VERIFIED") : "FIELD_VERIFIED";
  } else if (base.vertical && (confirmed || wrongPlace)) {
    verticalEvidence = wrongPlace ? "UNRESOLVED" : base.verticalEvidence ?? base.evidence;
  }

  return {
    ...base,
    // A segment not where UW Go shows it leaves routing until someone finds it where shown.
    activation: c.activation ?? (wrongPlace && base.activation !== "HISTORICAL" ? "QUARANTINED" : base.activation),
    evidence: wrongPlace ? "UNRESOLVED" : confirmed ? stronger(base.evidence, "FIELD_VERIFIED") : base.evidence,
    passage,
    passageEvidence,
    access,
    accessEvidence,
    vertical,
    verticalEvidence,
    basis: [base.basis, `Checked on the ground ${p.observedOn} (${p.id}): ${p.basis}`, ...notes].filter(Boolean).join(" "),
    field: [...(base.field ?? []), provenanceOf(p)],
  };
}

/** A building's facts with a promotion applied: its rule about its map point, and its posted hours. */
function promoteBuilding(existing: BuildingFact | undefined, code: string, p: FieldPromotion): BuildingFact {
  const c = p.claims;
  const base: BuildingFact = existing ?? { code };
  const inward = c.passage?.[`OUT>${code}`];
  const outward = c.passage?.[`${code}>OUT`];
  let exterior = base.exterior;
  if (exterior && (inward || outward)) {
    const changed = (inward !== undefined && inward !== exterior.in) || (outward !== undefined && outward !== exterior.out);
    exterior = { ...exterior, in: inward ?? exterior.in, out: outward ?? exterior.out, evidence: changed ? "FIELD_VERIFIED" : stronger(exterior.evidence, "FIELD_VERIFIED") };
  }
  let availability = base.availability;
  if (c.hours) {
    const same = availability && JSON.stringify(availability.value) === JSON.stringify(c.hours);
    availability = same
      ? { ...availability!, evidence: stronger(availability!.evidence, "FIELD_VERIFIED") }
      : { value: c.hours, evidence: "FIELD_VERIFIED", sourceIds: [], basis: `Hours posted on site, read ${p.observedOn} (${p.id}): ${p.basis}` };
  }
  return { ...base, exterior, availability, field: [...(base.field ?? []), provenanceOf(p)] };
}

export function compileKnowledge(research: CampusResearch, overlay: CampusOverlay, promotions: readonly FieldPromotion[] = []): CampusKnowledge {
  const edgeFacts = new Map<string, EdgeFact>(overlay.edges.map((f) => [f.ref.edgeId, f]));
  const buildingFacts = new Map<string, BuildingFact>(overlay.buildings.map((b) => [b.code, b]));
  for (const p of promotions) {
    if ("edges" in p.subject) for (const ref of p.subject.edges) edgeFacts.set(ref.edgeId, promoteEdge(edgeFacts.get(ref.edgeId), ref, p));
    else buildingFacts.set(p.subject.building, promoteBuilding(buildingFacts.get(p.subject.building), p.subject.building, p));
  }
  return {
    research,
    overlay,
    promotions,
    edgeFacts,
    buildingFacts,
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
 * be relied on. Official, field-verified and corroborated claims always; anecdotal and inferred ones
 * only when a caller explicitly asks for experimental data; unresolved ones never.
 */
export function claimsUsable(evidence: Evidence, experimental: boolean): boolean {
  if (evidence === "OFFICIAL" || evidence === "FIELD_VERIFIED" || evidence === "CORROBORATED") return true;
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

/**
 * Everything wrong with the knowledge as it stands, as sentences. Empty means every reference
 * resolves: each fact's segment exists with the kind and buildings it claims, each research id
 * and source exists, no historical link has reappeared as a live segment, and no promotion allows
 * what stronger evidence restricts, or lifts a quarantine, without saying how and why.
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
  const checkRef = (ref: NetworkEdgeRef, where: string) => {
    const s = surveyed.get(ref.edgeId);
    if (!s) problems.push(`${where}: no surveyed segment has id ${ref.edgeId}`);
    else {
      if (s.kind !== ref.kind) problems.push(`${where}: ${ref.edgeId} is surveyed as ${s.kind}, not ${ref.kind}`);
      if (!samePair(s.between, ref.between)) problems.push(`${where}: ${ref.edgeId} is surveyed between ${s.between.join(" and ")}, not ${ref.between.join(" and ")}`);
    }
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
      if (!isDirectionOf(key, f.ref.between)) problems.push(`${where}: passage "${key}" is not a direction of this segment`);
    }
    if (f.vertical && !VERTICAL.includes(f.ref.kind)) problems.push(`${where}: says how a change of floor is made, but it is a ${f.ref.kind}`);
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

  const networkBuildings = new Set([...surveyed.values()].flatMap((s) => [...s.between]));
  const promotionIds = new Set<string>();
  for (const p of k.promotions) {
    const where = `promotion ${p.id}`;
    if (promotionIds.has(p.id)) problems.push(`${where}: listed twice`);
    promotionIds.add(p.id);
    if (!p.observationIds.length) problems.push(`${where}: rests on no observation`);
    if (!p.basis.trim()) problems.push(`${where}: gives no basis`);
    const c = p.claims;
    if ("edges" in p.subject) {
      if (!p.subject.edges.length) problems.push(`${where}: names no segment`);
      if (c.hours) problems.push(`${where}: hours belong to a building, not a segment`);
      for (const key of Object.keys(c.passage ?? {})) {
        if (!p.subject.edges.some((ref) => isDirectionOf(key, ref.between))) problems.push(`${where}: passage "${key}" is not a direction of any segment it names`);
      }
      for (const ref of p.subject.edges) {
        checkRef(ref, where);
        if (c.vertical && !VERTICAL.includes(ref.kind)) problems.push(`${where}: ${ref.edgeId} is a ${ref.kind}, not a change of floor`);
        if (k.overlay.historical.some((h) => h.kind === ref.kind && samePair(h.between, ref.between))) problems.push(`${where}: ${ref.edgeId} is a link recorded as demolished`);
        const stated = k.overlay.edges.find((f) => f.ref.edgeId === ref.edgeId);
        if (!stated) continue;
        for (const [key, passage] of Object.entries(c.passage ?? {})) {
          const before = stated.passage?.[key];
          if (passage === "ALLOWED" && before && before !== "ALLOWED" && before !== "UNKNOWN" && !p.supersedes) problems.push(`${where}: "${key}" would allow what ${stated.label} restricts; say why in supersedes`);
        }
        for (const [flag, value] of Object.entries(c.access ?? {})) {
          if (value === true && stated.access?.[flag as keyof Access] === false && !p.supersedes) problems.push(`${where}: ${flag} contradicts ${stated.label}, recorded as not; say why in supersedes`);
        }
        // Lifting a quarantine has to say which ways the segment may now be used, or why not.
        if (stated.activation === "QUARANTINED" && c.activation === "ACTIVE" && !p.supersedes) {
          const [a, b] = ref.between;
          const unsaid = [`${a}>${b}`, `${b}>${a}`].filter((key) => !c.passage?.[key]);
          if (unsaid.length) problems.push(`${where}: lifts the quarantine on ${stated.label} without a passage for ${unsaid.join(" and ")}; claim both directions, or say why in supersedes`);
        }
      }
    } else {
      const code = p.subject.building;
      if (!buildingIds.has(code) && !networkBuildings.has(code)) problems.push(`${where}: ${code} is neither a research building nor on the network`);
      if (c.access || c.vertical || c.placement) problems.push(`${where}: access, changes of floor and placement belong to a segment, not a building`);
      const stated = k.overlay.buildings.find((b) => b.code === code);
      for (const [key, passage] of Object.entries(c.passage ?? {})) {
        const direction = key === `OUT>${code}` ? "in" : key === `${code}>OUT` ? "out" : undefined;
        if (!direction) { problems.push(`${where}: passage "${key}" is not into or out of ${code}`); continue; }
        if (!stated?.exterior) { problems.push(`${where}: ${code} has no rule about its map point for "${key}" to confirm`); continue; }
        if (passage === "ALLOWED" && stated.exterior[direction] !== "ALLOWED" && !p.supersedes) problems.push(`${where}: "${key}" would allow what ${code}'s rule restricts; say why in supersedes`);
      }
      if (c.hours && stated?.availability?.evidence === "OFFICIAL" && JSON.stringify(stated.availability.value) !== JSON.stringify(c.hours) && !p.supersedes) {
        problems.push(`${where}: would replace ${code}'s official hours; say why in supersedes`);
      }
    }
  }
  return problems;
}
