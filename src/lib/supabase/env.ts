/**
 * Supabase configuration. The URL and anon key are public by design (they are how the
 * browser talks to Supabase; Row Level Security is what protects data). A service-role
 * key is never read here and never needed by this app.
 */
export interface SupabaseEnv { url: string; anonKey: string }

export function supabaseEnv(): SupabaseEnv | undefined {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return undefined;
  return { url, anonKey };
}

export type AuthMode = "SUPABASE" | "DEV_BYPASS" | "UNCONFIGURED";

/**
 * SUPABASE: real accounts. UNCONFIGURED: no keys, so nobody can get in (fail closed).
 * DEV_BYPASS: `UWGO_DEV_SKIP_AUTH=1` in a development build only, for working on the app
 * without a Supabase project. Ignored entirely in production builds. Server-side only.
 */
export function authMode(): AuthMode {
  if (supabaseEnv()) return "SUPABASE";
  if (process.env.NODE_ENV === "development" && process.env.UWGO_DEV_SKIP_AUTH === "1") return "DEV_BYPASS";
  return "UNCONFIGURED";
}
