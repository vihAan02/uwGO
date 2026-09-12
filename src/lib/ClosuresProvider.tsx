"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/lib/auth/AuthProvider";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { closedEdgeIds as confirmedClosed, reportsUntilClosed, type ClosureTally } from "@/engine/closures";
import { supabaseClosureStore } from "./closureStore";

/**
 * What the campus currently says is shut, shared by everything that routes.
 *
 * The tallies are anonymous counts from the database; this turns them into the set of segments
 * routing must avoid. It is deliberately tolerant: with no account, no Supabase, or a failed
 * read, the set is simply empty and every route is computed exactly as it was before. A closure
 * feature that could take the app down with it would be a bad trade.
 */

export interface ClosuresApi {
  /** Segments enough students have reported shut. Routing avoids these. */
  closed: ReadonlySet<string>;
  /** The current count per segment, for showing how close one is to being confirmed. */
  tallies: ReadonlyMap<string, ClosureTally>;
  /** Segments this student has an active report on. */
  mine: ReadonlySet<string>;
  /** File a report for one segment. Resolves false if it could not be saved. */
  report(edgeId: string): Promise<boolean>;
  /** Take back this student's own report. */
  withdraw(edgeId: string): Promise<boolean>;
  /** How many more accounts a segment needs before it closes. */
  remaining(edgeId: string): number;
  refresh(): void;
  loaded: boolean;
}

const EMPTY: ClosuresApi = {
  closed: new Set(),
  tallies: new Map(),
  mine: new Set(),
  report: async () => false,
  withdraw: async () => false,
  remaining: () => 5,
  refresh: () => {},
  loaded: false,
};

const Ctx = createContext<ClosuresApi>(EMPTY);

/** Re-read the tallies this often, so a closure confirmed while the app is open takes effect. */
const REFRESH_MS = 5 * 60_000;

export function ClosuresProvider({ children }: { children: React.ReactNode }) {
  const auth = useAuth();
  const userId = auth.user?.id;
  const [tallies, setTallies] = useState<ClosureTally[]>([]);
  const [mine, setMine] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [nonce, setNonce] = useState(0);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);

  useEffect(() => {
    const supabase = getBrowserSupabase();
    // Nothing to read without an account. The value below is derived from `userId`, so signing
    // out empties it without this effect having to reset anything.
    if (!supabase || !userId) return;
    const store = supabaseClosureStore(supabase, userId);
    let cancelled = false;
    const read = async () => {
      try {
        const [t, m] = await Promise.all([store.tallies(), store.mine()]);
        if (!cancelled) { setTallies(t); setMine(m); setLoaded(true); }
      } catch {
        // Unreachable closures must never stop the app routing; the set stays as it was.
        if (!cancelled) setLoaded(true);
      }
    };
    void read();
    const id = setInterval(read, REFRESH_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [userId, nonce]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  const api = useMemo<ClosuresApi>(() => {
    const supabase = getBrowserSupabase();
    const store = supabase && userId ? supabaseClosureStore(supabase, userId) : undefined;
    // Signed out, or Supabase not configured: no closures, and every route is computed exactly
    // as it was before this feature existed.
    if (!store) return EMPTY;
    const byEdge = new Map(tallies.map((t) => [t.edgeId, t]));
    const mineSet = new Set(mine);
    return {
      closed: confirmedClosed(tallies),
      tallies: byEdge,
      mine: mineSet,
      remaining: (edgeId) => reportsUntilClosed(byEdge.get(edgeId)),
      loaded,
      refresh,
      report: async (edgeId) => {
        if (!store) return false;
        const r = await store.report(edgeId);
        if (r.ok) refresh();
        return r.ok;
      },
      withdraw: async (edgeId) => {
        if (!store) return false;
        const r = await store.withdraw(edgeId);
        if (r.ok) refresh();
        return r.ok;
      },
    };
  }, [tallies, mine, loaded, refresh, userId]);

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useClosures(): ClosuresApi {
  return useContext(Ctx);
}
