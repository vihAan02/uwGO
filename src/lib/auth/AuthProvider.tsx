"use client";
import { createContext, useCallback, useContext, useMemo } from "react";
import { useRouter } from "next/navigation";
import type { AuthMode } from "@/lib/supabase/env";
import { getBrowserSupabase } from "@/lib/supabase/client";

export interface AuthState {
  mode: AuthMode;
  user?: { id: string; email: string };
}

interface AuthApi extends AuthState {
  signOut(): Promise<void>;
}

const Ctx = createContext<AuthApi | undefined>(undefined);

/** Session facts come from the server (layout.tsx), verified there; the client only ever signs out. */
export function AuthProvider({ initial, children }: { initial: AuthState; children: React.ReactNode }) {
  const router = useRouter();
  const signOut = useCallback(async () => {
    try { await getBrowserSupabase()?.auth.signOut(); } catch { /* cookies are cleared by the proxy on the next request anyway */ }
    router.replace("/login");
    router.refresh();
  }, [router]);
  const api = useMemo<AuthApi>(() => ({ ...initial, signOut }), [initial, signOut]);
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used inside AuthProvider");
  return v;
}
