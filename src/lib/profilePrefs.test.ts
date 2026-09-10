import { describe, expect, it } from "vitest";
import { prefsFromRow, prefsKeyOf, rowMatches, toRow, type Prefs, type ProfileRow } from "./profilePrefs";

const local: Prefs = { gym: { enabled: true, durationMinutes: 60, preferredTime: "NONE" }, routePreference: "INDOORS", arrivalBufferMinutes: 10 };
const fresh: ProfileRow = { id: "u1", email: "a@uwaterloo.ca", gym_enabled: null, gym_duration_minutes: null, gym_preferred_time: null, route_preference: null, arrival_buffer_minutes: null };

describe("profile preference mapping", () => {
  it("a row written from the device reads back as the same preferences", () => {
    const row = toRow("u1", "a@uwaterloo.ca", local);
    expect(prefsKeyOf(prefsFromRow(row, 15))).toBe(prefsKeyOf(local));
    expect(rowMatches(row, local)).toBe(true);
  });

  it("a fresh profile does not match a device that has answers, so the device uploads", () => {
    expect(rowMatches(fresh, local)).toBe(false);
  });

  it("a fresh profile gives a new device nothing to adopt except its own buffer", () => {
    expect(prefsFromRow(fresh, 10)).toEqual({ gym: undefined, routePreference: undefined, arrivalBufferMinutes: 10 });
    expect(rowMatches({ ...fresh, arrival_buffer_minutes: 10 }, { arrivalBufferMinutes: 10 })).toBe(true);
  });

  it("the comparison key ignores field order inside gym", () => {
    const shuffled: Prefs = { ...local, gym: { preferredTime: "NONE", durationMinutes: 60, enabled: true } };
    expect(prefsKeyOf(shuffled)).toBe(prefsKeyOf(local));
  });
});
