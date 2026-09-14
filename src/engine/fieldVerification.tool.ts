import { writeFileSync } from "node:fs";
import path from "node:path";
import { it } from "vitest";
import { buildFieldTargets } from "./fieldTargets";
import { TIERS, analyseFieldPriorities } from "./fieldPriority";
import { renderFieldVerificationDoc } from "./fieldVerificationDoc";

/**
 * Regenerates the field-verification ranking (src/data/campus/field/priorities.generated.json) and
 * docs/campus-field-verification.md: `npm run campus:field`. Run it after changing the network, the overlay,
 * a promotion or the ranking itself; a test says when it is due. Not a test.
 */
it("field verification ranking", async () => {
  const started = performance.now();
  const targets = buildFieldTargets();
  const priorities = await analyseFieldPriorities(targets);
  const root = process.cwd();
  writeFileSync(path.resolve(root, "src/data/campus/field/priorities.generated.json"), `${JSON.stringify(priorities, null, 1)}\n`);
  writeFileSync(path.resolve(root, "docs/campus-field-verification.md"), renderFieldVerificationDoc(targets, priorities));
  const tiers = TIERS.map((tier) => `${tier} ${Object.values(priorities.targets).filter((p) => p.tier === tier).length}`).join(", ");
  process.stderr.write(`\n${targets.length} targets ranked in ${Math.round(performance.now() - started)} ms: ${tiers}\n`);
}, 600_000);
