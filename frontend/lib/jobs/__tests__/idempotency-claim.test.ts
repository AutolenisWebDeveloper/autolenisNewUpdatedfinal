// Crash-safe claim (claimJob) — the concurrency lock a Vercel-Cron / Postgres
// executor uses so a run killed mid-flight can be re-driven, without ever
// letting two live runs execute the same identity.
//
// Run with:
//   npx tsx --test lib/jobs/__tests__/idempotency-claim.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { claimJob } from "@/lib/jobs/idempotency";

// A minimal fake of the fluent supabase query builder for `idempotency_keys`.
// It records the operations claimJob issues and returns programmed responses.
interface Script {
  insert?: { error: { code?: string } | null };
  select?: { data: { execution_status: string; created_at: string } | null; error: unknown };
  update?: { data: Array<{ key_hash: string }> | null; error: unknown };
}

function makeSupabase(script: Script) {
  const calls = { insert: 0, select: 0, update: 0, updateEqs: [] as Array<[string, string]> };

  function from() {
    return {
      insert(_row: unknown) {
        calls.insert += 1;
        return Promise.resolve(script.insert ?? { error: null });
      },
      select(_cols?: string) {
        // Two shapes: a read (…select().eq().single()) and the tail of an update
        // (…update().eq().eq().select()). Distinguish by whether update ran.
        if (calls.update > 0) {
          return Promise.resolve(script.update ?? { data: [], error: null });
        }
        calls.select += 1;
        const eqRead = {
          eq() {
            return {
              single() {
                return Promise.resolve(
                  script.select ?? { data: null, error: null },
                );
              },
            };
          },
        };
        return eqRead;
      },
      update(_row: unknown) {
        calls.update += 1;
        const chain = {
          _eqs: [] as Array<[string, string]>,
          eq(col: string, val: string) {
            this._eqs.push([col, val]);
            calls.updateEqs.push([col, val]);
            return this;
          },
          select() {
            return Promise.resolve(script.update ?? { data: [], error: null });
          },
        };
        return chain;
      },
    };
  }

  return { client: { from } as never, calls };
}

const STALE = { staleMs: 600_000 };

test("fresh insert succeeds → claimed", async () => {
  const { client, calls } = makeSupabase({ insert: { error: null } });
  assert.equal(await claimJob(client, "intake:process:opp_1", STALE), true);
  assert.equal(calls.insert, 1);
  assert.equal(calls.select, 0, "no collision inspection on a clean insert");
});

test("non-conflict insert error throws (not swallowed)", async () => {
  const { client } = makeSupabase({ insert: { error: { code: "42501" } } });
  await assert.rejects(() => claimJob(client, "intake:process:opp_1", STALE));
});

test("collision with a FRESH 'processing' row → BLOCKED (live run holds it)", async () => {
  const fresh = new Date().toISOString();
  const { client, calls } = makeSupabase({
    insert: { error: { code: "23505" } },
    select: { data: { execution_status: "processing", created_at: fresh }, error: null },
  });
  assert.equal(await claimJob(client, "intake:process:opp_1", STALE), false);
  assert.equal(calls.update, 0, "must not reclaim a live claim");
});

test("collision with a STALE 'processing' row → reclaimed via CAS", async () => {
  const stale = new Date(Date.now() - 20 * 60_000).toISOString(); // 20 min old
  const { client, calls } = makeSupabase({
    insert: { error: { code: "23505" } },
    select: { data: { execution_status: "processing", created_at: stale }, error: null },
    update: { data: [{ key_hash: "h" }], error: null },
  });
  assert.equal(await claimJob(client, "intake:process:opp_1", STALE), true);
  assert.equal(calls.update, 1);
  // CAS must pin the observed created_at so two reclaimers cannot both win.
  assert.ok(calls.updateEqs.some(([c, v]) => c === "created_at" && v === stale));
});

test("collision with a 'failed' row → reclaimed (prior run failed, retry)", async () => {
  const when = new Date(Date.now() - 60_000).toISOString();
  const { client } = makeSupabase({
    insert: { error: { code: "23505" } },
    select: { data: { execution_status: "failed", created_at: when }, error: null },
    update: { data: [{ key_hash: "h" }], error: null },
  });
  assert.equal(await claimJob(client, "intake:process:opp_1", STALE), true);
});

test("collision with a 'completed' row → BLOCKED (authoritatively done)", async () => {
  const when = new Date().toISOString();
  const { client, calls } = makeSupabase({
    insert: { error: { code: "23505" } },
    select: { data: { execution_status: "completed", created_at: when }, error: null },
  });
  assert.equal(await claimJob(client, "intake:process:opp_1", STALE), false);
  assert.equal(calls.update, 0);
});

test("reclaim CAS loses (0 rows updated) → not claimed", async () => {
  const stale = new Date(Date.now() - 20 * 60_000).toISOString();
  const { client } = makeSupabase({
    insert: { error: { code: "23505" } },
    select: { data: { execution_status: "failed", created_at: stale }, error: null },
    update: { data: [], error: null }, // another reclaimer won the CAS
  });
  assert.equal(await claimJob(client, "intake:process:opp_1", STALE), false);
});

test("incumbent row vanished before inspection → not claimed (retry next tick)", async () => {
  const { client } = makeSupabase({
    insert: { error: { code: "23505" } },
    select: { data: null, error: null },
  });
  assert.equal(await claimJob(client, "intake:process:opp_1", STALE), false);
});
