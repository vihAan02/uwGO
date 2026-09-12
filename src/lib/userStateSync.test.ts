import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { CourseMeeting } from "@/domain/types";
import { DEFAULT_PLANNER_CONFIG } from "@/domain/config";
import { asAnon, asUser, createTestDb, createUser, pgUserStateStore, rawRow } from "../../test/helpers/supabaseTestDb";
import { emptyState, type AppState } from "./storage";
import { parseUserStateRow, toUserStateWrite } from "./userState";
import { FALL_2026 } from "../../test/fixtures/fall2026Schedule";
import type { UserStateStore } from "./userStateStore";
import { createUserStateSync, type Timers } from "./userStateSync";

/**
 * The sync controller against a real Postgres running the repo's migrations, so saving,
 * loading and Row Level Security are exercised end to end, minus only the HTTP hop to Supabase.
 */

let db: PGlite;
beforeAll(async () => { db = await createTestDb(); }, 60_000);
afterAll(async () => { await db?.close(); });

const meeting = (over: Partial<CourseMeeting> = {}): CourseMeeting => ({
  id: "cs135-lec", university: "UW", courseCode: "CS 135", courseTitle: "Designing Functional Programs",
  section: "001", component: "LEC", days: ["T", "Th"], start: 780, end: 860,
  location: { kind: "ROOM", buildingCode: "MC", roomNumber: "4020" },
  instructors: ["Someone, A"], source: "QUEST", includeInPlan: true,
  ...over,
});

const onboarded = (): AppState => ({
  ...emptyState(),
  schedule: {
    meetings: [meeting(), meeting({ id: "math135-lec", courseCode: "MATH 135", days: ["M", "W", "F"], start: 870, end: 920, location: { kind: "ROOM", buildingCode: "QNC", roomNumber: "2502" } })],
    term: { season: "Fall", year: 2026, termId: 1269 },
    importedAt: "2026-09-10T12:00:00.000Z",
    source: "QUEST",
  },
  home: { name: "Village 1 (V1)", latitude: 43.4717, longitude: -80.5502, preset: { university: "UW", buildingCode: "V1" } },
  config: { ...DEFAULT_PLANNER_CONFIG, arrivalBufferMinutes: 15 },
  gym: { enabled: true, durationMinutes: 90, preferredTime: "EVENING" },
  routePreference: "INDOORS",
});

/** Timers the test runs by hand, recording each requested delay. */
function manualTimers() {
  let nextId = 1;
  const pending = new Map<number, { fn: () => void; ms: number }>();
  const timers: Timers = {
    set: (fn, ms) => { const id = nextId++; pending.set(id, { fn, ms }); return id; },
    clear: (handle) => { pending.delete(handle as number); },
  };
  return { timers, delays: () => [...pending.values()].map((p) => p.ms), runAll: () => { const all = [...pending.values()]; pending.clear(); all.forEach((p) => p.fn()); } };
}

/** One browser: its local state, and a controller signed in as `user`. */
function openDevice(user: { id: string; email: string }, initial: AppState = emptyState(), store: UserStateStore = pgUserStateStore(db, user)) {
  let state = initial;
  const t = manualTimers();
  const sync = createUserStateSync({ store, userId: user.id, local: { get: () => state, set: (next) => { state = next; } }, timers: t.timers, debounceMs: 1000 });
  return {
    sync,
    timers: t,
    get state() { return state; },
    /** A change made by the student, followed by the notification the provider sends. */
    edit(fn: (s: AppState) => AppState) { state = fn(state); sync.notify(); },
    /** Let any waiting save go out now, and wait for it. */
    async settle() { t.runAll(); await sync.flush(); },
  };
}

/** Counts saves so a test can tell "saved once" from "saved on every keystroke". */
function counting(inner: UserStateStore) {
  const counts = { saves: 0 };
  const store: UserStateStore = { load: (id) => inner.load(id), save: (w) => { counts.saves++; return inner.save(w); }, remove: (id) => inner.remove(id) };
  return { store, counts };
}

/** A store whose network can be switched off. */
function switchable(inner: UserStateStore) {
  const net = { up: false };
  const down = { kind: "error", message: "Failed to fetch" } as const;
  const store: UserStateStore = {
    load: (id) => (net.up ? inner.load(id) : Promise.resolve(down)),
    save: (w) => (net.up ? inner.save(w) : Promise.resolve({ ok: false, message: down.message })),
    remove: (id) => (net.up ? inner.remove(id) : Promise.resolve({ ok: false, message: down.message })),
  };
  return { store, net };
}

async function saveDirectly(user: { id: string; email: string }, state: AppState) {
  const res = await pgUserStateStore(db, user).save(toUserStateWrite(user.id, state));
  expect(res).toEqual({ ok: true });
}

describe("a brand-new student", () => {
  it("has no saved state, so the app shows onboarding and nothing is written", async () => {
    const user = await createUser(db);
    const device = openDevice(user);
    await device.sync.load();
    expect(device.sync.snapshot().status).toBe("ready");
    expect(device.state.schedule).toBeUndefined();
    await device.settle();
    expect(await rawRow(db, user.id)).toBeUndefined();
  });

  it("finishing onboarding saves the schedule and preferences at once", async () => {
    const user = await createUser(db);
    const device = openDevice(user);
    await device.sync.load();

    device.edit((s) => ({ ...onboarded(), sync: s.sync }));
    expect(device.timers.delays()).toEqual([0]);
    await device.settle();

    const row = await rawRow(db, user.id);
    expect(row?.onboarding_complete).toBe(true);
    const saved = parseUserStateRow(row);
    expect(saved.malformed).toBe(false);
    expect(saved.schedule?.meetings.map((m) => m.id)).toEqual(["cs135-lec", "math135-lec"]);
    expect(saved.preferences.home?.name).toBe("Village 1 (V1)");
    expect(saved.preferences.gym).toEqual({ enabled: true, durationMinutes: 90, preferredTime: "EVENING" });
    expect(JSON.stringify(row)).toContain("Someone, A"); // the professor is saved with the schedule
    expect(device.state.sync?.dirtySince).toBeUndefined();
  });
});

describe("a returning student", () => {
  it("gets their schedule on a new device without pasting it again, and nothing is rewritten", async () => {
    const user = await createUser(db);
    await saveDirectly(user, onboarded());
    const before = await rawRow(db, user.id);

    const device = openDevice(user);
    await device.sync.load();
    await device.settle();

    expect(device.sync.snapshot().status).toBe("ready");
    expect(device.state.schedule?.meetings.map((m) => m.courseCode)).toEqual(["CS 135", "MATH 135"]);
    expect(device.state.schedule?.term).toEqual({ season: "Fall", year: 2026, termId: 1269 });
    expect(device.state.sync).toEqual({ ownerId: user.id });
    expect((await rawRow(db, user.id))?.updated_at.getTime()).toBe(before?.updated_at.getTime());
  });

  it("gets their preferences back too", async () => {
    const user = await createUser(db);
    await saveDirectly(user, onboarded());
    const device = openDevice(user);
    await device.sync.load();
    expect(device.state.home).toEqual(onboarded().home);
    expect(device.state.gym).toEqual({ enabled: true, durationMinutes: 90, preferredTime: "EVENING" });
    expect(device.state.routePreference).toBe("INDOORS");
    expect(device.state.config.arrivalBufferMinutes).toBe(15);
  });

  it("replacing the schedule is saved at once, and toggling a class is saved after a pause", async () => {
    const user = await createUser(db);
    await saveDirectly(user, onboarded());
    const device = openDevice(user);
    await device.sync.load();

    device.edit((s) => ({ ...s, schedule: { meetings: [meeting({ id: "stat230-lec", courseCode: "STAT 230" })], importedAt: "2027-01-06T09:00:00.000Z", source: "QUEST" } }));
    expect(device.timers.delays()).toEqual([0]);
    await device.settle();
    const afterReplace = openDevice(user);
    await afterReplace.sync.load();
    expect(afterReplace.state.schedule?.meetings.map((m) => m.courseCode)).toEqual(["STAT 230"]);

    device.edit((s) => ({ ...s, schedule: { ...s.schedule!, meetings: s.schedule!.meetings.map((m) => ({ ...m, includeInPlan: false })) } }));
    expect(device.timers.delays()).toEqual([1000]);
    await device.settle();
    const afterToggle = openDevice(user);
    await afterToggle.sync.load();
    expect(afterToggle.state.schedule?.meetings[0].includeInPlan).toBe(false);
  });

  it("several preference changes in a row become one save, and they persist", async () => {
    const user = await createUser(db);
    await saveDirectly(user, onboarded());
    const { store, counts } = counting(pgUserStateStore(db, user));
    const device = openDevice(user, emptyState(), store);
    await device.sync.load();

    device.edit((s) => ({ ...s, routePreference: "FASTEST" }));
    device.edit((s) => ({ ...s, config: { ...s.config, arrivalBufferMinutes: 5 } }));
    device.edit((s) => ({ ...s, gym: { enabled: false, durationMinutes: 60, preferredTime: "NONE" } }));
    expect(device.timers.delays()).toEqual([1000]);
    expect(counts.saves).toBe(0);
    await device.settle();
    expect(counts.saves).toBe(1);

    const other = openDevice(user);
    await other.sync.load();
    expect(other.state.routePreference).toBe("FASTEST");
    expect(other.state.config.arrivalBufferMinutes).toBe(5);
    expect(other.state.gym?.enabled).toBe(false);
  });

  it("logging out and back in restores everything, including a change made just before logging out", async () => {
    const user = await createUser(db);
    await saveDirectly(user, onboarded());
    const device = openDevice(user);
    await device.sync.load();

    device.edit((s) => ({ ...s, routePreference: "FASTEST" }));
    expect(device.timers.delays()).toEqual([1000]); // still waiting when the student taps Log out
    await device.sync.flush(); // what Settings does before signing out
    device.sync.dispose();

    const signedBackIn = openDevice(user, emptyState()); // signing out cleared the device copy
    await signedBackIn.sync.load();
    expect(signedBackIn.state.schedule?.meetings).toHaveLength(2);
    expect(signedBackIn.state.home?.name).toBe("Village 1 (V1)");
    expect(signedBackIn.state.routePreference).toBe("FASTEST");
  });

  it("Delete everything removes the saved state and does not upload the emptied device", async () => {
    const user = await createUser(db);
    await saveDirectly(user, onboarded());
    const device = openDevice(user);
    await device.sync.load();

    const deleting = device.sync.forget();
    device.edit(() => emptyState()); // the store reset that happens alongside it
    expect(await deleting).toBe(true);
    await device.settle();
    expect(await rawRow(db, user.id)).toBeUndefined();
  });
});

describe("a returning student on a brand-new device (empty local storage)", () => {
  // A realistic term: TBA rooms, ONLINE and unscheduled meetings, one-off test dates. The whole
  // thing must survive the round-trip, or a device 2 would drop the schedule and show onboarding.
  const realState = (): AppState => ({
    ...emptyState(),
    schedule: { meetings: FALL_2026, term: { season: "Fall", year: 2026, termId: 1269 }, importedAt: "2026-09-10T12:00:00.000Z", source: "QUEST" },
    home: { name: "UW Place (UWP)", latitude: 43.4708, longitude: -80.5352, preset: { university: "UW", buildingCode: "UWP" } },
    config: { ...DEFAULT_PLANNER_CONFIG, arrivalBufferMinutes: 5 },
    gym: { enabled: true, durationMinutes: 60, preferredTime: "NONE" },
    routePreference: "FASTEST",
    endOfDay: "LIBRARY",
  });

  it("restores the whole schedule and preferences from Supabase, from truly empty local storage, so onboarding is skipped", async () => {
    const user = await createUser(db);
    await saveDirectly(user, realState()); // device 1 saved it; the row is the only source of truth
    const before = await rawRow(db, user.id);

    // Device 2: a different browser with nothing in local storage.
    const device = openDevice(user, emptyState());
    expect(device.state.schedule).toBeUndefined();
    expect(device.state.home).toBeUndefined();

    await device.sync.load();
    await device.settle();

    expect(device.sync.snapshot().status).toBe("ready");
    // The schedule is back in full (every meeting, including TBA/ONLINE/unscheduled ones).
    expect(device.state.schedule?.meetings.map((m) => m.id)).toEqual(FALL_2026.map((m) => m.id));
    expect(device.state.schedule?.term).toEqual({ season: "Fall", year: 2026, termId: 1269 });
    // ...and the preferences, so the app is fully set up: onboarding is skipped, not re-shown.
    expect(device.state.home?.preset).toEqual({ university: "UW", buildingCode: "UWP" });
    expect(device.state.config.arrivalBufferMinutes).toBe(5);
    expect(device.state.gym).toEqual({ enabled: true, durationMinutes: 60, preferredTime: "NONE" });
    expect(device.state.routePreference).toBe("FASTEST");
    expect(device.state.endOfDay).toBe("LIBRARY");
    // A pure read rewrites nothing.
    expect((await rawRow(db, user.id))?.updated_at.getTime()).toBe(before?.updated_at.getTime());
  });

  it("a new student with no row still gets onboarding, and nothing is written", async () => {
    const user = await createUser(db);
    const device = openDevice(user, emptyState());
    await device.sync.load();
    await device.settle();
    expect(device.sync.snapshot().status).toBe("ready");
    expect(device.state.schedule).toBeUndefined(); // no schedule -> the app shows onboarding
    expect(await rawRow(db, user.id)).toBeUndefined();
  });

  it("a failed read never masquerades as a new student: it errors for retry, then hydrates once the network is back", async () => {
    const user = await createUser(db);
    await saveDirectly(user, realState());
    const { store, net } = switchable(pgUserStateStore(db, user));

    const device = openDevice(user, emptyState(), store);
    await device.sync.load();
    // Not "ready with an empty schedule" (which would send them to onboarding) — an explicit error.
    expect(device.sync.snapshot()).toMatchObject({ status: "error", loadError: "Failed to fetch" });
    expect(device.state.schedule).toBeUndefined();

    net.up = true;
    await device.sync.retry();
    await device.settle();
    expect(device.sync.snapshot().status).toBe("ready");
    expect(device.state.schedule?.meetings).toHaveLength(FALL_2026.length);
    expect(device.state.endOfDay).toBe("LIBRARY");
  });
});

describe("one student's data is private to them", () => {
  it("another student cannot read, create, change or delete it, and anon can do nothing", async () => {
    const a = await createUser(db, "a");
    const b = await createUser(db, "b");
    await saveDirectly(a, onboarded());
    await saveDirectly(b, { ...onboarded(), routePreference: "FASTEST" });
    const bBefore = await rawRow(db, b.id);

    await asUser(db, a, async (tx) => {
      expect((await tx.query("select user_id from public.user_state")).rows).toEqual([{ user_id: a.id }]);
      expect((await tx.query("select 1 from public.user_state where user_id = $1", [b.id])).rows).toHaveLength(0);
      expect((await tx.query("update public.user_state set onboarding_complete = false where user_id = $1", [b.id])).affectedRows).toBe(0);
      expect((await tx.query("delete from public.user_state where user_id = $1", [b.id])).affectedRows).toBe(0);
    });
    const c = await createUser(db, "c"); // created outside A's transaction: PGlite runs one query at a time
    await expect(asUser(db, a, (tx) => tx.query("insert into public.user_state (user_id, preferences) values ($1, '{}')", [c.id])))
      .rejects.toThrow(/row-level security/);
    await expect(asUser(db, a, (tx) => tx.query(
      "insert into public.user_state (user_id, preferences) values ($1, '{}') on conflict (user_id) do update set preferences = excluded.preferences", [b.id],
    ))).rejects.toThrow(/row-level security/);
    await expect(asUser(db, a, (tx) => tx.query("update public.user_state set user_id = $1 where user_id = $2", [b.id, a.id])))
      .rejects.toThrow();

    await expect(asAnon(db, (tx) => tx.query("select * from public.user_state"))).rejects.toThrow(/permission denied/);
    await expect(asAnon(db, (tx) => tx.query("insert into public.user_state (user_id, preferences) values ($1, '{}')", [b.id]))).rejects.toThrow(/permission denied/);

    // Through the same operations the app uses.
    const aStore = pgUserStateStore(db, a);
    expect(await aStore.load(b.id)).toEqual({ kind: "none" });
    expect((await aStore.save({ ...toUserStateWrite(b.id, emptyState()) })).ok).toBe(false);
    expect(await aStore.remove(b.id)).toEqual({ ok: true }); // deletes nothing: RLS hides the row
    const bAfter = await rawRow(db, b.id);
    expect(bAfter?.updated_at.getTime()).toBe(bBefore?.updated_at.getTime());
    expect(parseUserStateRow(bAfter).preferences.routePreference).toBe("FASTEST");
  });

  it("a shared device holding another student's copy never shows or uploads it", async () => {
    const a = await createUser(db, "a");
    const b = await createUser(db, "b");
    const aDevice = openDevice(a);
    await aDevice.sync.load();
    aDevice.edit((s) => ({ ...onboarded(), sync: s.sync }));
    await aDevice.settle();
    aDevice.sync.dispose();

    const bDevice = openDevice(b, aDevice.state); // same browser, B signs in without A logging out
    await bDevice.sync.load();
    await bDevice.settle();
    expect(bDevice.state.schedule).toBeUndefined();
    expect(bDevice.state.home).toBeUndefined();
    expect(await rawRow(db, b.id)).toBeUndefined();
  });
});

describe("a double degree student's Laurier courses", () => {
  it("keep their Laurier code, room and professor across a new device and a fresh sign-in", async () => {
    const user = await createUser(db);
    const laurier: CourseMeeting = {
      id: "bus352-lec", university: "WLU", courseCode: "BUS 352W", laurierCode: "BU352",
      courseTitle: "Business Finance", section: "999", component: "LEC",
      days: ["T", "Th"], start: 870, end: 950,
      location: { kind: "ROOM", buildingCode: "LH", roomNumber: "1001" },
      instructors: ["Ravi Patel"], source: "QUEST", includeInPlan: true,
    };
    const device = openDevice(user);
    await device.sync.load();
    device.edit((s) => ({
      ...onboarded(),
      schedule: { ...onboarded().schedule!, meetings: [...onboarded().schedule!.meetings, laurier] },
      sync: s.sync,
    }));
    await device.settle();

    // A different device, with nothing in local storage at all.
    const fresh = openDevice(user);
    await fresh.sync.load();
    const restored = fresh.state.schedule?.meetings.find((m) => m.id === "bus352-lec");
    expect(restored).toBeDefined();
    expect(restored).toMatchObject({
      university: "WLU",
      laurierCode: "BU352",
      instructors: ["Ravi Patel"],
      location: { kind: "ROOM", buildingCode: "LH", roomNumber: "1001" },
    });
    // ...and the Waterloo courses and preferences came back untouched alongside it.
    expect(fresh.state.schedule?.meetings.map((m) => m.id)).toContain("cs135-lec");
    expect(fresh.state.home?.name).toBe("Village 1 (V1)");
  });
});

describe("failures", () => {
  it("malformed saved data fails safely: nothing throws, onboarding shows, and the row is not rewritten", async () => {
    const user = await createUser(db);
    await db.query(
      "insert into public.user_state (user_id, schedule, preferences, onboarding_complete) values ($1, $2::jsonb, $3::jsonb, true)",
      [user.id, JSON.stringify({ meetings: [{ id: 7 }, { courseCode: "CS 135" }], importedAt: "yesterday" }), JSON.stringify({ arrivalBufferMinutes: "ten", gym: "always", home: { name: "x", latitude: 999, longitude: 0 } })],
    );
    const before = await rawRow(db, user.id);

    const device = openDevice(user);
    await device.sync.load();
    await device.settle();
    expect(device.sync.snapshot().status).toBe("ready");
    expect(device.state.schedule).toBeUndefined();
    expect(device.state.home).toBeUndefined();
    expect(device.state.config.arrivalBufferMinutes).toBe(DEFAULT_PLANNER_CONFIG.arrivalBufferMinutes);
    expect((await rawRow(db, user.id))?.updated_at.getTime()).toBe(before?.updated_at.getTime());

    // The student's own device still has a good copy: it replaces the broken row.
    const ownDevice = openDevice(user, { ...onboarded(), sync: { ownerId: user.id } });
    await ownDevice.sync.load();
    await ownDevice.settle();
    const repaired = parseUserStateRow(await rawRow(db, user.id));
    expect(repaired.malformed).toBe(false);
    expect(repaired.onboardingComplete).toBe(true);
  });

  it("the database rejects rows that are not the expected shape", async () => {
    const user = await createUser(db);
    await expect(asUser(db, user, (tx) => tx.query("insert into public.user_state (user_id, schedule, preferences) values ($1, '\"garbage\"', '{}')", [user.id])))
      .rejects.toThrow(/user_state_schedule_shape/);
    await expect(asUser(db, user, (tx) => tx.query("insert into public.user_state (user_id, schedule, preferences, onboarding_complete) values ($1, null, '{}', true)", [user.id])))
      .rejects.toThrow(/user_state_complete_needs_schedule/);
  });

  it("a failed read leaves the device untouched, saves nothing, and uploads the student's changes once it works", async () => {
    const user = await createUser(db);
    await saveDirectly(user, onboarded());
    const { store, net } = switchable(pgUserStateStore(db, user));
    const device = openDevice(user, { ...onboarded(), sync: { ownerId: user.id } }, store);

    await device.sync.load();
    expect(device.sync.snapshot()).toMatchObject({ status: "error", loadError: "Failed to fetch" });
    expect(device.state.schedule?.meetings).toHaveLength(2);

    device.sync.continueOffline();
    // Only an edit made after the account's copy counts as newer. Both times are read in whole
    // milliseconds, so an edit in the same millisecond as the save would tie and lose.
    await new Promise((r) => setTimeout(r, 5));
    device.edit((s) => ({ ...s, routePreference: "FASTEST" }));
    expect(device.timers.delays()).toEqual([]);
    expect(device.state.sync?.dirtySince).toBeDefined();
    expect(parseUserStateRow(await rawRow(db, user.id)).preferences.routePreference).toBe("INDOORS");

    net.up = true;
    await device.sync.retry();
    await device.settle();
    expect(device.sync.snapshot().status).toBe("ready");
    expect(parseUserStateRow(await rawRow(db, user.id)).preferences.routePreference).toBe("FASTEST");
    expect(device.state.sync?.dirtySince).toBeUndefined();
  });

  it("a failed save keeps the change on the device and reports it, and retry sends it", async () => {
    const user = await createUser(db);
    await saveDirectly(user, onboarded());
    const { store, net } = switchable(pgUserStateStore(db, user));
    net.up = true;
    const device = openDevice(user, emptyState(), store);
    await device.sync.load();

    net.up = false;
    device.edit((s) => ({ ...s, gym: { enabled: false, durationMinutes: 45, preferredTime: "MORNING" } }));
    await device.settle();
    expect(device.sync.snapshot().saveError).toBe("Failed to fetch");
    expect(device.state.gym?.durationMinutes).toBe(45);

    net.up = true;
    await device.sync.retry();
    expect(device.sync.snapshot().saveError).toBeUndefined();
    expect(parseUserStateRow(await rawRow(db, user.id)).preferences.gym?.durationMinutes).toBe(45);
  });
});
