"use client";
import { AlertTriangle } from "lucide-react";
import type { ParsedSchedule } from "@/domain/types";
import { parseRawLocation } from "@/rooms/roomParser";
import { formatMinutesOfDay } from "@/time/toronto";
import { Badge } from "@/components/ui/badge";
import { Reveal } from "@/components/ui/reveal";

const BLOCKING = new Set(["WRONG_PAGE_HOMEPAGE_WIDGET", "WRONG_PAGE_COURSE_SELECTION", "NOT_REGISTERED", "NO_COURSES"]);

export function ParsePreview({ parsed }: { parsed: ParsedSchedule }) {
  const blocking = parsed.warnings.filter((w) => BLOCKING.has(w.code));
  const other = parsed.warnings.filter((w) => !BLOCKING.has(w.code) && w.code !== "DUPLICATE_DROPPED");
  const dupes = parsed.warnings.filter((w) => w.code === "DUPLICATE_DROPPED").length;

  if (!parsed.recognised && parsed.meetings.length === 0) {
    return (
      <div className="mt-3 flex gap-2.5 rounded-xl bg-bad-soft p-3 text-sm text-bad" role="alert">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
        <span>{blocking[0]?.message ?? "That doesn't look like a Quest Class Schedule List View page. Select the whole page (Ctrl/Cmd + A) in List View and paste again."}</span>
      </div>
    );
  }

  return (
    <Reveal key={`${parsed.meetings.length}-${parsed.term?.year ?? ""}`} step={35} duration={450} className="mt-4">
      <div data-reveal className="flex flex-wrap items-center gap-1.5">
        <Badge variant="ok">{parsed.meetings.length} meeting rows</Badge>
        {parsed.term && <Badge variant="brand">{parsed.term.season} {parsed.term.year}</Badge>}
        {parsed.dateOrder === "UNKNOWN" && <Badge variant="warn">dates unknown</Badge>}
        {dupes > 0 && <Badge>{dupes} duplicate{dupes > 1 ? "s" : ""} ignored</Badge>}
      </div>
      {other.length > 0 && (
        <ul data-reveal className="mt-2 space-y-1 text-xs text-warn">
          {other.map((w, i) => <li key={i}>{w.message}</li>)}
        </ul>
      )}
      <ul className="mt-2 divide-y divide-line">
        {parsed.meetings.map((m) => {
          const room = parseRawLocation(m.location, m.university);
          const where = m.location.kind === "ONLINE" ? "Online" : m.location.kind === "TBA" ? "Room TBA" : `${m.location.buildingCode} ${m.location.roomNumber}`;
          const skipped = !m.includeInPlan || m.unscheduled || m.location.kind !== "ROOM" || (room && !room.resolved);
          const why = m.component === "TST" ? "exam, not routed" : room && !room.resolved && m.location.kind === "ROOM" ? "unknown building" : "not routed";
          return (
            <li key={m.id} data-reveal className="flex items-start justify-between gap-3 py-2.5 text-sm">
              <div className="min-w-0">
                <div className="font-semibold">
                  {m.courseCode} <span className="font-normal text-ink-muted">{m.component}{m.section ? ` ${m.section}` : ""}</span>
                </div>
                <div className="text-ink-muted">
                  {m.unscheduled ? "No scheduled time" : `${m.days.join("")} ${formatMinutesOfDay(m.start)}–${formatMinutesOfDay(m.end)}`} · {where}{room?.buildingName ? ` · ${room.buildingName}` : ""}
                </div>
              </div>
              {skipped && <Badge className="mt-0.5">{why}</Badge>}
            </li>
          );
        })}
      </ul>
    </Reveal>
  );
}
