import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { UW_INDOOR_NETWORK as NET } from "@/data/indoor/uw-indoor-network.generated";
import { edgeId } from "@/data/indoor/edgeId";
import { CAMPUS_KNOWLEDGE, CAMPUS_OVERLAY, CAMPUS_RESEARCH, EVIDENCE_STRENGTH, FIELD_PROMOTIONS, claimsUsable, compileKnowledge, surveyedEdges, validateKnowledge } from "..";
import { EVIDENCE_ORDER } from "../types";
import type { FieldObservation, FieldPromotion, FieldTargetRef } from "./types";
import { OBSERVATION_FILE_SCHEMA, describeClaims, directionsSeen, markConflicts, normaliseMarks, observationProblems, parseObservationFile, promotionProblems, suggestClaims } from "./rules";

/**
 * Field verification keeps what was seen apart from what routing uses: an observation is checked when it
 * is imported, and becomes a fact only through a promotion whose every claim the observations support.
 */

const SLC_EAST = "5ba0e3d2964bf706";
const SLC_PAC = "c34ea719b8b9dee5";
const MC_LOWER = "20827964a85e8890";
const surveyed = surveyedEdges(NET, edgeId);

const slcEast: FieldTargetRef = {
  id: `door:${SLC_EAST}`, kind: "DOOR", name: "SLC east doors (toward MC)", building: "SLC", edgeIds: [SLC_EAST],
  entry: { from: "OUT", to: "SLC", label: "Into SLC" }, exit: { from: "SLC", to: "OUT", label: "Out of SLC" },
  shown: { evidence: "CORROBORATED", activation: "ACTIVE", knowledgeReviewedAt: "2026-09-14" },
};

const observation = (over: Partial<FieldObservation> = {}): FieldObservation => ({
  id: "fo-20260920T181500Z-a1b2", target: slcEast, observedAt: "2026-09-20T14:15:00-04:00", verifier: "DM", marks: ["BOTH_WAYS", "AUTOMATIC_DOOR"], ...over,
});

const promotion = (over: Partial<FieldPromotion> = {}): FieldPromotion => ({
  id: "FP_TEST",
  observationIds: ["fo-20260920T181500Z-a1b2"],
  subject: { edges: [{ edgeId: SLC_EAST, kind: "DOOR", between: ["OUT", "SLC"] }] },
  claims: { passage: { "OUT>SLC": "ALLOWED", "SLC>OUT": "ALLOWED" }, access: { automaticDoor: true } },
  observedOn: "2026-09-20", verifiedBy: ["DM"], reviewedAt: "2026-09-21", reviewedBy: "DM", basis: "Went in and out; the opener works.",
  ...over,
});

const byId = (...obs: FieldObservation[]) => new Map(obs.map((o) => [o.id, o]));

describe("marks", () => {
  it("read entry and exit together as both, and a lock as whichever way was not marked working", () => {
    expect(normaliseMarks(["EXIT_WORKS", "ENTRY_WORKS", "RAMP"])).toEqual(["BOTH_WAYS", "RAMP"]);
    expect(directionsSeen(["EXIT_WORKS", "LOCKED"])).toEqual({ entry: "LOCKED", exit: "WORKS" });
    expect(directionsSeen(["LOCKED"])).toEqual({ entry: "LOCKED", exit: "LOCKED" });
    expect(directionsSeen(["AUTOMATIC_DOOR"])).toEqual({ entry: undefined, exit: undefined });
  });

  it("refuse combinations that cannot all be true of one visit", () => {
    expect(markConflicts(["DOES_NOT_EXIST", "ENTRY_WORKS"])).toHaveLength(1);
    expect(markConflicts(["ACCESSIBLE", "NOT_ACCESSIBLE"])).toHaveLength(1);
    expect(markConflicts(["ENTRY_WORKS", "EXIT_WORKS", "LOCKED"])).toHaveLength(1);
    expect(markConflicts(["EXIT_WORKS", "LOCKED", "STAIRS"])).toEqual([]);
  });
});

describe("an exported file", () => {
  it("imports a well-formed observation", () => {
    const { observations, problems } = parseObservationFile({ schema: OBSERVATION_FILE_SCHEMA, exportedAt: "2026-09-20T18:00:00Z", observations: [observation()] });
    expect(problems).toEqual([]);
    expect(observations).toHaveLength(1);
  });

  it("refuses anything the page would not have written", () => {
    expect(parseObservationFile({ observations: [] }).problems[0]).toMatch(/not a UW Go field observation export/);
    expect(observationProblems({ ...observation(), id: "x" }).join()).toMatch(/id is not/);
    expect(observationProblems({ ...observation(), observedAt: "2026-09-20 14:15" }).join()).toMatch(/observedAt/);
    expect(observationProblems({ ...observation(), marks: ["SOMETIMES"] }).join()).toMatch(/known marks/);
    expect(observationProblems({ ...observation(), marks: [] }).join()).toMatch(/nothing was recorded/);
    expect(observationProblems({ ...observation(), marks: ["BOTH_WAYS", "LOCKED"] }).join()).toMatch(/locked, and working both ways/);
    expect(observationProblems({ ...observation(), correctedLocation: { lat: 43.472, lng: -80.545, source: "GPS" } }).join()).toMatch(/Wrong location/);
    expect(observationProblems({ ...observation(), marks: ["WRONG_LOCATION"], correctedLocation: { lat: 40.7, lng: -74, source: "GPS" } }).join()).toMatch(/not on or near campus/);
    const twice = parseObservationFile({ schema: OBSERVATION_FILE_SCHEMA, exportedAt: "", observations: [observation(), observation()] });
    expect(twice.observations).toHaveLength(1);
    expect(twice.problems).toEqual(["fo-20260920T181500Z-a1b2: listed twice"]);
  });

  it("lets a door the research describes but nobody has placed be given its position without calling it wrong", () => {
    const portal: FieldTargetRef = { ...slcEast, id: "portal:SLC-P01", kind: "PORTAL", edgeIds: [] };
    expect(observationProblems(observation({ target: portal, marks: ["ENTRY_WORKS"], correctedLocation: { lat: 43.4719, lng: -80.5454, source: "GPS" } }))).toEqual([]);
  });
});

describe("drafting and checking a promotion", () => {
  it("drafts only what every visit agrees on, and reports what they disagree about", () => {
    expect(suggestClaims(slcEast, [observation()])).toEqual({ claims: { placement: "CONFIRMED", passage: { "OUT>SLC": "ALLOWED", "SLC>OUT": "ALLOWED" }, access: { automaticDoor: true } }, contradictions: [] });
    const night = observation({ id: "fo-20260921T010000Z-c3d4", observedAt: "2026-09-20T21:00:00-04:00", marks: ["EXIT_WORKS", "LOCKED"] });
    const both = suggestClaims(slcEast, [observation(), night]);
    expect(both.contradictions).toEqual(["Into SLC: one visit found it working, another locked"]);
    expect(both.claims.passage).toEqual({ "SLC>OUT": "ALLOWED" });
  });

  it("accepts claims the observations saw", () => {
    expect(promotionProblems(promotion(), byId(observation()))).toEqual([]);
    expect(describeClaims(promotion().claims)).toEqual(["OUT → SLC allowed", "SLC → OUT allowed", "automatic door"]);
  });

  it("refuses a claim nobody saw, a restriction a visit contradicts, and a date or verifier that does not match", () => {
    const problems = promotionProblems(promotion({ claims: { passage: { "OUT>SLC": "PROHIBITED" }, access: { stepFree: true, accessibleDesignation: true } }, observedOn: "2026-09-19", verifiedBy: ["XY"] }), byId(observation()));
    for (const expected of ["OUT>SLC PROHIBITED: no observation found it locked", "OUT>SLC PROHIBITED: an observation saw it work", "stepFree", "accessibleDesignation", "observedOn is 2026-09-19", "verifiedBy should be DM"]) {
      expect(problems.some((p) => p.includes(expected)), expected).toBe(true);
    }
    expect(promotionProblems(promotion({ observationIds: ["fo-20260101T000000Z-zzzz"] }), byId(observation()))).toEqual(["promotion FP_TEST: no imported observation fo-20260101T000000Z-zzzz"]);
  });

  it("never turns a door nobody marked automatic into a manual one", () => {
    expect(promotionProblems(promotion({ claims: { access: { automaticDoor: false } } }), byId(observation({ marks: ["BOTH_WAYS"] }))).join()).toMatch(/unknown, not manual/);
  });

  it("refuses claims about a segment the observations were not about", () => {
    const elsewhere = promotion({ subject: { edges: [{ edgeId: MC_LOWER, kind: "DOOR", between: ["OUT", "MC"] }] } });
    expect(promotionProblems(elsewhere, byId(observation())).join()).toMatch(/is not part of door:5ba0e3d2964bf706/);
  });

  it("reads each visit's directions from the target as that visit saw it, so a relabelled link cannot flip them", () => {
    const link = (from: string, to: string): FieldTargetRef => ({
      id: `link:${SLC_PAC}`, kind: "LINK", name: "SLC–PAC link at the PAC front desk", edgeIds: [SLC_PAC],
      entry: { from, to, label: `${from} to ${to}` }, exit: { from: to, to: from, label: `${to} to ${from}` },
      shown: { evidence: "CORROBORATED", activation: "ACTIVE", knowledgeReviewedAt: "2026-09-14" },
    });
    const one = observation({ target: link("SLC", "PAC"), marks: ["ENTRY_WORKS"] });
    // Recorded after the page's labels swapped: its "exit" is SLC to PAC.
    const two = observation({ id: "fo-20260921T160000Z-e5f6", observedAt: "2026-09-21T12:00:00-04:00", target: link("PAC", "SLC"), marks: ["EXIT_WORKS", "LOCKED"] });
    const drafted = suggestClaims(link("SLC", "PAC"), [one, two]);
    expect(drafted.contradictions).toEqual([]);
    expect(drafted.claims.passage).toEqual({ "SLC>PAC": "ALLOWED", "PAC>SLC": "PROHIBITED" });
  });

  it("does not make usable what a visit found locked, and never quarantines on a visit", () => {
    const locked = promotionProblems(promotion({ claims: { activation: "ACTIVE" } }), byId(observation({ marks: ["LOCKED"] })));
    expect(locked.some((p) => p.includes("no observation used it"))).toBe(true);
    expect(locked.some((p) => p.includes("OUT>SLC was found locked"))).toBe(true);
    const exitOnly = byId(observation({ marks: ["EXIT_WORKS", "LOCKED"] }));
    expect(promotionProblems(promotion({ claims: { activation: "ACTIVE", passage: { "SLC>OUT": "ALLOWED" } } }), exitOnly).join()).toMatch(/OUT>SLC was found locked, so the promotion must restrict it/);
    expect(promotionProblems(promotion({ claims: { activation: "ACTIVE", passage: { "OUT>SLC": "PROHIBITED", "SLC>OUT": "ALLOWED" } } }), exitOnly)).toEqual([]);

    const quarantined: FieldTargetRef = { ...slcEast, shown: { ...slcEast.shown, activation: "QUARANTINED" } };
    expect(suggestClaims(quarantined, [observation({ target: quarantined, marks: ["EXIT_WORKS", "LOCKED"] })]).claims.activation).toBeUndefined();
    expect(suggestClaims(quarantined, [observation({ target: quarantined, marks: ["BOTH_WAYS"] })]).claims.activation).toBe("ACTIVE");
    expect(promotionProblems(promotion({ claims: { activation: "QUARANTINED" } }), byId(observation())).join()).toMatch(/a visit does not quarantine/);
  });

  it("reads a locked change of floor as needing a key, never as step-free or usable", () => {
    const id = edgeId(NET, NET.edges.find((e) => e.kind === "STAIRS" && e.floors !== 0)!);
    const between = surveyed.get(id)!.between;
    const stairwell: FieldTargetRef = { id: `vertical:${id}`, kind: "VERTICAL", name: "A stairwell", building: between[0], edgeIds: [id], shown: { evidence: "SURVEYED", activation: "ACTIVE", knowledgeReviewedAt: "2026-09-14" } };
    const visit = (marks: FieldObservation["marks"]) => observation({ target: stairwell, marks });
    expect(observationProblems(visit(["ELEVATOR", "ACCESSIBLE", "LOCKED"])).join()).toMatch(/marked accessible, and locked/);

    const drafted = suggestClaims(stairwell, [visit(["ELEVATOR", "LOCKED"])]);
    expect(drafted.claims).toMatchObject({ vertical: ["ELEVATOR"], access: { independent: false } });
    expect(drafted.claims.access?.stepFree).not.toBe(true);
    expect(drafted.claims.activation).toBeUndefined();

    const subject = { edges: [{ edgeId: id, kind: "STAIRS" as const, between }] };
    const seen = byId(visit(["ELEVATOR", "LOCKED"]));
    expect(promotionProblems(promotion({ subject, claims: { vertical: ["ELEVATOR"], access: { stepFree: true } } }), seen).join()).toMatch(/stepFree: needs/);
    expect(promotionProblems(promotion({ subject, claims: { activation: "ACTIVE" } }), seen).join()).toMatch(/activation ACTIVE: an observation found it locked/);
    expect(promotionProblems(promotion({ subject, claims: { vertical: ["ELEVATOR"], access: { independent: false } } }), seen)).toEqual([]);
  });

  it("confirms a place only from a visit that found it there, and only for something that has one", () => {
    const confirmed = promotion({ claims: { placement: "CONFIRMED" } });
    expect(promotionProblems(confirmed, byId(observation({ marks: ["WRONG_LOCATION"] }))).join()).toMatch(/no observation recorded finding it here/);
    expect(promotionProblems(confirmed, byId(observation({ marks: ["STAIRS"] })))).toEqual([]);
    const rule: FieldTargetRef = { id: "rule:PAC:exterior", kind: "RULE", name: "PAC's corner doors", building: "PAC", edgeIds: [], shown: slcEast.shown };
    const atRule = promotion({ subject: { building: "PAC" }, claims: { placement: "CONFIRMED" } });
    expect(promotionProblems(atRule, byId(observation({ target: rule, marks: ["LOCKED"] }))).join()).toMatch(/placement: only a surveyed door, link or change of floor/);
  });
});

describe("a promotion in the knowledge", () => {
  it("rests the fact on the visit, names the observations, and keeps everything it did not claim", () => {
    const promoted = compileKnowledge(CAMPUS_RESEARCH, CAMPUS_OVERLAY, [promotion()]);
    const before = CAMPUS_KNOWLEDGE.edgeFacts.get(SLC_EAST)!;
    const fact = promoted.edgeFacts.get(SLC_EAST)!;
    expect(fact.evidence).toBe("FIELD_VERIFIED");
    expect(fact.passage).toEqual({ "OUT>SLC": "ALLOWED", "SLC>OUT": "ALLOWED" });
    // Entry was official but the way out was never recorded: the passage as a whole now rests on the visit.
    expect(fact.passageEvidence).toBe("FIELD_VERIFIED");
    expect(fact.access).toEqual({ automaticDoor: true });
    expect(fact.accessEvidence).toBe("FIELD_VERIFIED");
    expect({ label: fact.label, sourceIds: fact.sourceIds, research: fact.research }).toEqual({ label: before.label, sourceIds: before.sourceIds, research: before.research });
    expect(fact.field).toEqual([{ promotionId: "FP_TEST", observationIds: ["fo-20260920T181500Z-a1b2"], observedOn: "2026-09-20", verifiedBy: ["DM"], reviewedAt: "2026-09-21", claims: promotion().claims }]);
    expect(validateKnowledge(promoted, surveyed)).toEqual([]);
  });

  it("keeps the stronger evidence for a passage a visit only confirms", () => {
    const entry = compileKnowledge(CAMPUS_RESEARCH, CAMPUS_OVERLAY, [promotion({ claims: { passage: { "OUT>SLC": "ALLOWED" } } })]).edgeFacts.get(SLC_EAST)!;
    expect(entry.passageEvidence).toBe("OFFICIAL");
    expect(entry.evidence).toBe("FIELD_VERIFIED");
  });

  it("does not let finding a door vouch for access nobody checked", () => {
    const mcDoor = { edgeId: MC_LOWER, kind: "DOOR" as const, between: ["OUT", "MC"] as const };
    // The catalogue's automatic door, on a door matched to the catalogue only by UW Go's guess.
    expect(CAMPUS_KNOWLEDGE.edgeFacts.get(MC_LOWER)).toMatchObject({ evidence: "INFERRED", access: { automaticDoor: true } });
    const placed = compileKnowledge(CAMPUS_RESEARCH, CAMPUS_OVERLAY, [promotion({ subject: { edges: [mcDoor] }, claims: { placement: "CONFIRMED" } })]).edgeFacts.get(MC_LOWER)!;
    expect(placed.evidence).toBe("FIELD_VERIFIED");
    expect(placed.access).toEqual({ automaticDoor: true });
    expect(claimsUsable(placed.accessEvidence ?? placed.evidence, false)).toBe(false);

    const opener = compileKnowledge(CAMPUS_RESEARCH, CAMPUS_OVERLAY, [promotion({ subject: { edges: [mcDoor] }, claims: { placement: "CONFIRMED", access: { automaticDoor: true } } })]).edgeFacts.get(MC_LOWER)!;
    expect(opener.accessEvidence).toBe("FIELD_VERIFIED");

    // A visit that marks a ramp does not carry the guessed opener onto evidence it never had.
    const ramp = compileKnowledge(CAMPUS_RESEARCH, CAMPUS_OVERLAY, [promotion({ subject: { edges: [mcDoor] }, claims: { access: { ramp: true } } })]).edgeFacts.get(MC_LOWER)!;
    expect(ramp.access).toEqual({ ramp: true });
    expect(ramp.accessEvidence).toBe("FIELD_VERIFIED");
  });

  it("only ever adds ways of changing floor, each resting on the visit that saw it", () => {
    const id = edgeId(NET, NET.edges.find((e) => e.kind === "STAIRS" && e.floors !== 0)!);
    const ref = { edgeId: id, kind: "STAIRS" as const, between: surveyed.get(id)!.between };
    const k = compileKnowledge(CAMPUS_RESEARCH, CAMPUS_OVERLAY, [
      promotion({ id: "FP_STAIRS", subject: { edges: [ref] }, claims: { vertical: ["STAIRS"] } }),
      promotion({ id: "FP_LIFT", subject: { edges: [ref] }, claims: { vertical: ["ELEVATOR"] } }),
    ]);
    const fact = k.edgeFacts.get(id)!;
    expect([...fact.vertical!].sort()).toEqual(["ELEVATOR", "STAIRS"]);
    expect(fact.verticalEvidence).toBe("FIELD_VERIFIED");
    expect(validateKnowledge(k, surveyed)).toEqual([]);
  });

  it("lifts a quarantine only when the promotion says which ways the segment may be used, or why not", () => {
    const passage1501 = { edgeId: "da37b9775d7d3903", kind: "TUNNEL" as const, between: ["RCH", "DWE"] as const };
    const lift = (claims: FieldPromotion["claims"]) => compileKnowledge(CAMPUS_RESEARCH, CAMPUS_OVERLAY, [promotion({ id: "FP_1501", subject: { edges: [passage1501] }, claims })]);
    const problemsOf = (k: ReturnType<typeof lift>) => validateKnowledge(k, surveyed).filter((p) => p.includes("FP_1501"));
    expect(problemsOf(lift({ activation: "ACTIVE", passage: { "RCH>DWE": "ALLOWED" } })).join()).toMatch(/without a passage for DWE>RCH/);
    const both = lift({ activation: "ACTIVE", passage: { "RCH>DWE": "ALLOWED", "DWE>RCH": "ALLOWED" } });
    expect(problemsOf(both)).toEqual([]);
    expect(both.edgeFacts.get(passage1501.edgeId)).toMatchObject({ activation: "ACTIVE", evidence: "FIELD_VERIFIED", passageEvidence: "FIELD_VERIFIED" });
  });

  it("makes an inferred door one routing may rely on, a surveyed door with no fact a fact, and a misplaced one unusable", () => {
    const mcDoor = { edgeId: MC_LOWER, kind: "DOOR" as const, between: ["OUT", "MC"] as const };
    expect(CAMPUS_KNOWLEDGE.edgeFacts.get(MC_LOWER)!.evidence).toBe("INFERRED");
    const confirmed = compileKnowledge(CAMPUS_RESEARCH, CAMPUS_OVERLAY, [promotion({ subject: { edges: [mcDoor] }, claims: { placement: "CONFIRMED" } })]);
    expect(confirmed.edgeFacts.get(MC_LOWER)!.evidence).toBe("FIELD_VERIFIED");
    expect(claimsUsable(confirmed.edgeFacts.get(MC_LOWER)!.evidence, false)).toBe(true);

    const wrong = compileKnowledge(CAMPUS_RESEARCH, CAMPUS_OVERLAY, [promotion({ subject: { edges: [mcDoor] }, claims: { placement: "WRONG" } })]);
    expect(wrong.edgeFacts.get(MC_LOWER)!.evidence).toBe("UNRESOLVED");
    // Not where UW Go shows it: out of routing, access included, until someone finds it there.
    expect(wrong.edgeFacts.get(MC_LOWER)).toMatchObject({ activation: "QUARANTINED", accessEvidence: "UNRESOLVED" });

    const unreviewed = NET.edges
      .filter((e) => e.kind === "DOOR" && [NET.nodes[e.a].building, NET.nodes[e.b].building].sort().join() === "MC,OUT")
      .map((e) => edgeId(NET, e))
      .find((id) => !CAMPUS_KNOWLEDGE.edgeFacts.has(id))!;
    const fresh = compileKnowledge(CAMPUS_RESEARCH, CAMPUS_OVERLAY, [promotion({ subject: { edges: [{ edgeId: unreviewed, kind: "DOOR", between: ["OUT", "MC"] }] }, label: "MC north-west doors", claims: { passage: { "OUT>MC": "ALLOWED" } } })]);
    expect(fresh.edgeFacts.get(unreviewed)).toMatchObject({ label: "MC north-west doors", evidence: "FIELD_VERIFIED", activation: "ACTIVE", passage: { "OUT>MC": "ALLOWED" } });
    expect(validateKnowledge(fresh, surveyed)).toEqual([]);
  });

  it("requires a reason before the ground overrules stronger evidence, and then records the change as field-verified", () => {
    const pacIn = { subject: { building: "PAC" }, claims: { passage: { "OUT>PAC": "ALLOWED" } } } as const;
    const unreasoned = compileKnowledge(CAMPUS_RESEARCH, CAMPUS_OVERLAY, [promotion({ id: "FP_PAC", ...pacIn })]);
    expect(validateKnowledge(unreasoned, surveyed).some((p) => p.includes("FP_PAC") && p.includes("supersedes"))).toBe(true);
    const reasoned = compileKnowledge(CAMPUS_RESEARCH, CAMPUS_OVERLAY, [promotion({ id: "FP_PAC", ...pacIn, supersedes: "test" })]);
    expect(validateKnowledge(reasoned, surveyed)).toEqual([]);
    expect(reasoned.buildingFacts.get("PAC")!.exterior).toMatchObject({ in: "ALLOWED", out: "ALLOWED", evidence: "FIELD_VERIFIED" });

    const ev1hh = { edgeId: "fc8df53f6b2f3f8b", kind: "TUNNEL" as const, between: ["EV1", "HH"] as const };
    const stepFree = compileKnowledge(CAMPUS_RESEARCH, CAMPUS_OVERLAY, [promotion({ id: "FP_EV1HH", subject: { edges: [ev1hh] }, claims: { access: { stepFree: true } } })]);
    expect(validateKnowledge(stepFree, surveyed).some((p) => p.includes("FP_EV1HH") && p.includes("stepFree contradicts"))).toBe(true);
  });

  it("catches a promotion naming a segment the network does not have, or calling a door a change of floor", () => {
    const ghost = compileKnowledge(CAMPUS_RESEARCH, CAMPUS_OVERLAY, [promotion({ id: "FP_GHOST", subject: { edges: [{ edgeId: "0000000000000000", kind: "DOOR", between: ["OUT", "MC"] }] } })]);
    expect(validateKnowledge(ghost, surveyed).some((p) => p.includes("FP_GHOST") && p.includes("no surveyed segment"))).toBe(true);
    const lift = compileKnowledge(CAMPUS_RESEARCH, CAMPUS_OVERLAY, [promotion({ id: "FP_LIFT", claims: { vertical: ["ELEVATOR"] } })]);
    expect(validateKnowledge(lift, surveyed).some((p) => p.includes("FP_LIFT") && p.includes("not a change of floor"))).toBe(true);
  });
});

describe("what routing reads", () => {
  it("never imports a field observation: only promotions reach a route", () => {
    const src = path.resolve(process.cwd(), "src");
    const importsObservations = /(?:from|import\s*\(|require\s*\()\s*["'][^"']*\bobservations\//;
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(entry.name) && !/\.(test|tool)\.ts$/.test(entry.name) && importsObservations.test(readFileSync(p, "utf8"))) offenders.push(path.relative(src, p));
      }
    };
    walk(src);
    expect(offenders).toEqual([]);
  });

  it("holds every committed observation file well-formed, and every promotion to observations that support it", () => {
    const dir = path.resolve(process.cwd(), "src/data/campus/field/observations");
    const all: FieldObservation[] = [];
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
      const { observations, problems } = parseObservationFile(JSON.parse(readFileSync(path.join(dir, file), "utf8")));
      expect(problems, file).toEqual([]);
      all.push(...observations);
    }
    expect(new Set(all.map((o) => o.id)).size).toBe(all.length);
    const observationsById = new Map(all.map((o) => [o.id, o]));
    for (const p of FIELD_PROMOTIONS) expect(promotionProblems(p, observationsById), p.id).toEqual([]);
    expect(validateKnowledge(CAMPUS_KNOWLEDGE, surveyed)).toEqual([]);
  });

  it("orders evidence the same way everywhere", () => {
    expect(EVIDENCE_STRENGTH).toEqual(EVIDENCE_ORDER);
  });
});
