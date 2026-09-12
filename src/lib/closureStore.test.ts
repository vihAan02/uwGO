import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asAnon, asUser, createTestDb, createUser } from "../../test/helpers/supabaseTestDb";

/**
 * The closure table against a real Postgres with the repo's own migrations applied, so Row Level
 * Security is exercised as written. What matters here: a student can only ever speak for
 * themselves, nobody can find out who reported what, and the shared tally is counted rather
 * than stored.
 */
let db: PGlite;
beforeAll(async () => { db = await createTestDb(); }, 60_000);
afterAll(async () => { await db?.close(); });

const EDGE = "a1b2c3d4e5f60718";
const OTHER = "0f1e2d3c4b5a6978";

const fileReport = (user: { id: string; email?: string }, edgeId: string) =>
  asUser(db, user, (tx) => tx.query(
    `insert into public.route_closure_reports (reporter_id, edge_id) values ($1, $2)
     on conflict (reporter_id, edge_id) do update set status = 'CLOSED'`,
    [user.id, edgeId],
  ));

const tally = (user: { id: string; email?: string }, edgeId: string) =>
  asUser(db, user, async (tx) => (await tx.query<{ edge_id: string; reports: number }>(
    "select edge_id, reports from public.route_closure_consensus where edge_id = $1", [edgeId],
  )).rows[0]);

describe("filing a closure report", () => {
  it("records one report, and reporting again refreshes it rather than adding a second", async () => {
    const user = await createUser(db);
    await fileReport(user, EDGE);
    await fileReport(user, EDGE);
    await fileReport(user, EDGE);
    const { rows } = await db.query<{ n: number }>(
      "select count(*)::int as n from public.route_closure_reports where reporter_id = $1 and edge_id = $2", [user.id, EDGE]);
    expect(rows[0].n).toBe(1);
    expect((await tally(user, EDGE))?.reports).toBe(1);
  });

  it("times the report by the database's clock, so it cannot be backdated or made to outlive the window", async () => {
    const user = await createUser(db);
    await asUser(db, user, (tx) => tx.query(
      "insert into public.route_closure_reports (reporter_id, edge_id, reported_at) values ($1, $2, $3)",
      [user.id, OTHER, "2020-01-01T00:00:00Z"]));
    const { rows } = await db.query<{ reported_at: Date }>(
      "select reported_at from public.route_closure_reports where reporter_id = $1 and edge_id = $2", [user.id, OTHER]);
    expect(rows[0].reported_at.getUTCFullYear()).toBeGreaterThan(2020);
  });

  it("refuses a segment id that is not a canonical one", async () => {
    const user = await createUser(db);
    await expect(asUser(db, user, (tx) => tx.query(
      "insert into public.route_closure_reports (reporter_id, edge_id) values ($1, $2)", [user.id, "not-an-edge"]))).rejects.toThrow();
  });
});

describe("one student cannot speak for another", () => {
  it("cannot file a report in someone else's name", async () => {
    const me = await createUser(db);
    const them = await createUser(db);
    await expect(asUser(db, me, (tx) => tx.query(
      "insert into public.route_closure_reports (reporter_id, edge_id) values ($1, $2)", [them.id, EDGE]))).rejects.toThrow();
  });

  it("cannot read, change or delete anyone else's reports", async () => {
    const me = await createUser(db);
    const them = await createUser(db);
    await fileReport(them, EDGE);

    const seen = await asUser(db, me, async (tx) => (await tx.query("select * from public.route_closure_reports")).rows);
    expect(seen).toEqual([]);

    await asUser(db, me, (tx) => tx.query("update public.route_closure_reports set status = 'OPEN' where reporter_id = $1", [them.id]));
    await asUser(db, me, (tx) => tx.query("delete from public.route_closure_reports where reporter_id = $1", [them.id]));
    const { rows } = await db.query<{ status: string }>(
      "select status from public.route_closure_reports where reporter_id = $1 and edge_id = $2", [them.id, EDGE]);
    expect(rows[0]?.status).toBe("CLOSED"); // untouched
  });

  it("gives a visitor with only the public key nothing at all", async () => {
    await expect(asAnon(db, (tx) => tx.query("select * from public.route_closure_reports"))).rejects.toThrow();
    await expect(asAnon(db, (tx) => tx.query("select * from public.route_closure_consensus"))).rejects.toThrow();
  });
});

describe("the shared tally", () => {
  it("counts reports from accounts the reader cannot see, without naming any of them", async () => {
    const edge = "1111222233334444";
    const students = [];
    for (let i = 0; i < 5; i++) {
      const s = await createUser(db);
      students.push(s);
      await fileReport(s, edge);
    }
    // A sixth student, who reported nothing, still sees the count.
    const bystander = await createUser(db);
    expect((await tally(bystander, edge))?.reports).toBe(5);
    // ...but cannot see a single underlying row.
    const rows = await asUser(db, bystander, async (tx) => (await tx.query("select * from public.route_closure_reports")).rows);
    expect(rows).toEqual([]);
  });

  it("exposes no column that could identify a reporter", async () => {
    const { rows } = await db.query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_name = 'route_closure_consensus'");
    expect(rows.map((r) => r.column_name).sort()).toEqual(["edge_id", "latest", "reports"]);
  });

  it("stops counting reports once they age past the window", async () => {
    const edge = "5555666677778888";
    const s = await createUser(db);
    await fileReport(s, edge);
    expect((await tally(s, edge))?.reports).toBe(1);
    // Age the row past 24 hours. The trigger normally forbids this, which is the point of it.
    await db.exec("alter table public.route_closure_reports disable trigger route_closure_reports_touch");
    await db.query("update public.route_closure_reports set reported_at = now() - interval '25 hours' where edge_id = $1", [edge]);
    await db.exec("alter table public.route_closure_reports enable trigger route_closure_reports_touch");
    expect(await tally(s, edge)).toBeUndefined();
  });
});
