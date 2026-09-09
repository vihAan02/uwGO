import { describe, it, expect } from "vitest";
import { createManualMeeting } from "./manual";

describe("manual meeting entry", () => {
  it("creates a WLU class", () => {
    const r = createManualMeeting({ university: "WLU", courseCode: "bu 111", component: "LEC", days: ["Th", "T"], start: "2:30PM", end: "3:50PM", buildingCode: "lh", roomNumber: "1001" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.meeting).toMatchObject({ university: "WLU", courseCode: "BU 111", days: ["T", "Th"], start: 14 * 60 + 30, end: 15 * 60 + 50, location: { kind: "ROOM", buildingCode: "LH", roomNumber: "1001" }, source: "MANUAL", includeInPlan: true });
    }
  });
  it("rejects bad input with specific messages", () => {
    const r = createManualMeeting({ university: "WLU", courseCode: "x", days: [], start: "25:00", end: "9:00", buildingCode: "SBE" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.join("\n")).toMatch(/Course code/);
      expect(r.errors.join("\n")).toMatch(/at least one day/);
      expect(r.errors.join("\n")).toMatch(/Start time/);
      expect(r.errors.join("\n")).toMatch(/Unknown WLU building code "SBE"/);
    }
  });
  it("refuses buildings without coordinates and end <= start", () => {
    const r = createManualMeeting({ university: "WLU", courseCode: "BU 111", days: ["M"], start: "10:00", end: "9:00", buildingCode: "M" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.join("\n")).toMatch(/no coordinates/);
      expect(r.errors.join("\n")).toMatch(/after start/);
    }
  });
  it("resolves UW aliases and excludes TST by default", () => {
    const r = createManualMeeting({ university: "UW", courseCode: "ECE 105", component: "TST", days: ["W"], start: "19:00", end: "20:50", buildingCode: "E7", roomNumber: "2317" });
    expect(r.ok && r.meeting.location.kind === "ROOM" && r.meeting.location.buildingCode).toBe("PSE");
    expect(r.ok && r.meeting.includeInPlan).toBe(false);
  });
});
