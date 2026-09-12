"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import type { CourseMeeting, GymPreferences, ParsedSchedule, UserHome } from "@/domain/types";
import { laurierEnrichmentNeeded } from "@/domain/laurier";
import { questParser } from "@/parsers/quest/QuestParser";
import type { LaurierRecord } from "@/parsers/loris/LorisParser";
import { mergeLaurier } from "@/parsers/loris/merge";
import Link from "next/link";
import { useStore } from "@/lib/store";
import { useUserState } from "@/lib/UserStateProvider";
import { AccountLoadError, AccountLoading } from "@/components/account/AccountGate";
import { Button } from "@/components/ui/button";
import { Reveal } from "@/components/ui/reveal";
import { Wordmark } from "@/components/ui/wordmark";
import { PasteStep } from "./PasteStep";
import { LorisStep } from "./LorisStep";
import { ParsePreview } from "./ParsePreview";
import { ManualClassForm } from "./ManualClassForm";
import { HomePicker } from "./HomePicker";
import { BufferPicker } from "./BufferPicker";
import { GymPrefsPicker } from "../prefs/GymPrefsPicker";

/**
 * `replace`: pasting a new schedule over an existing one, from Settings. Otherwise a student who
 * already has a schedule (on this device or in their account) goes straight to the plan.
 */
export function Onboarding({ replace = false }: { replace?: boolean }) {
  const router = useRouter();
  const { state, hydrated } = useStore();
  const account = useUserState();
  const hasSchedule = Boolean(state.schedule?.meetings.length);
  const settled = account.status === "ready" || account.status === "local" || account.status === "offline";
  // After a failed read, a device that already has a schedule is still usable.
  const usable = settled || (account.status === "error" && hasSchedule);
  useEffect(() => {
    if (hydrated && usable && hasSchedule && !replace) router.replace("/plan");
  }, [hydrated, usable, hasSchedule, replace, router]);

  if (!hydrated || account.status === "loading") return <AccountLoading />;
  if (!usable) return <AccountLoadError />;
  if (hasSchedule && !replace) return <AccountLoading />;
  return <OnboardingForm key="form" replace={replace} initialHome={state.home} initialBuffer={state.config.arrivalBufferMinutes} initialGym={state.gym} />;
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

function OnboardingForm({ replace, initialHome, initialBuffer, initialGym }: { replace: boolean; initialHome: UserHome | undefined; initialBuffer: number; initialGym: GymPreferences | undefined }) {
  const router = useRouter();
  const { setSchedule, addMeeting, setHome, setConfig, setGym } = useStore();
  const [gym, setLocalGym] = useState<GymPreferences | undefined>(initialGym);
  const [parsed, setParsed] = useState<ParsedSchedule | undefined>();
  const [laurier, setLaurier] = useState<LaurierRecord[]>([]);
  const [manual, setManual] = useState<CourseMeeting[]>([]);
  const [home, setLocalHome] = useState<UserHome | undefined>(initialHome);
  const [buffer, setBuffer] = useState(initialBuffer);

  // Quest creates every course, Laurier ones included. A LORIS paste only fills in the professor
  // and the Laurier room on courses that already exist, so it is folded in here rather than
  // adding anything of its own.
  const questMeetings = useMemo(() => mergeLaurier(parsed?.meetings ?? [], laurier).meetings, [parsed, laurier]);
  const meetings = [...questMeetings, ...manual];
  const laurierNeeding = questMeetings.filter((m) => laurierEnrichmentNeeded(m).any).length;
  const canBuild = meetings.some((m) => m.includeInPlan) && Boolean(home);

  const build = () => {
    if (!canBuild) return;
    setSchedule(questMeetings, parsed?.term, parsed ? "QUEST" : "MANUAL");
    for (const m of manual) addMeeting(m);
    setHome(home);
    setConfig({ arrivalBufferMinutes: buffer });
    setGym(gym ?? { enabled: false, durationMinutes: 60, preferredTime: "NONE" });
    router.replace("/plan");
  };

  return (
    <main className="app mx-auto w-full max-w-xl px-5 pb-40 sm:px-6">
      <header className="flex h-14 items-center justify-between">
        <Wordmark href="/setup" />
        {replace && (
          <Button asChild variant="ghost" size="sm" className="-mr-3">
            <Link href="/plan">Cancel</Link>
          </Button>
        )}
      </header>

      <Reveal step={60}>
        <div data-reveal className="mt-6 sm:mt-10">
          <h1 className="text-[2rem] font-semibold leading-[1.1] tracking-[-0.025em] sm:text-[2.5rem]">{replace ? "Paste your new schedule." : "Paste your schedule."}</h1>
          <p className="mt-3 max-w-md text-[1.0625rem] leading-relaxed text-ink-muted">
            {replace
              ? "It replaces the classes from your last paste. Classes you added by hand stay."
              : "UW GO turns it into your week: the buildings, the walks, and the minute to leave for each class."}
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
                Add a class by hand
              </summary>
              <p className="mt-1 text-sm text-ink-muted">For anything Quest could not give us. Your Laurier courses are already in your Quest paste.</p>
              <div className="mt-3">
                <ManualClassForm defaultUniversity="WLU" onAdd={(m) => { setManual((list) => (list.some((x) => x.id === m.id) ? list : [...list, m])); }} />
              </div>
            </details>
          </Step>

          <Step n="02" title="Laurier details" hint="Optional. Only if you take Laurier courses and want their room and professor." data-reveal>
            <LorisStep onRecords={setLaurier} needing={laurierNeeding} />
          </Step>

          <Step n="03" title="Where you live" data-reveal>
            <HomePicker value={home} onChange={setLocalHome} />
          </Step>

          <Step n="04" title="Arrival buffer" hint="How early you want to be at the door." data-reveal>
            <BufferPicker value={buffer} onChange={setBuffer} />
          </Step>

          <Step n="05" title="Gym" data-reveal>
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
