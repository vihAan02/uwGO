import { NextResponse } from "next/server";
import { ACCESS_MESSAGE, isAllowedEmail, normalizeEmail } from "@/lib/auth/domain";
import { createServerSupabase } from "@/lib/supabase/server";
import { authMode } from "@/lib/supabase/env";

export const runtime = "nodejs";

export interface SendCodeResponse { ok?: true; error?: string }

/** One send per address per this many ms, so the form cannot be used to spam an inbox. */
const RESEND_MS = 30_000;
const lastSent = new Map<string, number>();

/**
 * Starts sign-in: validates the Waterloo domain on the server, then asks Supabase to email a
 * one-time sign-in code. Sign-in is code only: no redirect URL is sent, and the Supabase "Magic
 * Link" and "Confirm signup" templates must show {{ .Token }} (docs/SUPABASE_SETUP.md).
 * The domain is also enforced in the database (supabase/migrations), so calling Supabase
 * directly with the public anon key does not get around this check either.
 */
export async function POST(req: Request) {
  let email = "";
  try {
    email = normalizeEmail(String(((await req.json()) as { email?: string }).email ?? ""));
  } catch { /* fallthrough */ }
  if (!isAllowedEmail(email)) return NextResponse.json({ error: ACCESS_MESSAGE } satisfies SendCodeResponse, { status: 403 });

  if (authMode() !== "SUPABASE") return NextResponse.json({ error: "Sign-in is not configured on this server." } satisfies SendCodeResponse, { status: 503 });
  const supabase = await createServerSupabase();
  if (!supabase) return NextResponse.json({ error: "Sign-in is not configured on this server." } satisfies SendCodeResponse, { status: 503 });

  const last = lastSent.get(email);
  if (last && Date.now() - last < RESEND_MS) return NextResponse.json({ error: "A sign-in email was just sent. Check your inbox, then try again in a moment." } satisfies SendCodeResponse, { status: 429 });
  lastSent.set(email, Date.now());

  const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
  if (error) {
    // The database trigger rejects non-Waterloo addresses with this text; anything else is Supabase's own message.
    const blocked = /uwaterloo|not allowed|Database error saving new user/i.test(error.message);
    return NextResponse.json({ error: blocked ? ACCESS_MESSAGE : error.message } satisfies SendCodeResponse, { status: blocked ? 403 : 502 });
  }
  return NextResponse.json({ ok: true } satisfies SendCodeResponse);
}
