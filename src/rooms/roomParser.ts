import type { CampusBuilding, ParsedRoom, RawLocation, University } from "@/domain/types";
import { findBuilding, findBuildingAnywhere } from "@/data/buildings";

/** Split a room string into building code + room number without resolving it. */
export function splitRoomString(raw: string, hint?: University): { buildingCode: string; roomNumber?: string } | undefined {
  const s = raw.trim().replace(/\s+/g, " ");
  if (!s) return undefined;

  // WLU Arts wings: "1C16", "2C15", "1E1" (floor digit, wing letter, room)
  const wing = /^(\d)([ACE])(\d{1,3}[A-Z]?)$/i.exec(s);
  if (wing && hint === "WLU") return { buildingCode: wing[2].toUpperCase(), roomNumber: `${wing[1]}${wing[2].toUpperCase()}${wing[3]}` };

  // "MC 2065", "MC 4045A", "DAWB 2-108", "E7 2317", "STC 0010"
  const spaced = /^([A-Z][A-Z0-9]*)\s+(\d+(?:-\d+)?[A-Z]?)$/i.exec(s);
  if (spaced) return { buildingCode: spaced[1].toUpperCase(), roomNumber: spaced[2].toUpperCase() };

  // "BA201", "LH1001", "P327", "DAWB2-108" (letters immediately followed by digits; WLU style)
  const glued = /^([A-Z]{1,5})(\d+(?:-\d+)?[A-Z]?)$/i.exec(s);
  if (glued) return { buildingCode: glued[1].toUpperCase(), roomNumber: glued[2].toUpperCase() };

  // Building only
  const only = /^([A-Z][A-Z0-9]{0,5})$/i.exec(s);
  if (only) return { buildingCode: only[1].toUpperCase() };
  return undefined;
}

/** Floor from a building's rule. Never guesses beyond the rule. */
export function inferFloor(building: CampusBuilding | undefined, roomNumber: string | undefined): { floor: number | "unknown"; confidence?: "verified" | "likely" } {
  if (!building || !roomNumber) return { floor: "unknown" };
  const rule = building.floorRule;
  switch (rule.kind) {
    case "FIRST_DIGIT": {
      const m = /^(\d)\d*[A-Z]?$/.exec(roomNumber);
      if (!m) return { floor: "unknown" };
      return { floor: Number(m[1]), confidence: rule.confidence };
    }
    case "DASH_PREFIX": {
      const m = /^(\d+)-\d+[A-Z]?$/.exec(roomNumber);
      if (!m) return { floor: "unknown" };
      return { floor: Number(m[1]), confidence: rule.confidence };
    }
    case "LEADING_DIGIT_THEN_WING": {
      const m = /^(\d)[ACE]\d+[A-Z]?$/i.exec(roomNumber);
      if (!m) return { floor: "unknown" };
      return { floor: Number(m[1]), confidence: rule.confidence };
    }
    default:
      return { floor: "unknown" };
  }
}

export function parseRoom(raw: string, hint?: University): ParsedRoom {
  const parts = splitRoomString(raw, hint);
  if (!parts) return { raw, buildingCode: raw.trim().toUpperCase(), floor: "unknown", resolved: false };
  const building = hint ? findBuilding(hint, parts.buildingCode) ?? findBuildingAnywhere(parts.buildingCode, hint) : findBuildingAnywhere(parts.buildingCode);
  const { floor, confidence } = inferFloor(building, parts.roomNumber);
  return {
    raw,
    buildingCode: building?.code ?? parts.buildingCode,
    buildingName: building?.name,
    roomNumber: parts.roomNumber,
    floor,
    floorConfidence: floor === "unknown" ? undefined : confidence,
    university: building?.university ?? hint,
    resolved: Boolean(building),
  };
}

export function parseRawLocation(loc: RawLocation, hint?: University): ParsedRoom | undefined {
  if (loc.kind !== "ROOM") return undefined;
  return parseRoom(`${loc.buildingCode} ${loc.roomNumber}`, hint);
}
