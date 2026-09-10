/**
 * Room positions inside a building, derived by UW GO from floor plans the owner obtained
 * through WatIAM. Only this derived metadata is kept in the repo; the source plans stay in
 * `private/` (gitignored) and are never served.
 *
 * x/y are normalised to the plan image (0..1, x to the right, y downwards), so a marker can
 * be placed over a plan image at any screen size. `description` is a plain-language hint
 * ("east side", "north hallway") computed from x/y and the plan's north bearing.
 */
export interface FloorPlanMeta {
  /** e.g. "mc-floor-1" */
  id: string;
  buildingCode: string;
  floor: number;
  /** Compass bearing of the plan's "up" direction, in degrees clockwise from north. 0 = north-up. */
  upBearingDeg: number;
  /** Where the metadata came from, for the record. Not a link to the file. */
  source: string;
  /** Present only when a plan image may be shown to users (see docs/FLOORPLANS.md). */
  imageUrl?: string;
  width?: number;
  height?: number;
}

export interface RoomPosition {
  buildingCode: string;
  roomNumber: string;
  floor: number;
  floorPlanId: string;
  x?: number;
  y?: number;
  description?: string;
  /** OCR confidence 0..1, when the position was read automatically. */
  confidence?: number;
}
