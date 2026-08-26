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
  chainThrows: boolean;
  paidDeposit: boolean;
  depositResolved: boolean;
  preCheckoutResolved: boolean;
  selectedOffer: boolean;
  liveAuction: boolean;
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
    chainThrows: false,
    paidDeposit: false,
    depositResolved: false,
    preCheckoutResolved: false,
    selectedOffer: false,
    liveAuction: true,
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
    if (ctrl.chainThrows) throw new Error("chain upsert boom");
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
    depositConversionResolved: async () => ctrl.depositResolved,
    preCheckoutResolved: async () => ctrl.preCheckoutResolved,
    hasSelectedOffer: async () => ctrl.selectedOffer,
    hasDealerBid: async () => false,
    hasLiveAuction: async () => ctrl.liveAuction,
  },
});

// Pre-checkout `prepare` mints a resume token; mock the raw token so the resume
// URL is deterministic (raw token lives only in the email — hash-at-rest).
mock.module("@/lib/services/buyer/request-resume-token.service", {
  namedExports: {
    issueResumeToken: async () => ({ rawToken: "RAWTOKEN", expiresAt: new Date(Date.now() + 86400000) }),
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
const HR = 60 * 60 * SEC;
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

test("deposit_reminder_1 sends (buyer), marks done, chains deposit_reminder_2 at +5h (→+6h from enroll)", async () => {
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
  // #5 — the CTA returns the buyer directly to the $99 checkout for the preserved request.
  assert.match(String(ctrl.notifies[0].sms), /\/buyer\/deposit/, "SMS CTA points at the $99 checkout");
  assert.ok(ctrl.statusUpdates.some((u) => u.id === "r1" && u.payload.status === "done"));
  assert.equal(ctrl.nextScheduled.length, 1);
  const np = ctrl.nextScheduled[0];
  assert.equal(np.sequence, "deposit_reminder_2");
  assert.equal(np.base_key, "deposit-reminder:b1", "chain reuses base_key");
  const runAt = new Date(np.run_at as string).getTime();
  assert.ok(runAt >= before + 5 * HR - 10000 && runAt <= Date.now() + 5 * HR + 10000, "next ≈ +5h");
});

test("payment before Touch 2 stops Touch 2–4 (guard cancels a later touch too) (#8)", async () => {
  ctrl.dueRows = [{ id: "r1" }];
  ctrl.rowsById = { r1: row({ sequence: "deposit_reminder_2" }) };
  ctrl.depositResolved = true;
  const { drainDueLifecycleTouches } = await load();
  const r = await drainDueLifecycleTouches();
  assert.equal(r.canceled, 1);
  assert.equal(ctrl.notifies.length, 0);
  assert.equal(ctrl.nextScheduled.length, 0, "no Touch 3 is chained after conversion");
});

test("deposit_reminder_3 chains deposit_reminder_4 at +48h (→+72h from enroll)", async () => {
  ctrl.dueRows = [{ id: "r1" }];
  ctrl.rowsById = { r1: row({ sequence: "deposit_reminder_3" }) };
  const { drainDueLifecycleTouches } = await load();
  const before = Date.now();
  const r = await drainDueLifecycleTouches();
  assert.equal(r.sent, 1);
  assert.equal(ctrl.nextScheduled.length, 1);
  assert.equal(ctrl.nextScheduled[0].sequence, "deposit_reminder_4");
  const runAt = new Date(ctrl.nextScheduled[0].run_at as string).getTime();
  assert.ok(runAt >= before + 48 * HR - 10000, "next ≈ +48h");
});

test("deposit_reminder_4 is terminal — sends, no further chain", async () => {
  ctrl.dueRows = [{ id: "r1" }];
  ctrl.rowsById = { r1: row({ sequence: "deposit_reminder_4" }) };
  const { drainDueLifecycleTouches } = await load();
  const r = await drainDueLifecycleTouches();
  assert.equal(r.sent, 1);
  assert.equal(ctrl.nextScheduled.length, 0, "4th touch ends the conversion window");
});

test("CONVERSION GUARD: deposit_reminder_1 stops when depositConversionResolved (paid/no-pending) — no send, no chain", async () => {
  ctrl.dueRows = [{ id: "r1" }];
  ctrl.rowsById = { r1: row() };
  ctrl.depositResolved = true; // paid, or the pending intent is gone
  const { drainDueLifecycleTouches } = await load();
  const r = await drainDueLifecycleTouches();
  assert.equal(r.canceled, 1);
  assert.equal(r.sent, 0);
  assert.equal(ctrl.notifies.length, 0, "resolved buyer is not messaged");
  assert.equal(ctrl.nextScheduled.length, 0, "no chain after resolution");
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

// ── §10 live-auction truthfulness guard (auction_active/-midpoint/-closing) ──
test("§10: auction_active is CANCELED when the buyer has no live ACTIVE auction (concierge CLOSED / already closed)", async () => {
  ctrl.dueRows = [{ id: "r1" }];
  ctrl.rowsById = { r1: row({ sequence: "auction_active", base_key: "auction:a1" }) };
  ctrl.selectedOffer = false; // not converted…
  ctrl.liveAuction = false; // …but no live auction → must NOT send "your auction is LIVE"
  const { drainDueLifecycleTouches } = await load();
  const r = await drainDueLifecycleTouches();
  assert.equal(r.canceled, 1);
  assert.equal(r.sent, 0);
  assert.equal(ctrl.notifies.length, 0);
  assert.equal(ctrl.nextScheduled.length, 0); // no chain to midpoint
});

test("§10: auction_active SENDS + chains midpoint when a live ACTIVE auction exists and buyer unconverted", async () => {
  ctrl.dueRows = [{ id: "r1" }];
  ctrl.rowsById = { r1: row({ sequence: "auction_active", base_key: "auction:a1" }) };
  ctrl.selectedOffer = false;
  ctrl.liveAuction = true;
  const { drainDueLifecycleTouches } = await load();
  const r = await drainDueLifecycleTouches();
  assert.equal(r.sent, 1);
  assert.equal(ctrl.notifies[0].entityType, "buyer");
  assert.equal(ctrl.nextScheduled.length, 1);
  assert.equal(ctrl.nextScheduled[0].sequence, "auction_midpoint");
});

test("§10: auction_midpoint is CANCELED once the auction is no longer live", async () => {
  ctrl.dueRows = [{ id: "r1" }];
  ctrl.rowsById = { r1: row({ sequence: "auction_midpoint", base_key: "auction:a1" }) };
  ctrl.selectedOffer = false;
  ctrl.liveAuction = false;
  const { drainDueLifecycleTouches } = await load();
  const r = await drainDueLifecycleTouches();
  assert.equal(r.canceled, 1);
  assert.equal(ctrl.notifies.length, 0);
});

test("§10: auction_closing is CANCELED once the auction is no longer live (as well as on offer-selected)", async () => {
  ctrl.dueRows = [{ id: "r1" }];
  ctrl.rowsById = { r1: row({ sequence: "auction_closing", base_key: "auction:a1" }) };
  ctrl.selectedOffer = false;
  ctrl.liveAuction = false;
  const { drainDueLifecycleTouches } = await load();
  const r = await drainDueLifecycleTouches();
  assert.equal(r.canceled, 1);
  assert.equal(ctrl.notifies.length, 0);
});

test("check_form_completion_1 delivers via contact resolution — no email/phone passed (QStash parity)", async () => {
  ctrl.dueRows = [{ id: "r1" }];
  ctrl.rowsById = {
    r1: row({ sequence: "check_form_completion_1", base_key: "form:b1", email: "b@x.com", phone: "+15550000000" }),
  };
  const { drainDueLifecycleTouches } = await load();
  const r = await drainDueLifecycleTouches();
  assert.equal(r.sent, 1);
  assert.equal(ctrl.notifies.length, 1);
  assert.equal(ctrl.notifies[0].entityId, "b1");
  assert.equal(ctrl.notifies[0].email, undefined, "email omitted → resolves from contact (parity)");
  assert.equal(ctrl.notifies[0].phone, undefined, "phone omitted → resolves from contact (parity)");
  // still chains to touch 2
  assert.equal(ctrl.nextScheduled.length, 1);
  assert.equal(ctrl.nextScheduled[0].sequence, "check_form_completion_2");
});

test("a chain-upsert throw does NOT reset the done row or re-send (no double-send)", async () => {
  ctrl.dueRows = [{ id: "r1" }];
  ctrl.rowsById = { r1: row() }; // deposit_reminder_1 → chains deposit_reminder_2
  ctrl.chainThrows = true;
  const { drainDueLifecycleTouches } = await load();
  const r = await drainDueLifecycleTouches();
  // The send succeeded and the row was marked done BEFORE the failing chain write;
  // the chain failure is swallowed so the drain does not reset the row to pending.
  assert.equal(r.sent, 1);
  assert.equal(r.retried, 0);
  assert.equal(r.failed, 0);
  assert.equal(ctrl.notifies.length, 1);
  const doneUpdate = ctrl.statusUpdates.find((u) => u.id === "r1" && u.payload.status === "done");
  assert.ok(doneUpdate, "row stays done");
  assert.ok(
    !ctrl.statusUpdates.some((u) => u.id === "r1" && u.payload.status === "pending"),
    "row is never reset to pending (which would re-send)",
  );
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

// ── cancelDepositReminderTouches / depositReminderBaseKey ────────────────────
// A hand-rolled chainable supabase that records the update payload + filters and
// returns a controllable result (the shared fake models only the drain's claim).
function cancelFake(result: { data: unknown; error: unknown }) {
  const calls: { payload?: Record<string, unknown>; filters: Array<[string, unknown, unknown]> } = { filters: [] };
  const b: Record<string, unknown> = {
    update: (d: Record<string, unknown>) => { calls.payload = d; return b; },
    eq: (c: string, v: unknown) => { calls.filters.push(["eq", c, v]); return b; },
    in: (c: string, v: unknown) => { calls.filters.push(["in", c, v]); return b; },
    select: () => b,
    then: (res: (v: unknown) => void) => res(result),
  };
  return { supabase: { from: () => b } as never, calls };
}

test("depositReminderBaseKey is stable per buyer", async () => {
  const { depositReminderBaseKey } = await load();
  assert.equal(depositReminderBaseKey("b1"), "deposit-reminder:b1");
});

test("cancelDepositReminderTouches moves pending/sending deposit_reminder_* rows to canceled", async () => {
  const { cancelDepositReminderTouches } = await load();
  const { supabase, calls } = cancelFake({ data: [{ id: "x1" }, { id: "x2" }], error: null });
  const r = await cancelDepositReminderTouches("b1", { supabase, reason: "deposit_paid" });
  assert.equal(r.status, "OK");
  assert.equal(r.canceled, 2);
  assert.equal(calls.payload?.status, "canceled");
  assert.equal(calls.payload?.last_error, "deposit_paid");
  // scoped to this buyer's chain, the 4 deposit sequences, and only in-flight rows
  assert.ok(calls.filters.some((f) => f[1] === "base_key" && f[2] === "deposit-reminder:b1"));
  assert.ok(calls.filters.some((f) => f[0] === "in" && f[1] === "sequence"));
  assert.ok(calls.filters.some((f) => f[0] === "in" && f[1] === "status"));
});

test("cancelDepositReminderTouches is DORMANT-safe — a missing table is a no-op", async () => {
  const { cancelDepositReminderTouches } = await load();
  const { supabase } = cancelFake({ data: null, error: { code: "42P01", message: "does not exist" } });
  const r = await cancelDepositReminderTouches("b1", { supabase });
  assert.equal(r.status, "NO_TABLE");
  assert.equal(r.canceled, 0);
});

// ── $99 PRE-CHECKOUT conversion (form_submitted / check_form_completion) ─────
test("form_submitted mints a SECURE resume link, drives to $99, no 'dealers waiting' claim", async () => {
  ctrl.dueRows = [{ id: "r1" }];
  ctrl.rowsById = { r1: row({ sequence: "form_submitted", base_key: "precheckout:b1" }) };
  const { drainDueLifecycleTouches } = await load();
  const r = await drainDueLifecycleTouches();
  assert.equal(r.sent, 1);
  const sms = String(ctrl.notifies[0].sms);
  // CTA is the opaque resume deep-link (no PII, no /thank-you?email=).
  assert.match(sms, /\/api\/public\/request\/resume\/RAWTOKEN/, "secure resume link in the touch");
  assert.doesNotMatch(sms, /thank-you\?email=|@/, "no PII/insecure link");
  assert.match(sms, /\$99/, "names the $99 deposit");
  // Truthful — no claim that dealers are already waiting/competing/bidding.
  assert.doesNotMatch(sms.toLowerCase(), /dealers are waiting|are competing|get them bidding|room is still empty/);
  // Chains the first follow-up at +1h.
  assert.equal(ctrl.nextScheduled[0].sequence, "check_form_completion_1");
});

test("pre-checkout STOPS (guard preCheckoutResolved) once checkout started / request gone — no send, no mint", async () => {
  ctrl.dueRows = [{ id: "r1" }];
  ctrl.rowsById = { r1: row({ sequence: "check_form_completion_1", base_key: "precheckout:b1" }) };
  ctrl.preCheckoutResolved = true; // a Deposit now exists (handoff) or no open request
  const { drainDueLifecycleTouches } = await load();
  const r = await drainDueLifecycleTouches();
  assert.equal(r.canceled, 1);
  assert.equal(r.sent, 0);
  assert.equal(ctrl.notifies.length, 0, "resolved lead is not messaged");
  assert.equal(ctrl.nextScheduled.length, 0, "no further pre-checkout touch chained");
});

test("cancelPreCheckoutTouches cancels the pre-checkout chain (handoff)", async () => {
  const { cancelPreCheckoutTouches, preCheckoutBaseKey } = await load();
  // MUST match the lifecycle-scheduler's form_submitted base_key so the handoff
  // cancel targets the right rows.
  assert.equal(preCheckoutBaseKey("b1"), "form-submitted:b1");
  const { supabase, calls } = cancelFake({ data: [{ id: "x1" }], error: null });
  const r = await cancelPreCheckoutTouches("b1", { supabase, reason: "checkout_started" });
  assert.equal(r.status, "OK");
  assert.equal(r.canceled, 1);
  assert.equal(calls.payload?.status, "canceled");
  assert.equal(calls.payload?.last_error, "checkout_started");
  assert.ok(calls.filters.some((f) => f[1] === "base_key" && f[2] === "form-submitted:b1"));
});
