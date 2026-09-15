import type { CampusLocation, RouteOption } from "@/domain/types";

/** What the one planner map is showing: a trip, a place, or everywhere the student has to be that day. */
export type MapSelection =
  | { kind: "LEG"; label: string; from: CampusLocation; to: CampusLocation; route?: RouteOption; /** Used by Trip Mode when a transit option has gone. */ walkFallback?: RouteOption }
  | { kind: "PLACE"; label: string; at: CampusLocation }
  | { kind: "DAY"; label: string; stops: { at: CampusLocation; label: string }[] };
