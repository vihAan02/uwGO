import type { RouteOption, RouteStep } from "@/domain/types";

/** RouteOption with every Date as an ISO string, safe for JSON transport and localStorage. */
export interface RouteOptionJSON extends Omit<RouteOption, "departureTime" | "arrivalTime" | "steps"> {
  departureTime?: string;
  arrivalTime?: string;
  steps?: (Omit<RouteStep, "transit"> & { transit?: Omit<NonNullable<RouteStep["transit"]>, "departureTime" | "arrivalTime"> & { departureTime: string; arrivalTime: string } })[];
}

export function serializeRoute(r: RouteOption): RouteOptionJSON {
  return {
    ...r,
    departureTime: r.departureTime?.toISOString(),
    arrivalTime: r.arrivalTime?.toISOString(),
    steps: r.steps?.map((s) => ({
      ...s,
      transit: s.transit
        ? { ...s.transit, departureTime: s.transit.departureTime.toISOString(), arrivalTime: s.transit.arrivalTime.toISOString() }
        : undefined,
    })),
  };
}

export function deserializeRoute(j: RouteOptionJSON): RouteOption {
  return {
    ...j,
    departureTime: j.departureTime ? new Date(j.departureTime) : undefined,
    arrivalTime: j.arrivalTime ? new Date(j.arrivalTime) : undefined,
    steps: j.steps?.map((s) => ({
      ...s,
      transit: s.transit ? { ...s.transit, departureTime: new Date(s.transit.departureTime), arrivalTime: new Date(s.transit.arrivalTime) } : undefined,
    })),
  };
}
