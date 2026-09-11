/**
 * Indoor connections between University of Waterloo buildings as STATED on the university's
 * own Campus Accessibility building pages (uwaterloo.ca/accessibility/getting-around/
 * building-accessibility/<building>), read on 2026-09-09. Nothing here is inferred from a
 * map or from memory; if a page does not state a connection, the edge is not listed.
 *
 * Not used for routing. The winter route runs over the surveyed network in
 * uw-indoor-network.generated.ts, which has geometry; this list is the independent source
 * the audit (scripts/audit-indoor-network.mjs) cross-checks that network against, so a link
 * one source has and the other lacks is reported rather than silently trusted.
 *
 * Known omissions (no statement on the pages, so deliberately absent): E5-E6, MC-M3 direct,
 * DC-CIM (CIM is not a routable building), the BMH/LHI/EXP health cluster (no codes).
 */
export type ConnectionKind = "TUNNEL" | "BRIDGE" | "LINK";

export interface IndoorConnection {
  a: string;
  b: string;
  kind: ConnectionKind;
  /** Where the connection is, as the page describes it. */
  note: string;
  /** The accessibility page that states it (slug under building-accessibility/). */
  source: string;
  /** Extra minutes over a plain walk: stairs, doors, the odd ramp. */
  penaltyMinutes?: number;
}

const ACCESS = "uwaterloo.ca/accessibility/getting-around/building-accessibility/";

export const INDOOR_CONNECTIONS: readonly IndoorConnection[] = [
  // Math / science core
  { a: "MC", b: "QNC", kind: "BRIDGE", note: "Overpass from MC third floor to QNC second floor (automated)", source: ACCESS + "mathematics-and-computer-mc" },
  { a: "MC", b: "SLC", kind: "BRIDGE", note: "Overpass link from MC third floor to the SLC", source: ACCESS + "mathematics-and-computer-mc" },
  { a: "MC", b: "DC", kind: "BRIDGE", note: "Overpass on DC second floor to MC", source: ACCESS + "wg-davis-computer-research-centre-dc" },
  { a: "DC", b: "M3", kind: "BRIDGE", note: "Automated overpass on DC third floor to M3", source: ACCESS + "wg-davis-computer-research-centre-dc" },
  { a: "DC", b: "E3", kind: "BRIDGE", note: "Overpass on DC first floor, East end, to E3", source: ACCESS + "wg-davis-computer-research-centre-dc" },
  { a: "DC", b: "EIT", kind: "LINK", note: "Internal link by DC room 2836D (second floor)", source: ACCESS + "wg-davis-computer-research-centre-dc" },
  { a: "DC", b: "C2", kind: "BRIDGE", note: "Ramped overpass, DC second floor Southwest end to C2 third floor (steep)", source: ACCESS + "chemistry-2-c2", penaltyMinutes: 1 },
  { a: "QNC", b: "B2", kind: "BRIDGE", note: "Automated overpass from QNC second floor to B2 second floor", source: ACCESS + "quantum-nano-centre-qnc" },
  { a: "QNC", b: "SLC", kind: "BRIDGE", note: "Overpass to the SLC on the QNC first floor, North end", source: ACCESS + "quantum-nano-centre-qnc" },
  { a: "SLC", b: "PAC", kind: "BRIDGE", note: "Automatic above-ground link on the SLC second floor to PAC", source: ACCESS + "student-life-centre-slc" },
  { a: "B1", b: "B2", kind: "LINK", note: "Corridor on the West side of B1, floors 1-3", source: ACCESS + "biology-1-b1" },
  { a: "B1", b: "ESC", kind: "LINK", note: "Corridor on the Northeast side of B1, floors 2-3", source: ACCESS + "biology-1-b1" },
  { a: "STC", b: "B2", kind: "LINK", note: "Doors by the STC elevator to B2 on floors 1-3", source: ACCESS + "science-teaching-complex-stc" },
  { a: "STC", b: "NH", kind: "LINK", note: "Accessible pathway from the STC third floor, Southwest side, to Needles Hall", source: ACCESS + "science-teaching-complex-stc" },
  { a: "ESC", b: "C2", kind: "BRIDGE", note: "Second and third floor overpasses", source: ACCESS + "earth-sciences-chemistry-1-esc" },
  { a: "ESC", b: "EIT", kind: "LINK", note: "Corridor on the EIT West side to ESC second floor; third-floor link too", source: ACCESS + "centre-environmental-information-technology-eit" },
  { a: "EIT", b: "PHY", kind: "LINK", note: "Link between PHY and EIT on multiple floors", source: ACCESS + "physics-phy" },
  { a: "PHY", b: "E2", kind: "LINK", note: "Link to E2 at the East end of the PHY third floor", source: ACCESS + "physics-phy" },
  { a: "NH", b: "LIB", kind: "TUNNEL", note: "Tunnel from Needles Hall Southeast end to the Dana Porter (Arts) library", source: ACCESS + "needles-hall-nh" },

  // Engineering
  { a: "E2", b: "CPH", kind: "LINK", note: "Internal connection on floors 1-3, West side of CPH", source: ACCESS + "carl-pollock-hall-cph" },
  { a: "E2", b: "E3", kind: "LINK", note: "Internal connection on floor two", source: ACCESS + "engineering-2-e2" },
  { a: "E2", b: "RCH", kind: "LINK", note: "Lower-level internal connection; second floor by small elevator", source: ACCESS + "jr-coutts-engineering-lecture-hall-rch", penaltyMinutes: 1 },
  { a: "E2", b: "DWE", kind: "LINK", note: "Link to E2 on the DWE third floor", source: ACCESS + "douglas-wright-engineering-dwe" },
  { a: "DWE", b: "RCH", kind: "LINK", note: "Connected through room 1501", source: ACCESS + "jr-coutts-engineering-lecture-hall-rch" },
  { a: "E3", b: "E5", kind: "BRIDGE", note: "Overpass on the third floor (and fifth) between E3 and E5", source: ACCESS + "engineering-5-e5" },
  { a: "E6", b: "PSE", kind: "BRIDGE", note: "Access bridge from E6 to E7 (now PSE)", source: ACCESS + "engineering-6-e6" },

  // Arts / environment quad
  { a: "EV1", b: "EV2", kind: "LINK", note: "Internal connection, EV1 Southwest side / EV2 Northeast side", source: ACCESS + "environment-1-ev1" },
  { a: "EV2", b: "EV3", kind: "LINK", note: "Link from EV2 to EV3 by the automatic door facing ML", source: ACCESS + "environment-2-ev2" },
  { a: "EV1", b: "ML", kind: "TUNNEL", note: "Lower-level tunnel near EV1 room 109", source: ACCESS + "environment-1-ev1" },
  { a: "EV1", b: "AL", kind: "TUNNEL", note: "Lower-level tunnel near EV1 room 109", source: ACCESS + "environment-1-ev1" },
  { a: "EV1", b: "TC", kind: "TUNNEL", note: "Lower-level tunnel near EV1 room 109", source: ACCESS + "environment-1-ev1" },
  { a: "EV1", b: "HH", kind: "LINK", note: "Basement link on the HH West side to EV1", source: ACCESS + "hagey-hall-humanities-hh" },
  { a: "ML", b: "AL", kind: "TUNNEL", note: "Tunnel between ML, AL and TC", source: ACCESS + "modern-languages-ml" },
  { a: "ML", b: "TC", kind: "TUNNEL", note: "Tunnel between ML, AL and TC", source: ACCESS + "william-m-tatham-centre-tc" },
  { a: "ML", b: "HH", kind: "TUNNEL", note: "Tunnel, stairs involved (not step-free)", source: ACCESS + "modern-languages-ml", penaltyMinutes: 1 },
  { a: "ML", b: "SCH", kind: "TUNNEL", note: "Tunnel, stairs involved (not step-free)", source: ACCESS + "modern-languages-ml", penaltyMinutes: 1 },
  { a: "SCH", b: "AL", kind: "TUNNEL", note: "Tunnel from SCH Southwest side to AL", source: ACCESS + "south-campus-hall-sch" },
  { a: "PAS", b: "EV2", kind: "LINK", note: "Link at the North end of PAS to EV2", source: ACCESS + "psychology-anthropology-and-sociology-pas" },
];
