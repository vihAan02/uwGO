// Field verification: bring a phone's export into the repo, and review what the observations support.
// Reads the TypeScript sources directly (Node strips the types), so it needs Node 22.6+.
//
// Usage:
//   node scripts/campus-field.mjs import EXPORT.json
//       Checks every observation in an export from /dev/campus-audit and adds the new ones to
//       src/data/campus/field/observations/, one file per verifier and day. Changes nothing that routes.
//   node scripts/campus-field.mjs list
//       Every imported observation, grouped by what it was about.
//   node scripts/campus-field.mjs review TARGET_ID
//       One target's observations: what they support, what they disagree on, how that compares with what
//       UW Go believes, and a draft promotion to check and, if it stands, paste into promotions.ts.
import fs from "node:fs";
import path from "node:path";
import raw from "../src/data/campus/research/uwgo-routing-research-2026-09-14.json" with { type: "json" };
import { normalizeResearch } from "../src/data/campus/normalize.ts";
import { CAMPUS_OVERLAY } from "../src/data/campus/overlay.ts";
import { FIELD_PROMOTIONS } from "../src/data/campus/field/promotions.ts";
import { compileKnowledge } from "../src/data/campus/knowledge.ts";
import { MARK_LABEL, OBSERVATION_FILE_SCHEMA, describeClaims, markConflicts, observedOn, parseObservationFile, promotionProblems, suggestClaims } from "../src/data/campus/field/rules.ts";
import { UW_INDOOR_NETWORK as NET } from "../src/data/indoor/uw-indoor-network.generated.ts";
import { edgeId } from "../src/data/indoor/edgeId.ts";

const here = path.dirname(new URL(import.meta.url).pathname);
const dir = path.join(here, "..", "src", "data", "campus", "field", "observations");
const [command, arg] = process.argv.slice(2);

function fail(message) {
  console.error(message);
  process.exit(1);
}

/** Every imported observation, with the file it is in. */
function imported() {
  const all = [];
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    const { observations, problems } = parseObservationFile(JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")));
    if (problems.length) fail(`${file} is not well-formed:\n  ${problems.join("\n  ")}`);
    for (const o of observations) all.push({ file, o });
  }
  return all;
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "verifier";
const marks = (o) => (o.marks.length ? o.marks.map((m) => MARK_LABEL[m]).join(", ") : "no marks");
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

if (command === "import") {
  if (!arg) fail("Usage: node scripts/campus-field.mjs import EXPORT.json");
  const { observations, problems } = parseObservationFile(JSON.parse(fs.readFileSync(arg, "utf8")));
  if (problems.length) fail(`Nothing imported. The export has problems:\n  ${problems.join("\n  ")}`);
  const known = new Set(imported().map((x) => x.o.id));
  const fresh = observations.filter((o) => !known.has(o.id));
  const byFile = new Map();
  for (const o of fresh) {
    const file = `${observedOn(o)}-${slug(o.verifier)}.json`;
    byFile.set(file, [...(byFile.get(file) ?? []), o]);
  }
  for (const [file, adding] of byFile) {
    const target = path.join(dir, file);
    const existing = fs.existsSync(target) ? JSON.parse(fs.readFileSync(target, "utf8")).observations : [];
    const merged = [...existing, ...adding].sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt) || (a.id < b.id ? -1 : 1));
    fs.writeFileSync(target, `${JSON.stringify({ schema: OBSERVATION_FILE_SCHEMA, exportedAt: new Date().toISOString(), observations: merged }, null, 2)}\n`);
    console.log(`${path.relative(process.cwd(), target)}: ${adding.length} added`);
  }
  console.log(`${fresh.length} new, ${observations.length - fresh.length} already imported. Nothing routes on these until a promotion does; run "review TARGET_ID" to see what they support.`);
} else if (command === "list") {
  const groups = new Map();
  for (const { o } of imported()) groups.set(o.target.id, [...(groups.get(o.target.id) ?? []), o]);
  if (!groups.size) console.log("No observations imported yet.");
  for (const [id, obs] of [...groups].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const latest = obs.map(observedOn).sort().at(-1);
    const promoted = FIELD_PROMOTIONS.filter((p) => p.observationIds.some((x) => obs.some((o) => o.id === x))).map((p) => p.id);
    console.log(`${obs[0].target.name} (${id}): ${obs.length} observation${obs.length === 1 ? "" : "s"}, latest ${latest}${promoted.length ? `, promoted in ${promoted.join(", ")}` : ", not promoted"}`);
  }
} else if (command === "review") {
  if (!arg) fail("Usage: node scripts/campus-field.mjs review TARGET_ID");
  const obs = imported().map((x) => x.o).filter((o) => o.target.id === arg).sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt));
  if (!obs.length) fail(`No imported observation is about ${arg}. "list" shows what there is.`);
  const target = obs[obs.length - 1].target;
  const knowledge = compileKnowledge(normalizeResearch(raw), CAMPUS_OVERLAY, FIELD_PROMOTIONS);

  console.log(`# ${target.name} (${target.id}, ${target.kind.toLowerCase()})\n`);
  console.log(`When observed, UW Go showed it as ${target.shown.evidence.toLowerCase()}, ${target.shown.activation.toLowerCase()} (knowledge reviewed ${target.shown.knowledgeReviewedAt}).`);
  for (const id of target.edgeIds) {
    const fact = knowledge.edgeFacts.get(id);
    console.log(`Now, segment ${id}: ${fact ? `"${fact.label}", ${fact.evidence.toLowerCase()}, ${fact.activation.toLowerCase()}${fact.passage ? `, passage ${JSON.stringify(fact.passage)}` : ""}${fact.access ? `, access ${JSON.stringify(fact.access)}` : ""}` : "no reviewed fact (the survey alone)"}`);
  }
  if (target.building && ["RULE", "HOURS"].includes(target.kind)) console.log(`Now, building ${target.building}: ${JSON.stringify(knowledge.buildingFacts.get(target.building) ?? "no reviewed fact")}`);

  console.log("\n## Observations\n");
  for (const o of obs) {
    console.log(`- ${o.id}, ${o.observedAt} by ${o.verifier}: ${marks(o)}`);
    if (o.note) console.log(`  Note: ${o.note}`);
    if (o.correctedLocation) console.log(`  Location: ${o.correctedLocation.lat}, ${o.correctedLocation.lng} (${o.correctedLocation.source}${o.correctedLocation.accuracyMetres ? `, ±${Math.round(o.correctedLocation.accuracyMetres)} m` : ""})`);
    if (o.photoRef) console.log(`  Photo: ${o.photoRef}`);
    for (const c of markConflicts(o.marks)) console.log(`  Contradicts itself: ${c}`);
  }

  const { claims, contradictions } = suggestClaims(target, obs);
  console.log("\n## What they support\n");
  console.log(describeClaims(claims).map((c) => `- ${c}`).join("\n") || "- nothing a promotion can claim");
  if (contradictions.length) console.log(`\nThey disagree, so none of this is drafted:\n${contradictions.map((c) => `- ${c}`).join("\n")}`);
  if (target.kind === "HOURS") console.log("\nHours are never drafted: read the notes above and write the posted hours as `claims.hours` yourself.");

  const promoted = FIELD_PROMOTIONS.filter((p) => p.observationIds.some((id) => obs.some((o) => o.id === id)));
  if (promoted.length) console.log(`\nAlready promoted in: ${promoted.map((p) => p.id).join(", ")}`);

  const byId = new Map(NET.edges.map((e) => [edgeId(NET, e), e]));
  const refs = target.edgeIds.map((id) => byId.get(id)).filter(Boolean).map((e) => {
    const between = [NET.nodes[e.a].building, NET.nodes[e.b].building];
    // In the target's own entry order, so the reviewed fact keeps "entry" meaning what the visits meant by it.
    const { entry } = target;
    const ordered = entry && entry.from !== entry.to && between.includes(entry.from) && between.includes(entry.to) ? [entry.from, entry.to] : between;
    return { edgeId: edgeId(NET, e), kind: e.kind, between: ordered };
  });
  const subject = refs.length ? { edges: refs } : target.building && ["RULE", "HOURS"].includes(target.kind) ? { building: target.building } : undefined;
  if (!subject) {
    console.log("\nThis target has no surveyed segment for a promotion to attach to. Record what was found in overlay.ts instead (an edge fact once the survey has the door, or an update to the conflict or field check), and cite the observations in its basis.");
    process.exit(0);
  }
  const draft = {
    id: `FP_${target.id.replace(/[^A-Za-z0-9]+/g, "_").toUpperCase()}_${observedOn(obs[obs.length - 1]).replace(/-/g, "")}`,
    observationIds: obs.map((o) => o.id),
    subject,
    ...(refs.length && !target.edgeIds.some((id) => knowledge.edgeFacts.has(id)) ? { label: target.name } : {}),
    claims,
    observedOn: obs.map(observedOn).sort().at(-1),
    verifiedBy: [...new Set(obs.map((o) => o.verifier))].sort(),
    reviewedAt: today(),
    reviewedBy: "TODO",
    basis: "TODO: what was seen, when, and in which direction.",
  };
  console.log("\n## Draft promotion (check every claim before using it)\n");
  console.log(JSON.stringify(draft, null, 2));
  const problems = promotionProblems(draft, new Map(obs.map((o) => [o.id, o])));
  console.log(problems.length ? `\nThe draft does not stand as it is:\n${problems.map((p) => `- ${p}`).join("\n")}` : "\nEvery claim in the draft is supported by the observations it names.");
  console.log(`\nBefore adding it to src/data/campus/field/promotions.ts:
1. UWGO_ROUTES_OUT=before.json npm run campus:regression   (every route as it is now)
2. add the entry, filling in reviewedBy and basis
3. npx vitest run src/data/campus                            (checks it against the observations)
4. UWGO_ROUTES_BEFORE=before.json npm run campus:regression (every route it changed)
5. npm run campus:field && node scripts/audit-campus-routing.mjs`);
} else {
  fail("Usage: node scripts/campus-field.mjs import EXPORT.json | list | review TARGET_ID");
}
