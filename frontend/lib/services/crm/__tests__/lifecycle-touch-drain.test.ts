// Unit tests for the lifecycle communications drain — internal parity for the 12
// deferred QStash lifecycle-notification jobs. Consolidated, sequence-
// discriminated (outreach-touch-drain / lead-nurture precedent).
//
// Pins:
//   enqueueLifecycleTouch
//     • inserts one pending row keyed UNIQUE(base_key, sequence), carries phone;
//     • idempotent (conflict → scheduled:false); DB error throws; unknown seq throws.
//   drainDueLifecycleTouches
//     • NO_DUE / NO_TABLE (dormant);
//     • a touch sends via notifyContact (right entityType) → done → chains next;
//     • CONVERSION GUARD: a guarded sequence whose guard is true is canceled —
//       NO send, NO chain (parity: the QStash job early-exits);
//     • FIX: auction_closing now honours hasSelectedOffer (the QStash job did not);
//     • review_request fires the coupled refinance + referral cross-table enqueues;
//     • a gated/suppressed send (notify false/false) is still done + still chains;
//     • unknown sequence canceled; notify throw retries then 'failed' at MAX;
//     • lost claim skipped; real due-query error throws.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "lib/services/crm/__tests__/lifecycle-touch-drain.test.ts"

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
  paidDeposit: boolean;
  selectedOffer: boolean;
  scheduled: Array<Record<string, unknown>>;
  nextScheduled: Array<Record<string, unknown>>;
  statusUpdates: Array<{ id: string | undefined; payload: Record<string, unknown> }>;
  notifies: Array<Record<string, unknown>>;
  refinanceEnqueues: Array<Record<string, unknown>>;
  outreachEnqueues: Array<Record<string, unknown>>;
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
    paidDeposit: false,
    selectedOffer: false,
    scheduled: [],
    nextScheduled: [],
    statusUpdates: [],
    notifies: [],
    refinanceEnqueues: [],
    outreachEnqueues: [],
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
  const isEnqueue = op === "upsert";

  if (op === "select") return { data: ctrl.dueRows, error: ctrl.queryError };
  if (isEnqueue) {
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

mock.module("@/lib/qstash/state", {
  namedExports: {
    hasPaidDeposit: async () => ctrl.paidDeposit,
    hasSelectedOffer: async () => ctrl.selectedOffer,
    hasDealerBid: async () => false,
  },
});

mock.module("@/lib/services/refinance/refinance-outreach-drain.service", {
  namedExports: {
    enqueueRefinanceOutreach: async (input: Record<string, unknown>) => { ctrl.refinanceEnqueues.push(input); return { scheduled: true }; },
  },
});

mock.module("@/lib/services/crm/outreach-touch-drain.service", {
  namedExports: {
    enqueueOutreachTouch: async (input: Record<string, unknown>) => { ctrl.outreachEnqueues.push(input); return { scheduled: true }; },
  },
});

mock.module("@/lib/logger", {
  namedExports: { logger: { error: () => {}, warn: () => {}, info: () => {} } },
});

async function load() {
  return import("@/lib/services/crm/lifecycle-touch-drain.service");
}

beforeEach(() => {
  ctrl = freshCtrl();
});

const SEC = 1000;
const DAY = 24 * 60 * 60 * SEC;

function row(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: "r1",
    base_key: "deposit-reminder:b1",
    sequence: "deposit_reminder_1",
    entity_id: "b1",
    first_name: "Sam",
    email: "b@example.com",
    phone: null,
    attempts: 0,
    ...over,
  };
}

// ── enqueueLifecycleTouch ───────────────────────────────────────────────────
test("enqueue inserts one pending row (with phone) and returns scheduled:true", async () => {
  const { enqueueLifecycleTouch } = await load();
  const before = Date.now();
  const r = await enqueueLifecycleTouch({
    sequence: "form_submitted",
    entityId: "b1",
    firstName: "Sam",
    email: "b@x.com",
    phone: "+15551234567",
    baseKey: "form-submitted:b1",
    runAt: new Date(before + DAY),
  });
  assert.equal(r.scheduled, true);
  assert.equal(ctrl.scheduled.length, 1);
  const p = ctrl.scheduled[0];
  assert.equal(p.sequence, "form_submitted");
  assert.equal(p.base_key, "form-submitted:b1");
  assert.equal(p.entity_id, "b1");
  assert.equal(p.phone, "+15551234567");
  assert.equal(p.status, "pending");
});

test("enqueue is idempotent — a conflict reports scheduled:false", async () => {
  ctrl.scheduleConflict = true;
  const { enqueueLifecycleTouch } = await load();
  const r = await enqueueLifecycleTouch({ sequence: "auction_active", entityId: "b1", firstName: null, email: "b@x.com", baseKey: "k" });
  assert.equal(r.scheduled, false);
});

test("enqueue surfaces a DB error as a thrown, prefixed error", async () => {
  ctrl.scheduleError = { message: "unique violation" };
  const { enqueueLifecycleTouch } = await load();
  await assert.rejects(
    () => enqueueLifecycleTouch({ sequence: "auction_active", entityId: "b1", firstName: null, email: "b@x.com", baseKey: "k" }),
    /lifecycle_touch_enqueue_failed: unique violation/,
  );
});

test("enqueue rejects an unknown sequence", async () => {
  const { enqueueLifecycleTouch } = await load();
  await assert.rejects(
    // @ts-expect-error deliberate invalid sequence
    () => enqueueLifecycleTouch({ sequence: "bogus", entityId: "b1", firstName: null, email: "b@x.com", baseKey: "k" }),
    /lifecycle_touch_unknown_sequence/,
  );
});

// ── drainDueLifecycleTouches ────────────────────────────────────────────────
test("drain returns NO_DUE when nothing is due", async () => {
  const { drainDueLifecycleTouches } = await load();
  const r = await drainDueLifecycleTouches();
  assert.equal(r.status, "NO_DUE");
  assert.equal(ctrl.notifies.length, 0);
});

test("drain returns NO_TABLE (dormant) when the table doesn't exist yet", async () => {
  ctrl.queryError = { code: "42P01", message: 'relation "lifecycle_touch_schedule" does not exist' };
  const { drainDueLifecycleTouches } = await load();
  const r = await drainDueLifecycleTouches();
  assert.equal(r.status, "NO_TABLE");
});

test("deposit_reminder_1 sends (buyer), marks done, chains deposit_reminder_2 at +1d", async () => {
  ctrl.dueRows = [{ id: "r1" }];
  ctrl.rowsById = { r1: row() };
  const { drainDueLifecycleTouches } = await load();
  const before = Date.now();
  const r = await drainDueLifecycleTouches();
  assert.equal(r.status, "OK");
  assert.equal(r.sent, 1);
  assert.equal(ctrl.notifies.length, 1);
  assert.equal(ctrl.notifies[0].entityType, "buyer");
  assert.equal(ctrl.notifies[0].entityId, "b1");
  assert.ok(ctrl.statusUpdates.some((u) => u.id === "r1" && u.payload.status === "done"));
  assert.equal(ctrl.nextScheduled.length, 1);
  const np = ctrl.nextScheduled[0];
  assert.equal(np.sequence, "deposit_reminder_2");
  assert.equal(np.base_key, "deposit-reminder:b1", "chain reuses base_key");
  const runAt = new Date(np.run_at as string).getTime();
  assert.ok(runAt >= before + DAY - 10000 && runAt <= Date.now() + DAY + 10000, "next ≈ +1d");
});

test("CONVERSION GUARD: deposit_reminder_1 with a paid deposit is canceled — no send, no chain", async () => {
  ctrl.dueRows = [{ id: "r1" }];
  ctrl.rowsById = { r1: row() };
  ctrl.paidDeposit = true;
  const { drainDueLifecycleTouches } = await load();
  const r = await drainDueLifecycleTouches();
  assert.equal(r.canceled, 1);
  assert.equal(r.sent, 0);
  assert.equal(ctrl.notifies.length, 0, "converted buyer is not messaged");
  assert.equal(ctrl.nextScheduled.length, 0, "no chain after conversion");
  assert.ok(ctrl.statusUpdates.some((u) => u.id === "r1" && u.payload.status === "canceled" && u.payload.last_error === "converted"));
});

test("FIX: auction_closing honours hasSelectedOffer — a selected buyer is canceled (QStash job did not guard)", async () => {
  ctrl.dueRows = [{ id: "r1" }];
  ctrl.rowsById = { r1: row({ sequence: "auction_closing", base_key: "auction:a1" }) };
  ctrl.selectedOffer = true;
  const { drainDueLifecycleTouches } = await load();
  const r = await drainDueLifecycleTouches();
  assert.equal(r.canceled, 1);
  assert.equal(ctrl.notifies.length, 0);
});

test("auction_closing sends when no offer selected, terminal (no next)", async () => {
  ctrl.dueRows = [{ id: "r1" }];
  ctrl.rowsById = { r1: row({ sequence: "auction_closing", base_key: "auction:a1" }) };
  ctrl.selectedOffer = false;
  const { drainDueLifecycleTouches } = await load();
  const r = await drainDueLifecycleTouches();
  assert.equal(r.sent, 1);
  assert.equal(ctrl.notifies[0].entityType, "buyer");
  assert.equal(ctrl.nextScheduled.length, 0);
});

test("dealer_invited notifies entity 'dealer' and does not chain a bid reminder", async () => {
  ctrl.dueRows = [{ id: "r1" }];
  ctrl.rowsById = { r1: row({ sequence: "dealer_invited", entity_id: "d1", base_key: "dealer-invited:a1:d1" }) };
  const { drainDueLifecycleTouches } = await load();
  const r = await drainDueLifecycleTouches();
  assert.equal(r.sent, 1);
  assert.equal(ctrl.notifies[0].entityType, "dealer");
  assert.equal(ctrl.notifies[0].entityId, "d1");
  assert.equal(ctrl.nextScheduled.length, 0, "bid reminder is owned by cron/dealer-invitation-reminder");
});

test("review_request sends then fires the coupled refinance (+60d) and referral (+27d) enqueues", async () => {
  ctrl.dueRows = [{ id: "r1" }];
  ctrl.rowsById = { r1: row({ sequence: "review_request", entity_id: "b1", base_key: "deal:d1" }) };
  const { drainDueLifecycleTouches } = await load();
  const before = Date.now();
  const r = await drainDueLifecycleTouches();
  assert.equal(r.sent, 1);
  assert.ok(ctrl.statusUpdates.some((u) => u.id === "r1" && u.payload.status === "done"));
  // No same-table chain, but both cross-table enqueues fired.
  assert.equal(ctrl.nextScheduled.length, 0);
  assert.equal(ctrl.refinanceEnqueues.length, 1);
  assert.equal(ctrl.refinanceEnqueues[0].buyerId, "b1");
  assert.equal(ctrl.refinanceEnqueues[0].leadId, "b1");
  const refRunAt = new Date(ctrl.refinanceEnqueues[0].runAt as Date).getTime();
  assert.ok(refRunAt >= before + 60 * DAY - 20000, "refinance ≈ +60d");
  assert.equal(ctrl.outreachEnqueues.length, 1);
  assert.equal(ctrl.outreachEnqueues[0].sequence, "referral_nudge");
  assert.equal(ctrl.outreachEnqueues[0].entityId, "b1");
  const refnRunAt = new Date(ctrl.outreachEnqueues[0].runAt as Date).getTime();
  assert.ok(refnRunAt >= before + 27 * DAY - 20000, "referral ≈ +27d");
});

test("a gated/suppressed send is not a failure — still done, still chains", async () => {
  ctrl.dueRows = [{ id: "r1" }];
  ctrl.rowsById = { r1: row() };
  ctrl.notifyResult = { smsSent: false, emailSent: false };
  const { drainDueLifecycleTouches } = await load();
  const r = await drainDueLifecycleTouches();
  assert.equal(r.sent, 1);
  assert.ok(ctrl.statusUpdates.some((u) => u.id === "r1" && u.payload.status === "done"));
  assert.equal(ctrl.nextScheduled.length, 1, "sequence still advances (parity with the QStash job)");
});

test("drain cancels an unknown sequence without sending", async () => {
  ctrl.dueRows = [{ id: "rx" }];
  ctrl.rowsById = { rx: row({ id: "rx", sequence: "bogus_sequence" }) };
  const { drainDueLifecycleTouches } = await load();
  const r = await drainDueLifecycleTouches();
  assert.equal(ctrl.notifies.length, 0);
  assert.equal(r.canceled, 1);
  assert.ok(ctrl.statusUpdates.some((u) => u.id === "rx" && u.payload.status === "canceled"));
});

test("drain retries a notify failure then dead-ends 'failed' at MAX_ATTEMPTS", async () => {
  ctrl.dueRows = [{ id: "r1" }];
  ctrl.rowsById = { r1: row({ attempts: 0 }) };
  ctrl.notifyThrows = true;
  const { drainDueLifecycleTouches } = await load();
  const r1 = await drainDueLifecycleTouches();
  assert.equal(r1.retried, 1);
  assert.equal(r1.failed, 0);
  const retry = ctrl.statusUpdates.find((u) => u.id === "r1");
  assert.equal(retry!.payload.status, "pending");
  assert.equal(retry!.payload.attempts, 1);

  ctrl.statusUpdates.length = 0;
  ctrl.rowsById = { r1: row({ attempts: 3 }) };
  const r2 = await drainDueLifecycleTouches();
  assert.equal(r2.failed, 1);
  const fail = ctrl.statusUpdates.find((u) => u.id === "r1");
  assert.equal(fail!.payload.status, "failed");
  assert.equal(fail!.payload.attempts, 4);
});

test("drain skips a row whose claim is lost (no send)", async () => {
  ctrl.dueRows = [{ id: "r1" }];
  ctrl.rowsById = { r1: row() };
  ctrl.lostClaimIds = new Set(["r1"]);
  const { drainDueLifecycleTouches } = await load();
  const r = await drainDueLifecycleTouches();
  assert.equal(r.skipped, 1);
  assert.equal(ctrl.notifies.length, 0);
});

test("drain throws on a real (non-missing-table) due-query error", async () => {
  ctrl.queryError = { code: "57014", message: "statement timeout" };
  const { drainDueLifecycleTouches } = await load();
  await assert.rejects(() => drainDueLifecycleTouches(), /lifecycle_touch_due_query_failed: statement timeout/);
});
