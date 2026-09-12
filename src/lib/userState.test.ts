import { describe, expect, it } from "vitest";
import type { CourseMeeting } from "@/domain/types";
import { DEFAULT_PLANNER_CONFIG } from "@/domain/config";
import { emptyState, type AppState } from "./storage";
import {
  applyAccount, decideOnLoad, isMilestone, parseUserStateRow, persistedKey, sanitizeHome, sanitizeMeeting,
  sanitizePreferences, sanitizeSchedule, toUserStateWrite, type SavedAccountState,
} from "./userState";

const UID = "11111111-1111-4111-8111-111111111111";

const meeting = (over: Partial<CourseMeeting> = {}): CourseMeeting => ({
  id: "cs135-lec", university: "UW", courseCode: "CS 135", courseTitle: "Designing Functional Programs",
  section: "001", component: "LEC", days: ["T", "Th"], start: 780, end: 860,
  startDate: "2026-09-08", endDate: "2026-12-08",
  location: { kind: "ROOM", buildingCode: "MC", roomNumber: "4020" },
  instructors: ["Someone, A"], source: "QUEST", includeInPlan: true,
  ...over,
});

const signedUpState = (): AppState => ({
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
  endOfDay: "LIBRARY",
});

const account = (over: Partial<SavedAccountState> = {}): SavedAccountState => ({
  preferences: { arrivalBufferMinutes: 10 }, onboardingComplete: false, malformed: false, updatedAt: "2026-09-11T10:00:00.000Z", ...over,
});

describe("mapping app state to the account row", () => {
  it("a saved state reads back as the same schedule and preferences, professor included", () => {
    const original = signedUpState();
    const write = toUserStateWrite(UID, original);
    expect(write.user_id).toBe(UID);
    expect(write.onboarding_complete).toBe(true);
    // The professor travels with the account now: the Courses tab shows it, and for a
    // Laurier-hosted course it is exactly what Quest could not supply.
    expect(JSON.stringify(write)).toContain("Someone, A");

    const read = parseUserStateRow(JSON.parse(JSON.stringify({ ...write, updated_at: "2026-09-11T10:00:00Z" })));
    expect(read.malformed).toBe(false);
    expect(read.onboardingComplete).toBe(true);
    const restored = applyAccount(emptyState(), read, UID);
    expect(persistedKey(restored)).toBe(persistedKey(original));
    expect(restored.home).toEqual(original.home);
    expect(restored.gym).toEqual(original.gym);
    expect(restored.routePreference).toBe("INDOORS");
    expect(restored.endOfDay).toBe("LIBRARY");
    expect(restored.config.arrivalBufferMinutes).toBe(15);
    expect(restored.sync).toEqual({ ownerId: UID });
    expect(restored.schedule?.meetings[0].instructors).toEqual(["Someone, A"]);
  });

  it("the end-of-day destination persists and a bad one is dropped", () => {
    expect(sanitizePreferences({ endOfDay: "GYM" }).preferences.endOfDay).toBe("GYM");
    const bad = sanitizePreferences({ endOfDay: "MARS" });
    expect(bad.preferences.endOfDay).toBeUndefined();
    expect(bad.dropped).toBe(1);
    // It changes the saved-state key, so a change to it is actually saved.
    const s = signedUpState();
    expect(persistedKey({ ...s, endOfDay: "GYM" })).not.toBe(persistedKey(s));
  });

  it("course colours travel with the account, and a bad entry is dropped rather than trusted", () => {
    const s: AppState = { ...signedUpState(), courseColors: { math135: "purple", cs135: "sky" } };
    const read = parseUserStateRow(JSON.parse(JSON.stringify({ ...toUserStateWrite(UID, s), updated_at: "2026-09-11T10:00:00Z" })));
    expect(read.malformed).toBe(false);
    expect(applyAccount(emptyState(), read, UID).courseColors).toEqual({ math135: "purple", cs135: "sky" });
    // A colour change is a change worth saving; a student who never picked one writes nothing new.
    expect(persistedKey({ ...s, courseColors: { math135: "green" } })).not.toBe(persistedKey(s));
    expect(JSON.stringify(toUserStateWrite(UID, signedUpState()))).not.toContain("courseColors");

    const bad = sanitizePreferences({ courseColors: { math135: "neon", "CS 135": "blue", econ101: "green" } });
    expect(bad.preferences.courseColors).toEqual({ econ101: "green" });
    expect(bad.dropped).toBe(2);
    expect(decideOnLoad(emptyState(), account({ preferences: { arrivalBufferMinutes: 10, courseColors: { cs135: "red" } } }))).toBe("HYDRATE");
  });

  it("onboarding is complete only with both a schedule and a home", () => {
    const s = signedUpState();
    expect(toUserStateWrite(UID, { ...s, home: undefined }).onboarding_complete).toBe(false);
    expect(toUserStateWrite(UID, { ...s, schedule: undefined }).onboarding_complete).toBe(false);
    expect(toUserStateWrite(UID, { ...s, schedule: undefined }).schedule).toBeNull();
  });

  it("the saved-state key ignores gap answers, sync bookkeeping and key order", () => {
    const s = signedUpState();
    const withNoise: AppState = { ...s, gapChoices: { byDate: { "2026-09-10|x": { kind: "STAY" } }, byClass: {} }, sync: { ownerId: UID, dirtySince: "2026-09-11T00:00:00Z" } };
    expect(persistedKey(withNoise)).toBe(persistedKey(s));
    const reordered: AppState = { ...s, gym: { preferredTime: "EVENING", durationMinutes: 90, enabled: true } };
    expect(persistedKey(reordered)).toBe(persistedKey(s));
    expect(persistedKey({ ...s, routePreference: "FASTEST" })).not.toBe(persistedKey(s));
  });
});

describe("malformed rows fail safely", () => {
  it("never throws, and yields no schedule, default preferences and a malformed flag", () => {
    for (const raw of [null, undefined, "garbage", 42, [], { schedule: "garbage", preferences: 5, onboarding_complete: "yes" }]) {
      const read = parseUserStateRow(raw);
      expect(read.schedule).toBeUndefined();
      expect(read.onboardingComplete).toBe(false);
      expect(read.preferences.arrivalBufferMinutes).toBe(DEFAULT_PLANNER_CONFIG.arrivalBufferMinutes);
      expect(read.malformed).toBe(true);
    }
  });

  it("drops invalid or duplicate meetings and keeps the good ones", () => {
    const good = meeting();
    const { schedule, dropped } = sanitizeSchedule({
      meetings: [
        good,
        { id: 1 },
        { ...good, id: "late", start: 2000 },
        { ...good, id: "bad-date", startDate: "soon" },
        { ...good, id: "bad-day", days: ["Funday"] },
        { ...good, id: "bad-room", location: { kind: "ROOM", buildingCode: "" } },
        good,
      ],
      importedAt: "2026-09-10T12:00:00Z",
      source: "QUEST",
    });
    expect(schedule?.meetings.map((m) => m.id)).toEqual([good.id]);
    expect(dropped).toBe(6);
    expect(sanitizeSchedule({ meetings: [{ nope: true }] }).schedule).toBeUndefined();
  });

  it("an unusable schedule turns off onboarding even if the row claims it is complete", () => {
    const read = parseUserStateRow({ schedule: { meetings: [{ id: "x" }] }, preferences: {}, onboarding_complete: true, updated_at: "2026-09-11T10:00:00Z" });
    expect(read.onboardingComplete).toBe(false);
    expect(read.malformed).toBe(true);
  });

  it("validates home and preferences field by field", () => {
    expect(sanitizeHome({ name: "Home", latitude: 91, longitude: 0 })).toBeUndefined();
    expect(sanitizeHome({ name: "Home", latitude: "43", longitude: -80 })).toBeUndefined();
    expect(sanitizeHome({ name: "Home", latitude: 43.4, longitude: -80.5, preset: { university: "MIT", buildingCode: "V1" } })).toBeUndefined();
    expect(sanitizeHome({ name: "Home", latitude: 43.4, longitude: -80.5, address: "200 University Ave W" })).toEqual({ name: "Home", latitude: 43.4, longitude: -80.5, address: "200 University Ave W" });

    const { preferences, dropped } = sanitizePreferences({ arrivalBufferMinutes: 7, gym: "yes", routePreference: "BUS", home: { name: "x" } });
    expect(preferences).toEqual({ arrivalBufferMinutes: DEFAULT_PLANNER_CONFIG.arrivalBufferMinutes });
    expect(dropped).toBe(4);
    expect(sanitizePreferences({ gym: { enabled: true, durationMinutes: 75, preferredTime: "DAWN" } }).preferences.gym)
      .toEqual({ enabled: true, durationMinutes: 60, preferredTime: "NONE" });
  });

  it("a meeting with the wrong types is rejected rather than coerced", () => {
    expect(sanitizeMeeting({ ...meeting(), includeInPlan: "true" })).toBeUndefined();
    expect(sanitizeMeeting({ ...meeting(), source: "SCRAPED" })).toBeUndefined();
    expect(sanitizeMeeting({ ...meeting(), classNumber: 1.5 })).toBeUndefined();
  });

  it("keeps the professor and the Laurier code, and refuses a malformed list", () => {
    const m = sanitizeMeeting(meeting({ university: "WLU", courseCode: "BUS 352W", laurierCode: "BU352", instructors: ["Tatarko, K"] }));
    expect(m?.instructors).toEqual(["Tatarko, K"]);
    expect(m?.laurierCode).toBe("BU352");
    expect(sanitizeMeeting(meeting({ instructors: [42] as unknown as string[] }))).toBeUndefined();
    expect(sanitizeMeeting(meeting({ instructors: "Solo" as unknown as string[] }))).toBeUndefined();
    expect(sanitizeMeeting(meeting({ laurierCode: "" }))).toBeUndefined();
  });
});

describe("deciding what to do when the saved state arrives", () => {
  const empty = emptyState();
  const device = signedUpState();

  it("a brand-new student with nothing anywhere goes to onboarding", () => {
    expect(decideOnLoad(empty, undefined)).toBe("KEEP");
  });

  it("a returning student on an empty device gets the account's schedule", () => {
    const read = parseUserStateRow({ ...toUserStateWrite(UID, device), updated_at: "2026-09-11T10:00:00Z" });
    expect(decideOnLoad(empty, read)).toBe("HYDRATE");
  });

  it("a device that has a schedule the account lacks uploads it", () => {
    expect(decideOnLoad(device, undefined)).toBe("UPLOAD");
    expect(decideOnLoad(device, account({ preferences: { arrivalBufferMinutes: 5 } }))).toBe("UPLOAD");
  });

  it("an empty device takes preferences carried over from before accounts had schedules", () => {
    expect(decideOnLoad(empty, account({ preferences: { arrivalBufferMinutes: 5, routePreference: "INDOORS" } }))).toBe("HYDRATE");
  });

  it("unsaved device changes win only when they are newer than the row", () => {
    const withSchedule = account({ schedule: device.schedule, onboardingComplete: true });
    const newer: AppState = { ...device, sync: { ownerId: UID, dirtySince: "2026-09-11T11:00:00Z" } };
    const older: AppState = { ...device, sync: { ownerId: UID, dirtySince: "2026-09-11T09:00:00Z" } };
    expect(decideOnLoad(newer, withSchedule)).toBe("UPLOAD");
    expect(decideOnLoad(older, withSchedule)).toBe("HYDRATE");
  });

  it("an empty device never overwrites the account, even if marked as changed", () => {
    const dirtyEmpty: AppState = { ...empty, sync: { ownerId: UID, dirtySince: "2030-01-01T00:00:00Z" } };
    expect(decideOnLoad(dirtyEmpty, account({ schedule: device.schedule, onboardingComplete: true }))).toBe("HYDRATE");
    expect(decideOnLoad(dirtyEmpty, undefined)).toBe("KEEP");
  });

  it("a malformed row on an empty device is left alone and the student onboards", () => {
    expect(decideOnLoad(empty, parseUserStateRow({ schedule: { meetings: "nope" }, preferences: [], onboarding_complete: true }))).toBe("KEEP");
  });

  it("taking the account's schedule forgets gap answers for classes that no longer exist", () => {
    const local: AppState = { ...empty, gapChoices: { byDate: {}, byClass: { "cs135-lec:T": { kind: "REZ" }, "gone:M": { kind: "GYM" } } } };
    const restored = applyAccount(local, account({ schedule: { ...device.schedule!, meetings: [meeting()] }, onboardingComplete: true }), UID);
    expect(Object.keys(restored.gapChoices?.byClass ?? {})).toEqual(["cs135-lec:T"]);
  });
});

describe("which saves go out at once", () => {
  const base = toUserStateWrite(UID, signedUpState());
  it("the first save, finishing onboarding, and replacing the schedule are immediate", () => {
    expect(isMilestone(undefined, base)).toBe(true);
    expect(isMilestone({ ...base, onboarding_complete: false }, base)).toBe(true);
    expect(isMilestone(base, { ...base, schedule: { ...base.schedule!, importedAt: "2026-09-12T00:00:00Z" } })).toBe(true);
  });
  it("preference tweaks and class toggles wait for the debounce", () => {
    expect(isMilestone(base, { ...base, preferences: { ...base.preferences, routePreference: "FASTEST" } })).toBe(false);
    expect(isMilestone(base, { ...base, schedule: { ...base.schedule!, meetings: base.schedule!.meetings.map((m) => ({ ...m, includeInPlan: false })) } })).toBe(false);
  });
});
