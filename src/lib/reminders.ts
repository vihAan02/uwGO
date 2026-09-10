/**
 * Leave-time reminders. Pure data and a scheduler; the browser bits live in useReminders.
 *
 * A reminder is keyed by the leg it belongs to (date + transition id), so when the plan is
 * recomputed and that leg's departure moves, the reminder follows it instead of firing at
 * a time that no longer means anything.
 */
import type { ClassTransition, DayPlan } from "@/domain/types";
import { formatClock, formatDuration } from "@/time/toronto";

export interface Reminder {
  id: string;
  /** ISO instant to fire at. */
  at: string;
  title: string;
  body: string;
  /** Set once shown, so it is never shown twice. */
  firedAt?: string;
}

export const REMINDERS_KEY = "uwgo.reminders.v1";
/** A reminder whose time passed longer ago than this is skipped rather than shown late. */
export const MAX_LATE_MINUTES = 10;
/** A departure that moved by at least this much rewrites the reminder. */
export const MATERIAL_CHANGE_MINUTES = 1;

export function reminderIdFor(day: DayPlan, t: ClassTransition): string {
  return `${day.date}|${t.id}`;
}

function destinationLabel(t: ClassTransition, day: DayPlan): { course?: string; room?: string } {
  const cls = day.classes.find((c) => c.start.getTime() === t.arriveBy.getTime() && c.location.id === t.to.id);
  if (!cls) return {};
  const m = cls.meeting;
  return { course: m.courseCode, room: m.location.kind === "ROOM" ? `${m.location.buildingCode} ${m.location.roomNumber}` : undefined };
}

/** The notification text for a leg: "Leave now for MATH 135" / "12 min to MC 2065". */
export function reminderFor(day: DayPlan, t: ClassTransition): Reminder | undefined {
  if (!t.recommendedDeparture || !t.recommendedRoute) return undefined;
  const r = t.recommendedRoute;
  const { course, room } = destinationLabel(t, day);
  const where = room ?? t.to.buildingCode ?? t.to.name;
  const title = t.hasDeadline ? `Leave now for ${course ?? t.to.name}` : `Leave ${t.from.name} now`;
  const bus = r.steps?.find((s) => s.mode === "TRANSIT")?.transit;
  const how = r.mode === "TRANSIT" && bus
    ? `${bus.lineShort ?? bus.line} at ${formatClock(bus.departureTime)} from ${bus.departureStop}`
    : `${formatDuration(r.durationMinutes)} ${r.indoorPath ? "indoors" : "walk"}`;
  const body = t.hasDeadline
    ? `${formatDuration(r.durationMinutes)} to ${where} · ${how}${t.from.kind === "HOME" ? " · from home" : ""}`
    : `${formatDuration(r.durationMinutes)} home · ${how}`;
  return { id: reminderIdFor(day, t), at: t.recommendedDeparture.toISOString(), title, body };
}

/** Every leg of a plan the student could set a reminder on, keyed by reminder id. */
export function remindableLegs(days: Iterable<DayPlan | undefined>): Map<string, Reminder> {
  const out = new Map<string, Reminder>();
  for (const day of days) {
    if (!day) continue;
    for (const t of day.transitions) {
      const r = reminderFor(day, t);
      if (r) out.set(r.id, r);
    }
  }
  return out;
}

/**
 * Bring stored reminders in line with a fresh plan: a leg whose departure moved gets the
 * new time (and is re-armed if that time is still ahead). Reminders for legs that are no
 * longer in the plan are left alone; fired ones older than a day are dropped.
 */
export function syncReminders(stored: Reminder[], current: Map<string, Reminder>, now: Date): { reminders: Reminder[]; changed: boolean } {
  let changed = false;
  const dayAgo = now.getTime() - 24 * 60 * 60_000;
  const out: Reminder[] = [];
  for (const r of stored) {
    if (r.firedAt && Date.parse(r.firedAt) < dayAgo) { changed = true; continue; }
    const fresh = current.get(r.id);
    if (!fresh) { out.push(r); continue; }
    const moved = Math.abs(Date.parse(fresh.at) - Date.parse(r.at)) >= MATERIAL_CHANGE_MINUTES * 60_000;
    const textChanged = fresh.title !== r.title || fresh.body !== r.body;
    if (!moved && !textChanged) { out.push(r); continue; }
    changed = true;
    const stillAhead = Date.parse(fresh.at) > now.getTime();
    out.push({ ...r, at: fresh.at, title: fresh.title, body: fresh.body, firedAt: moved && stillAhead ? undefined : r.firedAt });
  }
  return { reminders: out, changed };
}

/** Reminders that should be shown right now, and those too old to bother with (marked fired silently). */
export function dueReminders(reminders: Reminder[], now: Date): { due: Reminder[]; expired: Reminder[] } {
  const due: Reminder[] = [];
  const expired: Reminder[] = [];
  for (const r of reminders) {
    if (r.firedAt) continue;
    const at = Date.parse(r.at);
    if (at > now.getTime()) continue;
    if (now.getTime() - at > MAX_LATE_MINUTES * 60_000) expired.push(r);
    else due.push(r);
  }
  return { due, expired };
}

export function loadReminders(storage: Pick<Storage, "getItem"> | undefined = typeof window !== "undefined" ? window.localStorage : undefined): Reminder[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(REMINDERS_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? list.filter((r): r is Reminder => Boolean(r && typeof r === "object" && typeof (r as Reminder).id === "string" && typeof (r as Reminder).at === "string")) : [];
  } catch {
    return [];
  }
}

export function saveReminders(reminders: Reminder[], storage: Pick<Storage, "setItem"> | undefined = typeof window !== "undefined" ? window.localStorage : undefined): void {
  try { storage?.setItem(REMINDERS_KEY, JSON.stringify(reminders)); } catch { /* quota / private mode */ }
}
