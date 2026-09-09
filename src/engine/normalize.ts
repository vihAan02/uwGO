import type { CampusLocation, CourseMeeting, DayOfWeek, ScheduledClass } from "@/domain/types";
import { DAYS_IN_ORDER } from "@/domain/types";
import { buildingLocation, findBuilding } from "@/data/buildings";
import { parseRawLocation } from "@/rooms/roomParser";
import { dateForDay, torontoDate } from "@/time/toronto";

export interface NormalizedWeek {
  mondayISO: string;
  byDay: Record<DayOfWeek, ScheduledClass[]>;
  skipped: { meeting: CourseMeeting; reason: string }[];
}

function emptyWeek(): Record<DayOfWeek, ScheduledClass[]> {
  return { M: [], T: [], W: [], Th: [], F: [], S: [], Su: [] };
}

/**
 * Turn meeting patterns into concrete class occurrences for the week starting on `mondayISO`.
 * Meetings that cannot be placed on the map (online, TBA, unknown building, no coordinates) are
 * reported in `skipped` with a reason instead of being guessed.
 */
export function normalizeWeek(meetings: CourseMeeting[], mondayISO: string): NormalizedWeek {
  const byDay = emptyWeek();
  const skipped: NormalizedWeek["skipped"] = [];

  for (const m of meetings) {
    if (!m.includeInPlan) { skipped.push({ meeting: m, reason: "Excluded from plan" }); continue; }
    if (m.unscheduled || m.days.length === 0) { skipped.push({ meeting: m, reason: "No scheduled day/time" }); continue; }
    if (m.location.kind === "ONLINE") { skipped.push({ meeting: m, reason: "Online, no location" }); continue; }
    if (m.location.kind === "TBA") { skipped.push({ meeting: m, reason: "Room not announced (TBA)" }); continue; }
    if (m.end <= m.start) { skipped.push({ meeting: m, reason: "End time is not after start time" }); continue; }

    const room = parseRawLocation(m.location, m.university);
    const building = room?.resolved ? findBuilding(room.university ?? m.university, room.buildingCode) : undefined;
    if (!room || !building) { skipped.push({ meeting: m, reason: `Unknown building code "${m.location.buildingCode}"` }); continue; }
    const location: CampusLocation | undefined = buildingLocation(building);
    if (!location) { skipped.push({ meeting: m, reason: `No coordinates on file for ${building.name}` }); continue; }

    for (const day of m.days) {
      const date = dateForDay(mondayISO, day);
      if (m.startDate && date < m.startDate) continue;
      if (m.endDate && date > m.endDate) continue;
      byDay[day].push({
        id: `${m.id}:${day}`,
        day,
        date,
        start: torontoDate(date, m.start),
        end: torontoDate(date, m.end),
        meeting: m,
        location,
        room,
      });
    }
  }

  for (const day of DAYS_IN_ORDER) byDay[day].sort((a, b) => a.start.getTime() - b.start.getTime() || a.end.getTime() - b.end.getTime());
  return { mondayISO, byDay, skipped };
}
