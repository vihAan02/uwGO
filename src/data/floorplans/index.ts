import type { FloorPlanMeta, RoomPosition } from "./types";
import { describePosition } from "./position";
import generated from "./generated/rooms.json";

/**
 * Registry of derived room positions. `generated/rooms.json` is produced by
 * `npm run ingest:floorplans` from plans in `private/floorplans/` (see docs/FLOORPLANS.md).
 */
interface Generated { plans: FloorPlanMeta[]; rooms: Omit<RoomPosition, "description">[] }

const data = generated as Generated;
const plans = new Map(data.plans.map((p) => [p.id, p]));
const rooms = new Map<string, RoomPosition>();
for (const r of data.rooms) {
  const plan = plans.get(r.floorPlanId);
  const description = plan && r.x !== undefined && r.y !== undefined ? describePosition(r.x, r.y, plan) : undefined;
  rooms.set(`${r.buildingCode.toUpperCase()} ${r.roomNumber.toUpperCase()}`, { ...r, description });
}

export function findRoomPosition(buildingCode: string, roomNumber: string): RoomPosition | undefined {
  return rooms.get(`${buildingCode.trim().toUpperCase()} ${roomNumber.trim().toUpperCase()}`);
}

export function floorPlan(id: string): FloorPlanMeta | undefined {
  return plans.get(id);
}

export function floorPlansFor(buildingCode: string): FloorPlanMeta[] {
  return data.plans.filter((p) => p.buildingCode === buildingCode.toUpperCase()).sort((a, b) => a.floor - b.floor);
}

export { describePosition };
export type { FloorPlanMeta, RoomPosition };
