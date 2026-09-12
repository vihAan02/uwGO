/**
 * Crowdsourced closures: when enough students agree a segment of the campus network is shut,
 * routing stops using it.
 *
 * Everything here is pure. The database counts the reports (see the
 * `route_closure_consensus` view) and this decides what those counts mean, so the rule can be
 * tested without a database and cannot drift between the routing code and the UI.
 */

export const CLOSURE_POLICY = {
  /**
   * Distinct accounts that must agree before a segment is treated as shut for everyone. Five is
   * high enough that one person having a bad day, or one locked door at an odd hour, does not
   * divert the whole campus, and low enough to be reached quickly when something is genuinely
   * blocked at a busy time.
   */
  consensus: 5,
  /**
   * How long a report counts for. Campus closures are mostly same-day facts: a tunnel locked for
   * an event, a corridor shut for cleaning, a path behind hoarding for a morning. A day is long
   * enough that something found in the morning still diverts the evening rush, and short enough
   * that a closure cleared overnight is not still in force the next afternoon. A closure that
   * really lasts weeks stays in force because people keep meeting it and reporting it, and each
   * report refreshes that account's row rather than adding another.
   */
  windowMs: 24 * 60 * 60 * 1000,
} as const;

/** One student's report, as stored. `reporterId` never leaves the database in practice. */
export interface ClosureReport {
  edgeId: string;
  reporterId: string;
  reportedAt: string | number | Date;
  status?: "CLOSED" | "OPEN";
}

/** What the anonymised view returns: a tally per segment, with no identities in it. */
export interface ClosureTally {
  edgeId: string;
  reports: number;
  latest?: string | number | Date;
}

const time = (v: string | number | Date): number => (v instanceof Date ? v.getTime() : typeof v === "number" ? v : Date.parse(v));

/** Reports still inside the window, counted once per account per segment. */
export function tallyReports(reports: readonly ClosureReport[], now: Date = new Date(), policy = CLOSURE_POLICY): ClosureTally[] {
  const cutoff = now.getTime() - policy.windowMs;
  const byEdge = new Map<string, { reporters: Set<string>; latest: number }>();
  for (const r of reports) {
    if ((r.status ?? "CLOSED") !== "CLOSED") continue;
    const at = time(r.reportedAt);
    if (!Number.isFinite(at) || at <= cutoff) continue;
    const entry = byEdge.get(r.edgeId) ?? { reporters: new Set<string>(), latest: 0 };
    entry.reporters.add(r.reporterId);
    entry.latest = Math.max(entry.latest, at);
    byEdge.set(r.edgeId, entry);
  }
  return [...byEdge.entries()].map(([edgeId, e]) => ({ edgeId, reports: e.reporters.size, latest: new Date(e.latest).toISOString() }));
}

/** The segments routing must avoid, from tallies the database has already counted. */
export function closedEdgeIds(tallies: readonly ClosureTally[], now: Date = new Date(), policy = CLOSURE_POLICY): Set<string> {
  const cutoff = now.getTime() - policy.windowMs;
  const closed = new Set<string>();
  for (const t of tallies) {
    if (t.reports < policy.consensus) continue;
    // The view already filters by age, but a tally read a while ago must not outlive its reports.
    if (t.latest !== undefined && time(t.latest) <= cutoff) continue;
    closed.add(t.edgeId);
  }
  return closed;
}

/** The same answer straight from raw reports, for tests and for anything holding the rows. */
export function closedFromReports(reports: readonly ClosureReport[], now: Date = new Date(), policy = CLOSURE_POLICY): Set<string> {
  return closedEdgeIds(tallyReports(reports, now, policy), now, policy);
}

/** How many more accounts would have to agree before a segment closed. */
export function reportsUntilClosed(tally: ClosureTally | undefined, policy = CLOSURE_POLICY): number {
  return Math.max(0, policy.consensus - (tally?.reports ?? 0));
}
