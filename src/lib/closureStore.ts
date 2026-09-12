import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClosureTally } from "@/engine/closures";

/**
 * Closure reports through the browser Supabase client: the public anon key and the student's own
 * session, with Row Level Security deciding what they may do. Nothing here is trusted to keep a
 * student honest; the database is.
 *
 * A student reads the anonymised tally (`route_closure_consensus`), files a report for one
 * segment, and can withdraw it. They can never read who else reported anything: the view exposes
 * counts only, and the table's policies limit every row query to their own reports.
 */

export const CLOSURE_TABLE = "route_closure_reports";
export const CLOSURE_CONSENSUS_VIEW = "route_closure_consensus";

export type ClosureWrite = { ok: true } | { ok: false; message: string };

export interface ClosureStore {
  /** How many accounts currently call each segment shut. No identities. */
  tallies(): Promise<ClosureTally[]>;
  /** Segments this student has an active report on, so the UI can show it as already reported. */
  mine(): Promise<string[]>;
  report(edgeId: string): Promise<ClosureWrite>;
  withdraw(edgeId: string): Promise<ClosureWrite>;
}

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

interface TallyRow { edge_id: string; reports: number; latest: string | null }

export function supabaseClosureStore(supabase: SupabaseClient, userId: string): ClosureStore {
  return {
    async tallies() {
      const { data, error } = await supabase.from(CLOSURE_CONSENSUS_VIEW).select("edge_id, reports, latest");
      if (error) throw new Error(error.message);
      return ((data ?? []) as TallyRow[]).map((r) => ({ edgeId: r.edge_id, reports: r.reports, latest: r.latest ?? undefined }));
    },
    async mine() {
      const { data, error } = await supabase.from(CLOSURE_TABLE).select("edge_id").eq("status", "CLOSED");
      if (error) throw new Error(error.message);
      return ((data ?? []) as { edge_id: string }[]).map((r) => r.edge_id);
    },
    async report(edgeId) {
      try {
        // One row per account per segment: reporting again refreshes it, which is how a closure
        // is reconfirmed, and can never become a second vote. `reported_at` is the database's.
        const { error } = await supabase
          .from(CLOSURE_TABLE)
          .upsert({ reporter_id: userId, edge_id: edgeId, status: "CLOSED" }, { onConflict: "reporter_id,edge_id" });
        return error ? { ok: false, message: error.message } : { ok: true };
      } catch (e) {
        return { ok: false, message: messageOf(e) };
      }
    },
    async withdraw(edgeId) {
      try {
        const { error } = await supabase.from(CLOSURE_TABLE).delete().eq("reporter_id", userId).eq("edge_id", edgeId);
        return error ? { ok: false, message: error.message } : { ok: true };
      } catch (e) {
        return { ok: false, message: messageOf(e) };
      }
    },
  };
}
