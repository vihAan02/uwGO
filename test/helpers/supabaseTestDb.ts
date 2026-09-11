import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite, type Transaction } from "@electric-sql/pglite";
import type { UserStateWrite } from "@/lib/userState";
import { messageOf, type LoadResult, type UserStateStore, type WriteResult } from "@/lib/userStateStore";

/**
 * A real Postgres (PGlite, in process) with the parts of Supabase that the repo's migrations
 * depend on: the anon and authenticated roles, auth.users, auth.uid() / auth.jwt() reading the
 * request JWT claims exactly as Supabase does, and Supabase's default grants on new public
 * tables. The migrations in supabase/migrations are then applied unchanged, so Row Level
 * Security is tested as written rather than mocked.
 */
const SUPABASE_STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text);
  create function auth.uid() returns uuid language sql stable as $fn$
    select coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    )::uuid
  $fn$;
  create function auth.jwt() returns jsonb language sql stable as $fn$
    select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
  $fn$;
  grant usage on schema auth, public to anon, authenticated;
  grant execute on all functions in schema auth to anon, authenticated;
  -- Supabase grants table privileges on new public tables to both API roles by default; a
  -- migration has to revoke what it does not want reachable.
  alter default privileges in schema public grant select, insert, update, delete on tables to anon, authenticated;
`;

export async function createTestDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(SUPABASE_STUB);
  const dir = path.resolve(process.cwd(), "supabase/migrations");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(path.join(dir, file), "utf8"));
  }
  return db;
}

let counter = 0;
export async function createUser(db: PGlite, name = "student"): Promise<{ id: string; email: string }> {
  const email = `${name}${++counter}@uwaterloo.ca`;
  const { rows } = await db.query<{ id: string }>("insert into auth.users (email) values ($1) returning id", [email]);
  return { id: rows[0].id, email };
}

/** Run as a signed-in student: the authenticated role with that student's JWT claims. */
export function asUser<T>(db: PGlite, user: { id: string; email?: string }, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.exec("set local role authenticated");
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: user.id, role: "authenticated", email: user.email })]);
    return fn(tx);
  });
}

/** Run as a visitor holding only the public anon key. */
export function asAnon<T>(db: PGlite, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.exec("set local role anon");
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ role: "anon" })]);
    return fn(tx);
  });
}

export interface RawUserStateRow {
  user_id: string;
  schedule: unknown;
  preferences: unknown;
  onboarding_complete: boolean;
  schema_version: number;
  updated_at: Date;
}

/** Read a row as the database owner, bypassing RLS, to check what was really stored. */
export async function rawRow(db: PGlite, userId: string): Promise<RawUserStateRow | undefined> {
  const { rows } = await db.query<RawUserStateRow>("select * from public.user_state where user_id = $1", [userId]);
  return rows[0];
}

/**
 * The same three operations the app's Supabase adapter performs, as that student, under RLS.
 * `upsert` mirrors PostgREST's `on_conflict=user_id` merge.
 */
export function pgUserStateStore(db: PGlite, user: { id: string; email?: string }): UserStateStore {
  return {
    async load(userId): Promise<LoadResult> {
      try {
        const rows = await asUser(db, user, async (tx) => (await tx.query<RawUserStateRow>(
          "select user_id, schedule, preferences, onboarding_complete, schema_version, updated_at from public.user_state where user_id = $1",
          [userId],
        )).rows);
        if (!rows[0]) return { kind: "none" };
        return { kind: "found", row: { ...rows[0], updated_at: rows[0].updated_at.toISOString() } };
      } catch (e) {
        return { kind: "error", message: messageOf(e) };
      }
    },
    async save(write: UserStateWrite): Promise<WriteResult> {
      try {
        await asUser(db, user, (tx) => tx.query(
          `insert into public.user_state (user_id, schedule, preferences, onboarding_complete, schema_version)
           values ($1, $2::jsonb, $3::jsonb, $4, $5)
           on conflict (user_id) do update set
             schedule = excluded.schedule, preferences = excluded.preferences,
             onboarding_complete = excluded.onboarding_complete, schema_version = excluded.schema_version`,
          [write.user_id, write.schedule === null ? null : JSON.stringify(write.schedule), JSON.stringify(write.preferences), write.onboarding_complete, write.schema_version],
        ));
        return { ok: true };
      } catch (e) {
        return { ok: false, message: messageOf(e) };
      }
    },
    async remove(userId): Promise<WriteResult> {
      try {
        await asUser(db, user, (tx) => tx.query("delete from public.user_state where user_id = $1", [userId]));
        return { ok: true };
      } catch (e) {
        return { ok: false, message: messageOf(e) };
      }
    },
  };
}
