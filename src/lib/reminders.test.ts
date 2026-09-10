import { describe, expect, it } from "vitest";
import { dueReminders, syncReminders, type Reminder } from "./reminders";

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
