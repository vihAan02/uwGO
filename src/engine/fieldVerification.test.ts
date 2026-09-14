import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CAMPUS_KNOWLEDGE } from "@/data/campus";
import { observationProblems } from "@/data/campus/field/rules";
import generated from "@/data/campus/field/priorities.generated.json";
import { isVertical } from "@/data/indoor/network";
import { buildFieldTargets, targetRef } from "./fieldTargets";
import { TIERS, fieldFingerprint, priorityReasons, type FieldPriorities } from "./fieldPriority";
import { renderFieldVerificationDoc } from "./fieldVerificationDoc";
import { OUTSIDE, campusGraph, graphOver } from "./indoorGraph";

/**
 * What there is to check on campus, how it is ranked, and the document to walk it by. The ranking itself is
 * generated (`npm run campus:field`) because it routes thousands of trips; these hold it current and hold
 * the targets to what the page and the observations rely on.
 */

const priorities = generated as unknown as FieldPriorities;
const targets = buildFieldTargets();
const byId = new Map(targets.map((t) => [t.id, t]));

describe("what there is to check", () => {
  it("names every target once and gives each something to check", () => {
    expect(new Set(targets.map((t) => t.id)).size).toBe(targets.length);
    for (const t of targets) expect(t.toCheck.length, t.id).toBeGreaterThan(0);
  });

  it("covers every door to outside, every link between buildings and every change of floor the survey has", () => {
    const g = campusGraph();
    expect(targets.filter((t) => t.kind === "DOOR")).toHaveLength(g.exteriorDoors.length);
    const vertical = g.net.edges.flatMap((e, i) => (isVertical(e.kind) && e.floors !== 0 ? [g.ids[i]] : []));
    expect(targets.filter((t) => t.kind === "VERTICAL").flatMap((t) => t.edgeIds).sort()).toEqual(vertical.sort());
    const links = g.net.edges.filter((e) => {
      const a = g.net.nodes[e.a].building;
      const b = g.net.nodes[e.b].building;
      return a !== b && a !== OUTSIDE && b !== OUTSIDE && !(isVertical(e.kind) && e.floors !== 0);
    });
    expect(targets.filter((t) => t.kind === "LINK")).toHaveLength(links.length);
  });

  it("attaches every reviewer's field check to something to walk", () => {
    const attached = new Set(targets.flatMap((t) => t.checks.map((c) => c.id)));
    for (const c of CAMPUS_KNOWLEDGE.overlay.fieldChecks) expect(attached.has(c.id), c.id).toBe(true);
  });

  it("says how far each position can be trusted: surveyed where the survey drew it, only the building's point otherwise", () => {
    for (const t of targets) {
      if (t.kind === "DOOR" || t.kind === "LINK" || t.kind === "VERTICAL") expect(t.location?.precision, t.id).toBe("SURVEYED");
      else if (t.location) expect(t.location.precision, t.id).toBe("BUILDING");
    }
    expect(byId.get("rule:PAC:exterior")!.location!.note).toMatch(/no surveyed position/);
    expect(byId.get("portal:SLC-P01")!.location!.note).toMatch(/not the door/);
  });

  it("keeps the research's community and inferred route leads as leads, none of them routed", () => {
    expect(byId.has("lead:R01")).toBe(false);
    for (const c of CAMPUS_KNOWLEDGE.research.routeCandidates.filter((x) => x.routeType !== "official_approach")) {
      const lead = byId.get(`lead:${c.id}`);
      expect(lead, c.id).toBeDefined();
      expect(lead!.shown.activation, c.id).not.toBe("ACTIVE");
    }
  });

  it("keeps enough of a target with each observation for the observation to stand on its own", () => {
    const door = byId.get("door:5ba0e3d2964bf706")!;
    expect(door.entry).toEqual({ from: "OUT", to: "SLC", label: "Into SLC" });
    expect(door.checks.map((c) => c.id)).toContain("FC_SLC_EAST_DOORS");
    expect(observationProblems({ id: "fo-20260920T181500Z-a1b2", target: targetRef(door), observedAt: "2026-09-20T14:15:00-04:00", verifier: "DM", marks: ["BOTH_WAYS"] })).toEqual([]);
  });
});

describe("the ranking", () => {
  it("is current: run `npm run campus:field` after changing the network, the knowledge, the targets or the ranking", () => {
    expect(priorities.fingerprint).toBe(fieldFingerprint(targets));
    expect(Object.keys(priorities.targets).sort()).toEqual(targets.map((t) => t.id).sort());
  });

  it("puts PAC's exit-only rule and its only allowed way in at P0 until someone has checked them", () => {
    for (const id of ["rule:PAC:exterior", "link:c34ea719b8b9dee5"]) {
      if (byId.get(id)!.shown.evidence !== "FIELD_VERIFIED") expect(priorities.targets[id].tier, id).toBe("P0");
    }
  });

  it("never ranks below P1 anything unverified that UW Go sends students through instead of Google's walk", () => {
    for (const t of targets) {
      const p = priorities.targets[t.id];
      if ((p.metrics.campus?.usedBy ?? 0) > 0 && t.shown.evidence !== "FIELD_VERIFIED") expect(["P0", "P1"], t.id).toContain(p.tier);
    }
  });

  it("explains every rank in sentences, and uses every tier", () => {
    for (const t of targets) expect(priorityReasons(t, priorities.targets[t.id]).length, t.id).toBeGreaterThan(0);
    for (const tier of TIERS) expect(Object.values(priorities.targets).some((p) => p.tier === tier), tier).toBe(true);
  });

  it("never gives a figure of nothing as a reason", () => {
    for (const t of targets) {
      for (const r of priorityReasons(t, priorities.targets[t.id])) expect(r, t.id).not.toMatch(/(^|[\s(])0 (s\b|trips\b|step-free trips\b)/);
    }
  });

  it("is fingerprinted on the network's lengths and entry points, not only on its ids", () => {
    const g = campusGraph();
    const longer = graphOver({ ...g.net, edges: g.net.edges.map((e, i) => (i === 0 ? { ...e, metres: e.metres + 1 } : e)) }, CAMPUS_KNOWLEDGE);
    const fewerAnchors = graphOver({ ...g.net, anchors: g.net.anchors.slice(1) }, CAMPUS_KNOWLEDGE);
    expect(fieldFingerprint(targets, longer)).not.toBe(fieldFingerprint(targets, g));
    expect(fieldFingerprint(targets, fewerAnchors)).not.toBe(fieldFingerprint(targets, g));
  });

  it("credits PAC's rule with the walks it corrects into PAC, and counts a link's traffic at both its buildings", () => {
    expect(priorities.targets["rule:PAC:exterior"].metrics).toMatchObject({ correctedDirections: ["into"] });
    expect(priorities.targets["rule:PAC:exterior"].metrics.correctedShare).toBeGreaterThan(0);
    expect(priorities.targets["link:c34ea719b8b9dee5"].metrics.buildingShare!).toBeGreaterThan(priorities.targets["door:5ba0e3d2964bf706"].metrics.buildingShare!);
  });
});

describe("docs/campus-field-verification.md", () => {
  it("matches the targets and the ranking; `npm run campus:field` regenerates it", () => {
    const written = readFileSync(path.resolve(process.cwd(), "docs/campus-field-verification.md"), "utf8");
    expect(written).toBe(renderFieldVerificationDoc(targets, priorities));
  });
});
