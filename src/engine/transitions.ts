import type { CampusLocation, ClassTransition, GapStop, ScheduledClass, TransitionKind } from "@/domain/types";
import { minutesBetween, torontoDate } from "@/time/toronto";

function isCrossCampus(a: CampusLocation, b: CampusLocation): boolean {
  return Boolean(a.university && b.university && a.university !== b.university);
}

/**
 * One leg of the day, before any route is fetched. Legs form a chain: each one starts
 * where the previous one ended, so the origin of a trip is wherever the itinerary
 * actually leaves the student, not wherever their previous class happened to be.
 */
export interface LegSpec extends ClassTransition {
  /** Index in `classes` of the class this leg sets off from, if it starts at a class. */
  fromClassIndex?: number;
  /** Index in `classes` of the class this leg is heading to, if it ends at a class. */
  toClassIndex?: number;
  /** Which gap this leg belongs to: the index of the class it follows. Absent for the day's bookends. */
  gapIndex?: number;
  /** Position within that gap's chain: 0 leaves the class, 1 leaves the first stop, and so on. */
  gapLeg?: number;
  /** The stop this leg is heading to, when it heads to one rather than to a class. */
  toStop?: GapStop;
  /** Minutes owed at `from` before setting off — the workout, on the leg leaving PAC. */
  dwellMinutes?: number;
}

/**
 * The day's legs in chronological order.
 *
 * `gapStops` holds, per class index, the ordered places the student chose to stop at during the
 * gap that follows it. A gap with N stops becomes N+1 legs instead of one, which is the whole
 * point: once the plan sends someone somewhere, the next trip has to start from there.
 */
export function buildItinerary(
  classes: ScheduledClass[],
  home: CampusLocation | undefined,
  gapStops: ReadonlyMap<number, readonly GapStop[]>,
  dateISO: string,
  /** Where the day ends after the last class; defaults to home. The morning leg always starts from home. */
  endDestination: CampusLocation | undefined = home,
): LegSpec[] {
  const out: LegSpec[] = [];
  if (classes.length === 0) return out;
  const dayStart = torontoDate(dateISO, 0);

  const toClass = (id: string, from: CampusLocation, earliest: Date, toIndex: number, fromIndex?: number, kind?: TransitionKind): LegSpec => {
    const b = classes[toIndex];
    return {
      id,
      kind: kind ?? (from.kind === "HOME" ? "HOME_TO_CLASS" : "CLASS_TO_CLASS"),
      from,
      to: b.location,
      departAfter: earliest,
      arriveBy: b.start,
      hasDeadline: true,
      availableMinutes: minutesBetween(earliest, b.start),
      feasibility: "UNKNOWN",
      crossCampus: isCrossCampus(from, b.location),
      fromClassIndex: fromIndex,
      toClassIndex: toIndex,
    };
  };

  if (home) out.push(toClass(`home->${classes[0].id}`, home, dayStart, 0));

  for (let i = 0; i < classes.length - 1; i++) {
    const a = classes[i];
    const stops = gapStops.get(i) ?? [];
    if (stops.length === 0) {
      out.push({ ...toClass(`${a.id}->${classes[i + 1].id}`, a.location, a.end, i + 1, i), gapIndex: i, gapLeg: 0 });
      continue;
    }

    // Hop to each stop in turn, then on to the next class. Every leg sets off from where the
    // previous one landed; the planner pushes the real departures forward once routes exist.
    // Ids are derived from what a leg actually joins, never from an ordinal: a reminder is keyed
    // by leg id (lib/reminders.ts) and has to survive the student changing an earlier choice.
    let from = a.location;
    let fromId = a.id;
    for (const [k, stop] of stops.entries()) {
      out.push({
        id: `${fromId}->${stop.at.id}`,
        kind: k === 0 ? "CLASS_TO_STOP" : "STOP_TO_STOP",
        from,
        to: stop.at,
        departAfter: a.end,
        arriveBy: a.end,
        hasDeadline: false,
        availableMinutes: 0,
        feasibility: "UNKNOWN",
        crossCampus: isCrossCampus(from, stop.at),
        fromClassIndex: k === 0 ? i : undefined,
        gapIndex: i,
        gapLeg: k,
        toStop: stop,
        dwellMinutes: stops[k - 1]?.minDwellMinutes,
      });
      from = stop.at;
      fromId = stop.at.id;
    }
    const last = stops[stops.length - 1];
    out.push({
      ...toClass(`${fromId}->${classes[i + 1].id}`, from, a.end, i + 1, undefined, "STOP_TO_CLASS"),
      gapIndex: i,
      gapLeg: stops.length,
      dwellMinutes: last.minDwellMinutes,
    });
  }

  if (endDestination) {
    const last = classes[classes.length - 1];
    const isHome = endDestination.kind === "HOME";
    out.push({
      id: `${last.id}->${isHome ? "home" : endDestination.id}`,
      kind: isHome ? "CLASS_TO_HOME" : "CLASS_TO_END",
      from: last.location,
      to: endDestination,
      departAfter: last.end,
      arriveBy: last.end,
      hasDeadline: false,
      availableMinutes: 0,
      feasibility: "UNKNOWN",
      crossCampus: isCrossCampus(last.location, endDestination),
      fromClassIndex: classes.length - 1,
    });
  }
  return out;
}

/** Back-compat wrapper: the plain academic chain, with no mid-gap stops. */
export function buildTransitions(classes: ScheduledClass[], home: CampusLocation | undefined, dateISO: string): ClassTransition[] {
  return buildItinerary(classes, home, new Map(), dateISO);
}

/**
 * The invariant that the Wednesday bug broke: you can only set off from where the last
 * leg left you. Returns a human-readable description of every break, empty when sound.
 */
export function findContinuityBreaks(legs: Pick<ClassTransition, "from" | "to">[]): string[] {
  const breaks: string[] = [];
  for (let i = 1; i < legs.length; i++) {
    const prev = legs[i - 1];
    const cur = legs[i];
    if (prev.to.id !== cur.from.id) {
      breaks.push(`leg ${i} starts at ${cur.from.name} but the previous leg ended at ${prev.to.name}`);
    }
  }
  return breaks;
}
