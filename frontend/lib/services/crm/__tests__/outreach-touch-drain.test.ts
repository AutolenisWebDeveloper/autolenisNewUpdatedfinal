// Unit tests for the non-deal outreach touch drain — internal parity for the
// QStash `referral-nudge` / `affiliate-inactive` / `affiliate-reengagement-2`
// notification jobs (QStash non-deal retirement). Consolidated,
// sequence-discriminated (lead-nurture precedent).
//
// Pins:
//   enqueueOutreachTouch
//     • inserts one row keyed UNIQUE(base_key, sequence), pending;
//     • idempotent (conflict → scheduled:false); DB error throws.
//   drainDueOutreachTouches
//     • NO_DUE when nothing is due; NO_TABLE (dormant) when the table is absent;
//     • affiliate_inactive → ONE notifyContact (entity 'affiliate') → status done
//       → chains affiliate_reengagement_2 at ≈ +14d (same base_key);
//     • affiliate_reengagement_2 / referral_nudge → send, done, NO next touch;
//     • referral_nudge notifies entity 'buyer';
//     • a gated/suppressed send (notifyContact false/false) is NOT a failure —
//       still marked done and still chains (parity: the QStash job proceeds too);
//     • an unknown sequence is canceled without sending;
//     • a notifyContact throw retries (attempts++, pending) then dead-ends
//       'failed' at MAX_ATTEMPTS;
//     • a lost claim is skipped;
//     • a real due-query error throws (→ cron FAILED / 500).
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "lib/services/crm/__tests__/outreach-touch-drain.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

interface Ctrl {
  dueRows: Array<{ id: string }>;
  rowsById: Record<string, Record<string, unknown>>;
  queryError: { code?: string; message?: string } | null;
  scheduleConflict: boolean;
  scheduleError: { message: string } | null;
  lostClaimIds: Set<string>;
  notifyResult: { smsSent: boolean; emailSent: boolean };
  notifyThrows: boolean;
  scheduled: Array<Record<string, unknown>>;
  nextScheduled: Array<Record<string, unknown>>;
  statusUpdates: Array<{ id: string | undefined; payload: Record<string, unknown> }>;
  notifies: Array<Record<string, unknown>>;
}

let ctrl: Ctrl;

function freshCtrl(): Ctrl {
  return {
    dueRows: [],
    rowsById: {},
    queryError: null,
    scheduleConflict: false,
    scheduleError: null,
    lostClaimIds: new Set(),
    notifyResult: { smsSent: true, emailSent: true },
    notifyThrows: false,
    scheduled: [],
    nextScheduled: [],
    statusUpdates: [],
    notifies: [],
  };
}

function resolve(state: {
  op: string;
  filters: Array<[string, string, unknown]>;
  hasSelect: boolean;
  payload: Record<string, unknown> | null;
}) {
  const { op, filters, hasSelect } = state;
  const idFilter = filters.find((f) => f[0] === "eq" && f[1] === "id");
  const id = idFilter?.[2] as string | undefined;
  // Whether a payload row already carries a status (enqueue path) vs a bare update.
  const isEnqueue = op === "upsert";

  if (op === "select") return { data: ctrl.dueRows, error: ctrl.queryError };
  if (isEnqueue) {
    // First-touch enqueue vs chained next-touch: both are upserts. The service
    // uses .select() only on the caller-facing enqueue; the chain enqueue omits it.
    if (hasSelect) {
      ctrl.scheduled.push(state.payload ?? {});
      return { data: ctrl.scheduleConflict ? [] : [{ id: "sched-new" }], error: ctrl.scheduleError };
    }
    ctrl.nextScheduled.push(state.payload ?? {});
    return { data: null, error: null };
  }
  if (op === "update") {
    if (hasSelect) {
      const pendingClaim = filters.some((f) => f[0] === "eq" && f[1] === "status" && f[2] === "pending");
      if (pendingClaim) {
        if (id && ctrl.lostClaimIds.has(id)) return { data: [], error: null };
        const row = id ? ctrl.rowsById[id] : undefined;
        return { data: row ? [row] : [], error: null };
      }
      return { data: [], error: null };
    }
    ctrl.statusUpdates.push({ id, payload: state.payload ?? {} });
    return { data: null, error: null };
  }
  return { data: null, error: null };
}

function fakeSupabase() {
  return {
    from() {
      const state = {
        op: "select",
        filters: [] as Array<[string, string, unknown]>,
        hasSelect: false,
        payload: null as Record<string, unknown> | null,
      };
      const b: Record<string, unknown> = {
        upsert: (d: Record<string, unknown>) => { state.op = "upsert"; state.payload = d; return b; },
        update: (d: Record<string, unknown>) => { state.op = "update"; state.payload = d; return b; },
        select: () => { state.hasSelect = true; return b; },
        eq: (c: string, v: unknown) => { state.filters.push(["eq", c, v]); return b; },
        in: (c: string, v: unknown) => { state.filters.push(["in", c, v]); return b; },
        lte: (c: string, v: unknown) => { state.filters.push(["lte", c, v]); return b; },
        lt: (c: string, v: unknown) => { state.filters.push(["lt", c, v]); return b; },
        order: () => b,
        limit: () => b,
        then: (res: (v: unknown) => void, rej?: (e: unknown) => void) => {
          try { res(resolve(state)); } catch (e) { if (rej) rej(e); else throw e; }
        },
      };
      return b;
    },
  };
}

mock.module("@/lib/supabase-service", {
  namedExports: { getServiceSupabase: () => fakeSupabase() },
});

mock.module("@/lib/qstash/notify", {
  namedExports: {
    notifyContact: async (input: Record<string, unknown>) => {
      if (ctrl.notifyThrows) throw new Error("notify boom");
      ctrl.notifies.push(input);
      return ctrl.notifyResult;
    },
    renderEmail: () => "<html>rendered</html>",
    NOTIFY_APP_URL: "https://autolenis.com",
  },
});

mock.module("@/lib/logger", {
  namedExports: { logger: { error: () => {}, warn: () => {}, info: () => {} } },
});

async function load() {
  return import("@/lib/services/crm/outreach-touch-drain.service");
}

beforeEach(() => {
  ctrl = freshCtrl();
});

const DAY = 24 * 60 * 60 * 1000;

function row(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: "r1",
    base_key: "affiliate-nudge:a1:2026-08-23",
    sequence: "affiliate_inactive",
    entity_id: "a1",
    first_name: "Sam",
    email: "aff@example.com",
    attempts: 0,
    ...over,
  };
}

// ── enqueueOutreachTouch ────────────────────────────────────────────────────
test("enqueue inserts one pending row and returns scheduled:true", async () => {
  const { enqueueOutreachTouch } = await load();
  const before = Date.now();
  const r = await enqueueOutreachTouch({
    sequence: "referral_nudge",
    entityId: "b1",
    firstName: "Sam",
    email: "b@x.com",
    baseKey: "referral-nudge:b1:2026-08-23",
    runAt: new Date(before + 27 * DAY),
  });
  assert.equal(r.scheduled, true);
  assert.equal(ctrl.scheduled.length, 1);
  const p = ctrl.scheduled[0];
  assert.equal(p.sequence, "referral_nudge");
  assert.equal(p.base_key, "referral-nudge:b1:2026-08-23");
  assert.equal(p.entity_id, "b1");
  assert.equal(p.status, "pending");
  const runAt = new Date(p.run_at as string).getTime();
  assert.ok(runAt >= before + 27 * DAY - 5000 && runAt <= before + 27 * DAY + 5000);
});

test("enqueue is idempotent — a conflict reports scheduled:false", async () => {
  ctrl.scheduleConflict = true;
  const { enqueueOutreachTouch } = await load();
  const r = await enqueueOutreachTouch({ sequence: "referral_nudge", entityId: "b1", firstName: null, email: "b@x.com", baseKey: "k" });
  assert.equal(r.scheduled, false);
});

test("enqueue surfaces a DB error as a thrown, prefixed error", async () => {
  ctrl.scheduleError = { message: "unique violation" };
  const { enqueueOutreachTouch } = await load();
  await assert.rejects(
    () => enqueueOutreachTouch({ sequence: "referral_nudge", entityId: "b1", firstName: null, email: "b@x.com", baseKey: "k" }),
    /outreach_touch_enqueue_failed: unique violation/,
  );
});

test("enqueue rejects an unknown sequence", async () => {
  const { enqueueOutreachTouch } = await load();
  await assert.rejects(
    // @ts-expect-error deliberate invalid sequence
    () => enqueueOutreachTouch({ sequence: "bogus", entityId: "b1", firstName: null, email: "b@x.com", baseKey: "k" }),
    /outreach_touch_unknown_sequence/,
  );
});

// ── drainDueOutreachTouches ─────────────────────────────────────────────────
test("drain returns NO_DUE when nothing is due", async () => {
  const { drainDueOutreachTouches } = await load();
  const r = await drainDueOutreachTouches();
  assert.equal(r.status, "NO_DUE");
  assert.equal(ctrl.notifies.length, 0);
});

test("drain returns NO_TABLE (dormant) when the table doesn't exist yet", async () => {
  ctrl.queryError = { code: "42P01", message: 'relation "outreach_touch_schedule" does not exist' };
  const { drainDueOutreachTouches } = await load();
  const r = await drainDueOutreachTouches();
  assert.equal(r.status, "NO_TABLE");
});

test("drain sends affiliate_inactive (entity affiliate), marks done, chains reengagement_2 at +14d", async () => {
  ctrl.dueRows = [{ id: "r1" }];
  ctrl.rowsById = { r1: row() };
  const { drainDueOutreachTouches } = await load();
  const before = Date.now();
  const r = await drainDueOutreachTouches();
  assert.equal(r.status, "OK");
  assert.equal(r.sent, 1);
  assert.equal(ctrl.notifies.length, 1);
  assert.equal(ctrl.notifies[0].entityType, "affiliate");
  assert.equal(ctrl.notifies[0].entityId, "a1");
  assert.ok(ctrl.statusUpdates.some((u) => u.id === "r1" && u.payload.status === "done"));
  assert.equal(ctrl.nextScheduled.length, 1);
  const np = ctrl.nextScheduled[0];
  assert.equal(np.sequence, "affiliate_reengagement_2");
  assert.equal(np.base_key, "affiliate-nudge:a1:2026-08-23", "chain reuses the base_key");
  const runAt = new Date(np.run_at as string).getTime();
  assert.ok(runAt >= before + 14 * DAY - 10000 && runAt <= Date.now() + 14 * DAY + 10000, "next ≈ +14d");
});

test("drain sends affiliate_reengagement_2 and schedules NO next", async () => {
  ctrl.dueRows = [{ id: "r2" }];
  ctrl.rowsById = { r2: row({ id: "r2", sequence: "affiliate_reengagement_2" }) };
  const { drainDueOutreachTouches } = await load();
  const r = await drainDueOutreachTouches();
  assert.equal(r.sent, 1);
  assert.equal(ctrl.notifies[0].entityType, "affiliate");
  assert.equal(ctrl.nextScheduled.length, 0);
});

test("drain sends referral_nudge to entity 'buyer', no next", async () => {
  ctrl.dueRows = [{ id: "r3" }];
  ctrl.rowsById = { r3: row({ id: "r3", sequence: "referral_nudge", entity_id: "b1", base_key: "referral-nudge:b1:2026-08-23" }) };
  const { drainDueOutreachTouches } = await load();
  const r = await drainDueOutreachTouches();
  assert.equal(r.sent, 1);
  assert.equal(ctrl.notifies[0].entityType, "buyer");
  assert.equal(ctrl.nextScheduled.length, 0);
});

test("a gated/suppressed send is not a failure — still done, still chains", async () => {
  ctrl.dueRows = [{ id: "r1" }];
  ctrl.rowsById = { r1: row() };
  ctrl.notifyResult = { smsSent: false, emailSent: false };
  const { drainDueOutreachTouches } = await load();
  const r = await drainDueOutreachTouches();
  assert.equal(r.sent, 1);
  assert.ok(ctrl.statusUpdates.some((u) => u.id === "r1" && u.payload.status === "done"));
  assert.equal(ctrl.nextScheduled.length, 1, "sequence still advances (parity with the QStash job)");
});

test("drain cancels an unknown sequence without sending", async () => {
  ctrl.dueRows = [{ id: "rx" }];
  ctrl.rowsById = { rx: row({ id: "rx", sequence: "bogus_sequence" }) };
  const { drainDueOutreachTouches } = await load();
  const r = await drainDueOutreachTouches();
  assert.equal(ctrl.notifies.length, 0);
  assert.equal(r.canceled, 1);
  assert.ok(ctrl.statusUpdates.some((u) => u.id === "rx" && u.payload.status === "canceled"));
});

test("drain retries a notify failure then dead-ends 'failed' at MAX_ATTEMPTS", async () => {
  ctrl.dueRows = [{ id: "r1" }];
  ctrl.rowsById = { r1: row({ attempts: 0 }) };
  ctrl.notifyThrows = true;
  const { drainDueOutreachTouches } = await load();
  const r1 = await drainDueOutreachTouches();
  assert.equal(r1.retried, 1);
  assert.equal(r1.failed, 0);
  const retry = ctrl.statusUpdates.find((u) => u.id === "r1");
  assert.equal(retry!.payload.status, "pending");
  assert.equal(retry!.payload.attempts, 1);

  ctrl.statusUpdates.length = 0;
  ctrl.rowsById = { r1: row({ attempts: 3 }) };
  const r2 = await drainDueOutreachTouches();
  assert.equal(r2.failed, 1);
  const fail = ctrl.statusUpdates.find((u) => u.id === "r1");
  assert.equal(fail!.payload.status, "failed");
  assert.equal(fail!.payload.attempts, 4);
});

test("drain skips a row whose claim is lost (no send)", async () => {
  ctrl.dueRows = [{ id: "r1" }];
  ctrl.rowsById = { r1: row() };
  ctrl.lostClaimIds = new Set(["r1"]);
  const { drainDueOutreachTouches } = await load();
  const r = await drainDueOutreachTouches();
  assert.equal(r.skipped, 1);
  assert.equal(ctrl.notifies.length, 0);
});

test("drain throws on a real (non-missing-table) due-query error", async () => {
  ctrl.queryError = { code: "57014", message: "statement timeout" };
  const { drainDueOutreachTouches } = await load();
  await assert.rejects(() => drainDueOutreachTouches(), /outreach_touch_due_query_failed: statement timeout/);
});
