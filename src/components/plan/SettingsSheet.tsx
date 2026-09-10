"use client";
import { useRouter } from "next/navigation";
import { useStore } from "@/lib/store";
import { useAuth } from "@/lib/auth/AuthProvider";
import { HomePicker } from "../onboarding/HomePicker";
import { BufferPicker } from "../onboarding/BufferPicker";
import { ManualClassForm } from "../onboarding/ManualClassForm";
import { GymPrefsPicker } from "../prefs/GymPrefsPicker";
import { RoutePrefPicker } from "../prefs/RoutePrefPicker";

export function SettingsSheet({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const { state, setHome, setConfig, setGym, setRoutePreference, setIncludeInPlan, removeMeeting, addMeeting, reset } = useStore();
  const auth = useAuth();
  const meetings = state.schedule?.meetings ?? [];
  return (
    <div className="fixed inset-0 z-20 flex items-end justify-center bg-ink/40" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-t-2xl bg-canvas p-4 pb-10" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Settings</h2>
          <button className="btn btn-secondary px-3 py-1 min-h-0 text-sm" onClick={onClose}>Done</button>
        </div>

        {auth.user && (
          <section className="card mt-4 flex items-center justify-between gap-3 p-4">
            <div className="min-w-0">
              <h3 className="font-semibold">Account</h3>
              <p className="truncate text-sm text-ink-muted">{auth.user.email}{auth.mode === "DEV_BYPASS" ? " (dev bypass)" : ""}</p>
            </div>
            <button className="btn btn-secondary shrink-0 px-3 py-2 min-h-0 text-sm" onClick={() => void auth.signOut()}>Log out</button>
          </section>
        )}

        <section className="card mt-4 p-4">
          <h3 className="font-semibold">Where you live</h3>
          <HomePicker value={state.home} onChange={setHome} />
        </section>

        <section className="card mt-4 p-4">
          <h3 className="font-semibold">Arrival buffer</h3>
          <BufferPicker value={state.config.arrivalBufferMinutes} onChange={(v) => setConfig({ arrivalBufferMinutes: v })} />
        </section>

        <section className="card mt-4 p-4">
          <h3 className="font-semibold">Route preference</h3>
          <RoutePrefPicker value={state.routePreference ?? "FASTEST"} onChange={setRoutePreference} />
        </section>

        <section className="card mt-4 p-4">
          <h3 className="font-semibold">Gym</h3>
          <GymPrefsPicker value={state.gym} onChange={setGym} />
        </section>

        <section className="card mt-4 p-4">
          <h3 className="font-semibold">Classes</h3>
          <ul className="mt-2 divide-y divide-line">
            {meetings.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={m.includeInPlan} onChange={(e) => setIncludeInPlan(m.id, e.target.checked)} />
                  <span><span className="font-semibold">{m.courseCode}</span> {m.component}{m.section ? ` ${m.section}` : ""} · {m.days.join("") || "no time"} · {m.location.kind === "ROOM" ? `${m.location.buildingCode} ${m.location.roomNumber}` : m.location.kind.toLowerCase()}</span>
                </label>
                {m.source === "MANUAL" && <button className="text-bad" onClick={() => removeMeeting(m.id)}>Remove</button>}
              </li>
            ))}
          </ul>
          <details className="mt-3">
            <summary className="cursor-pointer text-sm font-medium text-brand">Add a class by hand</summary>
            <ManualClassForm defaultUniversity="WLU" onAdd={addMeeting} />
          </details>
        </section>

        <section className="card mt-4 p-4">
          <h3 className="font-semibold">Start over</h3>
          <p className="mt-1 text-sm text-ink-muted">Removes the schedule and home from this device.</p>
          <button className="btn btn-secondary mt-3 w-full text-bad" onClick={() => { if (confirm("Delete your schedule and home from this device?")) { reset(); router.replace("/"); } }}>Delete everything</button>
        </section>

        <p className="mt-4 text-xs text-ink-muted">Building data: University of Waterloo campus map (used as-is) and Wilfrid Laurier University pages. Laurier coordinates © OpenStreetMap contributors (ODbL). Routes and maps by Google. PAC hours and live occupancy from Waterloo Athletics; indoor connections from the UW Campus Accessibility building pages.</p>
      </div>
    </div>
  );
}
