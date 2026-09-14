import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CAMPUS_KNOWLEDGE, surveyedEdges } from ".";
import { renderCampusAudit } from "./report";
import { UW_INDOOR_NETWORK as NET } from "@/data/indoor/uw-indoor-network.generated";
import { edgeId } from "@/data/indoor/edgeId";

describe("docs/campus-routing-audit.md", () => {
  it("matches the research and the reviewed decisions; run `node scripts/audit-campus-routing.mjs` after changing either", () => {
    const written = readFileSync(path.resolve(process.cwd(), "docs/campus-routing-audit.md"), "utf8");
    expect(written).toBe(renderCampusAudit(CAMPUS_KNOWLEDGE, surveyedEdges(NET, edgeId)));
  });

  it("lists every priority-1 field check and every conflict", () => {
    const doc = renderCampusAudit(CAMPUS_KNOWLEDGE, surveyedEdges(NET, edgeId));
    for (const c of CAMPUS_KNOWLEDGE.overlay.conflicts) expect(doc).toContain(`(\`${c.id}\`)`);
    for (const f of CAMPUS_KNOWLEDGE.overlay.fieldChecks.filter((x) => x.priority === 1)) expect(doc).toContain(f.question);
  });
});
