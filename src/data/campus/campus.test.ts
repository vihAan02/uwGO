import { describe, expect, it } from "vitest";
import raw from "./research/uwgo-routing-research-2026-09-14.json";
import { normalizeResearch, type RawResearch } from "./normalize";
import { CAMPUS_KNOWLEDGE, CAMPUS_RESEARCH, claimsUsable, compileKnowledge, validateKnowledge, type SurveyedEdge } from ".";
import { UW_INDOOR_NETWORK as NET } from "@/data/indoor/uw-indoor-network.generated";
import { edgeId } from "@/data/indoor/edgeId";
import { findBuilding } from "@/data/buildings";

/**
 * The research is read without adding to it, and every reviewed decision points at something that
 * exists. These are the guarantees the routing engine relies on.
 */

const surveyed = (): Map<string, SurveyedEdge> =>
  new Map(NET.edges.map((e) => [edgeId(NET, e), { kind: e.kind, between: [NET.nodes[e.a].building, NET.nodes[e.b].building] as const }]));

describe("reading the research package", () => {
  it("imports every record with nothing left unmapped", () => {
    const r = CAMPUS_RESEARCH;
    expect(r.issues).toEqual([]);
    expect({ buildings: r.buildings.length, portals: r.portals.length, connections: r.connections.length, candidates: r.routeCandidates.length, rules: r.rules.length, sources: r.sources.length })
      .toEqual({ buildings: 49, portals: 122, connections: 25, candidates: 13, rules: 12, sources: 84 });
    expect(r.status).toBe("research_seed_not_navigation_ready");
  });

  it("keeps unknowns unknown: no access flag becomes false because it was missing", () => {
    const accessible = CAMPUS_RESEARCH.portals.map((p) => p.access.accessibleDesignation);
    expect(accessible.filter((v) => v === true)).toHaveLength(20);
    expect(accessible.filter((v) => v === null)).toHaveLength(102);
    expect(accessible.filter((v) => v === false)).toHaveLength(0);
    expect(CAMPUS_RESEARCH.portals.every((p) => p.access.stepFree === null && p.access.independent === null)).toBe(true);
    // The one explicit "not step-free" in the whole package survives as false.
    expect(CAMPUS_RESEARCH.connections.filter((c) => c.stepFree === false).map((c) => c.id)).toEqual(["C19"]);
  });

  it("never activates a research record on its own: routing is disabled on every one", () => {
    expect(CAMPUS_RESEARCH.portals.some((p) => p.activation === "ACTIVE")).toBe(false);
    expect(CAMPUS_RESEARCH.connections.some((c) => c.activation === "ACTIVE")).toBe(false);
    expect(CAMPUS_RESEARCH.routeCandidates.some((c) => c.activation === "ACTIVE")).toBe(false);
  });

  it("reports rather than drops a record that gains geometry or routing in a later edition", () => {
    const edited = structuredClone(raw) as unknown as RawResearch;
    edited.portals[0].geometry = { type: "Point", coordinates: [-80.54, 43.47] };
    edited.connections[0].routing_enabled = true;
    edited.portals[1].entry_permission = "sometimes";
    const issues = normalizeResearch(edited).issues;
    expect(issues.some((i) => i.includes("AL-P01") && i.includes("geometry"))).toBe(true);
    expect(issues.some((i) => i.includes("C01") && i.includes("routing_enabled"))).toBe(true);
    expect(issues.some((i) => i.includes("B1-P01") && i.includes("sometimes"))).toBe(true);
  });

  it("keeps the research's directions: PAC's corner doors are exit-only, officially", () => {
    const p = CAMPUS_KNOWLEDGE.portals.get("PAC-P03")!;
    expect({ entry: p.entry, exit: p.exit, evidence: p.evidence, confidence: p.confidence }).toEqual({ entry: "PROHIBITED", exit: "ALLOWED", evidence: "OFFICIAL", confidence: "high" });
    expect(p.raw).toEqual({ entryPermission: "prohibited_normal_entry", exitPermission: "exit_only_reported" });
    expect(CAMPUS_KNOWLEDGE.portals.get("REV-P02")!.entry).toBe("CREDENTIAL");
    // A described entrance is not evidence that it can be used outwards.
    expect(CAMPUS_KNOWLEDGE.portals.get("SLC-P03")!.exit).toBe("UNKNOWN");
  });

  it("separates the kinds of evidence instead of flattening them", () => {
    const official = CAMPUS_RESEARCH.sources.filter((s) => s.evidence === "OFFICIAL").length;
    expect(official).toBe(73);
    expect(CAMPUS_RESEARCH.sources.filter((s) => s.evidence === "ANECDOTAL").map((s) => s.sourceType).sort())
      .toEqual(["community_anecdote", "community_anecdote", "community_anecdote", "community_anecdote", "community_anecdote", "community_anecdote", "community_anecdote", "historical_blog", "student_journalism", "student_journalism", "student_journalism"]);
    const candidate = (id: string) => CAMPUS_KNOWLEDGE.research.routeCandidates.find((c) => c.id === id)!;
    expect(candidate("R01").evidence).toBe("OFFICIAL");
    expect(candidate("R02").evidence).toBe("ANECDOTAL");
    expect(candidate("R12").evidence).toBe("INFERRED");
    // Low-rated official descriptions (stale or undated) are unresolved, and never routed on.
    expect(CAMPUS_KNOWLEDGE.portals.get("B1-P03")!).toMatchObject({ evidence: "UNRESOLVED", activation: "QUARANTINED" });
  });

  it("maps each connection's status onto activation", () => {
    const status = (id: string) => CAMPUS_KNOWLEDGE.connections.get(id)!.activation;
    expect(status("C23")).toBe("HISTORICAL");
    expect(status("C24")).toBe("HISTORICAL");
    expect(status("C14")).toBe("QUARANTINED");
    expect(status("C20")).toBe("QUARANTINED");
    expect(status("C15")).toBe("EXPERIMENTAL");
    expect(CAMPUS_KNOWLEDGE.connections.get("C20")!.evidence).toBe("UNRESOLVED");
  });
});

describe("UW Go's reviewed decisions", () => {
  it("all point at segments, research records and sources that exist", () => {
    expect(validateKnowledge(CAMPUS_KNOWLEDGE, surveyed())).toEqual([]);
  });

  it("catch a fact that no longer matches the network, instead of re-pointing it", () => {
    const moved = compileKnowledge(CAMPUS_RESEARCH, {
      ...CAMPUS_KNOWLEDGE.overlay,
      edges: [{ ...CAMPUS_KNOWLEDGE.overlay.edges[0], ref: { edgeId: "c34ea719b8b9dee5", kind: "BRIDGE", between: ["MC", "SLC"] } }],
    });
    const problems = validateKnowledge(moved, surveyed());
    expect(problems.some((p) => p.includes("surveyed as OPEN"))).toBe(true);
    expect(problems.some((p) => p.includes("surveyed between"))).toBe(true);
  });

  it("refuse an exterior rule stronger than the research, and a demolished bridge coming back", () => {
    const pac = CAMPUS_KNOWLEDGE.overlay.buildings.find((b) => b.code === "PAC")!;
    const overreach = compileKnowledge(CAMPUS_RESEARCH, {
      ...CAMPUS_KNOWLEDGE.overlay,
      buildings: [{ ...pac, code: "SLC", exterior: { ...pac.exterior!, portalIds: ["SLC-P03"] } }],
    });
    expect(validateKnowledge(overreach, surveyed()).some((p) => p.includes("does not prohibit entry"))).toBe(true);

    const withOldBridge = new Map(surveyed());
    withOldBridge.set("0000000000000000", { kind: "BRIDGE", between: ["DC", "MC"] });
    expect(validateKnowledge(CAMPUS_KNOWLEDGE, withOldBridge).some((p) => p.includes("MC–DC") && p.includes("never be routed"))).toBe(true);
  });

  it("quarantine what the research says not to route on, and nothing it merely describes", () => {
    const fact = (id: string) => CAMPUS_KNOWLEDGE.edgeFacts.get(id)!;
    expect(fact("da37b9775d7d3903")).toMatchObject({ activation: "QUARANTINED", research: { connection: "C14" } });
    expect(fact("88c0db7685cb4592")).toMatchObject({ activation: "QUARANTINED", research: { connection: "C20" } });
    const quarantined = CAMPUS_KNOWLEDGE.overlay.edges.filter((f) => f.activation !== "ACTIVE").map((f) => f.research?.connection);
    expect(quarantined.sort()).toEqual(["C14", "C20"]);
  });

  it("use a claim only as far as its evidence goes", () => {
    expect(claimsUsable("OFFICIAL", false)).toBe(true);
    expect(claimsUsable("CORROBORATED", false)).toBe(true);
    expect(claimsUsable("SURVEYED", false)).toBe(false);
    expect(claimsUsable("INFERRED", false)).toBe(false);
    expect(claimsUsable("INFERRED", true)).toBe(true);
    expect(claimsUsable("ANECDOTAL", true)).toBe(true);
    expect(claimsUsable("UNRESOLVED", true)).toBe(false);
  });

  it("put every placement and every conflict on the record for someone to check", () => {
    const o = CAMPUS_KNOWLEDGE.overlay;
    expect(o.conflicts.length).toBeGreaterThanOrEqual(10);
    expect(o.fieldChecks.filter((f) => f.priority === 1).length).toBeGreaterThanOrEqual(5);
    expect(o.fieldChecks.some((f) => f.research?.portals?.includes("PAC-P03"))).toBe(true);
  });
});

describe("building identity", () => {
  it("never resolves PAS to PAC because of the catalogue's URL, and keeps the E7 alias", () => {
    expect(findBuilding("UW", "PAS")!.code).toBe("PAS");
    expect(findBuilding("UW", "PAC")!.code).toBe("PAC");
    expect(CAMPUS_KNOWLEDGE.research.buildings.find((b) => b.id === "PAS")!.name).toBe("Psychology, Anthropology, Sociology");
    expect(findBuilding("UW", "E7")!.code).toBe("PSE");
    expect(CAMPUS_KNOWLEDGE.research.buildings.find((b) => b.id === "PSE")!.aliases).toContain("E7");
  });

  it("names every research building UW Go's registry knows, except the St. Jerome's complex code", () => {
    const missing = CAMPUS_RESEARCH.buildings.map((b) => b.id).filter((id) => !findBuilding("UW", id));
    expect(missing).toEqual(["SJU"]);
    // The registry spells it STJ, which the research lists as SJU's alias.
    expect(CAMPUS_RESEARCH.buildings.find((b) => b.id === "SJU")!.aliases).toContain("STJ");
    expect(findBuilding("UW", "STJ")).toBeDefined();
  });
});
