// Audit of the campus routing knowledge. Writes docs/campus-routing-audit.md.
// Reads the TypeScript sources directly (Node strips the types), so it needs Node 22.6+.
// Usage: node scripts/audit-campus-routing.mjs
import fs from "node:fs";
import path from "node:path";
import raw from "../src/data/campus/research/uwgo-routing-research-2026-09-14.json" with { type: "json" };
import { normalizeResearch } from "../src/data/campus/normalize.ts";
import { CAMPUS_OVERLAY } from "../src/data/campus/overlay.ts";
import { compileKnowledge, surveyedEdges, validateKnowledge } from "../src/data/campus/knowledge.ts";
import { renderCampusAudit } from "../src/data/campus/report.ts";
import { UW_INDOOR_NETWORK } from "../src/data/indoor/uw-indoor-network.generated.ts";
import { edgeId } from "../src/data/indoor/edgeId.ts";

const here = path.dirname(new URL(import.meta.url).pathname);
const out = path.join(here, "..", "docs", "campus-routing-audit.md");

const research = normalizeResearch(raw);
if (research.issues.length) {
  console.error("The research did not import cleanly:");
  for (const i of research.issues) console.error(`  ${i}`);
  process.exit(1);
}
const knowledge = compileKnowledge(research, CAMPUS_OVERLAY);
const surveyed = surveyedEdges(UW_INDOOR_NETWORK, edgeId);
const problems = validateKnowledge(knowledge, surveyed);
if (problems.length) {
  console.error("The overlay does not match the research or the network:");
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}

fs.writeFileSync(out, renderCampusAudit(knowledge, surveyed));
console.log(`wrote ${out}: ${CAMPUS_OVERLAY.edges.length} reviewed segments, ${CAMPUS_OVERLAY.conflicts.length} conflicts, ${CAMPUS_OVERLAY.fieldChecks.length} field checks`);
