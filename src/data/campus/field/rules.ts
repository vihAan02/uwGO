/**
 * The rules of field verification, in one place so that the capture page, the import and review script and the
 * tests apply the same ones: what each mark means, which marks cannot go together, whether an exported file is
 * well-formed, and whether a promotion claims only what its observations saw.
 *
 * Type-only imports: Node loads this file for scripts/campus-field.mjs.
 */
import type { Evidence, Passage, VerticalKind } from "../types";
import type { FieldClaims, FieldMark, FieldObservation, FieldPromotion, FieldTargetKind, FieldTargetRef } from "./types";

export const OBSERVATION_FILE_SCHEMA = "uwgo.field-observations/1";

export const FIELD_MARKS: readonly FieldMark[] = [
  "ENTRY_WORKS", "EXIT_WORKS", "BOTH_WAYS", "LOCKED",
  "AUTOMATIC_DOOR", "STAIRS", "RAMP", "ELEVATOR",
  "ACCESSIBLE", "NOT_ACCESSIBLE", "WRONG_LOCATION", "DOES_NOT_EXIST",
];

export const MARK_LABEL: Readonly<Record<FieldMark, string>> = {
  ENTRY_WORKS: "Entry works",
  EXIT_WORKS: "Exit works",
  BOTH_WAYS: "Both",
  LOCKED: "Locked / restricted",
  AUTOMATIC_DOOR: "Automatic door",
  STAIRS: "Stairs",
  RAMP: "Ramp",
  ELEVATOR: "Elevator",
  ACCESSIBLE: "Accessible",
  NOT_ACCESSIBLE: "Not accessible",
  WRONG_LOCATION: "Wrong location",
  DOES_NOT_EXIST: "Doesn't exist",
};

export const MARK_HINT: Readonly<Record<FieldMark, string>> = {
  ENTRY_WORKS: "You could go in this way without a key or card.",
  EXIT_WORKS: "You could come out this way without an alarm, key or card.",
  BOTH_WAYS: "Entry and exit both work.",
  LOCKED: "The way not marked as working is locked, signed exit-only, or needs a card or key. On a change of floor: it needs a key or help.",
  AUTOMATIC_DOOR: "A working automatic opener.",
  STAIRS: "There are steps.",
  RAMP: "There is a ramp.",
  ELEVATOR: "There is an elevator.",
  ACCESSIBLE: "Step-free, and usable without help.",
  NOT_ACCESSIBLE: "Steps, a door too heavy to open alone, or it needs help or a key.",
  WRONG_LOCATION: "It exists, but not where UW Go shows it. Set where it really is.",
  DOES_NOT_EXIST: "Nothing like it here.",
};

const TARGET_KINDS: readonly FieldTargetKind[] = ["DOOR", "LINK", "VERTICAL", "PORTAL", "RULE", "HOURS", "CHECK", "LEAD"];
const EVIDENCE: readonly Evidence[] = ["OFFICIAL", "FIELD_VERIFIED", "CORROBORATED", "SURVEYED", "ANECDOTAL", "INFERRED", "UNRESOLVED"];
const RESTRICTIVE: readonly Passage[] = ["PROHIBITED", "CREDENTIAL", "EMERGENCY_ONLY"];
/** Targets with a surveyed position of their own: moving one needs "Wrong location" marked. */
const SURVEYED_KINDS: readonly FieldTargetKind[] = ["DOOR", "LINK", "VERTICAL"];

/** The marks as one visit means them: entry and exit both working is "Both". In a fixed order. */
export function normaliseMarks(marks: readonly FieldMark[]): FieldMark[] {
  const set = new Set(marks);
  if (set.has("BOTH_WAYS") || (set.has("ENTRY_WORKS") && set.has("EXIT_WORKS"))) {
    set.delete("ENTRY_WORKS");
    set.delete("EXIT_WORKS");
    set.add("BOTH_WAYS");
  }
  return FIELD_MARKS.filter((m) => set.has(m));
}

/** Marks that cannot all be true of one visit, whatever it was of, as sentences. */
export function markConflicts(marks: readonly FieldMark[]): string[] {
  const m = normaliseMarks(marks);
  const has = (x: FieldMark) => m.includes(x);
  const out: string[] = [];
  if (has("DOES_NOT_EXIST") && m.length > 1) out.push(`"Doesn't exist" was marked together with other things`);
  if (has("ACCESSIBLE") && has("NOT_ACCESSIBLE")) out.push("marked both accessible and not accessible");
  if (has("LOCKED") && has("BOTH_WAYS")) out.push("marked locked, and working both ways");
  return out;
}

/** Marks that cannot all be true of one visit to this kind of target. On a change of floor, "Locked" means it needs a key or help. */
export function targetMarkConflicts(kind: FieldTargetKind, marks: readonly FieldMark[]): string[] {
  const m = normaliseMarks(marks);
  const out = markConflicts(m);
  if (kind === "VERTICAL" && m.includes("ACCESSIBLE") && m.includes("LOCKED")) out.push("marked accessible, and locked (on a change of floor, needing a key or help)");
  return out;
}

export type DirectionSeen = "WORKS" | "LOCKED";

/** What one visit's marks say about each direction: works, locked, or not observed. */
export function directionsSeen(marks: readonly FieldMark[]): { entry?: DirectionSeen; exit?: DirectionSeen } {
  const m = normaliseMarks(marks);
  const both = m.includes("BOTH_WAYS");
  const locked = m.includes("LOCKED");
  const entry = both || m.includes("ENTRY_WORKS") ? "WORKS" : locked ? "LOCKED" : undefined;
  const exit = both || m.includes("EXIT_WORKS") ? "WORKS" : locked ? "LOCKED" : undefined;
  return { entry, exit };
}

/**
 * What visits found in each direction, keyed "FROM>TO" by each observation's own entry and exit. Each
 * observation keeps the target as it was shown, so which way was "entry" is read from that, never from the
 * target as it is now.
 */
function directionFindings(observations: readonly FieldObservation[]): Map<string, { label: string; seen: Set<DirectionSeen> }> {
  const out = new Map<string, { label: string; seen: Set<DirectionSeen> }>();
  for (const o of observations) {
    const seen = directionsSeen(o.marks);
    for (const [dir, ref] of [["entry", o.target.entry], ["exit", o.target.exit]] as const) {
      if (!ref) continue;
      const key = `${ref.from}>${ref.to}`;
      const found = out.get(key) ?? { label: ref.label, seen: new Set<DirectionSeen>() };
      const s = seen[dir];
      if (s) found.seen.add(s);
      out.set(key, found);
    }
  }
  return out;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isText = (v: unknown, max: number): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= max;
const HEX16 = /^[0-9a-f]{16}$/;
const OBSERVATION_ID = /^fo-\d{8}T\d{6}Z-[0-9a-z]{4,12}$/;
/** ISO 8601 with seconds and an explicit offset, so the date part is the verifier's own day. */
const LOCAL_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?([+-]\d{2}:\d{2}|Z)$/;
/** Waterloo's main campus and its surroundings. A position outside this is a typo or a phone somewhere else. */
const NEAR_CAMPUS = { south: 43.44, north: 43.5, west: -80.58, east: -80.5 };

function positionProblems(p: unknown, name: string): string[] {
  if (!isRecord(p) || typeof p.lat !== "number" || typeof p.lng !== "number") return [`${name} needs a numeric lat and lng`];
  const out: string[] = [];
  if (p.lat < NEAR_CAMPUS.south || p.lat > NEAR_CAMPUS.north || p.lng < NEAR_CAMPUS.west || p.lng > NEAR_CAMPUS.east) out.push(`${name} is not on or near campus`);
  if (p.accuracyMetres !== undefined && (typeof p.accuracyMetres !== "number" || p.accuracyMetres < 0)) out.push(`${name}.accuracyMetres must be a positive number`);
  return out;
}

/** Everything wrong with one exported observation, as sentences. Empty means it can be imported. */
export function observationProblems(value: unknown): string[] {
  if (!isRecord(value)) return ["an observation is not an object"];
  const o = value;
  const at = (s: string) => `${typeof o.id === "string" ? o.id : "(no id)"}: ${s}`;
  const problems: string[] = [];
  if (typeof o.id !== "string" || !OBSERVATION_ID.test(o.id)) problems.push(at("id is not fo-YYYYMMDDTHHMMSSZ-xxxx"));

  const t = o.target;
  const kind = isRecord(t) && TARGET_KINDS.includes(t.kind as FieldTargetKind) ? (t.kind as FieldTargetKind) : undefined;
  if (!isRecord(t)) problems.push(at("no target"));
  else {
    if (!isText(t.id, 200)) problems.push(at("the target has no id"));
    if (!kind) problems.push(at(`target kind ${String(t.kind)} is unknown`));
    if (!isText(t.name, 300)) problems.push(at("the target has no name"));
    if (t.building !== undefined && !isText(t.building, 20)) problems.push(at("the target's building is malformed"));
    if (!Array.isArray(t.edgeIds) || !t.edgeIds.every((x) => typeof x === "string" && HEX16.test(x))) problems.push(at("the target's edgeIds must be segment ids"));
    for (const d of ["entry", "exit"] as const) {
      const dir = t[d];
      if (dir !== undefined && (!isRecord(dir) || !isText(dir.from, 20) || !isText(dir.to, 20) || !isText(dir.label, 120))) problems.push(at(`the target's ${d} direction is malformed`));
    }
    if (!isRecord(t.shown) || !EVIDENCE.includes(t.shown.evidence as Evidence) || typeof t.shown.activation !== "string") problems.push(at("the target does not say what UW Go showed"));
  }

  if (typeof o.observedAt !== "string" || !LOCAL_TIME.test(o.observedAt) || Number.isNaN(Date.parse(o.observedAt))) problems.push(at("observedAt is not an ISO time with an offset"));
  if (!isText(o.verifier, 100)) problems.push(at("no verifier"));
  if (!Array.isArray(o.marks) || !o.marks.every((m) => FIELD_MARKS.includes(m as FieldMark))) problems.push(at("marks must be known marks"));
  else {
    const marks = o.marks as FieldMark[];
    if (marks.length === 0 && !isText(o.note, 2000) && o.correctedLocation === undefined) problems.push(at("nothing was recorded: no mark, note or location"));
    problems.push(...(kind ? targetMarkConflicts(kind, marks) : markConflicts(marks)).map(at));
    if (o.correctedLocation !== undefined && kind && SURVEYED_KINDS.includes(kind) && !marks.includes("WRONG_LOCATION")) {
      problems.push(at(`moving a surveyed ${kind.toLowerCase()} needs "Wrong location" marked`));
    }
  }
  if (o.note !== undefined && (typeof o.note !== "string" || o.note.length > 2000)) problems.push(at("the note must be text of at most 2000 characters"));
  if (o.photoRef !== undefined && (typeof o.photoRef !== "string" || o.photoRef.length > 200)) problems.push(at("photoRef must be short text"));
  if (o.correctedLocation !== undefined) {
    problems.push(...positionProblems(o.correctedLocation, "correctedLocation").map(at));
    if (isRecord(o.correctedLocation) && o.correctedLocation.source !== "GPS" && o.correctedLocation.source !== "MAP") problems.push(at("correctedLocation.source must be GPS or MAP"));
  }
  if (o.observerPosition !== undefined) problems.push(...positionProblems(o.observerPosition, "observerPosition").map(at));
  return problems;
}

/** The observations in an exported file, and everything that kept any of them out. */
export function parseObservationFile(value: unknown): { observations: FieldObservation[]; problems: string[] } {
  if (!isRecord(value) || value.schema !== OBSERVATION_FILE_SCHEMA || !Array.isArray(value.observations)) {
    return { observations: [], problems: [`not a UW Go field observation export (expected schema "${OBSERVATION_FILE_SCHEMA}")`] };
  }
  const problems: string[] = [];
  const observations: FieldObservation[] = [];
  const seen = new Set<string>();
  for (const o of value.observations) {
    const found = observationProblems(o);
    if (found.length) { problems.push(...found); continue; }
    const obs = o as FieldObservation;
    if (seen.has(obs.id)) { problems.push(`${obs.id}: listed twice`); continue; }
    seen.add(obs.id);
    observations.push(obs);
  }
  return { observations, problems };
}

/** The day an observation was made, on the verifier's own clock. */
export const observedOn = (o: FieldObservation) => o.observedAt.slice(0, 10);

/**
 * The claims a set of observations of one target support, and what they disagree on. Only claims every
 * observation is consistent with are drafted; a disagreement is reported, never settled by majority.
 */
export function suggestClaims(target: FieldTargetRef, observations: readonly FieldObservation[]): { claims: FieldClaims; contradictions: string[] } {
  const marks = observations.map((o) => normaliseMarks(o.marks));
  const anyHas = (m: FieldMark) => marks.some((ms) => ms.includes(m));
  const vertical = target.kind === "VERTICAL";
  const contradictions: string[] = [];
  const claims: FieldClaims = {};

  if (anyHas("DOES_NOT_EXIST")) {
    if (marks.some((ms) => !ms.includes("DOES_NOT_EXIST"))) contradictions.push("one visit found nothing there, another recorded something");
    else return { claims: { activation: "HISTORICAL" }, contradictions };
  }
  if (anyHas("WRONG_LOCATION")) {
    if (marks.some((ms) => !ms.includes("WRONG_LOCATION") && ms.length > 0)) contradictions.push("one visit says it is somewhere else, another used it where shown");
    else claims.placement = "WRONG";
  } else if (SURVEYED_KINDS.includes(target.kind) && marks.some((ms) => ms.length > 0)) claims.placement = "CONFIRMED";

  const passage: Record<string, Passage> = {};
  for (const [key, { label, seen }] of directionFindings(observations)) {
    if (seen.has("WORKS") && seen.has("LOCKED")) contradictions.push(`${label}: one visit found it working, another locked`);
    else if (seen.has("WORKS")) passage[key] = "ALLOWED";
    else if (seen.has("LOCKED")) passage[key] = "PROHIBITED";
  }
  if (Object.keys(passage).length) claims.passage = passage;

  const access: FieldClaims["access"] = {};
  if (anyHas("AUTOMATIC_DOOR")) access.automaticDoor = true;
  if (anyHas("RAMP")) access.ramp = true;
  const needsKey = vertical && anyHas("LOCKED");
  if (anyHas("ACCESSIBLE") && anyHas("NOT_ACCESSIBLE")) contradictions.push("one visit found it accessible, another not");
  else if (anyHas("ACCESSIBLE") && needsKey) contradictions.push("one visit found it usable without help, another found it needs a key or help");
  else if (anyHas("ACCESSIBLE")) { access.stepFree = true; access.independent = true; }
  else {
    if (anyHas("NOT_ACCESSIBLE") || needsKey) access.independent = false;
    if (anyHas("NOT_ACCESSIBLE") && anyHas("STAIRS") && !anyHas("RAMP") && !anyHas("ELEVATOR")) access.stepFree = false;
  }
  if (Object.keys(access).length) claims.access = access;

  if (vertical) {
    const kinds = (["STAIRS", "ELEVATOR", "RAMP"] as const).filter((v) => anyHas(v));
    if (kinds.length) claims.vertical = kinds;
  }
  if (target.shown.activation === "QUARANTINED" && Object.values(passage).includes("ALLOWED") && !Object.values(passage).some((p) => RESTRICTIVE.includes(p))) claims.activation = "ACTIVE";
  return { claims, contradictions };
}

/** Why each claim of a promotion is not supported by the observations it names. */
function claimProblems(claims: FieldClaims, target: FieldTargetRef, observations: readonly FieldObservation[]): string[] {
  const problems: string[] = [];
  const marks = observations.map((o) => normaliseMarks(o.marks));
  const anyHas = (m: FieldMark) => marks.some((ms) => ms.includes(m));
  const vertical = target.kind === "VERTICAL";
  const findings = directionFindings(observations);
  const knownDirection = (key: string) => findings.has(key) || [...findings.keys()].some((k) => k.split(">").reverse().join(">") === key);
  const anyWorks = [...findings.values()].some((f) => f.seen.has("WORKS"));

  for (const [key, passage] of Object.entries(claims.passage ?? {})) {
    if (!knownDirection(key)) { problems.push(`passage ${key} is not a direction of ${target.id}`); continue; }
    const seen = findings.get(key)?.seen ?? new Set<DirectionSeen>();
    if (passage === "ALLOWED") {
      if (!seen.has("WORKS")) problems.push(`passage ${key} ALLOWED: no observation saw it work`);
      if (seen.has("LOCKED")) problems.push(`passage ${key} ALLOWED: an observation found it locked`);
    } else if (RESTRICTIVE.includes(passage)) {
      if (!seen.has("LOCKED")) problems.push(`passage ${key} ${passage}: no observation found it locked`);
      if (seen.has("WORKS")) problems.push(`passage ${key} ${passage}: an observation saw it work`);
    } else problems.push(`passage ${key} ${passage}: only ALLOWED or a restriction can be promoted`);
  }

  const a = claims.access ?? {};
  if (claims.access && Object.keys(claims.access).length === 0) problems.push("access: claims nothing");
  for (const [flag, value] of Object.entries(a)) if (value === null) problems.push(`access ${flag} null: a promotion cannot make something unknown`);
  const needsKey = vertical && anyHas("LOCKED");
  if (a.automaticDoor === true && !anyHas("AUTOMATIC_DOOR")) problems.push("automaticDoor: no observation marked an automatic door");
  if (a.automaticDoor === false) problems.push("automaticDoor false: a door nobody marked automatic is unknown, not manual");
  if (a.ramp === true && !anyHas("RAMP")) problems.push("ramp: no observation marked a ramp");
  if (a.ramp === false) problems.push("ramp false: no mark can show there is no ramp");
  if (a.stepFree === true && (!anyHas("ACCESSIBLE") || anyHas("NOT_ACCESSIBLE") || needsKey || (anyHas("STAIRS") && !anyHas("RAMP") && !anyHas("ELEVATOR")))) {
    problems.push("stepFree: needs a visit marked accessible, none marked not accessible or (on a change of floor) locked, and no stairs without a ramp or elevator");
  }
  if (a.stepFree === false && !anyHas("NOT_ACCESSIBLE") && !anyHas("STAIRS")) problems.push("stepFree false: no observation marked stairs or not accessible");
  if (a.independent === true && (!anyHas("ACCESSIBLE") || anyHas("NOT_ACCESSIBLE") || needsKey)) problems.push("independent: needs a visit marked accessible, and none marked not accessible or (on a change of floor) locked");
  if (a.independent === false && !anyHas("NOT_ACCESSIBLE") && !anyHas("LOCKED")) problems.push("independent false: no observation marked not accessible or locked");
  if (a.accessibleDesignation !== undefined) problems.push("accessibleDesignation is the university's own listing; a visit cannot confirm it");

  if (claims.vertical && claims.vertical.length === 0) problems.push("vertical: claims nothing");
  for (const v of claims.vertical ?? []) if (!anyHas(v as VerticalKind)) problems.push(`vertical ${v}: no observation marked it`);

  switch (claims.activation) {
    case "ACTIVE":
      if (anyHas("DOES_NOT_EXIST") || anyHas("WRONG_LOCATION")) problems.push("activation ACTIVE: an observation says it is not there");
      if (vertical) {
        if (!anyHas("STAIRS") && !anyHas("RAMP") && !anyHas("ELEVATOR")) problems.push("activation ACTIVE: no observation found a way between the floors");
        if (anyHas("LOCKED")) problems.push("activation ACTIVE: an observation found it locked");
      } else {
        if (!anyWorks) problems.push("activation ACTIVE: no observation used it");
        for (const [key, { seen }] of findings) {
          const claimed = claims.passage?.[key];
          if (seen.has("LOCKED") && !(claimed && RESTRICTIVE.includes(claimed))) problems.push(`activation ACTIVE: ${key} was found locked, so the promotion must restrict it`);
        }
      }
      break;
    case "HISTORICAL":
      if (!marks.every((ms) => ms.includes("DOES_NOT_EXIST"))) problems.push("activation HISTORICAL: needs every observation to say it does not exist");
      break;
    case "EXPERIMENTAL":
      problems.push("activation EXPERIMENTAL: a field observation does not make something experimental");
      break;
    case "QUARANTINED":
      problems.push("activation QUARANTINED: a visit does not quarantine; record a lock as a restricted passage, a wrong position as placement WRONG, or a doubt in overlay.ts");
      break;
  }

  if (claims.placement && !SURVEYED_KINDS.includes(target.kind)) problems.push("placement: only a surveyed door, link or change of floor has a place UW Go shows");
  if (claims.placement === "WRONG" && !anyHas("WRONG_LOCATION")) problems.push("placement WRONG: no observation marked the wrong location");
  const placedHere = claims.placement === "CONFIRMED" || Object.keys(claims.passage ?? {}).length > 0 || Object.keys(a).length > 0 || (claims.vertical?.length ?? 0) > 0 || claims.activation === "ACTIVE";
  if (SURVEYED_KINDS.includes(target.kind) && placedHere && claims.placement !== "WRONG") {
    if (!marks.some((ms) => ms.some((m) => m !== "WRONG_LOCATION" && m !== "DOES_NOT_EXIST"))) problems.push("placement: no observation recorded finding it here");
    if (anyHas("WRONG_LOCATION") || anyHas("DOES_NOT_EXIST")) problems.push("claims about it here, but an observation says it is not here");
  }
  if (claims.hours && !observations.some((o) => isText(o.note, 2000))) problems.push("hours: the posted hours must be written in an observation's note");
  return problems;
}

/** Everything wrong with a promotion against the imported observations, as sentences. Empty means it may stand. */
export function promotionProblems(p: FieldPromotion, observationsById: ReadonlyMap<string, FieldObservation>): string[] {
  const where = (s: string) => `promotion ${p.id}: ${s}`;
  const problems: string[] = [];
  if (!p.observationIds.length) return [where("rests on no observation")];
  const found: FieldObservation[] = [];
  for (const id of p.observationIds) {
    const o = observationsById.get(id);
    if (o) found.push(o);
    else problems.push(where(`no imported observation ${id}`));
  }
  if (!found.length) return problems;

  const target = found[0].target;
  for (const o of found) if (o.target.id !== target.id) problems.push(where(`${o.id} is about ${o.target.id}, not ${target.id}`));
  if ("edges" in p.subject) {
    for (const ref of p.subject.edges) if (!target.edgeIds.includes(ref.edgeId)) problems.push(where(`segment ${ref.edgeId} is not part of ${target.id}`));
  } else if (target.building !== p.subject.building) problems.push(where(`${target.id} is not about ${p.subject.building}`));

  const latest = found.map(observedOn).sort().at(-1)!;
  if (p.observedOn !== latest) problems.push(where(`observedOn is ${p.observedOn}, but the latest observation it names is from ${latest}`));
  const verifiers = [...new Set(found.map((o) => o.verifier))].sort();
  if ([...p.verifiedBy].sort().join("|") !== verifiers.join("|")) problems.push(where(`verifiedBy should be ${verifiers.join(", ")}`));
  for (const o of found) for (const c of targetMarkConflicts(o.target.kind, o.marks)) problems.push(where(`${o.id} ${c}`));
  problems.push(...claimProblems(p.claims, target, found).map(where));
  return problems;
}

/** A claim set in words, for provenance and review. */
export function describeClaims(claims: FieldClaims): string[] {
  const out: string[] = [];
  if (claims.placement === "CONFIRMED") out.push("where UW Go shows it");
  if (claims.placement === "WRONG") out.push("not where UW Go shows it");
  for (const [key, passage] of Object.entries(claims.passage ?? {})) out.push(`${key.replace(">", " → ")} ${passage.toLowerCase().replace("_", " ")}`);
  const a = claims.access ?? {};
  if (a.automaticDoor === true) out.push("automatic door");
  if (a.ramp === true) out.push("ramp");
  if (a.stepFree === true) out.push("step-free");
  if (a.stepFree === false) out.push("not step-free");
  if (a.independent === true) out.push("usable without help");
  if (a.independent === false) out.push("needs help or a key");
  for (const v of claims.vertical ?? []) out.push(v.toLowerCase());
  if (claims.activation === "ACTIVE") out.push("usable");
  if (claims.activation === "HISTORICAL") out.push("no longer there");
  if (claims.hours) out.push("posted hours");
  return out;
}
