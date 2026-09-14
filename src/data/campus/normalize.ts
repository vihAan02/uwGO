/**
 * The research package, read into UW Go's shapes without adding anything to it.
 *
 * The published JSON (research/uwgo-routing-research-2026-09-14.json) is kept byte for byte. This
 * renames fields, maps the research's own labels onto UW Go's evidence and activation scales, and
 * checks what the research promises about itself: no coordinates, no opening hours, no measured
 * times, and routing disabled on every record. Anything it cannot map is reported in `issues`
 * rather than guessed; a clean import has none.
 *
 * Type-only imports: scripts/audit-campus-routing.mjs loads this file directly with Node.
 */
import type {
  Access,
  Activation,
  CampusResearch,
  ConnectionStatus,
  Evidence,
  Passage,
  ResearchBuilding,
  ResearchConfidence,
  ResearchConnection,
  ResearchPortal,
  ResearchRouteCandidate,
  ResearchRule,
  ResearchSource,
  RouteCandidateType,
  SourceType,
} from "./types";

/** The published schema (version 1.0), as far as UW Go reads it. */
export interface RawResearch {
  schema_version: string;
  as_of: string;
  timezone: string;
  status: string;
  scope: string;
  confidence_definitions: Record<string, string>;
  buildings: { id: string; name: string; aliases: string[]; source_ids: string[]; entrance_inventory_complete: boolean; notes: string; confidence: string }[];
  portals: {
    id: string; building_id: string; description: string; record_type: string; geometry: unknown; interior_level: unknown;
    entry_permission: string; exit_permission: string; automatic_entry: boolean | null; automatic_exit: boolean | null;
    ramp_reported: boolean | null; accessible_designation: boolean | null; step_free_end_to_end: boolean | null;
    opening_hours: unknown; confidence: string; evidence_type: string; source_ids: string[]; field_verified_at: string | null;
    checked_date: string; routing_enabled: boolean;
  }[];
  connections: {
    id: string; from_building: string; to_building: string; levels: Record<string, string | string[] | null> | null; connection_type: string;
    condition: string; confidence: string; source_ids: string[]; status: string; step_free_end_to_end: boolean | null;
    geometry: unknown; measured_seconds: unknown; routing_enabled: boolean;
  }[];
  route_candidates: {
    id: string; origin_destination: string; sequence: string[]; route_type: string; reported_benefit: string; limitation: string;
    confidence: string; source_ids: string[]; geometry: unknown; measured_seconds: unknown; routing_enabled: boolean;
  }[];
  rules: { id: string; scope: string; type: string; rule: string; source_ids: string[]; confidence: string; event_dates_must_be_confirmed?: boolean }[];
  sources: { id: string; title: string; url: string; published_date: string | null; publisher: string; source_type: string; access: string; checked_date: string }[];
  global_unknowns: string[];
  import_policy: { enable_any_record_without_validation: boolean; unknown_boolean: null; never_infer_bidirectionality: boolean; emergency_egress_is_not_routine_shortcut: boolean };
}

const CONFIDENCES: readonly ResearchConfidence[] = ["high", "medium", "low"];
const SOURCE_TYPES: readonly SourceType[] = ["official", "student_journalism", "community_anecdote", "historical_blog"];
const STATUSES: readonly ConnectionStatus[] = ["candidate", "conditional_exclude", "credential_conditional", "disputed_exclude", "demolished_exclude"];
const ROUTE_TYPES: readonly RouteCandidateType[] = ["official_approach", "community_candidate", "inferred_candidate"];

function oneOf<T extends string>(allowed: readonly T[], value: string, where: string, issues: string[], fallback: T): T {
  if ((allowed as readonly string[]).includes(value)) return value as T;
  issues.push(`${where}: unrecognised value "${value}"`);
  return fallback;
}

/** A university page is official; everything else the research cites is someone's account of it. */
export function evidenceOfSourceType(type: SourceType): Evidence {
  return type === "official" ? "OFFICIAL" : "ANECDOTAL";
}

/** Inward permission. "Documented entrance, conditions incomplete" is a way in whose hours and conditions nobody stated. */
function entryOf(value: string): Passage | undefined {
  switch (value) {
    case "documented_entrance_conditions_incomplete": return "ALLOWED";
    case "prohibited_normal_entry": return "PROHIBITED";
    case "credential_required": return "CREDENTIAL";
    case "unknown": return "UNKNOWN";
    default: return undefined;
  }
}

/** Outward permission. "Exit-only reported" is an explicit statement that going out is how the door is used. */
function exitOf(value: string): Passage | undefined {
  switch (value) {
    case "exit_only_reported": return "ALLOWED";
    case "unknown": return "UNKNOWN";
    default: return undefined;
  }
}

/**
 * The research's own definitions: "low" is an anecdote, a weakly supported inference, a stale
 * closure or an unresolved conflict. An official description rated low is therefore not something
 * to route on, whatever its source.
 */
function descriptionEvidence(evidenceType: string, confidence: ResearchConfidence): Evidence {
  if (evidenceType !== "official_description") return "UNRESOLVED";
  return confidence === "low" ? "UNRESOLVED" : "OFFICIAL";
}

function connectionActivation(status: ConnectionStatus): Activation {
  switch (status) {
    case "demolished_exclude": return "HISTORICAL";
    case "conditional_exclude":
    case "disputed_exclude": return "QUARANTINED";
    // A candidate is described, not validated: UW Go's overlay has to promote it.
    case "candidate":
    case "credential_conditional": return "EXPERIMENTAL";
  }
}

function candidateEvidence(type: RouteCandidateType, confidence: ResearchConfidence): Evidence {
  if (type === "community_candidate") return "ANECDOTAL";
  if (type === "inferred_candidate") return "INFERRED";
  return confidence === "low" ? "UNRESOLVED" : "OFFICIAL";
}

const hasValue = (v: unknown) => v !== null && v !== undefined;

export function normalizeResearch(raw: RawResearch): CampusResearch {
  const issues: string[] = [];

  const sources: ResearchSource[] = raw.sources.map((s) => {
    const sourceType = oneOf(SOURCE_TYPES, s.source_type, `source ${s.id} source_type`, issues, "community_anecdote");
    return {
      id: s.id, title: s.title, url: s.url, publishedDate: s.published_date, publisher: s.publisher, sourceType,
      evidence: evidenceOfSourceType(sourceType), access: s.access, checkedDate: s.checked_date,
    };
  });
  const sourceById = new Map(sources.map((s) => [s.id, s]));
  const checkSources = (ids: string[], where: string) => {
    for (const id of ids) if (!sourceById.has(id)) issues.push(`${where}: cites unknown source ${id}`);
  };

  const buildings: ResearchBuilding[] = raw.buildings.map((b) => {
    checkSources(b.source_ids, `building ${b.id}`);
    if (b.entrance_inventory_complete) issues.push(`building ${b.id}: claims a complete entrance inventory`);
    return {
      id: b.id, name: b.name, aliases: [...b.aliases], sourceIds: [...b.source_ids],
      entranceInventoryComplete: b.entrance_inventory_complete, notes: b.notes,
      confidence: oneOf(CONFIDENCES, b.confidence, `building ${b.id} confidence`, issues, "low"),
    };
  });
  const buildingIds = new Set(buildings.map((b) => b.id));

  const portals: ResearchPortal[] = raw.portals.map((p) => {
    const where = `portal ${p.id}`;
    checkSources(p.source_ids, where);
    if (!buildingIds.has(p.building_id)) issues.push(`${where}: unknown building ${p.building_id}`);
    // The research promises these are unknown. If a later edition fills one in, it has to be
    // modelled deliberately, not dropped on the floor here.
    if (hasValue(p.geometry)) issues.push(`${where}: has geometry, which this importer does not read`);
    if (hasValue(p.interior_level)) issues.push(`${where}: has an interior level, which this importer does not read`);
    if (hasValue(p.opening_hours)) issues.push(`${where}: has opening hours, which this importer does not read`);
    if (hasValue(p.automatic_exit)) issues.push(`${where}: has automatic_exit, which this importer does not read`);
    if (p.routing_enabled) issues.push(`${where}: routing_enabled is true`);
    const entry = entryOf(p.entry_permission);
    const exit = exitOf(p.exit_permission);
    if (!entry) issues.push(`${where}: unrecognised entry_permission "${p.entry_permission}"`);
    if (!exit) issues.push(`${where}: unrecognised exit_permission "${p.exit_permission}"`);
    const confidence = oneOf(CONFIDENCES, p.confidence, `${where} confidence`, issues, "low");
    const evidence = descriptionEvidence(p.evidence_type, confidence);
    const access: Access = {
      stepFree: p.step_free_end_to_end ?? null,
      automaticDoor: p.automatic_entry ?? null,
      ramp: p.ramp_reported ?? null,
      accessibleDesignation: p.accessible_designation ?? null,
      independent: null,
    };
    return {
      id: p.id, buildingId: p.building_id, description: p.description,
      recordType: oneOf(["portal_or_group", "indirect_access"] as const, p.record_type, `${where} record_type`, issues, "portal_or_group"),
      entry: entry ?? "UNKNOWN", exit: exit ?? "UNKNOWN",
      raw: { entryPermission: p.entry_permission, exitPermission: p.exit_permission },
      access, confidence, evidence,
      activation: evidence === "UNRESOLVED" ? "QUARANTINED" : "EXPERIMENTAL",
      sourceIds: [...p.source_ids], checkedDate: p.checked_date, fieldVerifiedAt: p.field_verified_at,
    };
  });

  const connections: ResearchConnection[] = raw.connections.map((c) => {
    const where = `connection ${c.id}`;
    checkSources(c.source_ids, where);
    for (const b of [c.from_building, c.to_building]) if (!buildingIds.has(b)) issues.push(`${where}: unknown building ${b}`);
    if (hasValue(c.geometry)) issues.push(`${where}: has geometry, which this importer does not read`);
    if (hasValue(c.measured_seconds)) issues.push(`${where}: has a measured time, which this importer does not read`);
    if (c.routing_enabled) issues.push(`${where}: routing_enabled is true`);
    const status = oneOf(STATUSES, c.status, `${where} status`, issues, "disputed_exclude");
    const confidence = oneOf(CONFIDENCES, c.confidence, `${where} confidence`, issues, "low");
    const cited = c.source_ids.map((id) => sourceById.get(id)).filter((s): s is ResearchSource => Boolean(s));
    const evidence: Evidence = status === "disputed_exclude" || confidence === "low"
      ? "UNRESOLVED"
      : cited.some((s) => s.evidence === "OFFICIAL") ? "OFFICIAL" : "ANECDOTAL";
    return {
      id: c.id, from: c.from_building, to: c.to_building, levels: c.levels, connectionType: c.connection_type,
      condition: c.condition, confidence, status, stepFree: c.step_free_end_to_end ?? null,
      evidence, activation: connectionActivation(status), sourceIds: [...c.source_ids],
    };
  });

  const routeCandidates: ResearchRouteCandidate[] = raw.route_candidates.map((r) => {
    const where = `route candidate ${r.id}`;
    checkSources(r.source_ids, where);
    if (hasValue(r.geometry)) issues.push(`${where}: has geometry, which this importer does not read`);
    if (hasValue(r.measured_seconds)) issues.push(`${where}: has a measured time, which this importer does not read`);
    if (r.routing_enabled) issues.push(`${where}: routing_enabled is true`);
    const routeType = oneOf(ROUTE_TYPES, r.route_type, `${where} route_type`, issues, "inferred_candidate");
    const confidence = oneOf(CONFIDENCES, r.confidence, `${where} confidence`, issues, "low");
    return {
      id: r.id, originDestination: r.origin_destination, sequence: [...r.sequence], routeType,
      reportedBenefit: r.reported_benefit, limitation: r.limitation, confidence,
      evidence: candidateEvidence(routeType, confidence), activation: "EXPERIMENTAL", sourceIds: [...r.source_ids],
    };
  });

  const rules: ResearchRule[] = raw.rules.map((r) => {
    checkSources(r.source_ids, `rule ${r.id}`);
    return {
      id: r.id, scope: r.scope, type: r.type, rule: r.rule,
      confidence: oneOf(CONFIDENCES, r.confidence, `rule ${r.id} confidence`, issues, "low"),
      sourceIds: [...r.source_ids], eventDatesMustBeConfirmed: r.event_dates_must_be_confirmed ?? false,
    };
  });

  const seen = new Set<string>();
  for (const id of [...buildings, ...portals, ...connections, ...routeCandidates, ...rules, ...sources].map((r) => r.id)) {
    if (seen.has(id)) issues.push(`duplicate id ${id}`);
    seen.add(id);
  }

  const definitions = raw.confidence_definitions;
  return {
    schemaVersion: raw.schema_version,
    asOf: raw.as_of,
    timezone: raw.timezone,
    status: raw.status,
    scope: raw.scope,
    confidenceDefinitions: { high: definitions.high ?? "", medium: definitions.medium ?? "", low: definitions.low ?? "" },
    buildings,
    portals,
    connections,
    routeCandidates,
    rules,
    sources,
    globalUnknowns: [...raw.global_unknowns],
    importPolicy: {
      enableAnyRecordWithoutValidation: raw.import_policy.enable_any_record_without_validation,
      unknownBoolean: null,
      neverInferBidirectionality: raw.import_policy.never_infer_bidirectionality,
      emergencyEgressIsNotRoutineShortcut: raw.import_policy.emergency_egress_is_not_routine_shortcut,
    },
    issues,
  };
}
