import { NextResponse } from "next/server";
import { parseFacilityOccupancy, type PacLive } from "@/data/pac/live";

export const runtime = "nodejs";

const SOURCE = "https://warrior.uwaterloo.ca/FacilityOccupancy";
const CACHE_MS = 2 * 60_000;

let cached: { at: number; body: PacLive } | undefined;

export interface PacLiveResponse { live?: PacLive; error?: string }

/** Live PAC occupancy, proxied because the portal sends no CORS headers. Cached briefly so a class full of students is one request. */
export async function GET() {
  if (cached && Date.now() - cached.at < CACHE_MS) return NextResponse.json({ live: cached.body } satisfies PacLiveResponse);
  try {
    const res = await fetch(SOURCE, { headers: { "User-Agent": "UW GO (student schedule app)" }, signal: AbortSignal.timeout(8000), cache: "no-store" });
    if (!res.ok) throw new Error(`portal returned ${res.status}`);
    const live = parseFacilityOccupancy(await res.text());
    if (!live.zones.length) throw new Error("no occupancy cards found");
    cached = { at: Date.now(), body: live };
    return NextResponse.json({ live } satisfies PacLiveResponse);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) } satisfies PacLiveResponse, { status: 502 });
  }
}
