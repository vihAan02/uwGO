import type { CampusLocation, ClassTransition, ScheduledClass } from "@/domain/types";
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
  /** True for the mid-day trip home during a gap, as opposed to going home at the end of the day. */
  midDayHomeReturn?: boolean;
}

/**
 * The day's legs in chronological order.
 *
 * `goHomeAfter` holds the indices of classes after which the student was told to go home
 * during the gap. Those gaps become two legs (class -> home, home -> next class) instead
 * of one, which is the whole point: once the plan sends someone home, the next trip has
 * to start from home.
 */
export function buildItinerary(
  classes: ScheduledClass[],
  home: CampusLocation | undefined,
  goHomeAfter: ReadonlySet<number>,
  dateISO: string,
): LegSpec[] {
  const out: LegSpec[] = [];
  if (classes.length === 0) return out;
  const dayStart = torontoDate(dateISO, 0);

  const toClass = (id: string, from: CampusLocation, earliest: Date, toIndex: number, fromIndex?: number): LegSpec => {
    const b = classes[toIndex];
    return {
      id,
      kind: from.kind === "HOME" ? "HOME_TO_CLASS" : "CLASS_TO_CLASS",
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
    if (home && goHomeAfter.has(i)) {
      out.push({
        id: `${a.id}->home`,
        kind: "CLASS_TO_HOME",
        from: a.location,
        to: home,
        departAfter: a.end,
        arriveBy: a.end,
        hasDeadline: false,
        availableMinutes: 0,
        feasibility: "UNKNOWN",
        crossCampus: isCrossCampus(a.location, home),
        fromClassIndex: i,
        midDayHomeReturn: true,
      });
      // Earliest is still the class end here; the planner pushes it to the real arrival
      // home once the leg above has a route.
      out.push({ ...toClass(`home->${classes[i + 1].id}`, home, a.end, i + 1), midDayHomeReturn: true });
      continue;
    }
    out.push(toClass(`${a.id}->${classes[i + 1].id}`, a.location, a.end, i + 1, i));
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
      fromClassIndex: classes.length - 1,
    });
  }
  return out;
}

/** Back-compat wrapper: the plain academic chain, with no mid-day home returns. */
export function buildTransitions(classes: ScheduledClass[], home: CampusLocation | undefined, dateISO: string): ClassTransition[] {
  return buildItinerary(classes, home, new Set(), dateISO);
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
