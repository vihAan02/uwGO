import { describe, it, expect } from "vitest";
import { findBuilding, findBuildingAnywhere, residencePresets, allBuildings, hasCoordinates } from "./index";

describe("building registry", () => {
  it("resolves core UW codes with official names and coordinates", () => {
    const mc = findBuilding("UW", "MC")!;
    expect(mc.name).toBe("Mathematics & Computer Building");
    expect(mc.latitude).toBeCloseTo(43.47208, 4);
    expect(mc.longitude).toBeCloseTo(-80.54395, 4);
    expect(mc.coordinatesSource).toBe("UW_ARCGIS");
    for (const code of ["DC", "RCH", "E5", "STC", "PAC", "SLC", "HH", "AL", "EV1", "EV2", "EV3", "QNC", "SCH", "PHY", "B1", "B2", "CPH", "PAS", "DWE", "E2", "E3", "M3", "TC"]) {
      const b = findBuilding("UW", code);
      expect(b, code).toBeDefined();
      expect(hasCoordinates(b!), code).toBe(true);
    }
  });

  it("resolves aliases: E7 -> PSE, STP -> UTD, DP -> LIB, case-insensitive", () => {
    expect(findBuilding("UW", "E7")!.code).toBe("PSE");
    expect(findBuilding("UW", "e7")!.code).toBe("PSE");
    expect(findBuilding("UW", "STP")!.code).toBe("UTD");
    expect(findBuilding("UW", "DP")!.code).toBe("LIB");
  });

  it("knows UW residences and colleges as presets", () => {
    const codes = residencePresets("UW").map((b) => b.code);
    for (const c of ["UWP", "CMH", "REV", "V1", "MKV", "CLV", "CGR", "REN", "STJ", "UTD"]) expect(codes).toContain(c);
    expect(findBuilding("UW", "UWP")!.kind).toBe("RESIDENCE");
    expect(findBuilding("UW", "CGR")!.kind).toBe("MIXED");
    expect(findBuilding("UW", "MC")!.kind).toBe("ACADEMIC");
  });

  it("resolves WLU codes and keeps unverified coordinates out of routing", () => {
    const lh = findBuilding("WLU", "LH")!;
    expect(lh.name).toBe("Lazaridis Hall");
    expect(lh.coordinatesSource).toBe("OSM");
    expect(hasCoordinates(lh)).toBe(true);
    const music = findBuilding("WLU", "M")!;
    expect(music.coordinatesSource).toBe("UNVERIFIED");
    expect(hasCoordinates(music)).toBe(false);
    expect(findBuilding("WLU", "BAB")!.code).toBe("BA");
    expect(findBuilding("WLU", "SBE")).toBeUndefined(); // not a real Laurier code
    expect(residencePresets("WLU").map((b) => b.residenceLabel)).toContain("Bricker Residence");
  });

  it("findBuildingAnywhere prefers the hinted university", () => {
    // "LIB" exists on both campuses
    expect(findBuildingAnywhere("LIB", "WLU")!.university).toBe("WLU");
    expect(findBuildingAnywhere("LIB")!.university).toBe("UW");
    expect(findBuildingAnywhere("DAWB")!.university).toBe("WLU");
    expect(findBuildingAnywhere("ZZZ")).toBeUndefined();
  });

  it("has no duplicate ids", () => {
    const ids = allBuildings().map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
