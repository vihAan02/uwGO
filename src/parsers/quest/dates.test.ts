import { describe, it, expect } from "vitest";
import { inferDateOrder, parseDateAs, termIdOf } from "./dates";
import { parseDayTokens } from "./days";

const fall2025 = { season: "Fall" as const, year: 2025, termId: 1259 };
const winter2020 = { season: "Winter" as const, year: 2020, termId: 1201 };

describe("date order inference", () => {
  it("DD/MM/YYYY (Fall 2025 real fixture)", () => {
    const r = inferDateOrder([{ start: "03/09/2025", end: "02/12/2025" }], fall2025);
    expect(r).toEqual({ order: "DMY", ambiguous: false });
    expect(parseDateAs("03/09/2025", "DMY")).toBe("2025-09-03");
  });
  it("MM/DD/YYYY (Winter 2020 real fixture, incl. a single-day TST range)", () => {
    const r = inferDateOrder([{ start: "01/06/2020", end: "04/03/2020" }, { start: "02/25/2020", end: "02/25/2020" }], winter2020);
    expect(r.order).toBe("MDY");
  });
  it("YYYY/MM/DD (Fall 2021 real fixture)", () => {
    expect(inferDateOrder([{ start: "2021/09/08", end: "2021/12/07" }], { season: "Fall", year: 2021, termId: 1219 }).order).toBe("YMD");
    expect(parseDateAs("2021/9/8", "YMD")).toBe("2021-09-08");
  });
  it("MM/DD/YYYY for a Fall term when DMY would run backwards (09/09/2026 - 12/08/2026)", () => {
    expect(inferDateOrder([{ start: "09/09/2026", end: "12/08/2026" }], { season: "Fall", year: 2026, termId: 1269 }).order).toBe("MDY");
  });
  it("uses the term window to disambiguate when both orders are valid", () => {
    expect(inferDateOrder([{ start: "05/01/2026", end: "08/01/2026" }], { season: "Spring", year: 2026, termId: 1265 }).order).toBe("MDY");
  });
  it("reports UNKNOWN + ambiguous when nothing disambiguates", () => {
    const r = inferDateOrder([{ start: "01/02/2026", end: "03/04/2026" }]);
    expect(r).toEqual({ order: "UNKNOWN", ambiguous: true });
  });
  it("rejects impossible dates", () => {
    expect(parseDateAs("31/02/2026", "DMY")).toBeUndefined();
    expect(parseDateAs("13/01/2026", "MDY")).toBeUndefined();
    expect(inferDateOrder([{ start: "31/13/2026", end: "31/13/2026" }]).order).toBe("UNKNOWN");
  });
  it("term ids follow Quest's scheme", () => {
    expect(termIdOf("Fall", 2019)).toBe(1199);
    expect(termIdOf("Spring", 2013)).toBe(1135);
    expect(termIdOf("Winter", 2026)).toBe(1261);
  });
});

describe("day tokens", () => {
  it("parses concatenated tokens", () => {
    expect(parseDayTokens("MWF")).toEqual(["M", "W", "F"]);
    expect(parseDayTokens("TTh")).toEqual(["T", "Th"]);
    expect(parseDayTokens("ThF")).toEqual(["Th", "F"]);
    expect(parseDayTokens("Th")).toEqual(["Th"]);
    expect(parseDayTokens("MTWThF")).toEqual(["M", "T", "W", "Th", "F"]);
    expect(parseDayTokens("SaSu")).toEqual(["S", "Su"]);
    expect(parseDayTokens("SU")).toEqual(["S", "Su"]);
    expect(parseDayTokens("FM")).toEqual(["M", "F"]);
  });
  it("rejects garbage", () => {
    expect(parseDayTokens("TBA")).toBeUndefined();
    expect(parseDayTokens("Mon")).toBeUndefined();
    expect(parseDayTokens("")).toBeUndefined();
  });
});
