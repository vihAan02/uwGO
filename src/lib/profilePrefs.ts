import type { GymPreferences, RoutePreference } from "@/domain/types";

/** The public.profiles row (see supabase/migrations). Preferences only; schedules stay on the device. */
export interface ProfileRow {
  id: string;
  email: string;
  gym_enabled: boolean | null;
  gym_duration_minutes: number | null;
  gym_preferred_time: GymPreferences["preferredTime"] | null;
  route_preference: RoutePreference | null;
  arrival_buffer_minutes: number | null;
}

export type Prefs = { gym?: GymPreferences; routePreference?: RoutePreference; arrivalBufferMinutes: number };

export function toRow(id: string, email: string, p: Prefs): ProfileRow {
  return {
    id,
    email,
    gym_enabled: p.gym?.enabled ?? null,
    gym_duration_minutes: p.gym?.durationMinutes ?? null,
    gym_preferred_time: p.gym?.preferredTime ?? null,
    route_preference: p.routePreference ?? null,
    arrival_buffer_minutes: p.arrivalBufferMinutes,
  };
}

/** Preferences as the profile holds them. A null buffer falls back to the device's. */
export function prefsFromRow(row: ProfileRow, fallbackBuffer: number): Prefs {
  return {
    gym: row.gym_enabled === null
      ? undefined
      : { enabled: row.gym_enabled, durationMinutes: (row.gym_duration_minutes ?? 60) as GymPreferences["durationMinutes"], preferredTime: row.gym_preferred_time ?? "NONE" },
    routePreference: row.route_preference ?? undefined,
    arrivalBufferMinutes: row.arrival_buffer_minutes ?? fallbackBuffer,
  };
}

/** Stable comparison key; field order inside `gym` does not matter. */
export function prefsKeyOf(p: Prefs): string {
  return JSON.stringify({
    gym: p.gym && { enabled: p.gym.enabled, durationMinutes: p.gym.durationMinutes, preferredTime: p.gym.preferredTime },
    routePreference: p.routePreference,
    arrivalBufferMinutes: p.arrivalBufferMinutes,
  });
}

/** Whether the stored row already holds exactly these preferences, nulls included. */
export function rowMatches(row: ProfileRow, prefs: Prefs): boolean {
  const want = toRow(row.id, row.email, prefs);
  return row.gym_enabled === want.gym_enabled
    && row.gym_duration_minutes === want.gym_duration_minutes
    && row.gym_preferred_time === want.gym_preferred_time
    && row.route_preference === want.route_preference
    && row.arrival_buffer_minutes === want.arrival_buffer_minutes;
}
