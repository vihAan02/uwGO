import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { emptyState } from "./storage";
import { USER_STATE_COLUMNS, toUserStateWrite } from "./userState";
import { supabaseUserStateStore } from "./userStateStore";

type Call = [string, ...unknown[]];

/** A stand-in for the supabase-js query builder that records what the adapter asks for. */
function fakeSupabase(result: { data?: unknown; error?: { message: string }; throws?: Error }) {
  const calls: Call[] = [];
  const settle = () => {
    if (result.throws) return Promise.reject(result.throws);
    return Promise.resolve({ data: result.data ?? null, error: result.error ?? null });
  };
  const builder = {
    select: (...a: unknown[]) => { calls.push(["select", ...a]); return builder; },
    eq: (...a: unknown[]) => { calls.push(["eq", ...a]); return builder; },
    delete: () => { calls.push(["delete"]); return builder; },
    upsert: (...a: unknown[]) => { calls.push(["upsert", ...a]); return settle(); },
    maybeSingle: () => { calls.push(["maybeSingle"]); return settle(); },
    then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => settle().then(resolve, reject),
  };
  const client = { from: (table: string) => { calls.push(["from", table]); return builder; } };
  return { client: client as unknown as SupabaseClient, calls };
}

const UID = "22222222-2222-4222-8222-222222222222";

describe("the Supabase adapter for user_state", () => {
  it("reads only the student's own row, with explicit columns", async () => {
    const { client, calls } = fakeSupabase({ data: { user_id: UID } });
    expect(await supabaseUserStateStore(client).load(UID)).toEqual({ kind: "found", row: { user_id: UID } });
    expect(calls).toEqual([["from", "user_state"], ["select", USER_STATE_COLUMNS], ["eq", "user_id", UID], ["maybeSingle"]]);
  });

  it("reports no row, and turns query errors and network failures into errors", async () => {
    expect(await supabaseUserStateStore(fakeSupabase({}).client).load(UID)).toEqual({ kind: "none" });
    expect(await supabaseUserStateStore(fakeSupabase({ error: { message: "permission denied" } }).client).load(UID)).toEqual({ kind: "error", message: "permission denied" });
    expect(await supabaseUserStateStore(fakeSupabase({ throws: new Error("Failed to fetch") }).client).load(UID)).toEqual({ kind: "error", message: "Failed to fetch" });
  });

  it("saves with an upsert on user_id, and deletes by user_id", async () => {
    const write = toUserStateWrite(UID, emptyState());
    const saving = fakeSupabase({});
    expect(await supabaseUserStateStore(saving.client).save(write)).toEqual({ ok: true });
    expect(saving.calls).toEqual([["from", "user_state"], ["upsert", write, { onConflict: "user_id" }]]);

    const deleting = fakeSupabase({});
    expect(await supabaseUserStateStore(deleting.client).remove(UID)).toEqual({ ok: true });
    expect(deleting.calls).toEqual([["from", "user_state"], ["delete"], ["eq", "user_id", UID]]);

    expect(await supabaseUserStateStore(fakeSupabase({ error: { message: "new row violates row-level security policy" } }).client).save(write))
      .toEqual({ ok: false, message: "new row violates row-level security policy" });
  });
});
