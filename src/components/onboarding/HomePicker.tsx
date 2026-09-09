"use client";
import { useState } from "react";
import type { University, UserHome } from "@/domain/types";
import { residencePresets } from "@/data/buildings";
import type { GeocodeResponse } from "@/app/api/geocode/route";

type Mode = "UW" | "WLU" | "ADDRESS";

export function HomePicker({ value, onChange }: { value: UserHome | undefined; onChange: (h: UserHome | undefined) => void }) {
  const [mode, setMode] = useState<Mode>(value?.preset?.university ?? (value?.address ? "ADDRESS" : "UW"));
  const [address, setAddress] = useState(value?.address ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const choosePreset = (u: University, code: string) => {
    const b = residencePresets(u).find((x) => x.code === code);
    if (!b || b.latitude === undefined || b.longitude === undefined) { onChange(undefined); return; }
    onChange({ name: b.residenceLabel ?? b.name, latitude: b.latitude, longitude: b.longitude, address: b.address, preset: { university: u, buildingCode: b.code } });
  };

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
    <div className="mt-3 space-y-3">
      <div className="flex gap-2">
        {([["UW", "UW residence"], ["WLU", "Laurier residence"], ["ADDRESS", "Address"]] as [Mode, string][]).map(([m, label]) => (
          <button key={m} className={`btn flex-1 px-2 text-sm ${mode === m ? "btn-primary" : "btn-secondary"}`} onClick={() => { setMode(m); onChange(undefined); }}>{label}</button>
        ))}
      </div>
      {mode !== "ADDRESS" ? (
        <select className="field" value={value?.preset?.university === mode ? value.preset.buildingCode : ""} onChange={(e) => choosePreset(mode, e.target.value)}>
          <option value="">Choose a residence…</option>
          {residencePresets(mode).map((b) => (
            <option key={b.id} value={b.code} disabled={b.latitude === undefined}>{b.residenceLabel}{b.latitude === undefined ? " (no coordinates yet)" : ""}</option>
          ))}
        </select>
      ) : (
        <div className="space-y-2">
          <input className="field" placeholder="Street address in Waterloo" value={address} onChange={(e) => setAddress(e.target.value)} />
          <button className="btn btn-secondary w-full" disabled={busy || address.trim().length < 4} onClick={lookup}>{busy ? "Looking up…" : "Find address"}</button>
          {error && <p className="text-sm text-bad">{error}</p>}
          <p className="text-xs text-ink-muted">The address is sent once to Google to get a map position, then kept only on this device.</p>
        </div>
      )}
      {value && <p className="text-sm text-ok">Home: {value.name}{value.address && value.name !== value.address ? ` · ${value.address}` : ""}</p>}
    </div>
  );
}
