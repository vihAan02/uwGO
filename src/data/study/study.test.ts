import { describe, expect, it } from "vitest";
import { STUDY_SPOTS, resolveStudySpots, studySpotsFor } from "./index";
import { studyHoursOn } from "./hours";

/** Roughly the middle of UW's main campus, from the ArcGIS snapshot. */
const CAMPUS = { lat: 43.4723, lng: -80.5449 };
const KM_PER_DEG_LAT = 111;

function kmFromCampus(lat: number, lng: number): number {
  const dLat = (lat - CAMPUS.lat) * KM_PER_DEG_LAT;
  const dLng = (lng - CAMPUS.lng) * KM_PER_DEG_LAT * Math.cos((CAMPUS.lat * Math.PI) / 180);
  return Math.hypot(dLat, dLng);
}

describe("the registry is a curated allowlist, not a name search", () => {
  it("is exactly the two UW libraries", () => {
    expect(STUDY_SPOTS.map((s) => s.id)).toEqual(["UW:DC", "UW:LIB"]);
  });

  it("never offers the buildings a name search would sweep in", () => {
    const codes = STUDY_SPOTS.map((s) => s.buildingCode);
    // Guelph, Cambridge, Rome, and a classroom block.
    for (const trap of ["TUL", "ARC", "AAR", "SJ1"]) expect(codes).not.toContain(trap);
  });

  it("every spot is on campus — the assertion that catches Guelph, Cambridge and Rome", () => {
    for (const { spot, at } of resolveStudySpots("UW")) {
      expect({ spot: spot.id, within2km: kmFromCampus(at.latitude, at.longitude) < 2 }).toEqual({ spot: spot.id, within2km: true });
    }
  });

  it("resolves coordinates from the building registry rather than carrying its own", () => {
    const resolved = resolveStudySpots("UW");
    expect(resolved).toHaveLength(2);
    for (const { at } of resolved) {
      expect(Number.isFinite(at.latitude) && Number.isFinite(at.longitude)).toBe(true);
    }
    // Nothing hand-typed a coordinate onto the spot itself.
    for (const spot of STUDY_SPOTS) expect(spot).not.toHaveProperty("latitude");
  });

  it("WLU has no curated spots yet, and says so rather than borrowing UW's", () => {
    expect(studySpotsFor("WLU")).toEqual([]);
    expect(resolveStudySpots("WLU")).toEqual([]);
  });
});

describe("hours are posted where they were read and assumed everywhere else", () => {
  it("a weekday in the week that was actually read is known", () => {
    const dc = studyHoursOn("UW:DC", "2026-09-10")!; // Thursday
    expect({ open: dc.open, close: dc.close, known: dc.known }).toEqual({ open: 8 * 60, close: 24 * 60, known: true });
    const dp = studyHoursOn("UW:LIB", "2026-09-10")!;
    expect({ open: dp.open, close: dp.close, known: dp.known }).toEqual({ open: 8 * 60, close: 21 * 60, known: true });
  });

  it("Davis Centre closes at midnight, expressed as 1440 rather than wrapped to 0", () => {
    expect(studyHoursOn("UW:DC", "2026-09-10")!.close).toBe(1440);
  });

  it("the weekend pattern differs from the weekday one", () => {
    const sat = studyHoursOn("UW:LIB", "2026-09-12")!;
    const sun = studyHoursOn("UW:LIB", "2026-09-06")!;
    expect({ satOpen: sat.open, sunOpen: sun.open, sunClose: sun.close }).toEqual({ satOpen: 11 * 60, sunOpen: 12 * 60, sunClose: 17 * 60 });
  });

  it("Labour Day is closed, for both libraries", () => {
    expect(studyHoursOn("UW:LIB", "2026-09-07")).toBeUndefined();
    expect(studyHoursOn("UW:DC", "2026-09-07")).toBeUndefined();
  });

  it("a date outside the week that was read is answered but flagged as assumed", () => {
    const later = studyHoursOn("UW:DC", "2026-10-15")!;
    expect({ known: later.known, label: later.label }).toEqual({ known: false, label: "Assumed regular hours" });
    expect(later.open).toBe(8 * 60);
  });

  it("a spot with no hours table returns undefined rather than a guess", () => {
    expect(studyHoursOn("UW:NOPE", "2026-09-10")).toBeUndefined();
  });

  it("every registered spot has hours", () => {
    for (const spot of STUDY_SPOTS) {
      expect({ id: spot.id, hasHours: studyHoursOn(spot.id, "2026-09-10") !== undefined }).toEqual({ id: spot.id, hasHours: true });
    }
  });
});
