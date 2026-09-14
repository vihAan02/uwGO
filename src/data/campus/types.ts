/**
 * What UW Go knows about moving around campus beyond the shape of the corridors: whether a door
 * may be used inwards, whether a link still exists, whether it is step-free, when it is open, how
 * sure we are of each of those, and on whose word.
 *
 * The geometry (where a corridor runs) is the surveyed network in src/data/indoor. Nothing here is
 * a coordinate. A fact about a segment is attached to it by the segment's canonical id
 * (src/data/indoor/edgeId.ts), the same id a closure report uses, so a regenerated network cannot
 * silently move a fact onto a different corridor.
 *
 * Files in this directory must only import types, so that Node can load them directly for the
 * audit script (see scripts/audit-campus-routing.mjs).
 */
import type { IndoorEdgeKind } from "../indoor/network";

/**
 * How strong the evidence behind one fact is, strongest first.
 *
 * - OFFICIAL: an explicit university statement about this particular fact.
 * - FIELD_VERIFIED: checked on the ground by someone working on UW Go, recorded as a field observation
 *   and deliberately promoted (src/data/campus/field). Dated: construction or a later survey can make it
 *   stale, which is why the observation's date travels with the fact.
 * - CORROBORATED: two independent sources agree, typically a university statement and the survey's
 *   geometry pointing at the same thing.
 * - SURVEYED: present in the WATIsGrass community survey only. It has real geometry, but nobody has
 *   said anything about permission, hours or access. The whole winter network is this by default.
 * - ANECDOTAL: student or community reports without geometry (Reddit threads, student journalism).
 * - INFERRED: an analytical hypothesis, or a match UW Go made that no source states.
 * - UNRESOLVED: sources disagree, or the only statement is undated or disputed.
 */
export type Evidence = "OFFICIAL" | "FIELD_VERIFIED" | "CORROBORATED" | "SURVEYED" | "ANECDOTAL" | "INFERRED" | "UNRESOLVED";

export const EVIDENCE_ORDER: readonly Evidence[] = ["OFFICIAL", "FIELD_VERIFIED", "CORROBORATED", "SURVEYED", "ANECDOTAL", "INFERRED", "UNRESOLVED"];

/** The weaker of two pieces of evidence: a route is only as certain as its least certain part. */
export function weakerEvidence(a: Evidence, b: Evidence): Evidence {
  return EVIDENCE_ORDER.indexOf(a) >= EVIDENCE_ORDER.indexOf(b) ? a : b;
}

/** The stronger of two pieces of evidence: what a claim rests on once a second source confirms it. */
export function strongerEvidence(a: Evidence, b: Evidence): Evidence {
  return EVIDENCE_ORDER.indexOf(a) <= EVIDENCE_ORDER.indexOf(b) ? a : b;
}

/**
 * Whether routing may use a fact.
 *
 * - ACTIVE: production routing uses it.
 * - EXPERIMENTAL: kept and routable only when a caller explicitly asks for experimental data.
 * - QUARANTINED: kept for provenance, never routed until the reason is resolved.
 * - HISTORICAL: no longer exists. Never routed, kept so a route can explain what it went without.
 */
export type Activation = "ACTIVE" | "EXPERIMENTAL" | "QUARANTINED" | "HISTORICAL";

/** A yes/no the sources may not have answered. `null` is unknown, and unknown is never false. */
export type Known = boolean | null;

/** Whether a door or link may be used in one direction. */
export type Passage =
  | "ALLOWED"
  | "PROHIBITED"
  /** Needs a key, card or lift key the student may not hold. */
  | "CREDENTIAL"
  /** Emergency egress. Not a routine route, however often people use it. */
  | "EMERGENCY_ONLY"
  | "UNKNOWN";

export type ResearchConfidence = "high" | "medium" | "low";

export interface Access {
  /** Step-free from one end to the other. A ramp alone does not make this true. */
  stepFree: Known;
  /** An automatic opener is described. Not tested. */
  automaticDoor: Known;
  /** A ramp is described. Says nothing about its gradient. */
  ramp: Known;
  /** The university lists it as accessible. */
  accessibleDesignation: Known;
  /** Can be completed without a key, a call button or someone's help. */
  independent: Known;
}

export const UNKNOWN_ACCESS: Access = { stepFree: null, automaticDoor: null, ramp: null, accessibleDesignation: null, independent: null };

/** How a change of floor can be made, as far as anyone has seen. */
export type VerticalKind = "STAIRS" | "ELEVATOR" | "RAMP";

/** Day of the week in Toronto, Sunday = 0, as `Date#getDay` numbers it. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface WeeklyWindow {
  days: readonly Weekday[];
  /** Minutes past midnight, Toronto wall clock. */
  open: number;
  /** Minutes past midnight; may exceed 1440 for a close after midnight. */
  close: number;
}

/**
 * When something can be used. A schedule is only ever what a source states: days it says nothing
 * about are listed as unknown rather than filled in.
 */
export type Availability =
  | { kind: "ALWAYS" }
  | { kind: "SCHEDULE"; windows: readonly WeeklyWindow[]; unknownDays?: readonly Weekday[] }
  | { kind: "UNKNOWN" }
  | { kind: "TEMPORARILY_CLOSED"; reason: string; until?: string };

// ---------------------------------------------------------------------------------------------
// The research package, normalised. Field-for-field what the research says, with its own labels
// kept alongside UW Go's, and every unknown still unknown.

export type SourceType = "official" | "student_journalism" | "community_anecdote" | "historical_blog";

export interface ResearchSource {
  id: string;
  title: string;
  url: string;
  publishedDate: string | null;
  publisher: string;
  sourceType: SourceType;
  evidence: Evidence;
  access: string;
  checkedDate: string;
}

export interface ResearchBuilding {
  id: string;
  name: string;
  aliases: string[];
  sourceIds: string[];
  entranceInventoryComplete: boolean;
  notes: string;
  confidence: ResearchConfidence;
}

export interface ResearchPortal {
  id: string;
  buildingId: string;
  description: string;
  recordType: "portal_or_group" | "indirect_access";
  /** Inward use, from `entry_permission`. */
  entry: Passage;
  /** Outward use, from `exit_permission`. */
  exit: Passage;
  /** The research's own words for the two permissions, kept for provenance. */
  raw: { entryPermission: string; exitPermission: string };
  access: Access;
  confidence: ResearchConfidence;
  evidence: Evidence;
  /** What the research alone allows. Never ACTIVE: `routing_enabled` is false on every record. */
  activation: Activation;
  sourceIds: string[];
  checkedDate: string;
  fieldVerifiedAt: string | null;
}

export type ConnectionStatus = "candidate" | "conditional_exclude" | "credential_conditional" | "disputed_exclude" | "demolished_exclude";

export interface ResearchConnection {
  id: string;
  from: string;
  to: string;
  /** Local floor labels per building, exactly as stated; null where the research could not say. */
  levels: Record<string, string | string[] | null> | null;
  connectionType: string;
  condition: string;
  confidence: ResearchConfidence;
  status: ConnectionStatus;
  stepFree: Known;
  evidence: Evidence;
  activation: Activation;
  sourceIds: string[];
}

export type RouteCandidateType = "official_approach" | "community_candidate" | "inferred_candidate";

export interface ResearchRouteCandidate {
  id: string;
  originDestination: string;
  sequence: string[];
  routeType: RouteCandidateType;
  reportedBenefit: string;
  limitation: string;
  confidence: ResearchConfidence;
  evidence: Evidence;
  activation: Activation;
  sourceIds: string[];
}

export interface ResearchRule {
  id: string;
  scope: string;
  type: string;
  rule: string;
  confidence: ResearchConfidence;
  sourceIds: string[];
  eventDatesMustBeConfirmed: boolean;
}

export interface CampusResearch {
  schemaVersion: string;
  asOf: string;
  timezone: string;
  status: string;
  scope: string;
  confidenceDefinitions: Record<ResearchConfidence, string>;
  buildings: ResearchBuilding[];
  portals: ResearchPortal[];
  connections: ResearchConnection[];
  routeCandidates: ResearchRouteCandidate[];
  rules: ResearchRule[];
  sources: ResearchSource[];
  globalUnknowns: string[];
  importPolicy: {
    enableAnyRecordWithoutValidation: boolean;
    unknownBoolean: null;
    neverInferBidirectionality: boolean;
    emergencyEgressIsNotRoutineShortcut: boolean;
  };
  /** Anything the normaliser could not map. Empty for a clean import; a test holds it there. */
  issues: string[];
}

// ---------------------------------------------------------------------------------------------
// UW Go's reviewed decisions: how the research attaches to the surveyed network.

/**
 * A segment of the surveyed network, named three ways: the id facts attach to, plus the kind and
 * the two buildings it joins. A test checks all three agree, so a regenerated network that moved a
 * segment fails loudly instead of quietly re-pointing a fact.
 */
export interface NetworkEdgeRef {
  edgeId: string;
  kind: IndoorEdgeKind;
  /** Building codes at the two ends, "OUT" for outside, in either order. */
  between: readonly [string, string];
}

/** A promotion of field observations that a fact now rests on. See src/data/campus/field. */
export interface FieldProvenance {
  promotionId: string;
  observationIds: readonly string[];
  /** Date of the latest observation promoted, YYYY-MM-DD, on the verifier's own clock. */
  observedOn: string;
  /** Who checked on the ground. */
  verifiedBy: readonly string[];
  reviewedAt: string;
  /** What the promotion claimed; `describeClaims` in field/rules.ts puts it in words. */
  claims: import("./field/types").FieldClaims;
}

export interface EdgeFact {
  ref: NetworkEdgeRef;
  label: string;
  research?: { portals?: readonly string[]; connection?: string; rules?: readonly string[]; candidates?: readonly string[] };
  activation: Activation;
  evidence: Evidence;
  sourceIds: readonly string[];
  /** Why UW Go believes this, in plain words. */
  basis: string;
  /**
   * Passage per direction, keyed "FROM>TO" with building codes ("OUT>SLC" is entering SLC from
   * outside). A direction not listed keeps the survey's default: usable, as surveyed.
   */
  passage?: Readonly<Record<string, Passage>>;
  access?: Partial<Access>;
  availability?: Availability;
  /** Evidence for the passage claims when it differs from the segment's own. */
  passageEvidence?: Evidence;
  /**
   * Evidence for the access claims when it differs from the segment's own. A visit that confirms which door
   * this is does not confirm what a research description said about its opener, so routing relies on access
   * claims by this, not by `evidence`.
   */
  accessEvidence?: Evidence;
  /**
   * How this change of floor can be made, where someone has seen it: the survey's kind is only its first
   * word. It decides the timing and what a route says; a step-free route still needs `access.stepFree`.
   */
  vertical?: readonly VerticalKind[];
  /** Evidence for `vertical` when it differs from the segment's own. */
  verticalEvidence?: Evidence;
  /** The field observations this fact rests on, once promoted. */
  field?: readonly FieldProvenance[];
}

/**
 * A link the sources say is gone. Matched by kind and building pair rather than by id, because the
 * point is that no current segment should exist there: if a future survey import brings one back,
 * it is treated as historical until someone records the replacement.
 */
export interface HistoricalLink {
  kind: IndoorEdgeKind;
  between: readonly [string, string];
  connectionId?: string;
  removed: string;
  sourceIds: readonly string[];
  basis: string;
}

export interface BuildingFact {
  code: string;
  /**
   * How the building's campus-map point may be used as a way in and out. A walk routed to a
   * building's map point arrives at whichever door is nearest it, so this is what such a route relies
   * on. Absent means nothing is known, which keeps today's behaviour.
   */
  exterior?: {
    in: Passage;
    out: Passage;
    portalIds: readonly string[];
    evidence: Evidence;
    sourceIds: readonly string[];
    basis: string;
    /** What to tell a student whose only route relies on a way in that is not allowed. */
    arrivalAdvice: string;
  };
  availability?: { value: Availability; ruleId?: string; evidence: Evidence; sourceIds: readonly string[]; basis: string };
  /** The field observations this building's facts rest on, once promoted. */
  field?: readonly FieldProvenance[];
}

export interface Conflict {
  id: string;
  subject: string;
  /** What each side says. */
  positions: readonly { says: string; sourceIds: readonly string[] }[];
  treatment: string;
  research?: { portals?: readonly string[]; connections?: readonly string[]; rules?: readonly string[] };
  edgeIds?: readonly string[];
}

export interface FieldCheck {
  id: string;
  /** 1 = blocks a production decision, 2 = would improve routing, 3 = completeness. */
  priority: 1 | 2 | 3;
  where: string;
  question: string;
  why: string;
  research?: { portals?: readonly string[]; connections?: readonly string[]; rules?: readonly string[] };
  edgeIds?: readonly string[];
}

export interface CampusOverlay {
  reviewedAt: string;
  edges: readonly EdgeFact[];
  historical: readonly HistoricalLink[];
  buildings: readonly BuildingFact[];
  conflicts: readonly Conflict[];
  fieldChecks: readonly FieldCheck[];
}
