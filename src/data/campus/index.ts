import raw from "./research/uwgo-routing-research-2026-09-14.json";
import { normalizeResearch, type RawResearch } from "./normalize";
import { CAMPUS_OVERLAY } from "./overlay";
import { compileKnowledge } from "./knowledge";

/**
 * Campus routing knowledge: the research package of 2026-09-14, normalised, and UW Go's reviewed
 * decisions attaching it to the surveyed network. See README.md in this directory.
 *
 * The JSON's inferred type is wider than the published schema in places (empty arrays, optional
 * fields), so it is read as the schema and `normalizeResearch` checks the values themselves.
 */
export const CAMPUS_RESEARCH = normalizeResearch(raw as unknown as RawResearch);

export const CAMPUS_KNOWLEDGE = compileKnowledge(CAMPUS_RESEARCH, CAMPUS_OVERLAY);

export { CAMPUS_OVERLAY };
export { claimsUsable, compileKnowledge, emptyKnowledge, surveyedEdges, validateKnowledge, type CampusKnowledge, type SurveyedEdge } from "./knowledge";
export type * from "./types";
