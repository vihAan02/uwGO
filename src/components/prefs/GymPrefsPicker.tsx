"use client";
import type { GymPreferences, GymTimePreference } from "@/domain/types";
import { GYM_DURATIONS } from "@/domain/types";
import { DEFAULT_GYM } from "@/lib/storage";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

const TIMES: { value: GymTimePreference; label: string }[] = [
  { value: "MORNING", label: "Morning" },
  { value: "AFTERNOON", label: "Afternoon" },
  { value: "EVENING", label: "Evening" },
  { value: "LEAST_BUSY", label: "Whenever it's least busy" },
  { value: "NONE", label: "No preference" },
];

/** "Do you work out?" and, if so, how long and when. `value` undefined = not answered yet. */
export function GymPrefsPicker({ value, onChange }: { value: GymPreferences | undefined; onChange: (g: GymPreferences) => void }) {
  const g = value ?? DEFAULT_GYM;
  return (
    <div>
      <p className="text-sm text-ink-muted">Do you work out? UW GO can find workout windows at the PAC Fitness Centre that fit around your classes.</p>
      <ToggleGroup type="single" className="mt-3 max-w-xs" value={value === undefined ? "" : g.enabled ? "yes" : "no"} onValueChange={(v) => { if (v) onChange({ ...g, enabled: v === "yes" }); }} aria-label="Do you work out">
        <ToggleGroupItem value="yes">Yes</ToggleGroupItem>
        <ToggleGroupItem value="no">No</ToggleGroupItem>
      </ToggleGroup>
      {g.enabled && (
        <>
          <p className="mt-5 text-sm font-medium">Workout length</p>
          <ToggleGroup type="single" className="mt-2 max-w-xs" value={String(g.durationMinutes)} onValueChange={(d) => { if (d) onChange({ ...g, durationMinutes: Number(d) as GymPreferences["durationMinutes"] }); }} aria-label="Workout length">
            {GYM_DURATIONS.map((d) => <ToggleGroupItem key={d} value={String(d)}>{d} min</ToggleGroupItem>)}
          </ToggleGroup>
          <p className="mt-5 text-sm font-medium">Preferred time</p>
          <ToggleGroup type="single" className="mt-2" value={g.preferredTime} onValueChange={(t) => { if (t) onChange({ ...g, preferredTime: t as GymTimePreference }); }} aria-label="Preferred gym time">
            {TIMES.map((t) => <ToggleGroupItem key={t.value} value={t.value} className="flex-none">{t.label}</ToggleGroupItem>)}
          </ToggleGroup>
          <p className="mt-3 text-xs text-ink-muted">Your preference affects ranking; whether a workout fits your schedule always comes first.</p>
        </>
      )}
    </div>
  );
}
