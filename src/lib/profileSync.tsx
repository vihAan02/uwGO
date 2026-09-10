"use client";
import { useEffect, useRef } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useAuth } from "@/lib/auth/AuthProvider";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { useStore } from "@/lib/store";
import { prefsFromRow, prefsKeyOf, rowMatches, toRow, type Prefs, type ProfileRow } from "./profilePrefs";

type User = { id: string; email: string };

/**
 * Upload the device's preferences. Awaited on purpose: a supabase-js query builder only sends
 * its request when it is awaited (or `.then()` is called), so `void supabase.from(...).upsert()`
 * silently sends nothing.
 */
async function savePrefs(supabase: SupabaseClient, user: User, prefs: Prefs, key: string, lastSaved: { current: string }): Promise<void> {
  const { error } = await supabase.from("profiles").upsert(toRow(user.id, user.email, prefs), { onConflict: "id" });
  if (error) {
    console.warn(`UW GO: could not save preferences to your account (${error.message}).`);
    return;
  }
  lastSaved.current = key;
}

/**
 * Keeps the signed-in student's preferences in their Supabase profile. localStorage stays the
 * source of truth on the device: a device with no answers of its own adopts the profile's, and a
 * device that has answers uploads them when they differ. Every later change is uploaded,
 * debounced. Nothing is uploaded before the profile has been read, so a slow network cannot
 * overwrite a good profile with an empty device. A failed sync never blocks the app.
 */
export function ProfileSync() {
  const auth = useAuth();
  const { state, hydrated, setGym, setRoutePreference, setConfig } = useStore();
  const pulledFor = useRef<string | undefined>(undefined);
  const reconciled = useRef(false);
  const lastSaved = useRef("");

  const prefs: Prefs = { gym: state.gym, routePreference: state.routePreference, arrivalBufferMinutes: state.config.arrivalBufferMinutes };
  const key = prefsKeyOf(prefs);
  // The read below resolves later; it must reconcile against the preferences as they are then.
  const latest = useRef({ prefs, key });
  useEffect(() => { latest.current = { prefs, key }; });

  // Once per signed-in user: read the profile, then reconcile.
  useEffect(() => {
    const supabase = getBrowserSupabase();
    const user = auth.user;
    if (!hydrated || !user || !supabase || pulledFor.current === user.id) return;
    pulledFor.current = user.id;
    reconciled.current = false;
    void (async () => {
      const { data, error } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle<ProfileRow>();
      if (error) {
        console.warn(`UW GO: could not read your account preferences (${error.message}).`);
        pulledFor.current = undefined;
        return;
      }
      const local = latest.current;
      const localAnswered = local.prefs.gym !== undefined || local.prefs.routePreference !== undefined;
      if (data && !localAnswered) {
        const remote = prefsFromRow(data, local.prefs.arrivalBufferMinutes);
        lastSaved.current = prefsKeyOf(remote);
        reconciled.current = true;
        if (remote.gym) setGym(remote.gym);
        if (remote.routePreference) setRoutePreference(remote.routePreference);
        if (remote.arrivalBufferMinutes !== local.prefs.arrivalBufferMinutes) setConfig({ arrivalBufferMinutes: remote.arrivalBufferMinutes });
        return;
      }
      if (data && rowMatches(data, local.prefs)) lastSaved.current = local.key;
      else await savePrefs(supabase, user, local.prefs, local.key, lastSaved);
      reconciled.current = true;
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, auth.user]);

  // Every later change, debounced.
  useEffect(() => {
    const supabase = getBrowserSupabase();
    const user = auth.user;
    if (!hydrated || !user || !supabase || !reconciled.current || key === lastSaved.current) return;
    const id = setTimeout(() => { void savePrefs(supabase, user, prefs, key, lastSaved); }, 800);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, hydrated, auth.user]);

  return null;
}
