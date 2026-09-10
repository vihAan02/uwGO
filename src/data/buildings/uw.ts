import type { CampusBuilding, FloorRule } from "@/domain/types";
import { UW_BUILDING_ROWS } from "./uw-buildings.generated";

/**
 * University of Waterloo buildings = generated ArcGIS snapshot + curated overlays
 * (kinds, residence labels, aliases, floor rules). Coordinates are building centroids.
 */

const RESIDENCES: Record<string, string> = {
  UWP: "UW Place (UWP)",
  CMH: "Claudette Millar Hall (CMH)",
  REV: "Ron Eydt Village (REV)",
  V1: "Village 1 (V1)",
  MKV: "Mackenzie King Village (MKV)",
  CLV: "Columbia Lake Village (CLV)",
  CLN: "Columbia Lake Village North (CLN)",
  MHR: "Minota Hagey Residence (MHR)",
};

/** Federated/affiliated colleges: both class locations and residences. */
const COLLEGES: Record<string, string> = {
  CGR: "Conrad Grebel University College (CGR)",
  REN: "Renison University College (REN)",
  STJ: "St. Jerome's University (STJ)",
  UTD: "United College (UTD, formerly St. Paul's)",
};

/** Codes that appear in Quest text but are not the current campus-map code. */
export const UW_ALIASES: Record<string, string> = {
  E7: "PSE", // renamed Pearl Sullivan Engineering Building (2026)
  STP: "UTD", // St. Paul's University College became United College
  DP: "LIB", // Dana Porter Library
  "DANA PORTER": "LIB",
};

/**
 * V1 rule for Waterloo classrooms: the first digit of the room number is the floor
 * (MC 2065 -> floor 2, DC 1350 -> floor 1, RCH 305 -> floor 3). Buildings below override
 * it; anything not listed there uses this rule and is flagged "likely", not "verified".
 */
const UW_DEFAULT_FLOOR_RULE: FloorRule = { kind: "FIRST_DIGIT", confidence: "likely", source: "UW GO v1 rule: first digit of the room number is the floor" };

const FLOOR_RULES: Record<string, FloorRule> = {
  // Verified from the public E7 space-booking floor-plan PDF (rooms 1327…7431 across floors 1-7).
  PSE: {
    kind: "FIRST_DIGIT",
    confidence: "verified",
    source: "uwaterloo.ca/engineering-7-event-space e7-space-booking-master.pdf",
  },
  // One public data point (MC 3001 described on the 3rd floor on the UW accessibility page). Not a floor plan.
  MC: {
    kind: "FIRST_DIGIT",
    confidence: "likely",
    source: "uwaterloo.ca/accessibility/getting-around/building-accessibility/mathematics-and-computer-mc",
  },
};

export const UW_BUILDINGS: readonly CampusBuilding[] = UW_BUILDING_ROWS.map((row) => {
  const code = row.code.toUpperCase();
  const isResidence = code in RESIDENCES;
  const isCollege = code in COLLEGES;
  const aliases = [...row.alternateNames];
  for (const [alias, target] of Object.entries(UW_ALIASES)) if (target === code) aliases.push(alias);
  return {
    id: `UW:${code}`,
    university: "UW",
    code,
    name: row.name,
    aliases,
    latitude: row.latitude,
    longitude: row.longitude,
    coordinatesSource: "UW_ARCGIS",
    address: "200 University Ave W, Waterloo, ON N2L 3G1",
    kind: isResidence ? "RESIDENCE" : isCollege ? "MIXED" : "ACADEMIC",
    parentCode: row.parentCode?.toUpperCase(),
    floorRule: FLOOR_RULES[code] ?? UW_DEFAULT_FLOOR_RULE,
    residenceLabel: RESIDENCES[code] ?? COLLEGES[code],
  };
});
