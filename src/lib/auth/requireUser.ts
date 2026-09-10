import "server-only";
import { NextResponse } from "next/server";
import { getServerAuth, type AuthUser } from "@/lib/supabase/server";
import { ACCESS_MESSAGE } from "./domain";

/** For API routes: the verified Waterloo user, or the 401/403 response to return instead. */
export async function requireUser(): Promise<{ user: AuthUser; response?: undefined } | { user?: undefined; response: NextResponse }> {
  const auth = await getServerAuth();
  if (auth.user) return { user: auth.user };
  if (auth.rejectedEmail) return { response: NextResponse.json({ error: ACCESS_MESSAGE }, { status: 403 }) };
  return { response: NextResponse.json({ error: auth.mode === "UNCONFIGURED" ? "Sign-in is not configured on this server." : "Sign in to use UW GO." }, { status: 401 }) };
}
