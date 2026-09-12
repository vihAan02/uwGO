"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Pencil, TriangleAlert } from "lucide-react";
import { useStore } from "@/lib/store";
import { useAuth } from "@/lib/auth/AuthProvider";
import { useUserState } from "@/lib/UserStateProvider";
import { AccountLoadError, AccountLoading, AccountSyncNotice } from "@/components/account/AccountGate";
import { groupCourses, displayName, termLabel } from "@/lib/courses";
import { normalizeCourseCode } from "@/domain/laurier";
import { parseRawLocation } from "@/rooms/roomParser";
import { formatMinutesOfDay } from "@/time/toronto";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Reveal } from "@/components/ui/reveal";
import { Wordmark } from "@/components/ui/wordmark";
import { cn } from "@/lib/utils";
import { AppTabs } from "@/components/nav/AppTabs";
import { Timetable } from "./Timetable";

/**
 * The student's academic profile. Everything on this page comes from the schedule already saved
 * to their account: this is a second view of it, never a second copy. Course titles fall back to
 * a small reference set only where the import had none.
 */
export function CoursesView() {
  const router = useRouter();
  const { state, hydrated } = useStore();
  const account = useUserState();
  const auth = useAuth();
  const settled = account.status === "ready" || account.status === "local" || account.status === "offline";
  const meetings = state.schedule?.meetings;

  useEffect(() => {
    if (hydrated && settled && !meetings?.length) router.replace("/setup");
  }, [hydrated, settled, meetings, router]);

  const courses = useMemo(() => groupCourses(meetings ?? []), [meetings]);
  const [selected, setSelected] = useState<string | undefined>();
  const term = termLabel(state.schedule?.term);
  const name = displayName(auth.user?.email);
  const laurierCount = courses.filter((c) => c.university === "WLU").length;
  const needsInfo = courses.filter((c) => c.needsLaurierInfo).length;

  if (account.status === "loading" || !hydrated) return <AccountLoading />;
  if (account.status === "error" && !meetings?.length) return <AccountLoadError />;

  return (
    <main className="app mx-auto w-full max-w-3xl px-4 pb-16 sm:px-6">
      <header className="sticky top-0 z-10 -mx-4 border-b border-line bg-canvas/90 px-4 backdrop-blur sm:-mx-6 sm:px-6">
        <div className="flex h-14 items-center justify-between gap-2">
          <Wordmark />
          <AppTabs />
        </div>
      </header>

      <div className="pt-4 empty:hidden"><AccountSyncNotice /></div>

      <Reveal step={70}>
        <div data-reveal className="pt-6">
          <h1 className="text-[1.75rem] font-semibold leading-tight tracking-[-0.02em]">Your courses</h1>
          <p className="mt-1 text-ink-muted">
            {[name, term, `${courses.length} course${courses.length === 1 ? "" : "s"}`].filter(Boolean).join(" · ")}
            {laurierCount > 0 && ` · ${laurierCount} at Laurier`}
          </p>
        </div>

        <div data-reveal className="mt-4 flex flex-wrap items-center gap-2">
          <Button asChild size="sm">
            <Link href="/setup?replace=1"><Pencil /> Update schedule</Link>
          </Button>
          {needsInfo > 0 && (
            <span className="inline-flex items-center gap-1.5 text-sm text-warn">
              <TriangleAlert className="size-4" aria-hidden="true" />
              {needsInfo} Laurier course{needsInfo === 1 ? "" : "s"} missing a room or professor
            </span>
          )}
        </div>

        <section data-reveal className="mt-6">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Your week</h2>
          <div className="mt-3"><Timetable meetings={meetings ?? []} onSelect={(m) => setSelected(normalizeCourseCode(m.courseCode))} /></div>
        </section>

        <ul className="mt-8 divide-y divide-line border-t border-line">
          {courses.map((c) => (
            <li
              key={c.key}
              data-reveal
              id={`course-${c.key}`}
              className={cn("py-4", selected === c.key && "bg-brand/[0.045] shadow-[inset_3px_0_0_0_var(--color-brand)]")}
            >
              <button
                type="button"
                onClick={() => setSelected((k) => (k === c.key ? undefined : c.key))}
                aria-expanded={selected === c.key}
                className="flex w-full items-baseline justify-between gap-3 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-brand/35"
              >
                <h2 className="text-lg font-bold leading-tight tracking-[-0.01em]">{c.code}</h2>
                {c.university === "WLU" && <Badge variant="wlu">Laurier{c.laurierCode ? ` · ${c.laurierCode}` : ""}</Badge>}
              </button>
              {c.title && <p className="text-sm text-ink-muted">{c.title}</p>}
              {c.instructors.length > 0 && <p className="mt-1 text-sm text-ink-muted">{c.instructors.join(", ")}</p>}

              <ul className="mt-2 space-y-1 text-sm">
                {c.meetings.map((m) => {
                  const room = parseRawLocation(m.location, m.university);
                  const where = m.location.kind === "ROOM" ? `${m.location.buildingCode} ${m.location.roomNumber}` : m.location.kind === "ONLINE" ? "Online" : "Room to be announced";
                  return (
                    <li key={m.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span className="font-medium">{m.component}{m.section ? ` ${m.section}` : ""}</span>
                      <span className="text-ink-muted">
                        {m.unscheduled ? "No scheduled time" : `${m.days.join("")} ${formatMinutesOfDay(m.start)}–${formatMinutesOfDay(m.end)}`}
                      </span>
                      <span className="text-ink-muted">· {where}{room?.buildingName ? ` · ${room.buildingName}` : ""}</span>
                    </li>
                  );
                })}
              </ul>

              {selected === c.key && (
                <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm">
                  <dt className="text-ink-muted">Campus</dt>
                  <dd>{c.university === "WLU" ? "Wilfrid Laurier" : "University of Waterloo"}</dd>
                  {c.laurierCode && <><dt className="text-ink-muted">Laurier code</dt><dd>{c.laurierCode}</dd></>}
                  {c.title && <><dt className="text-ink-muted">Title</dt><dd>{c.title}</dd></>}
                  <dt className="text-ink-muted">Sections</dt>
                  <dd>{c.meetings.map((m) => `${m.component}${m.section ? ` ${m.section}` : ""}`).join(", ")}</dd>
                  <dt className="text-ink-muted">Instructor</dt>
                  <dd>{c.instructors.length ? c.instructors.join(", ") : "Not known"}</dd>
                </dl>
              )}

              {c.needsLaurierInfo && (
                <p className="mt-2 text-xs text-warn">
                  Quest does not carry Laurier rooms or professors. Add them with an optional LORIS import from Update schedule.
                </p>
              )}
            </li>
          ))}
        </ul>
      </Reveal>
    </main>
  );
}
