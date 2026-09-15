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
import { assignCourseColors } from "@/lib/courseColors";
import { parseRawLocation } from "@/rooms/roomParser";
import { formatMinutesOfDay } from "@/time/toronto";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Reveal } from "@/components/ui/reveal";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/nav/PageHeader";
import { SettingsSheet } from "@/components/plan/SettingsSheet";
import { CourseColorPicker } from "./CourseColorPicker";
import { Timetable } from "./Timetable";

/**
 * The student's academic profile. Everything on this page comes from the schedule already saved
 * to their account: this is a second view of it, never a second copy. Course titles fall back to
 * a small reference set only where the import had none.
 */
export function CoursesView() {
  const router = useRouter();
  const { state, hydrated, setCourseColor } = useStore();
  const account = useUserState();
  const auth = useAuth();
  const settled = account.status === "ready" || account.status === "local" || account.status === "offline";
  const meetings = state.schedule?.meetings;
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    if (hydrated && settled && !meetings?.length) router.replace("/setup");
  }, [hydrated, settled, meetings, router]);

  const courses = useMemo(() => groupCourses(meetings ?? []), [meetings]);
  const colors = useMemo(() => assignCourseColors(courses.map((c) => c.key), state.courseColors), [courses, state.courseColors]);
  const [selected, setSelected] = useState<string | undefined>();
  const term = termLabel(state.schedule?.term);
  const name = displayName(auth.user?.email);
  const laurierCount = courses.filter((c) => c.university === "WLU").length;
  const needsInfo = courses.filter((c) => c.needsLaurierInfo).length;

  const showCourse = (key: string) => {
    setSelected(key);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    requestAnimationFrame(() => document.getElementById(`course-${key}`)?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" }));
  };

  if (account.status === "loading" || !hydrated) return <AccountLoading />;
  if (account.status === "error" && !meetings?.length) return <AccountLoadError />;

  return (
    <>
      <PageHeader title="Courses" onOpenSettings={() => setSettingsOpen(true)} initial={auth.user?.email?.[0]} />
      <main className="app mx-auto w-full max-w-5xl px-4 pb-[calc(env(safe-area-inset-bottom)+4rem)] sm:px-6">
        <div className="pt-4 empty:hidden"><AccountSyncNotice /></div>

        <Reveal step={30} duration={300}>
          <div data-reveal className="pt-5">
            <h1 className="text-[20px] font-semibold leading-[26px] tracking-[-0.01em]">Your courses</h1>
            <p className="mt-0.5 text-[15px] leading-[22px] text-ink-muted">
              {[name, term, `${courses.length} course${courses.length === 1 ? "" : "s"}`].filter(Boolean).join(" · ")}
              {laurierCount > 0 && ` · ${laurierCount} at Laurier`}
            </p>
          </div>

          <div data-reveal className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
            <Button asChild size="touch">
              <Link href="/setup?replace=1"><Pencil /> Update schedule</Link>
            </Button>
            {needsInfo > 0 && (
              <span className="inline-flex items-center gap-1.5 text-[14px] leading-5 text-warn">
                <TriangleAlert className="size-4 shrink-0" aria-hidden="true" />
                {needsInfo} Laurier course{needsInfo === 1 ? "" : "s"} missing a room or professor
              </span>
            )}
          </div>

          <section data-reveal className="mt-6">
            <h2 className="text-[15px] font-semibold leading-5">Your timetable</h2>
            <div className="mt-3">
              <Timetable meetings={meetings ?? []} colors={colors} onColorChange={setCourseColor} onShowCourse={showCourse} />
            </div>
          </section>

          <ul className="mt-8 divide-y divide-line border-y border-line">
            {courses.map((c) => (
              <li
                key={c.key}
                data-reveal
                id={`course-${c.key}`}
                className={cn("scroll-mt-20 py-3", selected === c.key && "bg-brand/[0.045] shadow-[inset_3px_0_0_0_var(--color-brand)]")}
              >
                <div className="flex items-center gap-1">
                  <Popover>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        aria-label={`Colour for ${c.code}`}
                        className="-ml-2.5 grid size-11 shrink-0 touch-manipulation place-items-center rounded-full outline-none transition-colors duration-150 hover:bg-fill focus-visible:ring-2 focus-visible:ring-brand"
                      >
                        <span aria-hidden="true" className="size-3.5 rounded-full" style={{ backgroundColor: colors.get(c.key)?.rail }} />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent align="start" className="w-auto max-w-[17rem]">
                      <p className="mb-2 text-[13px] font-medium leading-[18px]">Colour for {c.code}</p>
                      <CourseColorPicker value={colors.get(c.key)?.id} courseLabel={c.code} onChange={(color) => setCourseColor(c.key, color)} />
                    </PopoverContent>
                  </Popover>
                  <button
                    type="button"
                    onClick={() => setSelected((k) => (k === c.key ? undefined : c.key))}
                    aria-expanded={selected === c.key}
                    className="flex min-h-11 min-w-0 flex-1 touch-manipulation items-center justify-between gap-3 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-brand"
                  >
                    <h2 className="text-[16px] font-semibold leading-[22px]">{c.code}</h2>
                    {c.university === "WLU" && <Badge variant="wlu">Laurier{c.laurierCode ? ` · ${c.laurierCode}` : ""}</Badge>}
                  </button>
                </div>

                <div className="pl-[38px]">
                  {c.title && <p className="text-[14px] leading-5 text-ink-muted">{c.title}</p>}
                  {c.instructors.length > 0 && <p className="mt-0.5 text-[14px] leading-5 text-ink-muted">{c.instructors.join(", ")}</p>}

                  <ul className="mt-2 space-y-1 text-[14px] leading-5">
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
                    <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[14px] leading-5">
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
                    <p className="mt-2 text-[13px] leading-[18px] text-warn">
                      Quest does not carry Laurier rooms or professors. Add them with an optional LORIS import from Update schedule.
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Reveal>
      </main>
      <SettingsSheet open={settingsOpen} onOpenChange={setSettingsOpen} />
    </>
  );
}
