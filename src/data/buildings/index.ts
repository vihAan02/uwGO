import type { CampusBuilding, CampusLocation, University } from "@/domain/types";
import { UW_BUILDINGS, UW_ALIASES } from "./uw";
import { WLU_BUILDINGS } from "./wlu";

const ALL: readonly CampusBuilding[] = [...UW_BUILDINGS, ...WLU_BUILDINGS];

const byUniversity: Record<University, Map<string, CampusBuilding>> = { UW: new Map(), WLU: new Map() };
for (const b of ALL) {
  const map = byUniversity[b.university];
  map.set(b.code.toUpperCase(), b);
  for (const a of b.aliases) if (!map.has(a.toUpperCase())) map.set(a.toUpperCase(), b);
}
for (const [alias, target] of Object.entries(UW_ALIASES)) {
  const b = byUniversity.UW.get(target);
  if (b) byUniversity.UW.set(alias, b);
}

export function normalizeBuildingCode(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, " ");
}

/** Exact code or alias lookup within one university. */
export function findBuilding(university: University, code: string): CampusBuilding | undefined {
  return byUniversity[university].get(normalizeBuildingCode(code));
}

/** Try the hinted university first, then the other one. */
export function findBuildingAnywhere(code: string, hint?: University): CampusBuilding | undefined {
  const order: University[] = hint === "WLU" ? ["WLU", "UW"] : ["UW", "WLU"];
  for (const u of order) {
    const b = findBuilding(u, code);
    if (b) return b;
  }
  return undefined;
}

export function allBuildings(university?: University): readonly CampusBuilding[] {
  return university ? ALL.filter((b) => b.university === university) : ALL;
}

export function residencePresets(university: University): CampusBuilding[] {
  return ALL.filter((b) => b.university === university && b.residenceLabel).sort((a, b) =>
    a.residenceLabel!.localeCompare(b.residenceLabel!),
  );
}

export function hasCoordinates(b: CampusBuilding): b is CampusBuilding & { latitude: number; longitude: number } {
  return typeof b.latitude === "number" && typeof b.longitude === "number";
}

export function buildingLocation(b: CampusBuilding): CampusLocation | undefined {
  if (!hasCoordinates(b)) return undefined;
  return {
    id: b.id,
    name: b.name,
    university: b.university,
    latitude: b.latitude,
    longitude: b.longitude,
    kind: "BUILDING",
    buildingCode: b.code,
  };
}
