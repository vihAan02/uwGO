/**
 * Laying out a weekly timetable.
 *
 * One geometry constant drives both the grid and the blocks drawn on it, so a class's height is
 * always its real duration and nothing can drift out of step. The overlap handling is the lane
 * packing UW Flow uses (MIT; the idea, written here from scratch): classes that overlap share
 * the width of their group, and a group only closes once *every* lane in it has ended, which is
 * what makes a long lecture sitting across three short tutorials come out right.
 */

/** Pixels per hour. The single source of truth for the grid's geometry. */
export const HOUR_HEIGHT = 56;

export interface TimetableEvent {
  id: string;
  /** Minutes from midnight. */
  start: number;
  end: number;
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
 * group's lane count so they divide the width evenly.
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
    // The group ends only when nothing in it is still running.
    if (group.length && e.start >= groupEnd) flush();
    let lane = lanes.findIndex((end) => end <= e.start);
    if (lane === -1) { lanes.push(e.end); lane = lanes.length - 1; } else lanes[lane] = e.end;
    group.push({ item: e, column: lane });
    groupEnd = Math.max(groupEnd, e.end);
  }
  flush();
  return placed;
}

export interface DayBounds {
  /** Minutes from midnight at the top of the grid. */
  from: number;
  /** Minutes from midnight at the bottom. */
  to: number;
}

/**
 * The window the grid needs to show, rounded out to whole hours. An empty week still gets a
 * sensible teaching day rather than a collapsed grid.
 */
export function dayBounds(events: readonly TimetableEvent[], fallback: DayBounds = { from: 8 * 60, to: 18 * 60 }): DayBounds {
  if (events.length === 0) return fallback;
  const earliest = Math.min(...events.map((e) => e.start));
  const latest = Math.max(...events.map((e) => e.end));
  // Rounded out to whole hours so the hour marks line up; no extra padding, or a day of
  // late-morning classes would open with an hour of empty grid.
  return { from: Math.max(0, Math.floor(earliest / 60) * 60), to: Math.min(24 * 60, Math.ceil(latest / 60) * 60) };
}

/** Where a block sits in the grid, in pixels, given the window the grid is showing. */
export function blockGeometry(event: TimetableEvent, bounds: DayBounds): { top: number; height: number } {
  const top = ((event.start - bounds.from) / 60) * HOUR_HEIGHT;
  const height = (Math.max(1, event.end - event.start) / 60) * HOUR_HEIGHT;
  return { top, height };
}

/** The hour marks to draw down the side of the grid. */
export function hourMarks(bounds: DayBounds): number[] {
  const marks: number[] = [];
  for (let m = Math.ceil(bounds.from / 60) * 60; m <= bounds.to; m += 60) marks.push(m);
  return marks;
}
