import type { FloorPlanMeta, RoomPosition } from "./types";

/**
 * "east side", "north-west corner", "centre": where a normalised point sits on a plan,
 * turned into compass words using the plan's own orientation. Deliberately coarse.
 */
export function describePosition(x: number, y: number, plan: Pick<FloorPlanMeta, "upBearingDeg">): string {
  // Vector from the plan centre, in plan space (x right, y up).
  const dx = x - 0.5;
  const dy = 0.5 - y;
  const r = Math.hypot(dx, dy);
  if (r < 0.12) return "centre of the floor";
  // Plan "up" points at upBearingDeg; rotate the vector into compass space.
  const angleFromUp = (Math.atan2(dx, dy) * 180) / Math.PI; // 0 = up, 90 = right
  const bearing = ((angleFromUp + plan.upBearingDeg) % 360 + 360) % 360;
  const dirs = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];
  const dir = dirs[Math.round(bearing / 45) % 8];
  const strength = r > 0.3 ? "end" : "side";
  return dir.includes("-") ? `${dir} corner` : `${dir} ${strength}`;
}

export function roomLabel(p: RoomPosition): string {
  return p.description ? `${capitalize(p.description)} of floor ${p.floor}` : `Floor ${p.floor}`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
