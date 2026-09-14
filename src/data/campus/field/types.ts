/**
 * Field verification: what someone checked on the ground, kept apart from the knowledge routing uses.
 *
 * An observation records one visit: which door, link or place, what was found, when and by whom. It
 * never changes a route. Observations are captured on a phone at /dev/campus-audit, exported from
 * there, and imported into `observations/` by scripts/campus-field.mjs. A promotion (`promotions.ts`)
 * is the deliberate, reviewed step that turns what observations support into routing facts with
 * FIELD_VERIFIED evidence, naming the observations, so a route can say what it rests on.
 *
 * Type-only imports: Node loads these files for scripts/campus-field.mjs.
 */
import type { Access, Activation, Availability, Evidence, NetworkEdgeRef, Passage, VerticalKind } from "../types";

/** What a verifier can say about a door, link or change of floor with one tap. */
export type FieldMark =
  | "ENTRY_WORKS"
  | "EXIT_WORKS"
  | "BOTH_WAYS"
  /** The way (or ways) not marked as working is locked, signed exit-only, or needs a card or key. */
  | "LOCKED"
  | "AUTOMATIC_DOOR"
  | "STAIRS"
  | "RAMP"
  | "ELEVATOR"
  | "ACCESSIBLE"
  | "NOT_ACCESSIBLE"
  | "WRONG_LOCATION"
  | "DOES_NOT_EXIST";

/**
 * What a verification target is.
 *
 * - DOOR: a surveyed door to outside.
 * - LINK: a surveyed crossing between two buildings (bridge, tunnel, corridor, open join).
 * - VERTICAL: a surveyed change of floor (a stairwell point and every floor it joins).
 * - PORTAL: a door group the research describes but UW Go could not match to a surveyed door. It has
 *   no coordinate of its own.
 * - RULE: a rule about a building's way in or out that routing enforces (PAC's exit-only corners).
 * - HOURS: a building's opening hours, unknown or stated.
 * - CHECK: a reviewer's open question that no single door or link answers.
 * - LEAD: a research route candidate or connection that is not routed.
 */
export type FieldTargetKind = "DOOR" | "LINK" | "VERTICAL" | "PORTAL" | "RULE" | "HOURS" | "CHECK" | "LEAD";

/** A direction a door or link is used in. For a door, entry is from outside into the building. */
export interface FieldDirection {
  from: string;
  to: string;
  label: string;
}

/**
 * What an observation was about, as the page showed it at the time. Kept with the observation so it can
 * be reviewed after the list of targets has moved on.
 */
export interface FieldTargetRef {
  id: string;
  kind: FieldTargetKind;
  name: string;
  building?: string;
  /** The surveyed segments the target is about; empty for a place with none. */
  edgeIds: readonly string[];
  entry?: FieldDirection;
  exit?: FieldDirection;
  /** What UW Go believed when the observation was made. */
  shown: { evidence: Evidence; activation: Activation; knowledgeReviewedAt: string };
}

export interface FieldPosition {
  lat: number;
  lng: number;
  accuracyMetres?: number;
}

export interface FieldObservation {
  /** "fo-" + UTC time as YYYYMMDDTHHMMSSZ + a random suffix: unique without a server. */
  id: string;
  target: FieldTargetRef;
  /** When, as ISO 8601 with the verifier's own UTC offset, so its date is the day they were there. */
  observedAt: string;
  /** Who checked: initials or a name, as typed. */
  verifier: string;
  marks: readonly FieldMark[];
  note?: string;
  /** Where the thing really is, when it is not where UW Go put it or has no position at all. */
  correctedLocation?: FieldPosition & { source: "GPS" | "MAP" };
  /** Where the verifier stood when saving, if the phone would say. */
  observerPosition?: FieldPosition;
  /** A photo's name in the verifier's camera roll, or another reference. The photo is not stored. */
  photoRef?: string;
}

export interface FieldObservationFile {
  schema: string;
  exportedAt: string;
  observations: FieldObservation[];
}

/**
 * What a promotion establishes. Every claim must be something the observations it names actually saw;
 * src/data/campus/field/rules.ts decides that and a test enforces it.
 */
export interface FieldClaims {
  /**
   * The door, link or change of floor is where UW Go shows it (CONFIRMED), or not (WRONG). Any other claim about
   * a segment implies CONFIRMED. WRONG takes the segment out of routing until someone finds it where shown.
   */
  placement?: "CONFIRMED" | "WRONG";
  /** Passage per direction, keyed "FROM>TO". */
  passage?: Readonly<Record<string, Passage>>;
  access?: Partial<Access>;
  /** How a change of floor can be made. */
  vertical?: readonly VerticalKind[];
  /** ACTIVE confirms something usable (lifting a quarantine); HISTORICAL records it no longer exists. */
  activation?: Activation;
  /** Hours posted at the building, as read on site and written in an observation's note. */
  hours?: Availability;
}

export type FieldSubject = { edges: readonly NetworkEdgeRef[] } | { building: string };

export interface FieldPromotion {
  id: string;
  observationIds: readonly string[];
  subject: FieldSubject;
  /** What to call a segment no reviewed fact names yet. */
  label?: string;
  claims: FieldClaims;
  /** The latest observation's date, YYYY-MM-DD. Kept here because routing never reads the observations. */
  observedOn: string;
  verifiedBy: readonly string[];
  reviewedAt: string;
  reviewedBy: string;
  basis: string;
  /** Required when a claim would allow what stronger evidence restricts, or replace official hours: why the ground wins. */
  supersedes?: string;
}
