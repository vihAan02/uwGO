"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import type { CourseMeeting, GymPreferences, ParsedSchedule, UserHome } from "@/domain/types";
import { questParser } from "@/parsers/quest/QuestParser";
import { useStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Reveal } from "@/components/ui/reveal";
import { Wordmark } from "@/components/ui/wordmark";
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

/** One numbered group, in the landing page's 01 / 02 / 03 idiom. Hairlines separate them; no cards. */
function Step({ n, title, hint, children, ...rest }: { n: string; title: string; hint?: string; children: React.ReactNode } & React.ComponentProps<"section">) {
  return (
    <section className="py-8 first:pt-0" {...rest}>
      <div className="flex items-baseline gap-3">
        <span className="w-5 shrink-0 font-mono text-xs tracking-wider text-ink-muted" aria-hidden="true">{n}</span>
        <h2 className="text-[1.0625rem] font-semibold tracking-[-0.01em]">{title}</h2>
      </div>
      {hint && <p className="mt-1 text-sm text-ink-muted sm:pl-8">{hint}</p>}
      <div className="mt-4 sm:pl-8">{children}</div>
    </section>
  );
}

function OnboardingForm({ initialHome, initialBuffer, initialGym }: { initialHome: UserHome | undefined; initialBuffer: number; initialGym: GymPreferences | undefined }) {
  const router = useRouter();
  const { setSchedule, addMeeting, setHome, setConfig, setGym } = useStore();
  const [gym, setLocalGym] = useState<GymPreferences | undefined>(initialGym);
  const [parsed, setParsed] = useState<ParsedSchedule | undefined>();
  const [manual, setManual] = useState<CourseMeeting[]>([]);
  const [home, setLocalHome] = useState<UserHome | undefined>(initialHome);
  const [buffer, setBuffer] = useState(initialBuffer);

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
    <main className="app mx-auto w-full max-w-xl px-5 pb-40 sm:px-6">
      <header className="flex h-14 items-center">
        <Wordmark href="/" />
      </header>

      <Reveal step={60}>
        <div data-reveal className="mt-6 sm:mt-10">
          <h1 className="text-[2rem] font-semibold leading-[1.1] tracking-[-0.025em] sm:text-[2.5rem]">Paste your schedule.</h1>
          <p className="mt-3 max-w-md text-[1.0625rem] leading-relaxed text-ink-muted">
            UW GO turns it into your week: the buildings, the walks, and the minute to leave for each class.
          </p>
        </div>

        <div className="mt-10 divide-y divide-line">
          <Step n="01" title="Your Quest schedule" data-reveal>
            <PasteStep onText={(text) => setParsed(text.trim() ? questParser.parse(text) : undefined)} />
            {parsed && <ParsePreview parsed={parsed} />}

            {manual.length > 0 && (
              <ul className="mt-4 divide-y divide-line">
                {manual.map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <span>
                      <span className="font-semibold">{m.courseCode}</span> {m.component} · {m.days.join("")} · {m.location.kind === "ROOM" ? `${m.location.buildingCode} ${m.location.roomNumber}` : ""}
                    </span>
                    <Button variant="ghost" size="xs" className="text-ink-muted" onClick={() => setManual((list) => list.filter((x) => x.id !== m.id))}>
                      <X /> Remove
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <details className="group mt-4">
              <summary className="flex min-h-9 cursor-pointer list-none items-center gap-1.5 text-sm font-medium text-brand [&::-webkit-details-marker]:hidden">
                <Plus className="size-4 transition-transform group-open:rotate-45" />
                Add a Laurier class by hand
              </summary>
              <p className="mt-1 text-sm text-ink-muted">Laurier uses LORIS, which has no paste import yet. Laurier (or any extra) classes go in here.</p>
              <div className="mt-3">
                <ManualClassForm defaultUniversity="WLU" onAdd={(m) => { setManual((list) => (list.some((x) => x.id === m.id) ? list : [...list, m])); }} />
              </div>
            </details>
          </Step>

          <Step n="02" title="Where you live" data-reveal>
            <HomePicker value={home} onChange={setLocalHome} />
          </Step>

          <Step n="03" title="Arrival buffer" hint="How early you want to be at the door." data-reveal>
            <BufferPicker value={buffer} onChange={setBuffer} />
          </Step>

          <Step n="04" title="Gym" data-reveal>
            <GymPrefsPicker value={gym} onChange={setLocalGym} />
          </Step>
        </div>
      </Reveal>

      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-canvas/90 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur">
        <div className="mx-auto max-w-xl px-5 sm:px-6">
          <Button size="lg" className="w-full" disabled={!canBuild} onClick={build}>Build my routes</Button>
          <p className="mt-2 min-h-4 text-center text-xs text-ink-muted">
            {canBuild ? "" : meetings.length ? "Choose where you live to continue." : "Paste a schedule or add a class to continue."}
          </p>
        </div>
      </div>
    </main>
  );
}
