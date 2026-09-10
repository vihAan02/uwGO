"use client";
import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseEnv } from "./env";

let client: SupabaseClient | undefined;

/** Browser client (cookie-based session shared with the server). Undefined when Supabase is not configured. */
export function getBrowserSupabase(): SupabaseClient | undefined {
  const env = supabaseEnv();
  if (!env) return undefined;
  if (!client) client = createBrowserClient(env.url, env.anonKey);
  return client;
}
