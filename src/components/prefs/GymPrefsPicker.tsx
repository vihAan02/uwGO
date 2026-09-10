"use client";
import type { GymPreferences, GymTimePreference } from "@/domain/types";
import { GYM_DURATIONS } from "@/domain/types";
import { DEFAULT_GYM } from "@/lib/storage";

const TIMES: { value: GymTimePreference; label: string }[] = [
  { value: "MORNING", label: "Morning" },
  { value: "AFTERNOON", label: "Afternoon" },
  { value: "EVENING", label: "Evening" },
  { value: "LEAST_BUSY", label: "Whenever it's least busy" },
  { value: "NONE", label: "No preference" },
];

function Seg<T extends string | number>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T | undefined; onChange: (v: T) => void }) {
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {options.map((o) => (
        <button key={String(o.value)} type="button" className={`btn min-h-11 px-3 py-2 text-sm ${value === o.value ? "btn-primary" : "btn-secondary"}`} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

/** "Do you work out?" and, if so, how long and when. `value` undefined = not answered yet. */
export function GymPrefsPicker({ value, onChange }: { value: GymPreferences | undefined; onChange: (g: GymPreferences) => void }) {
  const g = value ?? DEFAULT_GYM;
  return (
    <div className="mt-1">
      <p className="text-sm text-ink-muted">Do you work out? UW GO can find workout windows at the PAC Fitness Centre that fit around your classes.</p>
      <Seg options={[{ value: "yes", label: "Yes" }, { value: "no", label: "No" }]} value={value === undefined ? undefined : g.enabled ? "yes" : "no"} onChange={(v) => onChange({ ...g, enabled: v === "yes" })} />
      {g.enabled && (
        <>
          <p className="mt-4 text-sm font-medium">Preferred workout duration</p>
          <Seg options={GYM_DURATIONS.map((d) => ({ value: d, label: `${d} min` }))} value={g.durationMinutes} onChange={(d) => onChange({ ...g, durationMinutes: d })} />
          <p className="mt-4 text-sm font-medium">Preferred gym time</p>
          <Seg options={TIMES} value={g.preferredTime} onChange={(t) => onChange({ ...g, preferredTime: t })} />
          <p className="mt-3 text-xs text-ink-muted">Your preference affects ranking; whether a workout fits your schedule always comes first.</p>
        </>
      )}
    </div>
  );
}
