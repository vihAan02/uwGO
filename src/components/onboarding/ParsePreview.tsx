"use client";
import type { ParsedSchedule } from "@/domain/types";
import { parseRawLocation } from "@/rooms/roomParser";
import { formatMinutesOfDay } from "@/time/toronto";

const BLOCKING = new Set(["WRONG_PAGE_HOMEPAGE_WIDGET", "WRONG_PAGE_COURSE_SELECTION", "NOT_REGISTERED", "NO_COURSES"]);

export function ParsePreview({ parsed }: { parsed: ParsedSchedule }) {
  const blocking = parsed.warnings.filter((w) => BLOCKING.has(w.code));
  const other = parsed.warnings.filter((w) => !BLOCKING.has(w.code) && w.code !== "DUPLICATE_DROPPED");
  const dupes = parsed.warnings.filter((w) => w.code === "DUPLICATE_DROPPED").length;

  if (!parsed.recognised && parsed.meetings.length === 0) {
    return (
      <div className="mt-3 rounded-xl bg-bad-soft p-3 text-sm text-bad">
        {blocking[0]?.message ?? "That doesn't look like a Quest Class Schedule List View page. Select the whole page (Ctrl/Cmd + A) in List View and paste again."}
      </div>
    );
  }

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="chip bg-ok-soft text-ok">{parsed.meetings.length} meeting rows</span>
        {parsed.term && <span className="chip bg-brand-soft text-brand">{parsed.term.season} {parsed.term.year}</span>}
        {parsed.dateOrder === "UNKNOWN" && <span className="chip bg-warn-soft text-warn">dates unknown</span>}
        {dupes > 0 && <span className="chip bg-canvas text-ink-muted">{dupes} duplicate{dupes > 1 ? "s" : ""} ignored</span>}
      </div>
      {other.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs text-warn">
          {other.map((w, i) => <li key={i}>{w.message}</li>)}
        </ul>
      )}
      <ul className="mt-3 divide-y divide-line">
        {parsed.meetings.map((m) => {
          const room = parseRawLocation(m.location, m.university);
          const where = m.location.kind === "ONLINE" ? "Online" : m.location.kind === "TBA" ? "Room TBA" : `${m.location.buildingCode} ${m.location.roomNumber}`;
          const skipped = !m.includeInPlan || m.unscheduled || m.location.kind !== "ROOM" || (room && !room.resolved);
          return (
            <li key={m.id} className="flex items-start justify-between gap-3 py-2 text-sm">
              <div>
                <div className="font-semibold">{m.courseCode} <span className="font-normal text-ink-muted">{m.component}{m.section ? ` ${m.section}` : ""}</span></div>
                <div className="text-ink-muted">{m.unscheduled ? "No scheduled time" : `${m.days.join("")} ${formatMinutesOfDay(m.start)}–${formatMinutesOfDay(m.end)}`} · {where}{room?.buildingName ? ` · ${room.buildingName}` : ""}</div>
              </div>
              {skipped && <span className="chip shrink-0 bg-canvas text-ink-muted">{m.component === "TST" ? "exam, not routed" : room && !room.resolved && m.location.kind === "ROOM" ? "unknown building" : "not routed"}</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
