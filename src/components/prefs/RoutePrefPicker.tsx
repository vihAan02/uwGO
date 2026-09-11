"use client";
import type { RoutePreference } from "@/domain/types";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

export function RoutePrefPicker({ value, onChange }: { value: RoutePreference; onChange: (v: RoutePreference) => void }) {
  return (
    <div>
      <p className="text-sm text-ink-muted">Winter option. &ldquo;Indoors when possible&rdquo; prefers Waterloo&rsquo;s tunnels, bridges and building links when they are not much slower than the fastest walk.</p>
      <ToggleGroup type="single" className="mt-3" value={value} onValueChange={(v) => { if (v) onChange(v as RoutePreference); }} aria-label="Route preference">
        <ToggleGroupItem value="FASTEST">Fastest</ToggleGroupItem>
        <ToggleGroupItem value="INDOORS">Indoors when possible</ToggleGroupItem>
      </ToggleGroup>
    </div>
  );
}
