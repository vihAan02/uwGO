"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { CourseMeeting, GymPreferences, ParsedSchedule, UserHome } from "@/domain/types";
import { questParser } from "@/parsers/quest/QuestParser";
import { useStore } from "@/lib/store";
import { PasteStep } from "./PasteStep";
import { ParsePreview } from "./ParsePreview";
import { ManualClassForm } from "./ManualClassForm";
import { HomePicker } from "./HomePicker";
import { BufferPicker } from "./BufferPicker";
import { GymPrefsPicker } from "../prefs/GymPrefsPicker";

export function Onboarding() {
  const router = useRouter();
  const { state, hydrated } = useStore();
  useEffect(() => {
    if (hydrated && state.schedule?.meetings.length) router.replace("/plan");
  }, [hydrated, state.schedule, router]);
  if (!hydrated) return null;
  return <OnboardingForm key="form" initialHome={state.home} initialBuffer={state.config.arrivalBufferMinutes} initialGym={state.gym} />;
}

function OnboardingForm({ initialHome, initialBuffer, initialGym }: { initialHome: UserHome | undefined; initialBuffer: number; initialGym: GymPreferences | undefined }) {
  const router = useRouter();
  const { setSchedule, addMeeting, setHome, setConfig, setGym } = useStore();
  const [gym, setLocalGym] = useState<GymPreferences | undefined>(initialGym);
  const [parsed, setParsed] = useState<ParsedSchedule | undefined>();
  const [manual, setManual] = useState<CourseMeeting[]>([]);
  const [home, setLocalHome] = useState<UserHome | undefined>(initialHome);
  const [buffer, setBuffer] = useState(initialBuffer);
  const [showManual, setShowManual] = useState(false);

  const meetings = [...(parsed?.meetings ?? []), ...manual];
  const canBuild = meetings.some((m) => m.includeInPlan) && Boolean(home);

  const build = () => {
    if (!canBuild) return;
    setSchedule(parsed?.meetings ?? [], parsed?.term, parsed ? "QUEST" : "MANUAL");
    for (const m of manual) addMeeting(m);
    setHome(home);
    setConfig({ arrivalBufferMinutes: buffer });
    setGym(gym ?? { enabled: false, durationMinutes: 60, preferredTime: "NONE" });
    router.push("/plan");
  };

  return (
    <main className="mx-auto w-full max-w-xl px-4 pb-32 pt-8">
      <header className="mb-6">
        <p className="text-sm font-semibold uppercase tracking-wide text-brand">UW GO</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">Never wonder when to leave.</h1>
        <p className="mt-2 text-ink-muted">Paste your Quest schedule. Get a day-by-day plan: when to leave, where the room is, walk or bus, and whether you can go home between classes.</p>
      </header>

      <section className="card p-4">
        <h2 className="text-lg font-semibold">1. Paste your schedule</h2>
        <PasteStep onText={(text) => setParsed(text.trim() ? questParser.parse(text) : undefined)} />
        {parsed && <ParsePreview parsed={parsed} />}
      </section>

      <section className="card mt-4 p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Laurier classes</h2>
          <button className="btn btn-ghost px-2 py-1 min-h-0" onClick={() => setShowManual((v) => !v)}>{showManual ? "Hide" : "Add"}</button>
        </div>
        <p className="mt-1 text-sm text-ink-muted">Laurier uses LORIS, which has no paste import yet. Add Laurier (or any extra) classes by hand.</p>
        {manual.length > 0 && (
          <ul className="mt-3 space-y-2">
            {manual.map((m) => (
              <li key={m.id} className="flex items-center justify-between rounded-xl bg-wlu-soft px-3 py-2 text-sm">
                <span><span className="font-semibold">{m.courseCode}</span> {m.component} · {m.days.join("")} · {m.location.kind === "ROOM" ? `${m.location.buildingCode} ${m.location.roomNumber}` : ""}</span>
                <button className="text-bad" onClick={() => setManual((list) => list.filter((x) => x.id !== m.id))}>Remove</button>
              </li>
            ))}
          </ul>
        )}
        {showManual && <ManualClassForm defaultUniversity="WLU" onAdd={(m) => { setManual((list) => (list.some((x) => x.id === m.id) ? list : [...list, m])); }} />}
      </section>

      <section className="card mt-4 p-4">
        <h2 className="text-lg font-semibold">2. Where do you live?</h2>
        <HomePicker value={home} onChange={setLocalHome} />
      </section>

      <section className="card mt-4 p-4">
        <h2 className="text-lg font-semibold">3. Arrival buffer</h2>
        <p className="mt-1 text-sm text-ink-muted">How early you want to be at the door.</p>
        <BufferPicker value={buffer} onChange={setBuffer} />
      </section>

      <section className="card mt-4 p-4">
        <h2 className="text-lg font-semibold">4. Gym</h2>
        <GymPrefsPicker value={gym} onChange={setLocalGym} />
      </section>

      <div className="fixed inset-x-0 bottom-0 border-t border-line bg-surface/95 p-4 backdrop-blur">
        <div className="mx-auto max-w-xl">
          <button className="btn btn-primary w-full text-lg" disabled={!canBuild} onClick={build}>Build my routes</button>
          {!canBuild && <p className="mt-2 text-center text-xs text-ink-muted">{meetings.length ? "Choose where you live to continue." : "Paste a schedule or add a class to continue."}</p>}
        </div>
      </div>
    </main>
  );
}
