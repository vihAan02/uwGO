import { describe, expect, it } from "vitest";
import { residenceHome } from "./HomePicker";
import { residencePresets } from "@/data/buildings";

/**
 * The green confirmation line under the residence dropdown shows `home.name`, and the dropdown's
 * value is `home.preset.buildingCode`. Both are read from the one object `residenceHome` returns,
 * so selecting a residence can never leave the confirmation showing the previous one.
 */
describe("residence selection drives the confirmation label", () => {
  it("every UW residence maps to a home whose name and code are that residence's own", () => {
    for (const b of residencePresets("UW")) {
      if (b.latitude === undefined) continue; // presets without coordinates are disabled in the UI
      const home = residenceHome("UW", b.code)!;
      expect(home.name).toBe(b.residenceLabel);
      expect(home.preset).toEqual({ university: "UW", buildingCode: b.code });
    }
  });

  it("switching from one residence to another returns the NEW residence, never the old", () => {
    const clv = residenceHome("UW", "CLV")!;
    expect(clv.name).toBe("Columbia Lake Village (CLV)");
    expect(clv.preset?.buildingCode).toBe("CLV");

    // The user switches CLV -> CLN -> MKV; each step reflects the new selection immediately.
    const cln = residenceHome("UW", "CLN")!;
    expect(cln.name).toBe("Columbia Lake Village North (CLN)");
    expect(cln.name).not.toBe(clv.name);

    const mkv = residenceHome("UW", "MKV")!;
    expect(mkv.name).toBe("Mackenzie King Village (MKV)");
    expect(mkv.preset?.buildingCode).toBe("MKV");
    expect(mkv.latitude).not.toBe(clv.latitude);
  });

  it("an unknown code yields no home (the dropdown's blank option clears the confirmation)", () => {
    expect(residenceHome("UW", "")).toBeUndefined();
    expect(residenceHome("UW", "NOT_A_CODE")).toBeUndefined();
  });
});
