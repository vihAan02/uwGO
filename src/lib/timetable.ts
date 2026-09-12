/**
 * The geometry of the timetable.
 *
 * Adapted from UW Flow's calendar (MIT, see THIRD_PARTY_NOTICES.md): the hour grid and block
 * placement from `src/components/calendar/Calendar.tsx`, the lane packing from
 * `src/components/calendar/calendarLayout.ts`, and the hour range from
 * `src/pages/profilePage/ProfileCalendar.tsx`.
 *
 * Every vertical measurement in the timetable goes through `timeToY` and `durationToHeight`. The
 * grid lines, the time labels and the class blocks are all placed with them, so a class starting
 * at 12:30 sits exactly halfway between the 12 and 1 lines and a 50-minute class is exactly 50
 * minutes tall. Nothing else may turn a time into pixels.
 */

/** Pixels per hour: the single source of truth for the grid's vertical scale (UW Flow's value). */
export const HOUR_HEIGHT = 64;

export interface TimetableEvent {
  id: string;
  /** Minutes from midnight. */
  start: number;
  end: number;
}

export interface GridBounds {
  /** The hour at the top edge of the grid. */
  fromHour: number;
  /** The hour at the bottom edge. */
  toHour: number;
}

/** Vertical position of a time of day, in pixels from the top of the grid. */
export function timeToY(minutes: number, bounds: GridBounds): number {
  return ((minutes - bounds.fromHour * 60) / 60) * HOUR_HEIGHT;
}

/** Height of a stretch of time, in pixels. */
export function durationToHeight(minutes: number): number {
  return (Math.max(0, minutes) / 60) * HOUR_HEIGHT;
}

/** Where a block sits in the grid, in pixels. */
export function blockGeometry(event: TimetableEvent, bounds: GridBounds): { top: number; height: number } {
  return { top: timeToY(event.start, bounds), height: durationToHeight(event.end - event.start) };
}

export function gridHeight(bounds: GridBounds): number {
  return durationToHeight((bounds.toHour - bounds.fromHour) * 60);
}

/** The hours whose lines and labels are drawn, top to bottom. */
export function hourMarks(bounds: GridBounds): number[] {
  const hours: number[] = [];
  for (let h = bounds.fromHour; h < bounds.toHour; h++) hours.push(h);
  return hours;
}

/** UW Flow opens on 9 to 5 and widens only for classes outside it. */
export const DEFAULT_GRID: GridBounds = { fromHour: 9, toHour: 18 };

/**
 * The hours the grid shows: the default teaching day, widened out to whole hours around any
 * class that starts earlier or ends later. Worked out over the whole term rather than the visible
 * week, so moving between weeks never makes the grid jump.
 */
export function gridBounds(events: readonly Pick<TimetableEvent, "start" | "end">[], fallback: GridBounds = DEFAULT_GRID): GridBounds {
  if (events.length === 0) return fallback;
  const earliest = Math.min(...events.map((e) => e.start));
  const latest = Math.max(...events.map((e) => e.end));
  return {
    fromHour: Math.max(0, Math.min(fallback.fromHour, Math.floor(earliest / 60))),
    toHour: Math.min(24, Math.max(fallback.toHour, Math.ceil(latest / 60))),
  };
}

export interface PlacedEvent<T extends TimetableEvent> {
  item: T;
  /** Which lane within its overlapping group, from 0. */
  column: number;
  /** How many lanes that group needs. */
  columns: number;
}

/**
 * Place a day's classes into lanes. Events are grouped by actual overlap; within a group each
 * event takes the first lane free at its start time, and every event in the group is given the
 * group's lane count so they divide the width evenly. A group closes only once every lane in it
 * has ended, which is what keeps a long lab beside the three short tutorials it spans.
 *
 * Touching is not overlapping: a class ending at 11:20 and one starting at 11:20 share a lane.
 */
export function layoutDay<T extends TimetableEvent>(events: readonly T[]): PlacedEvent<T>[] {
  const sorted = [...events].sort((a, b) => a.start - b.start || b.end - a.end || a.id.localeCompare(b.id));
  const placed: PlacedEvent<T>[] = [];
  let group: { item: T; column: number }[] = [];
  /** The end time currently occupying each lane. */
  let lanes: number[] = [];
  let groupEnd = -Infinity;

  const flush = () => {
    const columns = Math.max(1, lanes.length);
    for (const g of group) placed.push({ item: g.item, column: g.column, columns });
    group = [];
    lanes = [];
    groupEnd = -Infinity;
  };

  for (const e of sorted) {
    if (group.length && e.start >= groupEnd) flush();
    let lane = lanes.findIndex((end) => end <= e.start);
    if (lane === -1) { lanes.push(e.end); lane = lanes.length - 1; } else lanes[lane] = e.end;
    group.push({ item: e, column: lane });
    groupEnd = Math.max(groupEnd, e.end);
  }
  flush();
  return placed;
}

/*
 * What a block has room to say. The block's markup uses these exact numbers for its padding and
 * line heights, so "fits" here means fits on screen, and whatever does not fit is never rendered
 * rather than left to spill out of the block.
 */

/** Space kept clear under each block so back-to-back classes read as two. */
export const BLOCK_GAP = 1;
/** Padding above and below the text inside a block. */
export const BLOCK_PADDING_Y = 3;
/** Line height of the course code. */
export const TITLE_LINE = 16;
/** Line height of each detail line (time, section, room). */
export const DETAIL_LINE = 14;

export type BlockLine = "code" | "time" | "section" | "room" | "sectionAndRoom";

/**
 * The lines a block of this height shows, most important first: the course code, then the time,
 * then the section and room. With room for three lines the section and room share the third; a
 * block too short for even the code still shows it, clipped by the block rather than escaping it.
 */
export function blockLines(heightPx: number): BlockLine[] {
  const room = heightPx - BLOCK_GAP - 2 * BLOCK_PADDING_Y;
  const details = Math.floor((room - TITLE_LINE) / DETAIL_LINE);
  if (details >= 3) return ["code", "time", "section", "room"];
  if (details === 2) return ["code", "time", "sectionAndRoom"];
  if (details === 1) return ["code", "time"];
  return ["code"];
}

/** Pixels the given lines need, for checking they fit. */
export function linesHeight(lines: readonly BlockLine[]): number {
  return 2 * BLOCK_PADDING_Y + BLOCK_GAP + lines.reduce((h, l) => h + (l === "code" ? TITLE_LINE : DETAIL_LINE), 0);
}

/** "12:30", the compact clock used inside a block where the grid already says morning or afternoon. */
export function formatShortTime(minutes: number): string {
  const h24 = Math.floor(minutes / 60) % 24;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(minutes % 60).padStart(2, "0")}`;
}

/** "12:30–1:20" */
export function formatTimeRange(start: number, end: number): string {
  return `${formatShortTime(start)}–${formatShortTime(end)}`;
}

/** Gutter label for an hour line: "9 AM", "12 PM". */
export function formatHourLabel(hour: number): string {
  const h = hour % 24;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12} ${h < 12 ? "AM" : "PM"}`;
}
