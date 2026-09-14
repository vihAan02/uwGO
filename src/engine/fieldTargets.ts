/**
 * Everything on campus worth someone going to look at, one target per thing:
 * - each surveyed door to outside, link between buildings and change of floor;
 * - each door the research describes that UW Go could not place;
 * - each rule about a building's way in, and each building's hours;
 * - each open question a reviewer wrote down, and each research lead that is not routed.
 *
 * For each: where to stand and how far that position can be trusted, what UW Go believes now and on whose
 * word, why that needs checking, and exactly what to check. The field-verification page lists them and
 * fieldPriority.ts ranks them.
 */
import type { Access, Availability, CampusKnowledge, Evidence, FieldCheck, FieldTargetRef, Known, Passage, ResearchConnection, ResearchPortal, ResearchRouteCandidate } from "@/data/campus";
import { CAMPUS_KNOWLEDGE, claimsUsable } from "@/data/campus";
import { weakerEvidence } from "@/data/campus/types";
import { allBuildings, findBuilding } from "@/data/buildings";
import { isVertical, type IndoorEdgeKind, type IndoorNode } from "@/data/indoor/network";
import { OUTSIDE, REFUSAL_TEXT, buildingAvailability, campusGraph, evidenceFor, refusalFor, type Arc, type IndoorGraph } from "./indoorGraph";
import { crossingLabel, sideOf } from "./campusRoute";

/**
 * How far a target's position can be trusted:
 * - SURVEYED: where the WATIsGrass survey drew it. Real geometry, never checked on the ground.
 * - BUILDING: the building's campus-map point. The thing itself has no position anywhere in UW Go's data,
 *   so the marker is only where to start looking.
 */
export type LocationPrecision = "SURVEYED" | "BUILDING";

export interface TargetNode {
  id: number;
  building: string;
  floor: string;
  lat: number;
  lng: number;
}

export interface FieldTarget extends FieldTargetRef {
  location?: { lat: number; lng: number; precision: LocationPrecision; note: string };
  /** The surveyed nodes the target stands on, lowest floor first for a change of floor. */
  nodes: readonly TargetNode[];
  /** What the research says about it, in its own words. */
  research: readonly { id: string; text: string; evidence: Evidence }[];
  sourceIds: readonly string[];
  /** What routing does with it now. */
  current: readonly string[];
  checks: readonly FieldCheck[];
  conflicts: readonly { id: string; subject: string }[];
  /** Why someone needs to go and look. */
  why: readonly string[];
  /** What to check on the ground, in the order to check it. */
  toCheck: readonly string[];
}

/** What an observation keeps of a target: enough to review it after the list has moved on. */
export function targetRef(t: FieldTarget): FieldTargetRef {
  return { id: t.id, kind: t.kind, name: t.name, building: t.building, edgeIds: t.edgeIds, entry: t.entry, exit: t.exit, shown: t.shown };
}

const RESTRICTIVE: ReadonlySet<Passage> = new Set(["PROHIBITED", "CREDENTIAL", "EMERGENCY_ONLY"]);
const VERTICAL_WORD: Partial<Record<IndoorEdgeKind, string>> = { STAIRS: "Stairwell", ELEVATOR: "Elevator", RAMP: "Ramp", OTHER_VERTICAL: "Change of floor" };

const lower = (s: string) => s.toLowerCase().replace(/_/g, " ");
const unique = <T>(xs: readonly T[]): T[] => [...new Set(xs)];
const intersects = (a: readonly string[] | undefined, b: readonly string[]) => Boolean(a?.some((x) => b.includes(x)));
const nodeOf = (n: IndoorNode): TargetNode => ({ id: n.id, building: n.building, floor: n.floor, lat: n.lat, lng: n.lng });

function buildingPoint(code: string | undefined): { lat: number; lng: number } | undefined {
  const b = code ? findBuilding("UW", code) : undefined;
  return b?.latitude !== undefined && b.longitude !== undefined ? { lat: b.latitude, lng: b.longitude } : undefined;
}

/** What is recorded about access, and whether routing relies on it: a guessed match's access claims are shown, not used. */
function describeAccess(access: Partial<Access> | undefined, evidence?: Evidence): string {
  const parts = accessParts(access);
  if (!parts.length) return "Access: nothing recorded.";
  return `Access: ${parts.join(", ")}${evidence && !claimsUsable(evidence, false) ? ` (${lower(evidence)}: routing does not rely on this)` : ""}.`;
}

function accessParts(access: Partial<Access> | undefined): string[] {
  const parts: string[] = [];
  const say = (flag: Known | undefined, yes: string, no: string) => {
    if (flag === true) parts.push(yes);
    if (flag === false) parts.push(no);
  };
  say(access?.stepFree, "step-free", "not step-free");
  say(access?.automaticDoor, "automatic door", "no automatic door");
  say(access?.ramp, "ramp", "no ramp");
  say(access?.accessibleDesignation, "listed accessible by UW", "not listed accessible");
  say(access?.independent, "usable without help", "needs help or a key");
  return parts;
}

const clock = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function describeAvailability(av: Availability): string {
  switch (av.kind) {
    case "ALWAYS": return "open at all hours";
    case "UNKNOWN": return "unknown";
    case "TEMPORARILY_CLOSED": return `closed (${av.reason}${av.until ? `, until ${av.until}` : ""})`;
    case "SCHEDULE": {
      const windows = av.windows.map((w) => `${w.days.map((d) => DAY[d]).join(", ")} ${clock(w.open)}–${clock(w.close)}`);
      return [...windows, ...(av.unknownDays?.length ? [`unknown on ${av.unknownDays.map((d) => DAY[d]).join(", ")}`] : [])].join("; ");
    }
  }
}

const portalText = (p: ResearchPortal) => ({ id: p.id, text: `"${p.description}" (entry: ${p.raw.entryPermission}; exit: ${p.raw.exitPermission}; ${p.confidence} confidence)`, evidence: p.evidence });
const connectionText = (c: ResearchConnection) => ({ id: c.id, text: `${c.from}–${c.to}, ${c.connectionType}${c.condition ? `: ${c.condition}` : ""} (${c.status.replace(/_/g, " ")}, ${c.confidence} confidence)`, evidence: c.evidence });
const candidateText = (c: ResearchRouteCandidate) => ({ id: c.id, text: `${c.originDestination}: ${c.sequence.join(" → ")}. Reported benefit: ${c.reportedBenefit} Limitation: ${c.limitation}`, evidence: c.evidence });

/** The first registry building a piece of text names: by code as a whole word, otherwise by its full name. */
function buildingNamedIn(text: string): string | undefined {
  for (const word of text.split(/[^A-Za-z0-9]+/)) {
    if (word.length >= 2 && word === word.toUpperCase() && /[A-Z]/.test(word) && findBuilding("UW", word)) return findBuilding("UW", word)!.code;
  }
  const lowered = text.toLowerCase();
  return allBuildings("UW").find((b) => !b.parentCode && lowered.includes(b.name.toLowerCase()))?.code;
}

export function buildFieldTargets(g: IndoorGraph = campusGraph()): FieldTarget[] {
  const k: CampusKnowledge = g.knowledge ?? CAMPUS_KNOWLEDGE;
  const reviewedAt = k.overlay.reviewedAt;
  const attached = new Set<string>();
  const checksAbout = (edgeIds: readonly string[], portals: readonly string[], connections: readonly string[]) => {
    const found = k.overlay.fieldChecks.filter((c) => intersects(c.edgeIds, edgeIds) || intersects(c.research?.portals, portals) || intersects(c.research?.connections, connections));
    for (const c of found) attached.add(c.id);
    return found;
  };
  const conflictsAbout = (edgeIds: readonly string[], portals: readonly string[], connections: readonly string[]) =>
    k.overlay.conflicts
      .filter((c) => intersects(c.edgeIds, edgeIds) || intersects(c.research?.portals, portals) || intersects(c.research?.connections, connections))
      .map((c) => ({ id: c.id, subject: c.subject }));
  const state = (arc: Arc) => {
    const why = refusalFor(g, arc);
    return why ? REFUSAL_TEXT[why] : "usable";
  };
  const activationOf = (index: number) => (g.historical[index] ? "HISTORICAL" : g.facts[index]?.activation ?? "ACTIVE");
  /** What UW Go believes about a segment rests on its fact's evidence, or on the survey alone. */
  const believed = (index: number): Evidence => g.facts[index]?.evidence ?? "SURVEYED";
  const evidenceLine = (index: number) => {
    const fact = g.facts[index];
    const said = believed(index);
    if (!fact) return "Evidence: surveyed (the survey alone).";
    return `Evidence: ${lower(said)}${evidenceFor(g, index) !== said ? ". Routing does not rely on what is recorded about it until it is confirmed" : ""}.`;
  };
  const factWhy = (index: number): string[] => {
    const fact = g.facts[index];
    const why: string[] = [];
    if (!fact) why.push("Only the WATIsGrass survey says it is here. Nobody has recorded which ways it can be used, when, or whether it is step-free.");
    else {
      if (fact.activation === "QUARANTINED") why.push(`Not routed until someone confirms it: ${fact.basis}`);
      else if (fact.evidence === "INFERRED") why.push(`UW Go's match to the research is a guess: ${fact.basis}`);
      else if (fact.evidence === "UNRESOLVED") why.push(`Routing cannot rely on what is known about it: ${fact.basis}`);
      else if (fact.evidence === "CORROBORATED") why.push(`Matched to the research by UW Go and never seen on the ground: ${fact.basis}`);
      else if (fact.evidence === "OFFICIAL") why.push(`Official, but never checked on the ground: ${fact.basis}`);
      if (fact.field?.length) why.push(`Last checked on the ground ${fact.field[fact.field.length - 1].observedOn}.`);
    }
    return why;
  };
  const targets: FieldTarget[] = [];

  // ---- Doors to outside
  for (const d of g.exteriorDoors) {
    const id = g.ids[d.index];
    const fact = g.facts[d.index];
    const inward = g.adj[d.outside].find((a) => a.index === d.index)!;
    const outward = g.adj[d.inside].find((a) => a.index === d.index)!;
    const inside = g.net.nodes[d.inside];
    const portals = (fact?.research?.portals ?? []).map((p) => k.portals.get(p)).filter((p): p is ResearchPortal => Boolean(p));
    const portalIds = portals.map((p) => p.id);
    const checks = checksAbout([id], portalIds, []);
    const conflicts = conflictsAbout([id], portalIds, []);
    const side = sideOf(inside);
    targets.push({
      id: `door:${id}`,
      kind: "DOOR",
      name: crossingLabel(g, inward),
      building: d.building,
      edgeIds: [id],
      entry: { from: OUTSIDE, to: d.building, label: `Into ${d.building}` },
      exit: { from: d.building, to: OUTSIDE, label: `Out of ${d.building}` },
      shown: { evidence: believed(d.index), activation: activationOf(d.index), knowledgeReviewedAt: reviewedAt },
      location: { lat: inside.lat, lng: inside.lng, precision: "SURVEYED", note: `Where the WATIsGrass survey puts this door (${d.building} floor ${inside.floor}). Not checked on the ground.` },
      nodes: [nodeOf(inside)],
      research: portals.map(portalText),
      sourceIds: fact?.sourceIds ?? [],
      current: [`Inwards: ${state(inward)}. Outwards: ${state(outward)}.`, evidenceLine(d.index), describeAccess(fact?.access, fact && (fact.accessEvidence ?? fact.evidence))],
      checks,
      conflicts,
      why: [...factWhy(d.index), ...conflicts.map((c) => `Sources disagree: ${c.subject}.`)],
      toCheck: [
        `Find the door UW Go shows: ${d.building} floor ${inside.floor}${side ? `, ${side} side` : ""}. If it is somewhere else, mark "Wrong location" and set where it is; if there is no such door, "Doesn't exist".`,
        ...portals.map((p) => `Is this what the research calls "${p.description}"?`),
        "From outside, try to go in. Does it open without a card? Any \"exit only\", \"no entry\" or alarm sign?",
        "From inside, try to leave the same way.",
        "Is there a working automatic opener?",
        "Is the way in step-free: no step at the door, and no ramp too steep to use?",
        "If hours are posted on the door, write them in the note.",
        ...checks.map((c) => c.question),
      ],
    });
  }

  // ---- Links between two buildings (a change of floor between two buildings is a change of floor)
  g.net.edges.forEach((e, index) => {
    const na = g.net.nodes[e.a];
    const nb = g.net.nodes[e.b];
    if (na.building === OUTSIDE || nb.building === OUTSIDE || na.building === nb.building) return;
    if (isVertical(e.kind) && e.floors !== 0) return;
    const id = g.ids[index];
    const fact = g.facts[index];
    const [A, B] = fact ? [fact.ref.between[0], fact.ref.between[1]] : [na.building, nb.building].sort();
    const aNode = na.building === A ? na : nb;
    const bNode = aNode === na ? nb : na;
    const ab = g.adj[aNode.id].find((a) => a.index === index)!;
    const ba = g.adj[bNode.id].find((a) => a.index === index)!;
    const connection = fact?.research?.connection ? k.connections.get(fact.research.connection) : undefined;
    const connectionIds = connection ? [connection.id] : [];
    const checks = checksAbout([id], [], connectionIds);
    const conflicts = conflictsAbout([id], [], connectionIds);
    const mid = e.path[Math.floor(e.path.length / 2)];
    const what = e.kind === "OPEN" ? "open join" : lower(e.kind);
    targets.push({
      id: `link:${id}`,
      kind: "LINK",
      name: fact?.label ?? crossingLabel(g, ab),
      building: A,
      edgeIds: [id],
      entry: { from: A, to: B, label: `${A} → ${B}` },
      exit: { from: B, to: A, label: `${B} → ${A}` },
      shown: { evidence: believed(index), activation: activationOf(index), knowledgeReviewedAt: reviewedAt },
      location: { lat: mid[0], lng: mid[1], precision: "SURVEYED", note: `Where the survey draws this ${what}: ${A} floor ${aNode.floor} to ${B} floor ${bNode.floor}. Not checked on the ground.` },
      nodes: [nodeOf(aNode), nodeOf(bNode)],
      research: connection ? [connectionText(connection)] : [],
      sourceIds: fact?.sourceIds ?? [],
      current: [`${A} → ${B}: ${state(ab)}. ${B} → ${A}: ${state(ba)}.`, evidenceLine(index), describeAccess(fact?.access, fact && (fact.accessEvidence ?? fact.evidence))],
      checks,
      conflicts,
      why: [...factWhy(index), ...conflicts.map((c) => `Sources disagree: ${c.subject}.`)],
      toCheck: [
        `Walk it from ${A} (floor ${aNode.floor}) to ${B} (floor ${bNode.floor}). Is it where UW Go shows it? If it lands on a different floor at either end, say which in the note.`,
        `Can you go ${A} → ${B} without a card or key, and without passing through a room? And ${B} → ${A}?`,
        "Any steps along it, a ramp, or an elevator you would need instead?",
        "Doors on the way: automatic, or heavy manual ones?",
        "Any posted hours or signs (locked after hours, staff only)? Write them in the note.",
        ...checks.map((c) => c.question),
      ],
    });
  });

  // ---- Changes of floor, one target per surveyed point with every floor it joins
  const groups = new Map<string, number[]>();
  g.net.edges.forEach((e, index) => {
    if (!isVertical(e.kind) || e.floors === 0) return;
    const key = `${e.path[0][0]},${e.path[0][1]}`;
    groups.set(key, [...(groups.get(key) ?? []), index]);
  });
  for (const indices of groups.values()) {
    const edges = indices.map((i) => g.net.edges[i]);
    const ids = indices.map((i) => g.ids[i]).sort();
    // Levels relative to one node, followed through the climbs, so floors are listed bottom to top.
    const level = new Map<number, number>([[edges[0].a, 0]]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const e of edges) {
        if (level.has(e.a) && !level.has(e.b)) { level.set(e.b, level.get(e.a)! + e.floors); grew = true; }
        else if (level.has(e.b) && !level.has(e.a)) { level.set(e.a, level.get(e.b)! - e.floors); grew = true; }
      }
    }
    const nodes = unique(edges.flatMap((e) => [e.a, e.b])).sort((x, y) => (level.get(x) ?? 0) - (level.get(y) ?? 0) || x - y).map((n) => g.net.nodes[n]);
    const buildings = unique(nodes.map((n) => n.building));
    const kinds = unique(edges.map((e) => e.kind));
    const word = kinds.length === 1 ? VERTICAL_WORD[kinds[0]]! : "Change of floor";
    const floors = nodes.map((n) => (buildings.length > 1 ? `${n.building} ${n.floor}` : n.floor)).join(", ");
    const facts = indices.map((i) => g.facts[i]).filter((f): f is NonNullable<typeof f> => Boolean(f));
    const confirmedStepFree = facts.some((f) => f.access?.stepFree === true);
    const seen = unique(facts.flatMap((f) => f.vertical ?? []));
    const checks = checksAbout(ids, [], []);
    const conflicts = conflictsAbout(ids, [], []);
    const [lat, lng] = edges[0].path[0];
    targets.push({
      id: `vertical:${ids[0]}`,
      kind: "VERTICAL",
      name: buildings.length === 1 ? `${word} in ${buildings[0]} (floors ${floors})` : `${word} joining ${buildings.join(" and ")} (${floors})`,
      building: buildings[0],
      edgeIds: ids,
      shown: { evidence: indices.map(believed).reduce(weakerEvidence), activation: "ACTIVE", knowledgeReviewedAt: reviewedAt },
      location: { lat, lng, precision: "SURVEYED", note: `Where the survey puts this ${word.toLowerCase()}. Not checked on the ground.` },
      nodes: nodes.map(nodeOf),
      research: [],
      sourceIds: unique(facts.flatMap((f) => f.sourceIds)),
      current: [
        `Surveyed as: ${kinds.map(lower).join(", ")}.${seen.length ? ` Seen on the ground: ${seen.map(lower).join(", ")}.` : ""}`,
        `Step-free trips: ${confirmedStepFree ? "may change floor here" : "cannot change floor here: nobody has confirmed a step-free way between these floors"}.`,
      ],
      checks,
      conflicts,
      why: [
        kinds.every((kind) => kind === "STAIRS") ? "The survey records a stairwell and nothing about an elevator or ramp, so a step-free route cannot change floor here until one is confirmed." : "An elevator or ramp the survey records is not assumed step-free until someone confirms it.",
        ...conflicts.map((c) => `Sources disagree: ${c.subject}.`),
      ],
      toCheck: [
        `Find the ${word.toLowerCase()} UW Go shows, joining ${buildings.length > 1 ? floors : `floors ${floors} of ${buildings[0]}`}.`,
        "Is there an elevator at it or within sight, serving these floors? Mark \"Elevator\" and write in the note the floors it stops at.",
        "Can that elevator be used without a key, a card or calling for help? Mark \"Accessible\" if so, \"Locked / restricted\" if it needs a key.",
        "Is there a ramp between any of these levels? Mark \"Ramp\".",
        "If stairs are the only way, mark \"Stairs\".",
        ...checks.map((c) => c.question),
      ],
    });
  }

  // ---- Doors the research describes that UW Go could not place
  const placed = new Set(k.overlay.edges.flatMap((f) => f.research?.portals ?? []));
  const ruled = new Set(k.overlay.buildings.flatMap((b) => b.exterior?.portalIds ?? []));
  for (const p of k.research.portals) {
    if (placed.has(p.id) || ruled.has(p.id) || !g.anchorsByBuilding.has(p.buildingId)) continue;
    const at = buildingPoint(p.buildingId);
    const checks = checksAbout([], [p.id], []);
    const conflicts = conflictsAbout([], [p.id], []);
    targets.push({
      id: `portal:${p.id}`,
      kind: "PORTAL",
      name: `${p.buildingId}: ${p.description}`,
      building: p.buildingId,
      edgeIds: [],
      entry: { from: OUTSIDE, to: p.buildingId, label: `Into ${p.buildingId}` },
      exit: { from: p.buildingId, to: OUTSIDE, label: `Out of ${p.buildingId}` },
      shown: { evidence: p.evidence, activation: p.activation, knowledgeReviewedAt: reviewedAt },
      location: at && { ...at, precision: "BUILDING", note: `No position: the research describes this door, but UW Go could not match it to one the survey has. The marker is ${p.buildingId}'s campus-map point, not the door.` },
      nodes: [],
      research: [portalText(p)],
      sourceIds: p.sourceIds,
      current: ["Not routed: not matched to a surveyed door.", describeAccess(p.access)],
      checks,
      conflicts,
      why: [
        "The research describes it, but no surveyed door can be matched to it with confidence.",
        ...(p.evidence === "UNRESOLVED" ? ["The research itself rates this description low, stale or undated."] : []),
        ...conflicts.map((c) => `Sources disagree: ${c.subject}.`),
      ],
      toCheck: [
        `Find the door the research calls "${p.description}" at ${p.buildingId}. If there is no such door, mark "Doesn't exist".`,
        "Standing at it, set its location from GPS, or tap the map where it is.",
        "From outside, does it open without a card? From inside, can you leave through it?",
        "Is there an automatic opener? Is it step-free?",
        "If hours are posted on it, write them in the note.",
        ...checks.map((c) => c.question),
      ],
    });
  }

  // ---- Rules about a building's way in or out
  for (const stated of k.overlay.buildings) {
    if (!stated.exterior) continue;
    const exterior = k.buildingFacts.get(stated.code)?.exterior ?? stated.exterior;
    const portals = exterior.portalIds.map((id) => k.portals.get(id)).filter((p): p is ResearchPortal => Boolean(p));
    const checks = checksAbout([], exterior.portalIds, []);
    const conflicts = conflictsAbout([], exterior.portalIds, []);
    const noEntry = RESTRICTIVE.has(exterior.in);
    const noExit = RESTRICTIVE.has(exterior.out);
    const direction = noEntry && exterior.out === "ALLOWED" ? "exit-only" : noExit && exterior.in === "ALLOWED" ? "entrance-only" : `in: ${lower(exterior.in)}, out: ${lower(exterior.out)}`;
    const at = buildingPoint(stated.code);
    targets.push({
      id: `rule:${stated.code}:exterior`,
      kind: "RULE",
      name: `${stated.code}: ${portals.map((p) => p.description.toLowerCase()).join("; ") || "outside doors"} (${direction})`,
      building: stated.code,
      edgeIds: [],
      entry: { from: OUTSIDE, to: stated.code, label: `Into ${stated.code}` },
      exit: { from: stated.code, to: OUTSIDE, label: `Out of ${stated.code}` },
      shown: { evidence: exterior.evidence, activation: "ACTIVE", knowledgeReviewedAt: reviewedAt },
      location: at && { ...at, precision: "BUILDING", note: `These doors have no surveyed position. The marker is ${stated.code}'s campus-map point, which is where a walk to the building arrives.` },
      nodes: [],
      research: portals.map(portalText),
      sourceIds: exterior.sourceIds,
      current: [
        `A walk arriving at ${stated.code}'s map point ${noEntry ? "may not go in" : "may go in"} by these doors (${lower(exterior.in)}), and ${noExit ? "may not leave" : "may leave"} by them (${lower(exterior.out)}).`,
        `Students are told: "${exterior.arrivalAdvice}"`,
        `Evidence: ${lower(exterior.evidence)}.`,
      ],
      checks,
      conflicts,
      why: [
        "The doors have no surveyed position, so UW Go cannot show which is which.",
        ...conflicts.map((c) => `Sources disagree: ${c.subject}.`),
      ],
      toCheck: [
        ...portals.map((p) => `Go to each of the doors the research calls "${p.description}". From outside, try to go in: locked? Signed exit-only?`),
        "From inside, check each one opens outwards without an alarm.",
        "Which door, if any, does let you in from outside, and when? Write it in the note, and set its location.",
        "Note any hours, event-only or exam-only signs.",
        ...checks.map((c) => c.question),
      ],
    });
  }

  // ---- Opening hours of every building on the network
  const hourChecks = k.overlay.fieldChecks.filter((c) => !c.edgeIds?.length && !c.research?.portals?.length && !c.research?.connections?.length && /hours/i.test(`${c.id} ${c.question}`));
  for (const code of [...g.anchorsByBuilding.keys()].sort()) {
    const fact = k.buildingFacts.get(code)?.availability;
    const av = buildingAvailability(g, code);
    const checks = hourChecks.filter((c) => new RegExp(`\\b${code}\\b`).test(c.question));
    for (const c of checks) attached.add(c.id);
    const rule = fact?.ruleId ? k.research.rules.find((r) => r.id === fact.ruleId) : undefined;
    const at = buildingPoint(code);
    targets.push({
      id: `hours:${code}`,
      kind: "HOURS",
      name: `${code} opening hours`,
      building: code,
      edgeIds: [],
      // With nothing stated, what routing does is UW Go's own assumption.
      shown: { evidence: fact?.evidence ?? "INFERRED", activation: "ACTIVE", knowledgeReviewedAt: reviewedAt },
      location: at && { ...at, precision: "BUILDING", note: `${code}'s campus-map point. The hours to read are the ones posted at its main doors.` },
      nodes: [],
      research: rule ? [{ id: rule.id, text: rule.rule, evidence: fact!.evidence }] : [],
      sourceIds: fact?.sourceIds ?? [],
      current: [av && fact
        ? `Routing uses: ${describeAvailability(av)} (${lower(fact.evidence)}).`
        : `Unknown. Routes pass through ${code} only between 07:00 and 22:00, which is UW Go's assumption; a trip that starts or ends there is never refused.`],
      checks,
      conflicts: [],
      why: av && fact ? [`Stated by ${fact.sourceIds.join(", ") || "a source"}, never read on site.`] : ["Nobody has recorded when it is open."],
      toCheck: [
        `Read the hours posted at ${code}'s main entrances: weekdays, Saturday and Sunday. Write them in the note exactly as posted.`,
        "Are any doors locked earlier than the building, or card-only after hours? Note which.",
        "Note any exam-period, summer or holiday exceptions that are posted.",
        ...checks.map((c) => c.question),
      ],
    });
  }

  // ---- Research leads that are not routed
  for (const c of k.research.routeCandidates) {
    if (c.routeType === "official_approach") continue;
    const code = buildingNamedIn(c.originDestination) ?? buildingNamedIn(c.sequence.join(" "));
    const at = buildingPoint(code);
    targets.push({
      id: `lead:${c.id}`,
      kind: "LEAD",
      name: `${c.originDestination}: ${c.sequence.join(" → ")}`,
      building: code,
      edgeIds: [],
      shown: { evidence: c.evidence, activation: c.activation, knowledgeReviewedAt: reviewedAt },
      location: at && { ...at, precision: "BUILDING", note: `A research lead with no position. The marker is ${code}'s campus-map point.` },
      nodes: [],
      research: [candidateText(c)],
      sourceIds: c.sourceIds,
      current: ["Not routed. Kept for measurement: nothing in it is used until each door and link on the way is checked and promoted on its own."],
      checks: [],
      conflicts: [],
      why: [`A ${lower(c.routeType)} (${lower(c.evidence)}): ${c.reportedBenefit}`],
      toCheck: [
        `Walk it: ${c.sequence.join(" → ")}. Time it, and note any door that was locked or needed a card.`,
        "Walk the ordinary way outside between the same two places and time that too.",
        "Where UW Go shows a door or link you used, record it there as well, as its own observation.",
      ],
    });
  }
  const routed = new Set(k.overlay.edges.flatMap((f) => (f.research?.connection ? [f.research.connection] : [])));
  const gone = new Set(k.overlay.historical.flatMap((h) => (h.connectionId ? [h.connectionId] : [])));
  for (const c of k.research.connections) {
    if (routed.has(c.id) || gone.has(c.id)) continue;
    const checks = checksAbout([], [], [c.id]);
    const conflicts = conflictsAbout([], [], [c.id]);
    const code = findBuilding("UW", c.from)?.code;
    const at = buildingPoint(code);
    const levels = c.levels ? Object.entries(c.levels).map(([b, l]) => `${b} ${Array.isArray(l) ? l.join("/") : l ?? "?"}`).join(", ") : "";
    targets.push({
      id: `lead:${c.id}`,
      kind: "LEAD",
      name: `${c.from}–${c.to}: ${c.connectionType}`,
      building: code,
      edgeIds: [],
      shown: { evidence: c.evidence, activation: c.activation, knowledgeReviewedAt: reviewedAt },
      location: at && { ...at, precision: "BUILDING", note: `The survey has no such link. The marker is ${c.from}'s campus-map point.` },
      nodes: [],
      research: [connectionText(c)],
      sourceIds: c.sourceIds,
      current: [`Not routed: the survey has no such link (${c.status.replace(/_/g, " ")}).`],
      checks,
      conflicts,
      why: [`The research describes a ${c.connectionType} the survey does not have.`, ...conflicts.map((x) => `Sources disagree: ${x.subject}.`)],
      toCheck: [
        `Look for the ${c.connectionType} between ${c.from} and ${c.to}${levels ? ` (${levels})` : ""}. Does it exist?`,
        "If it does: which floor at each end, can students use it each way, any steps, any posted hours?",
        "Set where it starts from GPS, and describe it in the note.",
        ...checks.map((x) => x.question),
      ],
    });
  }

  // ---- Open questions no single door, link or building answers
  for (const c of k.overlay.fieldChecks) {
    if (attached.has(c.id)) continue;
    const portal = c.research?.portals?.map((id) => k.portals.get(id)).find(Boolean);
    const connection = c.research?.connections?.map((id) => k.connections.get(id)).find(Boolean);
    const code = portal?.buildingId ?? connection?.from ?? buildingNamedIn(c.where);
    const at = buildingPoint(code);
    targets.push({
      id: `check:${c.id}`,
      kind: "CHECK",
      name: c.where,
      building: code,
      edgeIds: c.edgeIds ?? [],
      shown: { evidence: "UNRESOLVED", activation: "ACTIVE", knowledgeReviewedAt: reviewedAt },
      location: at && { ...at, precision: "BUILDING", note: `${code}'s campus-map point. The question is about ${c.where}.` },
      nodes: [],
      research: [],
      sourceIds: [],
      current: [c.why],
      checks: [c],
      conflicts: [],
      why: [c.why],
      toCheck: [c.question],
    });
  }

  return targets.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
