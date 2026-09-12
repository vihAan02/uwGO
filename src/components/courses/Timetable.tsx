"use client";
import { useMemo } from "react";
import type { CourseMeeting, DayOfWeek } from "@/domain/types";
import { DAY_LABELS, DAYS_IN_ORDER } from "@/domain/types";
import { blockGeometry, dayBounds, HOUR_HEIGHT, hourMarks, layoutDay, type TimetableEvent } from "@/lib/timetable";
import { formatCourseCode } from "@/data/courses/metadata";
import { formatMinutesOfDay } from "@/time/toronto";
import { cn } from "@/lib/utils";

/**
 * The week as a timetable.
 *
 * One geometry constant drives the grid and the blocks, so a class's height is its real
 * duration. Overlapping classes share their group's width rather than hiding each other. On a
 * phone the grid is not shrunk until it is unreadable: the same week is shown a day at a time,
 * with the same blocks, because five columns on a 375px screen is not a timetable.
 */

interface Block extends TimetableEvent {
  meeting: CourseMeeting;
}

const roomOf = (m: CourseMeeting): string =>
  m.location.kind === "ROOM" ? `${m.location.buildingCode} ${m.location.roomNumber}` : m.location.kind === "ONLINE" ? "Online" : "Room TBA";

/** Colour by course, so every meeting of one course reads as the same thing. */
const TONES = [
  "bg-brand/10 border-brand/40 text-ink",
  "bg-ok-soft border-ok/40 text-ink",
  "bg-warn-soft border-warn/40 text-ink",
  "bg-wlu-soft border-wlu/40 text-ink",
  "bg-line/70 border-line text-ink",
] as const;

function toneFor(courseCode: string, order: string[]): string {
  const i = order.indexOf(courseCode);
  return TONES[(i < 0 ? 0 : i) % TONES.length];
}

function blocksByDay(meetings: readonly CourseMeeting[]): Record<DayOfWeek, Block[]> {
  const byDay = { M: [], T: [], W: [], Th: [], F: [], S: [], Su: [] } as Record<DayOfWeek, Block[]>;
  for (const m of meetings) {
    if (m.unscheduled || m.days.length === 0 || m.end <= m.start) continue;
    for (const d of m.days) byDay[d].push({ id: `${m.id}:${d}`, start: m.start, end: m.end, meeting: m });
  }
  return byDay;
}

function BlockCard({ b, tone, compact }: { b: Block; tone: string; compact?: boolean }) {
  const m = b.meeting;
  return (
    <div className={cn("h-full overflow-hidden rounded-lg border px-1.5 py-1 text-[11px] leading-tight", tone)}>
      <div className="truncate font-bold">{formatCourseCode(m.courseCode)}</div>
      <div className="truncate opacity-80">{m.component}{m.section ? ` ${m.section}` : ""}</div>
      <div className="truncate opacity-80">{roomOf(m)}</div>
      {compact && <div className="truncate opacity-80">{formatMinutesOfDay(m.start)}–{formatMinutesOfDay(m.end)}</div>}
    </div>
  );
}

export function Timetable({ meetings, onSelect }: { meetings: readonly CourseMeeting[]; onSelect?: (m: CourseMeeting) => void }) {
  const byDay = useMemo(() => blocksByDay(meetings), [meetings]);
  const all = useMemo(() => Object.values(byDay).flat(), [byDay]);
  const bounds = useMemo(() => dayBounds(all), [all]);
  const order = useMemo(() => [...new Set(meetings.map((m) => m.courseCode))].sort(), [meetings]);

  // Weekdays always; a weekend column only when something is actually on.
  const days = useMemo(
    () => DAYS_IN_ORDER.filter((d) => ["M", "T", "W", "Th", "F"].includes(d) || byDay[d].length > 0),
    [byDay],
  );
  const unscheduled = useMemo(() => meetings.filter((m) => m.unscheduled || m.days.length === 0), [meetings]);
  const gridHeight = ((bounds.to - bounds.from) / 60) * HOUR_HEIGHT;
  const marks = hourMarks(bounds);

  if (all.length === 0 && unscheduled.length === 0) {
    return <p className="py-8 text-center text-sm text-ink-muted">No scheduled classes to show.</p>;
  }

  return (
    <div>
      {/* Grid: tablet and up. */}
      <div className="hidden md:block">
        <div className="grid" style={{ gridTemplateColumns: `3.25rem repeat(${days.length}, minmax(0, 1fr))` }}>
          <div aria-hidden="true" />
          {days.map((d) => (
            <div key={d} className="pb-2 text-center text-xs font-semibold text-ink-muted">{DAY_LABELS[d]}</div>
          ))}

          <div className="relative" style={{ height: gridHeight }}>
            {marks.map((m) => (
              <div key={m} className="absolute -translate-y-1/2 pr-2 text-right text-[11px] tabular-nums text-ink-muted" style={{ top: ((m - bounds.from) / 60) * HOUR_HEIGHT, right: 0 }}>
                {formatMinutesOfDay(m)}
              </div>
            ))}
          </div>

          {days.map((d) => {
            const placed = layoutDay(byDay[d]);
            return (
              <div key={d} className="relative border-l border-line" style={{ height: gridHeight }}>
                {marks.map((m) => (
                  <div key={m} className="absolute inset-x-0 border-t border-line/70" style={{ top: ((m - bounds.from) / 60) * HOUR_HEIGHT }} aria-hidden="true" />
                ))}
                {placed.map(({ item, column, columns }) => {
                  const { top, height } = blockGeometry(item, bounds);
                  const width = 100 / columns;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onSelect?.(item.meeting)}
                      className="absolute p-px text-left outline-none focus-visible:ring-[3px] focus-visible:ring-brand/35"
                      style={{ top, height, left: `${column * width}%`, width: `${width}%` }}
                    >
                      <BlockCard b={item} tone={toneFor(item.meeting.courseCode, order)} />
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {/* Phone: the same week, a day at a time, at a size that can actually be read. */}
      <div className="space-y-4 md:hidden">
        {days.filter((d) => byDay[d].length > 0).map((d) => (
          <section key={d}>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{DAY_LABELS[d]}</h3>
            <ul className="mt-1.5 space-y-1.5">
              {[...byDay[d]].sort((a, b) => a.start - b.start).map((b) => (
                <li key={b.id}>
                  <button
                    type="button"
                    onClick={() => onSelect?.(b.meeting)}
                    className="flex w-full items-stretch gap-2 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-brand/35"
                  >
                    <span className="w-14 shrink-0 pt-1 text-right font-mono text-[11px] tabular-nums text-ink-muted">
                      {formatMinutesOfDay(b.start)}
                      <span className="block font-normal opacity-70">{formatMinutesOfDay(b.end)}</span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <BlockCard b={b} tone={toneFor(b.meeting.courseCode, order)} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      {unscheduled.length > 0 && (
        <p className="mt-4 text-xs text-ink-muted">
          Not on the timetable: {unscheduled.map((m) => `${formatCourseCode(m.courseCode)} ${m.component}`).join(", ")} (no scheduled time).
        </p>
      )}
    </div>
  );
}
