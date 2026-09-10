import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createServerSupabase } from "@/lib/supabase/server";
import { isAllowedEmail } from "@/lib/auth/domain";

export const runtime = "nodejs";

/**
 * Where the magic link lands. Supports both shapes Supabase can send:
 *   ?code=...                 (PKCE; the default {{ .ConfirmationURL }} template)
 *   ?token_hash=...&type=email (a template using {{ .TokenHash }}; works from any device)
 * After the session is created the email is checked once more; anything not @uwaterloo.ca
 * is signed straight back out.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const next = safeNext(url.searchParams.get("next"));
  const supabase = await createServerSupabase();
  if (!supabase) return NextResponse.redirect(new URL("/login?error=unconfigured", url.origin));

  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;

  let failed = false;
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    failed = Boolean(error);
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    failed = Boolean(error);
  } else {
    failed = true;
  }
  if (failed) return NextResponse.redirect(new URL("/login?error=link", url.origin));

  const { data } = await supabase.auth.getUser();
  const email = data.user?.email;
  if (!email || !isAllowedEmail(email)) {
    await supabase.auth.signOut();
    return NextResponse.redirect(new URL("/login?error=domain", url.origin));
  }
  return NextResponse.redirect(new URL(next, url.origin));
}

/** Only same-site paths; never an absolute URL from the query string. */
function safeNext(v: string | null): string {
  if (!v || !v.startsWith("/") || v.startsWith("//")) return "/plan";
  return v;
}
