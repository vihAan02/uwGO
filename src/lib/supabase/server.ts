import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { authMode, supabaseEnv, type AuthMode } from "./env";
import { isAllowedEmail, normalizeEmail } from "@/lib/auth/domain";

/** Server client bound to the request's cookies. Use in route handlers and server components. */
export async function createServerSupabase(): Promise<SupabaseClient | undefined> {
  const env = supabaseEnv();
  if (!env) return undefined;
  const store = await cookies();
  return createServerClient(env.url, env.anonKey, {
    cookies: {
      getAll() { return store.getAll(); },
      setAll(toSet) {
        try {
          for (const { name, value, options } of toSet) store.set(name, value, options);
        } catch {
          // Server components cannot write cookies; the proxy refreshes the session instead.
        }
      },
    },
  });
}

export interface AuthUser { id: string; email: string }
export interface ServerAuth { mode: AuthMode; user?: AuthUser; /** Set when a session exists but its email is not allowed. */ rejectedEmail?: string }

export const DEV_USER: AuthUser = { id: "00000000-0000-0000-0000-000000000000", email: "dev@uwaterloo.ca" };

/**
 * Who is making this request, verified against Supabase (getUser, not the unverified
 * session cookie). A session whose email is not a Waterloo address is reported as
 * `rejectedEmail` and never as a user, whatever the client claims.
 */
export async function getServerAuth(): Promise<ServerAuth> {
  const mode = authMode();
  if (mode === "DEV_BYPASS") return { mode, user: DEV_USER };
  if (mode === "UNCONFIGURED") return { mode };
  const supabase = await createServerSupabase();
  if (!supabase) return { mode: "UNCONFIGURED" };
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user?.email) return { mode };
  const email = normalizeEmail(data.user.email);
  if (!isAllowedEmail(email)) return { mode, rejectedEmail: email };
  return { mode, user: { id: data.user.id, email } };
}
