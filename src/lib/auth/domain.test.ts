import { describe, expect, it } from "vitest";
import { isAllowedEmail, normalizeEmail } from "./domain";

describe("Waterloo-only email check", () => {
  it("allows uwaterloo.ca in any casing", () => {
    expect(isAllowedEmail("student@uwaterloo.ca")).toBe(true);
    expect(isAllowedEmail("STUDENT@UWATERLOO.CA")).toBe(true);
    expect(isAllowedEmail("  d123mugh@uwaterloo.ca \n")).toBe(true);
  });
  it("blocks other providers, Laurier, and look-alike domains", () => {
    expect(isAllowedEmail("student@gmail.com")).toBe(false);
    expect(isAllowedEmail("student@wlu.ca")).toBe(false);
    expect(isAllowedEmail("student@uwaterloo.ca.fake.com")).toBe(false);
    expect(isAllowedEmail("student@fake-uwaterloo.ca")).toBe(false);
    expect(isAllowedEmail("student@mail.uwaterloo.ca")).toBe(false);
    expect(isAllowedEmail("student@uwaterloo.ca@gmail.com")).toBe(false);
    expect(isAllowedEmail("uwaterloo.ca")).toBe(false);
    expect(isAllowedEmail("@uwaterloo.ca")).toBe(false);
    expect(isAllowedEmail("")).toBe(false);
  });
  it("normalises casing and whitespace only", () => {
    expect(normalizeEmail("  User@UWaterloo.CA ")).toBe("user@uwaterloo.ca");
  });
});
