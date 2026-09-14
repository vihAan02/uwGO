/**
 * UW Go's representation of the campus indoor network: the tunnels, bridges, hallways, doors
 * and stairs that let a student cross Waterloo's campus without going outside, plus the
 * short outdoor walkways that join the indoor clusters. The data itself is generated (see
 * uw-indoor-network.generated.ts and README.md); this file is the shape it has.
 */

/** A point on the network: a coordinate on a given floor of a given building ("OUT" is outside). */
export interface IndoorNode {
  id: number;
  lat: number;
  lng: number;
  /** UW building code, or "OUT" for a point outdoors. */
  building: string;
  floor: string;
}

export type IndoorEdgeKind =
  /** A corridor within one floor of a building. */
  | "HALLWAY"
  /** An enclosed overpass between two buildings. */
  | "BRIDGE"
  /** An underground link between two buildings. */
  | "TUNNEL"
  /** A short walk outside, between doors. The only kind that is not under a roof. */
  | "OUTDOOR"
  /** A door between two adjacent buildings, or between a building and outside. Zero length. */
  | "DOOR"
  /** Adjacent buildings that flow into each other with no door. Zero length. */
  | "OPEN"
  /** A stairwell joining floors, possibly of two buildings. Zero length; `floors` is the climb. */
  | "STAIRS"
  /**
   * An elevator joining floors. That the survey records one says nothing about whether it works, needs a
   * key or is accessible, so it is not step-free until someone confirms it is.
   */
  | "ELEVATOR"
  /** A ramp joining levels. Its gradient is not surveyed, so it is not step-free until someone confirms it is either. */
  | "RAMP"
  /** A change of floor the survey records under a type UW Go does not recognise; `sourceType` keeps the survey's word. */
  | "OTHER_VERTICAL";

/** The kinds that change floor. */
export const VERTICAL_KINDS: readonly IndoorEdgeKind[] = ["STAIRS", "ELEVATOR", "RAMP", "OTHER_VERTICAL"];

export function isVertical(kind: IndoorEdgeKind): boolean {
  return kind === "STAIRS" || kind === "ELEVATOR" || kind === "RAMP" || kind === "OTHER_VERTICAL";
}

export interface IndoorEdge {
  a: number;
  b: number;
  kind: IndoorEdgeKind;
  /** Length along the ground, in metres. */
  metres: number;
  /** Floors climbed going a→b (negative going down). Only changes of floor have any. */
  floors: number;
  /** [lat, lng] vertices from a to b, for drawing. Zero-length edges hold their one point. */
  path: [number, number][];
  /** For OTHER_VERTICAL: the type the survey gave it. */
  sourceType?: string;
}

/** Where a building's floor joins the network, for starting or ending a route there. */
export interface IndoorAnchor {
  building: string;
  floor: string;
  node: number;
}

export interface IndoorNetwork {
  source: { name: string; url: string; commit: string; licence: string };
  nodes: IndoorNode[];
  edges: IndoorEdge[];
  anchors: IndoorAnchor[];
}
