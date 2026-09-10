"use client";
import type { RoutePreference } from "@/domain/types";

export function RoutePrefPicker({ value, onChange }: { value: RoutePreference; onChange: (v: RoutePreference) => void }) {
  return (
    <div className="mt-1">
      <p className="text-sm text-ink-muted">Winter option. &ldquo;Indoors when possible&rdquo; prefers Waterloo&rsquo;s tunnels, bridges and building links when they are not much slower than the fastest walk.</p>
      <div className="mt-2 flex gap-2">
        {([["FASTEST", "Fastest"], ["INDOORS", "Indoors when possible"]] as [RoutePreference, string][]).map(([v, label]) => (
          <button key={v} type="button" className={`btn flex-1 px-2 text-sm ${value === v ? "btn-primary" : "btn-secondary"}`} onClick={() => onChange(v)}>{label}</button>
        ))}
      </div>
    </div>
  );
}
