import { describe, expect, it } from "vitest";
import type { CampusLocation, ClassTransition, DayPlan, RouteOption, ScheduledClass } from "@/domain/types";
import { dueReminders, reminderFor, remindableLegs, syncReminders, type Reminder } from "./reminders";
import { routeChoices } from "./routeChoices";

describe("a reminder for the way the student chose", () => {
  /** September in Waterloo is UTC-4. */
  const at = (hhmm: string) => new Date(`2026-09-16T${hhmm}:00-04:00`);
  const place = (code: string): CampusLocation => ({ id: code, name: `${code} building`, latitude: 43.47, longitude: -80.54, kind: "BUILDING", buildingCode: code });
  const walk = (minutes: number, over: Partial<RouteOption> = {}): RouteOption => ({ mode: "WALK", durationMinutes: minutes, polyline: `walk-${minutes}`, provider: "google-routes", computedAt: "", isEstimate: false, ...over });
  const math: ScheduledClass = {
    id: "math:W", day: "W", date: "2026-09-16", start: at("10:30"), end: at("11:20"), location: place("MC"),
    meeting: { id: "math", university: "UW", courseCode: "MATH 137", component: "LEC", days: ["W"], start: 0, end: 0, location: { kind: "ROOM", buildingCode: "MC", roomNumber: "4020" }, source: "QUEST", includeInPlan: true },
    room: { raw: "MC 4020", buildingCode: "MC", roomNumber: "4020", floor: "unknown", resolved: true },
  };
  const outdoor = walk(8);
  const toMath: ClassTransition = {
    id: "slc->math:W", kind: "CLASS_TO_CLASS", from: place("SLC"), to: math.location, departAfter: at("09:50"), arriveBy: at("10:30"), hasDeadline: true, availableMinutes: 40,
    walkingRoute: outdoor, indoorRoute: walk(11, { polyline: "tunnel", indoorPath: ["SLC", "MC"] }), recommendedRoute: outdoor, recommendedDeparture: at("10:12"), expectedArrival: at("10:20"),
    feasibility: "COMFORTABLE", crossCampus: false,
  };
  const day: DayPlan = { day: "W", date: "2026-09-16", classes: [math], transitions: [toMath], warnings: [], gym: [], items: [] };
  const indoors = (buffer: number) => routeChoices(toMath, buffer).find((c) => c.key === "indoors")!;

  it("fires at that way's own leave time and says how, under an id of its own", () => {
    const planned = reminderFor(day, toMath)!;
    const chosen = reminderFor(day, toMath, indoors(10))!;
    expect(planned.at).toBe(at("10:12").toISOString());
    expect(chosen.at).toBe(at("10:09").toISOString());
    expect(chosen.body).toContain("11 min indoors");
    expect(chosen.id).not.toBe(planned.id);
    // Choosing the plan's own pick is the plan's reminder, not a second one.
    expect(reminderFor(day, toMath, routeChoices(toMath, 10)[0])).toEqual(planned);
  });

  it("follows the plan like the plan's own reminder does: a longer buffer moves it earlier", () => {
    const stored = [reminderFor(day, toMath, indoors(10))!];
    expect(remindableLegs([day]).has(stored[0].id)).toBe(false);
    const { reminders, changed } = syncReminders(stored, remindableLegs([day], 15), at("08:00"));
    expect(changed).toBe(true);
    expect(reminders[0].at).toBe(at("10:04").toISOString());
  });
});

const r = (id: string, at: string, firedAt?: string): Reminder => ({ id, at, title: "Leave now for MATH 135", body: "12 min to MC 2065", firedAt });

describe("reminders follow the plan", () => {
  it("a departure that moved rewrites the reminder and re-arms it if the new time is ahead", () => {
    const now = new Date("2026-09-16T15:00:00Z");
    const stored = [r("2026-09-16|home->math135", "2026-09-16T17:47:00Z")];
    const current = new Map([["2026-09-16|home->math135", { ...stored[0], at: "2026-09-16T17:43:00Z", body: "Bus 201 at 1:45 PM" }]]);
    const { reminders, changed } = syncReminders(stored, current, now);
    expect(changed).toBe(true);
    expect(reminders[0].at).toBe("2026-09-16T17:43:00Z");
    expect(reminders[0].body).toBe("Bus 201 at 1:45 PM");
    expect(reminders[0].firedAt).toBeUndefined();
  });

  it("an unchanged departure leaves the stored reminder alone; a leg no longer in the plan is kept", () => {
    const now = new Date("2026-09-16T15:00:00Z");
    const stored = [r("a", "2026-09-16T17:47:00Z"), r("b", "2026-09-17T13:00:00Z")];
    const current = new Map([["a", r("a", "2026-09-16T17:47:20Z")]]); // 20 s drift is not material
    const { reminders, changed } = syncReminders(stored, current, now);
    expect(changed).toBe(false);
    expect(reminders).toHaveLength(2);
  });

  it("fired reminders older than a day are dropped", () => {
    const now = new Date("2026-09-18T15:00:00Z");
    const { reminders } = syncReminders([r("old", "2026-09-16T17:47:00Z", "2026-09-16T17:47:10Z")], new Map(), now);
    expect(reminders).toHaveLength(0);
  });
});

describe("what is due", () => {
  it("fires at the departure time, skips ones that are long past, and never re-fires", () => {
    const now = new Date("2026-09-16T17:47:30Z");
    const { due, expired } = dueReminders([
      r("now", "2026-09-16T17:47:00Z"),
      r("later", "2026-09-16T18:10:00Z"),
      r("stale", "2026-09-16T16:00:00Z"),
      r("done", "2026-09-16T17:47:00Z", "2026-09-16T17:47:05Z"),
    ], now);
    expect(due.map((x) => x.id)).toEqual(["now"]);
    expect(expired.map((x) => x.id)).toEqual(["stale"]);
  });
});
