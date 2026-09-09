import { describe, it, expect } from "vitest";
import { parseRoom, splitRoomString } from "./roomParser";

describe("room parser", () => {
  it("MC 2065 -> Mathematics & Computer Building, room 2065, floor 2 (likely, not verified)", () => {
    const r = parseRoom("MC 2065", "UW");
    expect(r.resolved).toBe(true);
    expect(r.buildingName).toBe("Mathematics & Computer Building");
    expect(r.roomNumber).toBe("2065");
    expect(r.floor).toBe(2);
    expect(r.floorConfidence).toBe("likely");
    expect(r.university).toBe("UW");
  });

  it("PSE/E7 rooms get a verified floor; other UW buildings report unknown", () => {
    const e7 = parseRoom("E7 2317", "UW");
    expect(e7.buildingCode).toBe("PSE");
    expect(e7.floor).toBe(2);
    expect(e7.floorConfidence).toBe("verified");
    const dc = parseRoom("DC 1351", "UW");
    expect(dc.resolved).toBe(true);
    expect(dc.floor).toBe("unknown");
    expect(dc.floorConfidence).toBeUndefined();
  });

  it("normalizes internal whitespace and lettered suffixes", () => {
    expect(parseRoom("MC   4040", "UW").roomNumber).toBe("4040");
    expect(parseRoom("DWE 3522A", "UW").roomNumber).toBe("3522A");
    expect(splitRoomString("mc 2065")).toEqual({ buildingCode: "MC", roomNumber: "2065" });
  });

  it("handles WLU shapes: BA201, LH1001, DAWB 2-108, 1C16", () => {
    expect(parseRoom("BA201", "WLU")).toMatchObject({ buildingCode: "BA", roomNumber: "201", floor: 2, floorConfidence: "verified" });
    expect(parseRoom("LH1001", "WLU")).toMatchObject({ buildingCode: "LH", roomNumber: "1001", floor: 1 });
    expect(parseRoom("DAWB 2-108", "WLU")).toMatchObject({ buildingCode: "DAWB", roomNumber: "2-108", floor: 2 });
    expect(parseRoom("1C16", "WLU")).toMatchObject({ buildingCode: "C", roomNumber: "1C16", floor: 1 });
    expect(parseRoom("P 327", "WLU")).toMatchObject({ buildingCode: "P", floor: 3, resolved: true });
  });

  it("unknown building stays unresolved without inventing anything", () => {
    const r = parseRoom("ZZZ 123", "UW");
    expect(r.resolved).toBe(false);
    expect(r.buildingName).toBeUndefined();
    expect(r.floor).toBe("unknown");
    expect(parseRoom("", "UW").resolved).toBe(false);
  });
});
