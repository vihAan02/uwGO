import type { CampusLocation, StudySpot, University } from "@/domain/types";
import { buildingLocation, findBuilding } from "@/data/buildings";

/**
 * Places a student can go and work during a gap.
 *
 * A curated allowlist, deliberately. The generated building snapshot has four rows whose names
 * would pass a "library" or "study space" text search and which must never be offered:
 *
 *   TUL  Tri-University Library ............ 43.5356, -80.3225 — Guelph, ~25 km away
 *   ARC  School of Architecture ............ 43.3586, -80.3169 — Cambridge, ~15 km away
 *                                            (Musagetes Architecture Library is inside it)
 *   AAR  Architecture Annex Rome ........... 41.8896,  12.4709 — Rome, Italy
 *   SJ1  St Jerome's Classrooms and Library — a classroom block, not a student library
 *
 * ...and the search would still miss the Davis Centre Library, because DC is called "William G.
 * Davis Computer Research Centre". Curate; do not match on names.
 *
 * Adding a spot is one entry here plus one hours table in ./hours.ts.
 */
export const STUDY_SPOTS: readonly StudySpot[] = [
  { id: "UW:DC", university: "UW", buildingCode: "DC", name: "Davis Centre Library", shortName: "Davis Centre", floorNote: "Lower level of DC" },
  { id: "UW:LIB", university: "UW", buildingCode: "LIB", name: "Dana Porter Library", shortName: "Dana Porter" },
];

export function studySpotsFor(university: University): readonly StudySpot[] {
  return STUDY_SPOTS.filter((s) => s.university === university);
}

export interface ResolvedStudySpot {
  spot: StudySpot;
  at: CampusLocation;
}

/**
 * The spots that can actually be routed to. A spot whose building is missing or has no
 * coordinates is dropped rather than approximated — the same refusal `normalizeWeek` makes
 * about a class it cannot place.
 */
export function resolveStudySpots(university: University = "UW"): ResolvedStudySpot[] {
  const out: ResolvedStudySpot[] = [];
  for (const spot of studySpotsFor(university)) {
    const b = findBuilding(spot.university, spot.buildingCode);
    const at = b && buildingLocation(b);
    if (at) out.push({ spot, at });
  }
  return out;
}
