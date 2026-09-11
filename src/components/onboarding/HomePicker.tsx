"use client";
import { useState } from "react";
import { Check } from "lucide-react";
import type { University, UserHome } from "@/domain/types";
import { residencePresets } from "@/data/buildings";
import type { GeocodeResponse } from "@/app/api/geocode/route";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

type Mode = "UW" | "WLU" | "ADDRESS";

/**
 * The home a residence code stands for. The label the confirmation shows and the coordinates the
 * plan routes to come from the same building, so the two can never disagree with the dropdown.
 * Returns undefined for an unknown code or one whose building has no coordinates.
 */
export function residenceHome(university: University, code: string): UserHome | undefined {
  const b = residencePresets(university).find((x) => x.code === code);
  if (!b || b.latitude === undefined || b.longitude === undefined) return undefined;
  return { name: b.residenceLabel ?? b.name, latitude: b.latitude, longitude: b.longitude, address: b.address, preset: { university, buildingCode: b.code } };
}

export function HomePicker({ value, onChange }: { value: UserHome | undefined; onChange: (h: UserHome | undefined) => void }) {
  const [mode, setMode] = useState<Mode>(value?.preset?.university ?? (value?.address ? "ADDRESS" : "UW"));
  const [address, setAddress] = useState(value?.address ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const choosePreset = (u: University, code: string) => onChange(residenceHome(u, code));

  const lookup = async () => {
    setBusy(true); setError(undefined);
    try {
      const res = await fetch("/api/geocode", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address }) });
      const json = (await res.json()) as GeocodeResponse;
      if (!json.result) { setError(json.error ?? "Lookup failed."); onChange(undefined); return; }
      onChange({ name: "Home", latitude: json.result.latitude, longitude: json.result.longitude, address: json.result.formattedAddress });
    } catch {
      setError("Could not reach the address service.");
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-3">
      <ToggleGroup type="single" value={mode} onValueChange={(m) => { if (!m) return; setMode(m as Mode); onChange(undefined); }} aria-label="Kind of home">
        <ToggleGroupItem value="UW">Waterloo</ToggleGroupItem>
        <ToggleGroupItem value="WLU">Laurier</ToggleGroupItem>
        <ToggleGroupItem value="ADDRESS">Address</ToggleGroupItem>
      </ToggleGroup>
      {mode !== "ADDRESS" ? (
        <NativeSelect aria-label="Residence" value={value?.preset?.university === mode ? value.preset.buildingCode : ""} onChange={(e) => choosePreset(mode, e.target.value)}>
          <NativeSelectOption value="">Choose a {mode === "UW" ? "Waterloo" : "Laurier"} residence…</NativeSelectOption>
          {residencePresets(mode).map((b) => (
            <NativeSelectOption key={b.id} value={b.code} disabled={b.latitude === undefined}>
              {b.residenceLabel}{b.latitude === undefined ? " (no coordinates yet)" : ""}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      ) : (
        <div className="space-y-2">
          <div className="flex gap-2">
            <Input aria-label="Street address" placeholder="Street address in Waterloo" value={address} onChange={(e) => setAddress(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void lookup(); } }} />
            <Button variant="outline" size="lg" className="shrink-0" disabled={busy || address.trim().length < 4} onClick={lookup}>{busy ? "Looking up…" : "Find"}</Button>
          </div>
          {error && <p className="text-sm text-bad">{error}</p>}
          <p className="text-xs text-ink-muted">The address is sent once to Google to get a map position, then kept only on this device.</p>
        </div>
      )}
      {value && (
        <p className="flex items-start gap-1.5 text-sm text-ok">
          <Check className="mt-0.5 size-4 shrink-0" />
          <span>Home: {value.name}{value.address && value.name !== value.address ? ` · ${value.address}` : ""}</span>
        </p>
      )}
    </div>
  );
}
