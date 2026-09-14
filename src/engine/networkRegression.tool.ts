import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { it } from "vitest";
import type { IndoorNetwork } from "@/data/indoor/network";
import { UW_INDOOR_NETWORK } from "@/data/indoor/uw-indoor-network.generated";
import { edgeId, labelForEdgeId } from "@/data/indoor/edgeId";
import { diffNetworks, renderNetworkDiff } from "@/data/indoor/networkDiff";
import { CAMPUS_KNOWLEDGE } from "@/data/campus";
import { campusGraph, graphOver, type IndoorGraph } from "./indoorGraph";
import { arrivalsInto, compareSnapshots, renderRouteComparison, routeSnapshot, type RouteSnapshot } from "./networkRegression";

/**
 * Route regression, run by hand: `npm run campus:regression` with one or more of
 *
 *   UWGO_ROUTES_OUT=file.json          save every building-to-building route over the committed network
 *   UWGO_ROUTES_BEFORE=file.json       compare a saved file with the routes as they are now
 *   UWGO_NETWORK_CANDIDATE=file.ts     compare the committed network with a generated candidate
 *                                      (scripts/gen-indoor-network.mjs --out file.ts), segments and routes
 *   UWGO_REPORT_OUT=file.md            also write the report there
 *
 * Nothing here is a test: it reads its inputs from the environment and prints what differs.
 */

const env = process.env;
const resolve = (p: string) => path.resolve(process.cwd(), p);
const PAC_FROM = ["MC", "SLC", "DC", "QNC", "EIT", "E3", "AL"];

const nameOf = (g: IndoorGraph, id: string) => g.knowledge?.edgeFacts.get(id)?.label ?? labelForEdgeId(g.net, id);

function arrivals(g: IndoorGraph): string[] {
  return arrivalsInto(g, "PAC", PAC_FROM).map((a) => `  ${a.from} > PAC (${a.mode}): ${a.seconds === undefined ? "no route" : `${a.seconds} s, entering by ${a.lastCrossing ? `${nameOf(g, a.lastCrossing)} (${a.lastCrossing})` : "?"}`}`);
}

it("route regression", async () => {
  const report: string[] = [];
  const current = campusGraph();

  if (env.UWGO_ROUTES_OUT) {
    const snapshot = routeSnapshot(current);
    writeFileSync(resolve(env.UWGO_ROUTES_OUT), JSON.stringify(snapshot));
    report.push(`Saved ${Object.keys(snapshot).length} routes (${Object.values(snapshot).filter(Boolean).length} routable) to ${env.UWGO_ROUTES_OUT}.`, "", "Arrivals into PAC:", ...arrivals(current), "");
  }

  if (env.UWGO_ROUTES_BEFORE) {
    const before = JSON.parse(readFileSync(resolve(env.UWGO_ROUTES_BEFORE), "utf8")) as RouteSnapshot;
    report.push(`## Routes: ${env.UWGO_ROUTES_BEFORE} against now`, "", renderRouteComparison(compareSnapshots(before, routeSnapshot(current))), "", "Arrivals into PAC now:", ...arrivals(current), "");
  }

  if (env.UWGO_NETWORK_CANDIDATE) {
    const candidate = (await import(pathToFileURL(resolve(env.UWGO_NETWORK_CANDIDATE)).href)).UW_INDOOR_NETWORK as IndoorNetwork;
    const next = graphOver(candidate, CAMPUS_KNOWLEDGE);
    report.push(
      `## Network: committed against ${env.UWGO_NETWORK_CANDIDATE}`, "",
      renderNetworkDiff(diffNetworks(UW_INDOOR_NETWORK, candidate, edgeId)), "",
      "## Routes over each, with the same campus knowledge", "",
      renderRouteComparison(compareSnapshots(routeSnapshot(current), routeSnapshot(next))), "",
      "Arrivals into PAC, committed:", ...arrivals(current), "",
      "Arrivals into PAC, candidate:", ...arrivals(next), "",
    );
  }

  if (!report.length) report.push("Nothing to do: set UWGO_ROUTES_OUT, UWGO_ROUTES_BEFORE or UWGO_NETWORK_CANDIDATE (see the comment at the top of this file).");
  console.log(report.join("\n"));
  if (env.UWGO_REPORT_OUT) writeFileSync(resolve(env.UWGO_REPORT_OUT), report.join("\n"));
});
