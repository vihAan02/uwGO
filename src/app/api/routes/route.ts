import { NextResponse } from "next/server";
import type { LatLng } from "@/domain/types";
import { isInWaterlooRegion } from "@/routing/RoutingProvider";
import { getServerRoutingProvider, routingMode } from "@/routing/server";
import { serializeRoute } from "@/routing/serialize";
import type { RoutesRequestBody, RoutesResponseBody } from "@/routing/HttpRoutingProvider";

export const runtime = "nodejs";

function isLatLng(v: unknown): v is LatLng {
  return Boolean(v) && typeof (v as LatLng).latitude === "number" && typeof (v as LatLng).longitude === "number" && Number.isFinite((v as LatLng).latitude) && Number.isFinite((v as LatLng).longitude);
}

/**
 * Routing proxy. Receives coordinates + a time, never course data. Nothing is logged.
 * Uses the Google Routes API when GOOGLE_MAPS_SERVER_KEY is set, otherwise a clearly-labelled estimate.
 */
export async function POST(req: Request) {
  let body: RoutesRequestBody;
  try {
    body = (await req.json()) as RoutesRequestBody;
  } catch {
    return NextResponse.json({ route: null, error: "Invalid JSON" } satisfies RoutesResponseBody, { status: 400 });
  }
  if ((body.mode !== "WALK" && body.mode !== "TRANSIT") || !isLatLng(body.from) || !isLatLng(body.to)) {
    return NextResponse.json({ route: null, error: "Expected { mode, from, to }" } satisfies RoutesResponseBody, { status: 400 });
  }
  if (!isInWaterlooRegion(body.from) || !isInWaterlooRegion(body.to)) {
    return NextResponse.json({ route: null, error: "Only locations in Waterloo Region are supported." } satisfies RoutesResponseBody, { status: 400 });
  }
  const provider = getServerRoutingProvider();
  try {
    const route = body.mode === "WALK"
      ? await provider.getWalkingRoute(body.from, body.to)
      : await provider.getTransitRoute(body.from, body.to, {
          departureTime: body.departureTime ? new Date(body.departureTime) : undefined,
          arrivalTime: body.arrivalTime ? new Date(body.arrivalTime) : undefined,
        });
    return NextResponse.json({ route: route ? serializeRoute(route) : null } satisfies RoutesResponseBody, { headers: { "X-UWGO-Routing": routingMode() } });
  } catch (err) {
    return NextResponse.json({ route: null, error: err instanceof Error ? err.message : "Routing failed" } satisfies RoutesResponseBody, { status: 502 });
  }
}

export async function GET() {
  return NextResponse.json({ mode: routingMode() });
}
