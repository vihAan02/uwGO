import raw from "./research/uwgo-routing-research-2026-09-14.json";
import { normalizeResearch, type RawResearch } from "./normalize";
import { CAMPUS_OVERLAY } from "./overlay";
import { FIELD_PROMOTIONS } from "./field/promotions";
import { compileKnowledge } from "./knowledge";

/**
 * Campus routing knowledge: the research package of 2026-09-14, normalised; UW Go's reviewed decisions
 * attaching it to the surveyed network; and the field observations a reviewer has deliberately promoted
 * into facts. See README.md in this directory. The observations themselves are never imported here or
 * anywhere routing reads: only a promotion reaches a route.
 *
 * The JSON's inferred type is wider than the published schema in places (empty arrays, optional
 * fields), so it is read as the schema and `normalizeResearch` checks the values themselves.
 */
export const CAMPUS_RESEARCH = normalizeResearch(raw as unknown as RawResearch);

export const CAMPUS_KNOWLEDGE = compileKnowledge(CAMPUS_RESEARCH, CAMPUS_OVERLAY, FIELD_PROMOTIONS);

export { CAMPUS_OVERLAY, FIELD_PROMOTIONS };
export { EVIDENCE_STRENGTH, claimsUsable, compileKnowledge, emptyKnowledge, surveyedEdges, validateKnowledge, type CampusKnowledge, type SurveyedEdge } from "./knowledge";
export type * from "./types";
export type * from "./field/types";
