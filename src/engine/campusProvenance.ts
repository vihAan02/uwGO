/**
 * Where what a route relies on comes from: official research, community reports, the WATIsGrass survey, UW
 * Go's own review, a visit on the ground, students' closure reports, or a combination of them. A campus
 * decision names these for what activated it and for every door and link it uses, so once field observations
 * are promoted it is plain whether a route turned on a visit, on the research or on the survey alone.
 */
import type { CampusProvenance, CampusProvenanceKind } from "@/domain/types";
import { claimsUsable } from "@/data/campus";
import { edgeLabel } from "@/data/indoor/edgeId";
import { evidenceFor, type IndoorGraph } from "./indoorGraph";

export const PROVENANCE_WORDS: Record<CampusProvenanceKind, string> = {
  OFFICIAL_RESEARCH: "official research",
  FIELD: "field verification",
  UW_GO_REVIEW: "UW Go's review",
  COMMUNITY_RESEARCH: "community reports",
  WATISGRASS: "WATIsGrass survey",
  CLOSURE_REPORTS: "students' closure reports",
};

const ORDER: readonly CampusProvenanceKind[] = ["OFFICIAL_RESEARCH", "FIELD", "UW_GO_REVIEW", "COMMUNITY_RESEARCH", "WATISGRASS", "CLOSURE_REPORTS"];

const ordered = (kinds: ReadonlySet<CampusProvenanceKind>) => ORDER.filter((k) => kinds.has(k));
const lower = (s: string) => s.toLowerCase().replace(/_/g, " ");

function addSourceKinds(g: IndoorGraph, sourceIds: readonly string[], into: Set<CampusProvenanceKind>) {
  for (const id of sourceIds) {
    const source = g.knowledge?.sources.get(id);
    if (source) into.add(source.sourceType === "official" ? "OFFICIAL_RESEARCH" : "COMMUNITY_RESEARCH");
  }
}

const fieldOf = (field: readonly { promotionId: string; observedOn: string; verifiedBy: readonly string[] }[] | undefined) =>
  field?.length ? { field: field.map((f) => ({ promotionId: f.promotionId, observedOn: f.observedOn, verifiedBy: [...f.verifiedBy] })) } : {};

/** Where a segment of the network, and what is known about it, comes from. */
export function segmentProvenance(g: IndoorGraph, index: number, experimental = false, label?: string): CampusProvenance {
  const fact = g.facts[index];
  const from = new Set<CampusProvenanceKind>(["WATISGRASS"]);
  addSourceKinds(g, fact?.sourceIds ?? [], from);
  if (g.knowledge?.overlay.edges.some((f) => f.ref.edgeId === g.ids[index])) from.add("UW_GO_REVIEW");
  if (fact?.field?.length) from.add("FIELD");
  const hasAccess = Object.keys(fact?.access ?? {}).length > 0;
  return {
    subject: g.ids[index],
    label: label ?? fact?.label ?? edgeLabel(g.net, g.net.edges[index]),
    evidence: evidenceFor(g, index, experimental),
    ...(hasAccess ? { accessEvidence: fact!.accessEvidence ?? fact!.evidence } : {}),
    from: ordered(from),
    sourceIds: [...(fact?.sourceIds ?? [])],
    ...fieldOf(fact?.field),
  };
}

/** Where a building's rule about its map point comes from, if it has one. Only visits that checked the rule count. */
export function buildingRuleProvenance(g: IndoorGraph, code: string): CampusProvenance | undefined {
  const fact = g.knowledge?.buildingFacts.get(code);
  const exterior = fact?.exterior;
  if (!exterior) return undefined;
  const from = new Set<CampusProvenanceKind>();
  addSourceKinds(g, exterior.sourceIds, from);
  if (g.knowledge?.overlay.buildings.some((b) => b.code === code && b.exterior)) from.add("UW_GO_REVIEW");
  // A visit that only read the posted hours says nothing about the doors.
  const ruleVisits = fact.field?.filter((f) => f.claims.passage?.[`OUT>${code}`] !== undefined || f.claims.passage?.[`${code}>OUT`] !== undefined);
  if (ruleVisits?.length) from.add("FIELD");
  return {
    subject: `building:${code}`,
    label: `${code}'s rule about its map point (in: ${exterior.in.toLowerCase()}, out: ${exterior.out.toLowerCase()})`,
    evidence: exterior.evidence,
    from: ordered(from),
    sourceIds: [...exterior.sourceIds],
    ...fieldOf(ruleVisits),
  };
}

/** Students' closure reports that made Google's walk unusable. */
export function closuresProvenance(edgeIds: readonly string[]): CampusProvenance {
  return { subject: "closures", label: `${edgeIds.length} path segment${edgeIds.length === 1 ? "" : "s"} reported closed`, from: ["CLOSURE_REPORTS"], sourceIds: [...edgeIds] };
}

/** Every kind of source across several things, strongest first. */
export function provenanceKinds(items: readonly CampusProvenance[]): CampusProvenanceKind[] {
  return ordered(new Set(items.flatMap((p) => p.from)));
}

/** One line: what it is, the evidence routing relied on, every source behind it, and whether its access claims can be relied on. */
export function describeProvenance(p: CampusProvenance): string {
  const sources = p.sourceIds.length && !p.from.includes("CLOSURE_REPORTS") ? ` [${p.sourceIds.join(", ")}]` : "";
  const visits = p.field?.length ? `; checked on the ground ${p.field.map((f) => `${f.observedOn} by ${f.verifiedBy.join(", ")} (${f.promotionId})`).join("; ")}` : "";
  const access = p.accessEvidence ? `; access ${lower(p.accessEvidence)}${claimsUsable(p.accessEvidence, false) ? "" : ", not relied on"}` : "";
  return `${p.label}: ${p.evidence ? `${lower(p.evidence)}, ` : ""}from ${p.from.map((k) => PROVENANCE_WORDS[k]).join(" + ")}${sources}${visits}${access}`;
}
