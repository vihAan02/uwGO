import { describe, expect, it } from "vitest";
import { CLOSURE_POLICY, closedEdgeIds, closedFromReports, reportsUntilClosed, tallyReports, type ClosureReport } from "./closures";

const EDGE = "a1b2c3d4e5f60718";
const OTHER = "0f1e2d3c4b5a6978";
const NOW = new Date("2026-09-11T15:00:00Z");
const agoHours = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

const report = (reporterId: string, over: Partial<ClosureReport> = {}): ClosureReport => ({
  edgeId: EDGE, reporterId, reportedAt: agoHours(1), ...over,
});

const people = (n: number) => Array.from({ length: n }, (_, i) => report(`student-${i}`));

describe("how many students it takes to close a segment", () => {
  it("leaves the segment open for one to four accounts", () => {
    for (let n = 1; n <= 4; n++) {
      expect(closedFromReports(people(n), NOW).has(EDGE), `${n} reports`).toBe(false);
    }
  });

  it("closes it once five different accounts agree", () => {
    expect(closedFromReports(people(5), NOW).has(EDGE)).toBe(true);
    expect(closedFromReports(people(9), NOW).has(EDGE)).toBe(true);
    expect(CLOSURE_POLICY.consensus).toBe(5);
  });

  it("counts one account once, however many times it reports", () => {
    const spam = Array.from({ length: 20 }, () => report("keen-student"));
    expect(tallyReports(spam, NOW)).toEqual([{ edgeId: EDGE, reports: 1, latest: agoHours(1) }]);
    expect(closedFromReports(spam, NOW).has(EDGE)).toBe(false);
  });

  it("only closes the segment that was reported", () => {
    const closed = closedFromReports(people(5), NOW);
    expect(closed.has(EDGE)).toBe(true);
    expect(closed.has(OTHER)).toBe(false);
    expect(closed.size).toBe(1);
  });
});

describe("closures do not last forever", () => {
  it("ignores reports older than the window", () => {
    const stale = people(5).map((r) => ({ ...r, reportedAt: agoHours(25) }));
    expect(closedFromReports(stale, NOW).has(EDGE)).toBe(false);
    expect(CLOSURE_POLICY.windowMs).toBe(24 * 60 * 60 * 1000);
  });

  it("stops counting a segment once its reports go stale, without anyone doing anything", () => {
    const reports = people(5).map((r) => ({ ...r, reportedAt: agoHours(23) }));
    expect(closedFromReports(reports, NOW).has(EDGE)).toBe(true);
    const twoHoursLater = new Date(NOW.getTime() + 2 * 3_600_000);
    expect(closedFromReports(reports, twoHoursLater).has(EDGE)).toBe(false);
  });

  it("a fresh report reconfirms the closure for another full window", () => {
    const old = people(5).map((r) => ({ ...r, reportedAt: agoHours(23) }));
    const later = new Date(NOW.getTime() + 2 * 3_600_000);
    const renewed = old.map((r) => ({ ...r, reportedAt: later.toISOString() }));
    expect(closedFromReports(renewed, later).has(EDGE)).toBe(true);
  });

  it("needs five accounts still inside the window, not five ever", () => {
    const mixed = [...people(3), report("late-1", { reportedAt: agoHours(30) }), report("late-2", { reportedAt: agoHours(48) })];
    expect(closedFromReports(mixed, NOW).has(EDGE)).toBe(false);
  });

  it("ignores a report that has been withdrawn", () => {
    const withdrawn = [...people(4), report("student-4", { status: "OPEN" })];
    expect(closedFromReports(withdrawn, NOW).has(EDGE)).toBe(false);
  });
});

describe("reading the database's own tallies", () => {
  it("closes on a tally that meets the threshold and is still fresh", () => {
    expect(closedEdgeIds([{ edgeId: EDGE, reports: 5, latest: agoHours(2) }], NOW).has(EDGE)).toBe(true);
    expect(closedEdgeIds([{ edgeId: EDGE, reports: 4, latest: agoHours(2) }], NOW).has(EDGE)).toBe(false);
  });

  it("refuses a tally whose reports have aged out since it was read", () => {
    expect(closedEdgeIds([{ edgeId: EDGE, reports: 8, latest: agoHours(26) }], NOW).has(EDGE)).toBe(false);
  });

  it("says how many more accounts a segment needs", () => {
    expect(reportsUntilClosed({ edgeId: EDGE, reports: 2 })).toBe(3);
    expect(reportsUntilClosed(undefined)).toBe(5);
    expect(reportsUntilClosed({ edgeId: EDGE, reports: 7 })).toBe(0);
  });
});
