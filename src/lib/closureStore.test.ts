import { readFileSync } from "node:fs";
import path from "node:path";
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

const MIGRATION = readFileSync(path.resolve(process.cwd(), "supabase/migrations/20260912000000_route_closure_reports.sql"), "utf8");
const ROLLBACK = readFileSync(path.resolve(process.cwd(), "supabase/rollbacks/20260912000000_route_closure_reports.down.sql"), "utf8");

const EDGE = "a1b2c3d4e5f60718";
const OTHER = "0f1e2d3c4b5a6978";

const fileReport = (user: { id: string; email?: string }, edgeId: string, on: PGlite = db) =>
  asUser(on, user, (tx) => tx.query(
    `insert into public.route_closure_reports (reporter_id, edge_id) values ($1, $2)
     on conflict (reporter_id, edge_id) do update set status = 'CLOSED'`,
    [user.id, edgeId],
  ));

const tally = (user: { id: string; email?: string }, edgeId: string, on: PGlite = db) =>
  asUser(on, user, async (tx) => (await tx.query<{ edge_id: string; reports: number }>(
    "select edge_id, reports from public.route_closure_consensus where edge_id = $1", [edgeId],
  )).rows[0]);

/** Five distinct students report `edgeId` shut on `on`. */
const agree = async (edgeId: string, on: PGlite = db) => {
  const students = [];
  for (let i = 0; i < 5; i++) {
    const s = await createUser(on);
    students.push(s);
    await fileReport(s, edgeId, on);
  }
  return students;
};

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
    await expect(asAnon(db, (tx) => tx.query("select * from public.route_closure_reports"))).rejects.toThrow(/permission denied/);
    await expect(asAnon(db, (tx) => tx.query("select * from public.route_closure_consensus"))).rejects.toThrow(/permission denied/);
    await expect(asAnon(db, (tx) => tx.query("select * from private.route_closure_tallies()"))).rejects.toThrow(/permission denied/);
  });

  it("keeps the table's policies owner-only: the tally did not need them loosened", async () => {
    const { rows: [table] } = await db.query<{ rls: boolean }>(
      "select relrowsecurity as rls from pg_class where oid = 'public.route_closure_reports'::regclass");
    expect(table.rls).toBe(true);
    const { rows } = await db.query(
      `select cmd, permissive, array_to_string(roles, ',') as roles, qual, with_check
       from pg_policies where schemaname = 'public' and tablename = 'route_closure_reports' order by cmd`);
    const own = "(auth.uid() = reporter_id)";
    expect(rows).toEqual([
      { cmd: "DELETE", permissive: "PERMISSIVE", roles: "authenticated", qual: own, with_check: null },
      { cmd: "INSERT", permissive: "PERMISSIVE", roles: "authenticated", qual: null, with_check: own },
      { cmd: "SELECT", permissive: "PERMISSIVE", roles: "authenticated", qual: own, with_check: null },
      { cmd: "UPDATE", permissive: "PERMISSIVE", roles: "authenticated", qual: own, with_check: own },
    ]);
  });
});

describe("the shared tally", () => {
  it("counts reports from accounts the reader cannot see, without naming any of them", async () => {
    const edge = "1111222233334444";
    await agree(edge);
    // A sixth student, who reported nothing, still sees the count...
    const bystander = await createUser(db);
    expect((await tally(bystander, edge))?.reports).toBe(5);
    // ...including when reading the whole tally the way the app does...
    const all = await asUser(db, bystander, async (tx) => (await tx.query<{ edge_id: string; reports: number; latest: Date }>(
      "select edge_id, reports, latest from public.route_closure_consensus")).rows);
    const row = all.find((r) => r.edge_id === edge);
    expect(row?.reports).toBe(5);
    expect(row?.latest).toBeInstanceOf(Date);
    // ...but cannot see a single underlying row.
    const rows = await asUser(db, bystander, async (tx) => (await tx.query("select * from public.route_closure_reports")).rows);
    expect(rows).toEqual([]);
  });

  it("shows each student who reported the whole count, not only their own vote", async () => {
    const edge = "9999aaaabbbbcccc";
    const students = await agree(edge);
    for (const s of students) expect((await tally(s, edge))?.reports).toBe(5);
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

describe("the tally view borrows nothing from its owner", () => {
  it("is declared security_invoker, so it runs with the reader's privileges and RLS", async () => {
    const { rows } = await db.query<{ reloptions: string[] | null }>(
      "select reloptions from pg_class where oid = 'public.route_closure_consensus'::regclass");
    expect(rows[0].reloptions).toContain("security_invoker=true");
  });

  it("passes Supabase's Security Definer View check: no API-readable view in public runs as its owner", async () => {
    // The predicate of Supabase's security advisor lint 0010_security_definer_view, for `public`.
    const { rows } = await db.query<{ relname: string }>(
      `select c.relname
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where c.relkind = 'v' and n.nspname = 'public'
         and (has_table_privilege('anon', c.oid, 'SELECT') or has_table_privilege('authenticated', c.oid, 'SELECT'))
         and not (lower(coalesce(c.reloptions::text, '{}'))::text[]
           && array['security_invoker=1', 'security_invoker=true', 'security_invoker=yes', 'security_invoker=on'])`);
    expect(rows).toEqual([]);
  });

  it("still gives readers the right counts when its owner has no privileges at all", async () => {
    // An owner-rights view counting the table directly fails here: its owner could not read the
    // table. This one's counts come only from what the reader is granted.
    const edge = "ddddeeeeffff0000";
    await agree(edge);
    const reader = await createUser(db);
    const seen = await db.transaction(async (tx) => {
      await tx.exec("create role closure_view_nobody nologin");
      await tx.exec("alter view public.route_closure_consensus owner to closure_view_nobody");
      await tx.exec("set local role authenticated");
      await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: reader.id, role: "authenticated" })]);
      const { rows } = await tx.query<{ reports: number }>(
        "select reports from public.route_closure_consensus where edge_id = $1", [edge]);
      await tx.rollback();
      return rows[0]?.reports;
    });
    expect(seen).toBe(5);
    const { rows } = await db.query<{ owner: string }>(
      "select pg_get_userbyid(relowner) as owner from pg_class where oid = 'public.route_closure_consensus'::regclass");
    expect(rows[0].owner).not.toBe("closure_view_nobody"); // rolled back
  });

  it("does the cross-account counting in one function that returns totals only, out of the API's reach", async () => {
    const { rows } = await db.query(
      `select n.nspname as schema, p.prosecdef as definer, p.proconfig as config,
         pg_get_function_result(p.oid) as result,
         has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
         has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where p.proname = 'route_closure_tallies'`);
    expect(rows).toEqual([{
      schema: "private",
      definer: true,
      config: ['search_path=""'],
      result: "TABLE(edge_id text, reports integer, latest timestamp with time zone)",
      anon: false,
      authenticated: true,
    }]);
  });
});

describe("applying and rolling back the migration", () => {
  it("re-run over the owner-rights view it first shipped with, turns it reader-rights and keeps the counts", async () => {
    const fresh = await createTestDb();
    try {
      // Put the database back to how the migration first shipped: an owner-rights view counting
      // the table directly, and no private tally function.
      await fresh.exec(`
        drop view public.route_closure_consensus;
        drop function private.route_closure_tallies();
        drop schema private;
        create view public.route_closure_consensus as
          select edge_id, count(*)::int as reports, max(reported_at) as latest
          from public.route_closure_reports
          where status = 'CLOSED' and reported_at > now() - interval '24 hours'
          group by edge_id;
        revoke all on public.route_closure_consensus from anon;
        grant select on public.route_closure_consensus to authenticated;
      `);
      const edge = "0123456789abcdef";
      await agree(edge, fresh);

      await fresh.exec(MIGRATION);

      const { rows } = await fresh.query<{ reloptions: string[] | null }>(
        "select reloptions from pg_class where oid = 'public.route_closure_consensus'::regclass");
      expect(rows[0].reloptions).toContain("security_invoker=true");
      expect((await tally(await createUser(fresh), edge, fresh))?.reports).toBe(5);
      await expect(asAnon(fresh, (tx) => tx.query("select * from public.route_closure_consensus"))).rejects.toThrow(/permission denied/);
    } finally {
      await fresh.close();
    }
  }, 60_000);

  it("rolls back every object it created, and applies again cleanly afterwards", async () => {
    const fresh = await createTestDb();
    try {
      await fresh.exec(ROLLBACK);
      const { rows } = await fresh.query<Record<string, unknown>>(
        `select to_regclass('public.route_closure_reports') as reports_table,
           to_regclass('public.route_closure_consensus') as consensus_view,
           to_regprocedure('public.route_closure_reports_touch()') as touch_fn,
           exists (select 1 from pg_proc where proname = 'route_closure_tallies') as tallies_fn,
           exists (select 1 from pg_namespace where nspname = 'private') as private_schema`);
      expect(rows[0]).toEqual({ reports_table: null, consensus_view: null, touch_fn: null, tallies_fn: false, private_schema: false });

      await fresh.exec(MIGRATION);
      const edge = "fedcba9876543210";
      await agree(edge, fresh);
      expect((await tally(await createUser(fresh), edge, fresh))?.reports).toBe(5);
    } finally {
      await fresh.close();
    }
  }, 60_000);

  it("leaves the private schema alone on rollback if something else now lives in it", async () => {
    const fresh = await createTestDb();
    try {
      await fresh.exec("create table private.someone_elses (id int)");
      await fresh.exec(ROLLBACK);
      const { rows } = await fresh.query<{ kept: unknown }>("select to_regclass('private.someone_elses') as kept");
      expect(rows[0].kept).not.toBeNull();
      expect((await fresh.query("select 1 from pg_proc where proname = 'route_closure_tallies'")).rows).toEqual([]);
    } finally {
      await fresh.close();
    }
  }, 60_000);
});
