import type { CampusLocation, ClassTransition, ScheduledClass } from "@/domain/types";
import { minutesBetween, torontoDate } from "@/time/toronto";

function isCrossCampus(a: CampusLocation, b: CampusLocation): boolean {
  return Boolean(a.university && b.university && a.university !== b.university);
}

/** Skeleton transitions (no routes yet) for one day, in chronological order. */
export function buildTransitions(classes: ScheduledClass[], home: CampusLocation | undefined, dateISO: string): ClassTransition[] {
  const out: ClassTransition[] = [];
  if (classes.length === 0) return out;
  const dayStart = torontoDate(dateISO, 0);

  if (home) {
    const first = classes[0];
    out.push({
      id: `home->${first.id}`,
      kind: "HOME_TO_CLASS",
      from: home,
      to: first.location,
      departAfter: dayStart,
      arriveBy: first.start,
      hasDeadline: true,
      availableMinutes: minutesBetween(dayStart, first.start),
      feasibility: "UNKNOWN",
      crossCampus: isCrossCampus(home, first.location),
    });
  }

  for (let i = 0; i < classes.length - 1; i++) {
    const a = classes[i];
    const b = classes[i + 1];
    out.push({
      id: `${a.id}->${b.id}`,
      kind: "CLASS_TO_CLASS",
      from: a.location,
      to: b.location,
      departAfter: a.end,
      arriveBy: b.start,
      hasDeadline: true,
      availableMinutes: minutesBetween(a.end, b.start),
      feasibility: "UNKNOWN",
      crossCampus: isCrossCampus(a.location, b.location),
    });
  }

  if (home) {
    const last = classes[classes.length - 1];
    out.push({
      id: `${last.id}->home`,
      kind: "CLASS_TO_HOME",
      from: last.location,
      to: home,
      departAfter: last.end,
      arriveBy: last.end,
      hasDeadline: false,
      availableMinutes: 0,
      feasibility: "UNKNOWN",
      crossCampus: isCrossCampus(last.location, home),
    });
  }
  return out;
}
