import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { it } from "vitest";
import type { RouteOption } from "@/domain/types";
import { DEFAULT_PLANNER_CONFIG } from "@/domain/config";
import { campusGraph } from "./indoorGraph";
import { REGRESSION_AT } from "./networkRegression";
import { BenchmarkWalks, campusMetrics, campusSnapshot, compareCampusSnapshots, renderCampusComparison, renderCampusHighlights, renderCampusMetrics, type CampusSnapshot } from "./campusBenchmark";

/**
 * The campus-aware walk benchmark, run by hand: `npm run campus:benchmark` with any of
 *
 *   UWGO_CAMPUS_OUT=file.json       save every pair's decision as it is now
 *   UWGO_CAMPUS_BEFORE=file.json    compare a saved file with the decisions as they are now
 *   UWGO_CAMPUS_WALKS=file.json     use real walks (a map of pairKey to RouteOption) instead of the stand-in
 *   UWGO_REPORT_OUT=file.md         also write the report there
 *
 * Nothing here is a test: it reads its inputs from the environment and prints what the engine does.
 */

const env = process.env;
const resolve = (p: string) => path.resolve(process.cwd(), p);

it("campus benchmark", async () => {
  const walks = env.UWGO_CAMPUS_WALKS ? new BenchmarkWalks(JSON.parse(readFileSync(resolve(env.UWGO_CAMPUS_WALKS), "utf8")) as Record<string, RouteOption>) : new BenchmarkWalks();
  const now = await campusSnapshot(campusGraph(), DEFAULT_PLANNER_CONFIG, REGRESSION_AT, walks);
  const report: string[] = [
    `# Campus-aware walk benchmark`,
    "",
    `${now.places.length} places, ${Object.keys(now.pairs).length} ordered pairs, decided in ${now.ms} ms with ${env.UWGO_CAMPUS_WALKS ? `walks from ${env.UWGO_CAMPUS_WALKS}${walks.missing.size ? ` (${walks.missing.size} pairs missing)` : ""}` : "the stand-in for Google's walk"}.`,
    "",
    ...renderCampusMetrics(campusMetrics(now), "Now"),
    "",
    ...renderCampusHighlights(now),
  ];
  if (env.UWGO_CAMPUS_BEFORE) {
    const before = JSON.parse(readFileSync(resolve(env.UWGO_CAMPUS_BEFORE), "utf8")) as CampusSnapshot;
    report.push("", ...renderCampusMetrics(campusMetrics(before), `Before (${env.UWGO_CAMPUS_BEFORE})`), "", "## Pair by pair", "", ...renderCampusComparison(compareCampusSnapshots(before, now)));
  }
  if (env.UWGO_CAMPUS_OUT) {
    writeFileSync(resolve(env.UWGO_CAMPUS_OUT), JSON.stringify(now));
    report.push("", `Saved to ${env.UWGO_CAMPUS_OUT}.`);
  }
  console.log(report.join("\n"));
  if (env.UWGO_REPORT_OUT) writeFileSync(resolve(env.UWGO_REPORT_OUT), report.join("\n"));
});
