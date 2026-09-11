"use client";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/lib/auth/AuthProvider";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { supabaseEnv } from "@/lib/supabase/env";
import { useStore } from "@/lib/store";
import type { AppState } from "./storage";
import { supabaseUserStateStore } from "./userStateStore";
import { createUserStateSync, type AccountSnapshot, type UserStateSync } from "./userStateSync";

export type AccountSyncStatus = AccountSnapshot["status"] | "local";

export interface UserStateApi {
  /**
   * loading: the saved state is being read (or the session has not reached the page yet).
   * ready: the device matches the account, or changes are being saved.
   * error: the read failed; nothing on the device was changed.
   * offline: the student chose to carry on with the device's copy after a failed read.
   * local: there is no account to sync with (Supabase not configured, or the dev bypass).
   */
  status: AccountSyncStatus;
  loadError?: string;
  saveError?: string;
  saving: boolean;
  retry(): void;
  continueOffline(): void;
  /** Save any pending change now. Await before signing out. */
  flush(): Promise<void>;
  /** Delete the account's saved state ("Delete everything"). */
  forget(): Promise<boolean>;
}

const LOCAL_ONLY: UserStateApi = {
  status: "local",
  saving: false,
  retry: () => {},
  continueOffline: () => {},
  flush: async () => {},
  forget: async () => true,
};

const Ctx = createContext<UserStateApi>(LOCAL_ONLY);

/**
 * Connects the store to the signed-in student's `public.user_state` row through
 * `createUserStateSync`. The browser Supabase client uses the public anon key and the student's
 * session cookie; Row Level Security limits every query to their own row.
 */
export function UserStateProvider({ children }: { children: React.ReactNode }) {
  const auth = useAuth();
  const { state, hydrated, replaceState, reset } = useStore();
  const userId = auth.user?.id;
  const configured = supabaseEnv() !== undefined;

  const [tagged, setTagged] = useState<{ userId: string; snapshot: AccountSnapshot }>();
  const syncRef = useRef<UserStateSync | undefined>(undefined);
  const stateRef = useRef<AppState>(state);
  const actions = useRef({ replaceState, reset });
  useEffect(() => { actions.current = { replaceState, reset }; });

  // Declared before the controller effect so a new controller reads the state of the same commit.
  useEffect(() => {
    stateRef.current = state;
    syncRef.current?.notify();
  }, [state]);

  // One controller per signed-in account.
  useEffect(() => {
    const supabase = getBrowserSupabase();
    if (!hydrated || !userId || !supabase) return;
    const sync = createUserStateSync({
      store: supabaseUserStateStore(supabase),
      userId,
      local: {
        get: () => stateRef.current,
        set: (next) => { stateRef.current = next; actions.current.replaceState(next); },
      },
      onSnapshot: (snapshot) => setTagged({ userId, snapshot }),
    });
    syncRef.current = sync;
    void sync.load();

    const onOnline = () => {
      const s = sync.snapshot();
      if (s.status === "error" || s.saveError) void sync.retry();
    };
    // A phone locking or a tab closing is the likeliest moment to lose a debounced save.
    const onHidden = () => { if (document.visibilityState === "hidden") void sync.flush(); };
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onHidden);
      sync.dispose();
      if (syncRef.current === sync) syncRef.current = undefined;
    };
  }, [hydrated, userId]);

  // Signing out empties the device copy; the account keeps the saved one for next time.
  const previousUser = useRef(userId);
  useEffect(() => {
    if (previousUser.current && !userId) actions.current.reset();
    previousUser.current = userId;
  }, [userId]);

  const api = useMemo<UserStateApi>(() => {
    if (!configured) return LOCAL_ONLY;
    const snapshot = tagged && tagged.userId === userId ? tagged.snapshot : undefined;
    return {
      status: !userId || !hydrated || !snapshot ? "loading" : snapshot.status,
      loadError: snapshot?.loadError,
      saveError: snapshot?.saveError,
      saving: snapshot?.saving ?? false,
      retry: () => { void syncRef.current?.retry(); },
      continueOffline: () => { syncRef.current?.continueOffline(); },
      flush: () => syncRef.current?.flush() ?? Promise.resolve(),
      forget: () => syncRef.current?.forget() ?? Promise.resolve(false),
    };
  }, [configured, tagged, userId, hydrated]);

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useUserState(): UserStateApi {
  return useContext(Ctx);
}
