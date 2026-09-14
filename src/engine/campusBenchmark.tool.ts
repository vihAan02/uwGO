import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { it } from "vitest";
import type { CampusLocation } from "@/domain/types";
import { DEFAULT_PLANNER_CONFIG, type PlannerConfig } from "@/domain/config";
import { WALK_CACHE_TTL_MS } from "@/routing/CachedRoutingProvider";
import { GoogleRoutingProvider } from "@/routing/GoogleRoutingProvider";
import { haversineMeters } from "@/routing/EstimateRoutingProvider";
import { pairKey } from "@/routing/RoutingProvider";
import { campusGraph } from "./indoorGraph";
import { REGRESSION_AT } from "./networkRegression";
import { BenchmarkWalks, benchmarkPlaces, campusMetrics, campusSnapshot, compareCampusSnapshots, renderCampusComparison, renderCampusHighlights, renderCampusMetrics, type CampusSnapshot, type StoredWalk, type WalkFetch, type WalkSource } from "./campusBenchmark";

/**
 * The campus-aware walk benchmark, run by hand: `npm run campus:benchmark` with any of
 *
 *   UWGO_CAMPUS_OUT=file.json          save every pair's decision as it is now
 *   UWGO_CAMPUS_BEFORE=file.json       compare a saved file with the decisions as they are now
 *   UWGO_CAMPUS_WALKS=file.json        use real walks from this table (pairKey to stored walk) instead of the stand-in
 *   UWGO_CAMPUS_FETCH=1                fetch the walks the table lacks from Google, with GOOGLE_MAPS_SERVER_KEY from the
 *                                      environment or .env.local, and keep them in the table
 *   UWGO_CAMPUS_PREFETCH=1             with FETCH, first fetch every pair of places, one direction each, a few at a time
 *   UWGO_CAMPUS_REVERSE_SAMPLE=n       with FETCH, also fetch the other direction of n pairs spread over distance, to
 *                                      measure how far a walk served reversed can be from Google's own
 *   UWGO_CAMPUS_MARGIN=base,share,per  decide with this campusShortcutMargin instead of the default
 *   UWGO_CAMPUS_PLACES=MC,DC,PAC       only these places
 *   UWGO_REPORT_OUT=file.md            also write the report there
 *
 * Nothing here is a test: it reads its inputs from the environment and prints what the engine does. Walks
 * older than thirty days are dropped from the table, as the route cache drops them, and the key is never
 * printed.
 */

const env = process.env;
const resolve = (p: string) => path.resolve(process.cwd(), p);

/** A table of walks, less any kept longer than Google allows a route to be cached. */
function readTable(file: string): Record<string, StoredWalk> {
  if (!existsSync(file)) return {};
  const raw = JSON.parse(readFileSync(file, "utf8")) as { walks?: Record<string, StoredWalk> };
  const oldest = Date.now() - WALK_CACHE_TTL_MS;
  return Object.fromEntries(Object.entries(raw.walks ?? {}).filter(([, w]) => Date.parse(w.fetchedAt) > oldest));
}

function writeTable(file: string, walks: Record<string, StoredWalk>) {
  writeFileSync(`${file}.tmp`, JSON.stringify({ walks }));
  renameSync(`${file}.tmp`, file);
}

/**
 * The server's routing key: from the environment, or from .env.local, which Next does not load under
 * Vitest (it skips that file when NODE_ENV is test). Never printed.
 */
function routingKey(): string | undefined {
  if (process.env.GOOGLE_MAPS_SERVER_KEY) return process.env.GOOGLE_MAPS_SERVER_KEY;
  const file = resolve(".env.local");
  if (!existsSync(file)) return undefined;
  const line = readFileSync(file, "utf8").split(/\r?\n/).find((l) => l.startsWith("GOOGLE_MAPS_SERVER_KEY="));
  return line?.slice("GOOGLE_MAPS_SERVER_KEY=".length).trim().replace(/^(["'])(.*)\1$/, "$2") || undefined;
}

/** Google's walks, as the server asks for them, retried when Google is busy or the network drops. */
function googleWalks(): WalkFetch {
  const key = routingKey();
  if (!key) throw new Error("UWGO_CAMPUS_FETCH=1 needs GOOGLE_MAPS_SERVER_KEY, in the environment or .env.local");
  const google = new GoogleRoutingProvider(key);
  return async (from, to) => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await google.getWalkingRoute(from, to);
      } catch (err) {
        const status = Number(/Routes API (\d+)/.exec(err instanceof Error ? err.message : "")?.[1] ?? 0);
        const retry = status === 0 || status === 429 || status >= 500;
        if (attempt >= 4 || !retry) throw new Error(`Routes API ${status || "network"} failure`);
        await new Promise((done) => setTimeout(done, 1000 * 2 ** attempt));
      }
    }
  };
}

type Pair = readonly [CampusLocation, CampusLocation];

/** Every pair of places once, in the direction whose key sorts first. */
const unorderedPairs = (places: CampusLocation[]): Pair[] =>
  places.flatMap((a) => places.filter((b) => b.id !== a.id && pairKey(a, b) < pairKey(b, a)).map((b) => [a, b] as const));

async function inParallel<T>(items: readonly T[], size: number, work: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) await work(items[next++]);
  }));
}

/** `n` of `xs`, spread evenly through it. */
const spread = <T>(xs: readonly T[], n: number): T[] => (n >= xs.length ? [...xs] : Array.from({ length: n }, (_, i) => xs[Math.floor((i + 0.5) * (xs.length / n))]));

const percentile = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0;
};

it("campus benchmark", async () => {
  const g = campusGraph();
  const only = env.UWGO_CAMPUS_PLACES?.split(",").map((c) => c.trim());
  const places = benchmarkPlaces(g).filter((p) => !only || only.includes(p.buildingCode!));
  const tableFile = env.UWGO_CAMPUS_WALKS ? resolve(env.UWGO_CAMPUS_WALKS) : undefined;
  const fetching = env.UWGO_CAMPUS_FETCH === "1";
  if (fetching && !tableFile) throw new Error("UWGO_CAMPUS_FETCH=1 needs UWGO_CAMPUS_WALKS, to keep what it fetches");
  const table = tableFile ? readTable(tableFile) : undefined;
  const save = () => { if (tableFile && table && fetching) writeTable(tableFile, table); };
  let unsaved = 0;
  const exact = env.UWGO_CAMPUS_EXACT === "1";
  const walks = table
    ? new BenchmarkWalks(table, fetching ? googleWalks() : undefined, { serveReversed: !exact, onFetched: () => { if (++unsaved % 20 === 0) save(); } })
    : new BenchmarkWalks();
  const report: string[] = [`# Campus-aware walk benchmark`, ""];

  if (fetching && env.UWGO_CAMPUS_PREFETCH === "1") {
    const pairs = exact ? places.flatMap((a) => places.filter((b) => b.id !== a.id).map((b) => [a, b] as const)) : unorderedPairs(places);
    let refused = 0;
    let tried = 0;
    await inParallel(pairs, 6, async ([a, b]) => {
      if ((await walks.ensure(a, b, !exact)) === "MISSING") refused++;
      if (++tried === 12 && refused === 12) throw new Error("Google refused the first twelve walks; stopping");
    });
    save();
    report.push(`Prefetched ${pairs.length} ${exact ? "ordered pairs of places" : "pairs of places, one direction each"}: ${refused} could not be fetched.`, "");
  }

  if (fetching && env.UWGO_CAMPUS_ALL_DOORS === "1") {
    // Every door walk the engine could ask for (from a place to a door of another building), so a search
    // without pruning can be run against the table to judge what pruning gives up.
    const legs = places.flatMap((p) => g.exteriorDoors.filter((d) => d.building !== p.buildingCode).map((d) => [p, { latitude: g.net.nodes[d.inside].lat, longitude: g.net.nodes[d.inside].lng }] as const));
    const before = walks.fetched;
    let refused = 0;
    await inParallel(legs, 6, async ([p, door]) => { if ((await walks.ensure(p, door, false)) === "MISSING") refused++; });
    save();
    report.push(`Every door walk from every place: ${legs.length}; fetched ${walks.fetched - before}; could not be fetched ${refused}.`, "");
  }

  const sampleSize = Number(env.UWGO_CAMPUS_REVERSE_SAMPLE ?? 0);
  if (table && (exact || (fetching && sampleSize > 0))) {
    const byDistance = unorderedPairs(places).sort((x, y) => haversineMeters(x[0], x[1]) - haversineMeters(y[0], y[1]));
    const sample = exact ? byDistance : spread(byDistance, sampleSize);
    if (!exact) {
      await inParallel(sample, 6, async ([a, b]) => { await walks.ensure(b, a, false); });
      save();
    }
    const diffs = sample.flatMap(([a, b]) => {
      const there = table![pairKey(a, b)]?.route;
      const back = table![pairKey(b, a)]?.route;
      return there && back ? [{ pair: `${a.buildingCode}>${b.buildingCode}`, there: there.durationSeconds ?? 0, back: back.durationSeconds ?? 0 }] : [];
    });
    const abs = diffs.map((d) => Math.abs(d.there - d.back));
    report.push(
      `Both directions fetched for ${diffs.length} pairs spread over distance: the two differ by a median ${percentile(abs, 0.5)} s, 90th percentile ${percentile(abs, 0.9)} s, at most ${Math.max(0, ...abs)} s; ${abs.filter((x) => x > 10).length} by more than 10 s.`,
      `  Largest: ${[...diffs].sort((x, y) => Math.abs(y.there - y.back) - Math.abs(x.there - x.back)).slice(0, 5).map((d) => `${d.pair} ${d.there} s vs ${d.back} s back`).join("; ")}.`,
      "",
    );
  }

  const margin = env.UWGO_CAMPUS_MARGIN?.split(",").map(Number);
  const cfg: PlannerConfig = margin && margin.length >= 3
    ? { ...DEFAULT_PLANNER_CONFIG, campusShortcutMargin: { baseSeconds: margin[0], shareOfGoogle: margin[1], perBuildingSeconds: margin[2], buildingsCharged: margin[3] ?? DEFAULT_PLANNER_CONFIG.campusShortcutMargin.buildingsCharged } }
    : DEFAULT_PLANNER_CONFIG;
  const fetchedBefore = walks.fetched;
  const now = await campusSnapshot(g, cfg, REGRESSION_AT, walks, places, { exhaustive: env.UWGO_CAMPUS_EXHAUSTIVE === "1" });
  save();
  const sources: Partial<Record<WalkSource, number>> = {};
  for (const x of walks.log) sources[x.source] = (sources[x.source] ?? 0) + 1;
  report.push(
    `${now.places.length} places, ${Object.keys(now.pairs).length} ordered pairs, decided in ${now.ms} ms with ${tableFile ? `walks from ${env.UWGO_CAMPUS_WALKS}` : "the stand-in for Google's walk"}${margin ? `, margin ${margin.join(", ")}` : ""}.`,
    `Walks asked for: ${walks.asked} (${Object.entries(sources).map(([k, v]) => `${k.toLowerCase()} ${v}`).join(", ")}); fetched from Google while deciding: ${walks.fetched - fetchedBefore}; missing: ${walks.missing.size}.`,
    "",
    ...renderCampusMetrics(campusMetrics(now), "Now"),
    "",
    ...renderCampusHighlights(now),
  );
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
}, 60 * 60_000);
