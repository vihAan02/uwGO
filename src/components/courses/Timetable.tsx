"use client";
import { Fragment, useMemo, useState, useSyncExternalStore, type CSSProperties } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { CourseMeeting } from "@/domain/types";
import { normalizeCourseCode } from "@/domain/laurier";
import { courseTitleFor, formatCourseCode } from "@/data/courses/metadata";
import { parseRawLocation } from "@/rooms/roomParser";
import { formatMinutesOfDay, todayISO } from "@/time/toronto";
import {
  calendarDay, formatDateRange, formatMonth, formatShortDate, fullWeek, hoursOfClass, initialAnchor, isOnTimetable, monthWeeks, stepAnchor, weekColumns,
  type CalendarDay, type CalendarView, type ClassOccurrence, type MonthCell,
} from "@/lib/calendar";
import {
  BLOCK_GAP, BLOCK_PADDING_Y, DETAIL_LINE, TITLE_LINE, blockGeometry, blockLines, formatHourLabel, formatShortTime, formatTimeRange, gridBounds, gridHeight,
  hourMarks, layoutDay, linesHeight, timeToY, type BlockLine, type GridBounds,
} from "@/lib/timetable";
import { BLOCK_TITLE_COLOR, COURSE_COLORS, type CourseColor, type CourseColorId } from "@/lib/courseColors";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SegmentedControl, SegmentedItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { CourseColorPicker } from "./CourseColorPicker";

/**
 * The student's timetable, as UW Flow draws one.
 *
 * Adapted from UW Flow's calendar (MIT, see THIRD_PARTY_NOTICES.md):
 * `src/components/calendar/Calendar.tsx` for the hour grid with its half-hour line, the pale
 * course block with a coloured rail, the text that truncates rather than wraps, and the
 * "Current Week" / previous / next header; `src/pages/profilePage/ProfileCalendar.tsx` for the
 * dated week it shows. The geometry, dates and colours are in `lib/timetable.ts`,
 * `lib/calendar.ts` and `lib/courseColors.ts`; this file only draws them.
 *
 * On a phone UW Flow squeezes five columns into the screen. This opens on the day instead, with
 * the week a tap away and scrolling sideways at a readable column width rather than shrinking.
 */

const NARROW_QUERY = "(max-width: 767px)";
/** Width of the hour-label gutter, in pixels. */
const GUTTER = 56;
/** Narrowest a day column gets before the week scrolls sideways instead: room for "LEC 009 · EV3 1408". */
const MIN_COLUMN = 128;

const VIEWS: { id: CalendarView; label: string }[] = [
  { id: "day", label: "Day" },
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
];
const CURRENT_LABEL: Record<CalendarView, string> = { day: "Today", week: "Current Week", month: "This Month" };

function subscribeNarrow(onChange: () => void) {
  const mq = window.matchMedia(NARROW_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}
const useNarrow = () => useSyncExternalStore(subscribeNarrow, () => window.matchMedia(NARROW_QUERY).matches, () => false);

const hoursText = (hours: number) => `${hours} hour${hours === 1 ? "" : "s"}`;
const sectionLabel = (m: CourseMeeting) => `${m.component}${m.section ? ` ${m.section}` : ""}`;

function roomLabel(m: CourseMeeting): string {
  if (m.location.kind === "ROOM") return `${m.location.buildingCode} ${m.location.roomNumber}`;
  if (m.location.kind === "ONLINE") return "Online";
  return m.university === "WLU" ? "Laurier · room TBA" : "Room TBA";
}

export interface TimetableProps {
  meetings: readonly CourseMeeting[];
  /** Every course's colour, keyed by canonical course code. */
  colors: ReadonlyMap<string, CourseColor>;
  onColorChange: (courseKey: string, color: CourseColorId) => void;
  /** Jump to the course in the list below. */
  onShowCourse?: (courseKey: string) => void;
}

type BlockActions = Pick<TimetableProps, "onColorChange" | "onShowCourse"> & { colorOf: (m: CourseMeeting) => CourseColor };

export function Timetable({ meetings, colors, onColorChange, onShowCourse }: TimetableProps) {
  const narrow = useNarrow();
  const [today] = useState(() => todayISO());
  const [chosenView, setChosenView] = useState<CalendarView>();
  // Week is the timetable; a phone opens on the day until the student picks otherwise.
  const view = chosenView ?? (narrow ? "day" : "week");
  const [anchor, setAnchor] = useState(() => initialAnchor(meetings, today));

  const timed = useMemo(() => meetings.filter(isOnTimetable), [meetings]);
  const unscheduled = useMemo(() => meetings.filter((m) => !isOnTimetable(m)), [meetings]);
  const bounds = useMemo(() => gridBounds(timed), [timed]);
  const actions: BlockActions = {
    colorOf: (m) => colors.get(normalizeCourseCode(m.courseCode)) ?? COURSE_COLORS[0],
    onColorChange,
    onShowCourse,
  };

  if (timed.length === 0 && unscheduled.length === 0) {
    return <p className="py-8 text-center text-sm text-ink-muted">No scheduled classes to show.</p>;
  }

  let title: string;
  let subtitle: string | undefined;
  let body: React.ReactNode;
  if (view === "week") {
    const days = weekColumns(meetings, anchor, today);
    const hours = hoursOfClass(days);
    title = formatDateRange(days[0].date, days[days.length - 1].date);
    subtitle = hours > 0 ? `(${hoursText(hours)} this week)` : "No classes this week";
    body = <TimeGrid days={days} bounds={bounds} actions={actions} />;
  } else if (view === "day") {
    const day = calendarDay(meetings, anchor, today);
    const hours = hoursOfClass([day]);
    title = formatDateRange(anchor, anchor);
    subtitle = hours > 0 ? `(${hoursText(hours)} of class)` : "No classes";
    body = (
      <>
        <DayStrip week={fullWeek(meetings, anchor, today)} selected={anchor} colorOf={actions.colorOf} onPick={setAnchor} />
        <TimeGrid days={[day]} bounds={bounds} actions={actions} showDayHeader={false} />
      </>
    );
  } else {
    title = formatMonth(anchor);
    body = (
      <MonthGrid
        weeks={monthWeeks(meetings, anchor, today)}
        colorOf={actions.colorOf}
        onPick={(date) => { setAnchor(date); setChosenView(narrow ? "day" : "week"); }}
      />
    );
  }

  return (
    <div>
      <div className="overflow-hidden rounded-2xl border border-line bg-surface">
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3 border-b border-line p-4">
          <div className="min-w-0" aria-live="polite">
            <h3 className="text-lg font-semibold leading-tight tracking-[-0.01em]">{title}</h3>
            {subtitle && <p className="text-sm text-ink-muted">{subtitle}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* The planner's segmented control: a white lift on a quiet track (DESIGN.md §7). */}
            <SegmentedControl value={view} onValueChange={(v) => setChosenView(v as CalendarView)} label="Calendar view">
              {VIEWS.map((v) => (
                <SegmentedItem key={v.id} value={v.id} className="px-3 text-sm font-medium">{v.label}</SegmentedItem>
              ))}
            </SegmentedControl>
            <div className="flex items-center gap-1.5">
              <Button variant="outline" size="touch" onClick={() => setAnchor(today)}>{CURRENT_LABEL[view]}</Button>
              <Button variant="outline" size="icon-touch" aria-label={`Previous ${view}`} onClick={() => setAnchor((a) => stepAnchor(view, a, -1, today))}>
                <ChevronLeft />
              </Button>
              <Button variant="outline" size="icon-touch" aria-label={`Next ${view}`} onClick={() => setAnchor((a) => stepAnchor(view, a, 1, today))}>
                <ChevronRight />
              </Button>
            </div>
          </div>
        </div>
        {body}
      </div>

      {unscheduled.length > 0 && (
        <p className="mt-3 text-xs text-ink-muted">
          Not on the timetable: {unscheduled.map((m) => `${formatCourseCode(m.courseCode)} ${m.component}`).join(", ")} (no scheduled time).
        </p>
      )}
    </div>
  );
}

/** Hour grid with day columns. Used by the week view and, with one column, the day view. */
function TimeGrid({ days, bounds, actions, showDayHeader = true }: { days: CalendarDay[]; bounds: GridBounds; actions: BlockActions; showDayHeader?: boolean }) {
  const hours = hourMarks(bounds);
  return (
    <div className="overflow-x-auto overscroll-x-contain">
      <div style={{ minWidth: days.length > 1 ? GUTTER + days.length * MIN_COLUMN : undefined }}>
        {showDayHeader && (
          <div className="flex border-b border-line">
            <div className="sticky left-0 z-20 shrink-0 bg-surface" style={{ width: GUTTER }} />
            {days.map((d) => (
              <div key={d.date} className="min-w-0 flex-1 border-l border-line py-2 text-center text-[13px] font-medium">
                <span className={cn("rounded-full px-2 py-0.5", d.isToday ? "bg-brand-soft text-brand" : "text-ink-muted")}>{d.label}</span>
              </div>
            ))}
          </div>
        )}

        <div className="relative flex" style={{ height: gridHeight(bounds) }}>
          <div aria-hidden="true" className="sticky left-0 z-20 shrink-0 bg-surface" style={{ width: GUTTER }}>
            {hours.map((h) => (
              <div key={h} className="absolute inset-x-0 border-t border-line px-2 pt-1 text-[12px] leading-none tabular-nums text-ink-muted" style={{ top: timeToY(h * 60, bounds) }}>
                {formatHourLabel(h)}
              </div>
            ))}
          </div>

          <div className="relative flex min-w-0 flex-1">
            {hours.map((h) => (
              <Fragment key={h}>
                <div aria-hidden="true" className="absolute inset-x-0 border-t border-line" style={{ top: timeToY(h * 60, bounds) }} />
                <div aria-hidden="true" className="absolute inset-x-0 border-t border-line/45" style={{ top: timeToY(h * 60 + 30, bounds) }} />
              </Fragment>
            ))}
            {days.map((d) => (
              <div key={d.date} role="list" aria-label={formatDateRange(d.date, d.date)} className={cn("relative min-w-0 flex-1 border-l border-line", d.isToday && "bg-brand/[0.025]")}>
                {layoutDay(d.occurrences).map(({ item, column, columns }) => {
                  const { top, height } = blockGeometry(item, bounds);
                  return (
                    <ClassBlock
                      key={item.id}
                      occurrence={item}
                      height={height}
                      style={{ top, height, left: `calc(${(column / columns) * 100}% + 2px)`, width: `calc(${100 / columns}% - 4px)` }}
                      actions={actions}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** One class on the grid. Shows what its height has room for; everything is in its popover. */
function ClassBlock({ occurrence, height, style, actions }: { occurrence: ClassOccurrence; height: number; style: CSSProperties; actions: BlockActions }) {
  const m = occurrence.meeting;
  const color = actions.colorOf(m);
  const code = formatCourseCode(m.courseCode);
  const lines = blockLines(height);
  const text: Record<BlockLine, string> = {
    code,
    time: formatTimeRange(m.start, m.end),
    section: sectionLabel(m),
    room: roomLabel(m),
    sectionAndRoom: `${sectionLabel(m)} · ${roomLabel(m)}`,
  };
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="listitem"
          aria-label={`${code} ${sectionLabel(m)}, ${formatMinutesOfDay(m.start)} to ${formatMinutesOfDay(m.end)}, ${roomLabel(m)}`}
          className="group absolute z-10 text-left outline-none focus-visible:z-30"
          style={{ ...style, paddingBottom: BLOCK_GAP }}
        >
          <span
            className={cn(
              "flex h-full flex-col overflow-hidden whitespace-nowrap rounded-[5px] border-l-[3px] pl-1.5 pr-1 transition-[filter] duration-150 group-hover:brightness-[0.97] group-focus-visible:ring-2 group-focus-visible:ring-brand/60 group-data-[state=open]:ring-2 group-data-[state=open]:ring-ink/70",
              // Centred like UW Flow when the lines fit; top-aligned when even the code is clipped.
              linesHeight(lines) <= height ? "justify-center" : "justify-start",
            )}
            style={{ backgroundColor: color.fill, borderLeftColor: color.rail, paddingTop: BLOCK_PADDING_Y, paddingBottom: BLOCK_PADDING_Y }}
          >
            {lines.map((line) => (
              <span
                key={line}
                // Font size can rise to 12px without moving anything: blockLines measures by these line heights.
                className={cn("block truncate", line === "code" ? "text-xs font-semibold" : "text-[12px]")}
                style={{ lineHeight: `${line === "code" ? TITLE_LINE : DETAIL_LINE}px`, color: line === "code" ? BLOCK_TITLE_COLOR : color.text }}
              >
                {text[line]}
              </span>
            ))}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start">
        <ClassDetails occurrence={occurrence} color={color} actions={actions} />
      </PopoverContent>
    </Popover>
  );
}

function ClassDetails({ occurrence, color, actions }: { occurrence: ClassOccurrence; color: CourseColor; actions: BlockActions }) {
  const m = occurrence.meeting;
  const key = normalizeCourseCode(m.courseCode);
  const code = formatCourseCode(m.courseCode);
  const title = courseTitleFor(m.courseCode, m.courseTitle);
  const building = parseRawLocation(m.location, m.university)?.buildingName;
  const where = m.location.kind === "ROOM"
    ? `${m.location.buildingCode} ${m.location.roomNumber}${building ? ` · ${building}` : ""}`
    : m.location.kind === "ONLINE" ? "Online" : "Room to be announced";
  return (
    <div className="space-y-3">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <span aria-hidden="true" className="size-3 shrink-0 rounded-full" style={{ backgroundColor: color.rail }} />
          <p className="text-base font-bold leading-tight">{code}</p>
          {m.university === "WLU" && <Badge variant="wlu">Laurier{m.laurierCode ? ` · ${m.laurierCode}` : ""}</Badge>}
        </div>
        {title && <p className="mt-0.5 text-sm text-ink-muted">{title}</p>}
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-ink-muted">Section</dt>
        <dd>{sectionLabel(m)}{m.classNumber ? ` · Class ${m.classNumber}` : ""}</dd>
        <dt className="text-ink-muted">When</dt>
        <dd>{formatShortDate(occurrence.date)} · {formatMinutesOfDay(m.start)}–{formatMinutesOfDay(m.end)}</dd>
        <dt className="text-ink-muted">Where</dt>
        <dd className={cn(m.location.kind === "TBA" && m.university === "WLU" && "text-warn")}>{where}</dd>
        <dt className="text-ink-muted">Instructor</dt>
        <dd className={cn(!m.instructors?.length && "text-ink-muted")}>{m.instructors?.length ? m.instructors.join(", ") : "Not known"}</dd>
      </dl>
      <div>
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-muted">Colour</p>
        <CourseColorPicker value={color.id} courseLabel={code} onChange={(c) => actions.onColorChange(key, c)} />
      </div>
      {actions.onShowCourse && (
        <PopoverClose asChild>
          <Button variant="outline" size="touch" className="w-full" onClick={() => actions.onShowCourse?.(key)}>Course details</Button>
        </PopoverClose>
      )}
    </div>
  );
}

/** The day view's week at a glance: pick a day, see at a dot which days have classes. */
function DayStrip({ week, selected, colorOf, onPick }: { week: CalendarDay[]; selected: string; colorOf: BlockActions["colorOf"]; onPick: (date: string) => void }) {
  return (
    // A 2px gap leaves each of seven days at least 44px wide on a 375px phone.
    <div className="grid grid-cols-7 gap-0.5 border-b border-line p-2">
      {week.map((d) => {
        const on = d.date === selected;
        const [weekday, dayNumber] = d.label.split(" ");
        const courses = uniqueCourses(d.occurrences);
        return (
          <button
            key={d.date}
            type="button"
            aria-pressed={on}
            aria-label={`${formatDateRange(d.date, d.date)}, ${d.occurrences.length} class${d.occurrences.length === 1 ? "" : "es"}`}
            onClick={() => onPick(d.date)}
            className={cn(
              "flex min-h-11 touch-manipulation flex-col items-center justify-center rounded-xl py-1.5 outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-brand",
              on ? "bg-ink text-white" : "hover:bg-canvas active:bg-fill",
              !on && d.isToday && "text-brand",
            )}
          >
            <span className="text-[12px] font-medium opacity-80">{weekday}</span>
            <span className="text-sm font-semibold tabular-nums">{dayNumber}</span>
            <span aria-hidden="true" className="mt-0.5 flex h-1.5 gap-0.5">
              {courses.slice(0, 3).map((o) => (
                <span key={o.id} className="size-1.5 rounded-full" style={{ backgroundColor: on ? "#ffffff" : colorOf(o.meeting).rail }} />
              ))}
            </span>
          </button>
        );
      })}
    </div>
  );
}

const MONTH_HEADERS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTH_CHIPS = 3;

function MonthGrid({ weeks, colorOf, onPick }: { weeks: MonthCell[][]; colorOf: BlockActions["colorOf"]; onPick: (date: string) => void }) {
  return (
    <div>
      <div className="grid grid-cols-7 border-b border-line">
        {MONTH_HEADERS.map((d) => (
          <div key={d} className="py-2 text-center text-[13px] font-medium text-ink-muted">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {weeks.flat().map((c, i) => (
          <button
            key={c.date}
            type="button"
            onClick={() => onPick(c.date)}
            aria-label={`${formatDateRange(c.date, c.date)}, ${c.occurrences.length} class${c.occurrences.length === 1 ? "" : "es"}`}
            className={cn(
              "flex min-h-16 min-w-0 flex-col gap-1 border-line p-1 text-left outline-none transition-colors duration-150 hover:bg-canvas active:bg-fill focus-visible:relative focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand sm:min-h-24 sm:p-1.5",
              i % 7 !== 0 && "border-l",
              i >= 7 && "border-t",
              !c.inMonth && "bg-canvas/60 text-ink-muted",
            )}
          >
            <span className={cn("grid size-6 shrink-0 place-items-center self-center rounded-full text-xs font-semibold tabular-nums sm:self-start", c.isToday && "bg-ink text-white")}>
              {Number(c.date.slice(8))}
            </span>
            <span aria-hidden="true" className={cn("flex flex-wrap justify-center gap-0.5 sm:hidden", !c.inMonth && "opacity-60")}>
              {uniqueCourses(c.occurrences).slice(0, 4).map((o) => (
                <span key={o.id} className="size-1.5 rounded-full" style={{ backgroundColor: colorOf(o.meeting).rail }} />
              ))}
            </span>
            <span aria-hidden="true" className={cn("hidden min-w-0 flex-col gap-0.5 sm:flex", !c.inMonth && "opacity-60")}>
              {c.occurrences.slice(0, MONTH_CHIPS).map((o) => {
                const color = colorOf(o.meeting);
                return (
                  <span key={o.id} className="block truncate rounded-[4px] border-l-2 px-1 text-[12px] leading-4" style={{ backgroundColor: color.fill, borderLeftColor: color.rail, color: BLOCK_TITLE_COLOR }}>
                    <span className="tabular-nums" style={{ color: color.text }}>{formatShortTime(o.start)}</span> {formatCourseCode(o.meeting.courseCode)}
                  </span>
                );
              })}
              {c.occurrences.length > MONTH_CHIPS && <span className="px-1 text-[12px] leading-4 text-ink-muted">+{c.occurrences.length - MONTH_CHIPS} more</span>}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** A day's occurrences, one per course, earliest first. */
function uniqueCourses(occurrences: readonly ClassOccurrence[]): ClassOccurrence[] {
  const seen = new Set<string>();
  return occurrences.filter((o) => {
    const key = normalizeCourseCode(o.meeting.courseCode);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
