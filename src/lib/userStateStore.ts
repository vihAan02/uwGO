import type { SupabaseClient } from "@supabase/supabase-js";
import { USER_STATE_COLUMNS, USER_STATE_TABLE, type UserStateWrite } from "./userState";

export type LoadResult = { kind: "found"; row: unknown } | { kind: "none" } | { kind: "error"; message: string };
export type WriteResult = { ok: true } | { ok: false; message: string };

/** Where the account copy lives. Supabase in the app; a local Postgres in tests. */
export interface UserStateStore {
  load(userId: string): Promise<LoadResult>;
  save(write: UserStateWrite): Promise<WriteResult>;
  remove(userId: string): Promise<WriteResult>;
}

export const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * `public.user_state` through the browser Supabase client, which uses the public anon key and the
 * student's own session: Row Level Security, not this code, is what limits it to their row.
 * Every query is awaited; a supabase-js builder sends nothing until it is.
 */
export function supabaseUserStateStore(supabase: SupabaseClient): UserStateStore {
  return {
    async load(userId) {
      try {
        const { data, error } = await supabase.from(USER_STATE_TABLE).select(USER_STATE_COLUMNS).eq("user_id", userId).maybeSingle();
        if (error) return { kind: "error", message: error.message };
        return data ? { kind: "found", row: data } : { kind: "none" };
      } catch (e) {
        return { kind: "error", message: messageOf(e) };
      }
    },
    async save(write) {
      try {
        const { error } = await supabase.from(USER_STATE_TABLE).upsert(write, { onConflict: "user_id" });
        return error ? { ok: false, message: error.message } : { ok: true };
      } catch (e) {
        return { ok: false, message: messageOf(e) };
      }
    },
    async remove(userId) {
      try {
        const { error } = await supabase.from(USER_STATE_TABLE).delete().eq("user_id", userId);
        return error ? { ok: false, message: error.message } : { ok: true };
      } catch (e) {
        return { ok: false, message: messageOf(e) };
      }
    },
  };
}
