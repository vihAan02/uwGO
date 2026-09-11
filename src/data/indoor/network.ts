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
  /** A stairwell (or elevator) joining floors, possibly of two buildings. Zero length; `floors` is the climb. */
  | "STAIRS";

export interface IndoorEdge {
  a: number;
  b: number;
  kind: IndoorEdgeKind;
  /** Length along the ground, in metres. */
  metres: number;
  /** Floors climbed going a→b (negative going down). Only stairs have any. */
  floors: number;
  /** [lat, lng] vertices from a to b, for drawing. Zero-length edges hold their one point. */
  path: [number, number][];
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
