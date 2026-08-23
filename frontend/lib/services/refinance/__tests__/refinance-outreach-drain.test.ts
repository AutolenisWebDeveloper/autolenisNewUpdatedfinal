// Unit tests for the refinance-outreach durable drain — internal parity for the
// QStash `/api/jobs/refinance-outreach` job (NON-deal-path QStash retirement).
//
// Pins:
//   enqueueRefinanceOutreach
//     • inserts one row keyed `refinance-outreach:{buyerId}` at run_at ≈ +60d,
//       pending; idempotent (conflict → scheduled:false); DB error throws.
//   drainDueRefinanceOutreach
//     • NO_DUE when nothing is due;
//     • NO_TABLE (not an error) when the table doesn't exist yet (pre-cutover);
//     • a due touch with a completed purchase + no prior send → ONE notifyContact
//       + a REFINANCE_EMAIL_SENT BuyerActivityEvent + status done;
//     • no completed purchase → skipped (no send), status skipped;
//     • a prior REFINANCE_EMAIL_SENT/CLICKED event → skipped (no send);
//     • a notify failure retries (attempts++, back to pending) then dead-ends
//       'failed' at MAX_ATTEMPTS;
//     • a lost claim is skipped;
//     • a real due-query error throws (→ cron FAILED / 500).
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "lib/services/refinance/__tests__/refinance-outreach-drain.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

interface Ctrl {
  dueRows: Array<{ id: string }>;
  rowsById: Record<string, Record<string, unknown>>;
  queryError: { code?: string; message?: string } | null;
  scheduleConflict: boolean;
  scheduleError: { message: string } | null;
  lostClaimIds: Set<string>;
  completedDeals: number;
  priorEvent: { id: string } | null;
  notifyThrows: boolean;
  // recorders
  scheduled: Array<Record<string, unknown>>;
  statusUpdates: Array<{ id: string | undefined; payload: Record<string, unknown> }>;
  notifies: Array<Record<string, unknown>>;
  createdEvents: Array<Record<string, unknown>>;
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
    completedDeals: 1,
    priorEvent: null,
    notifyThrows: false,
    scheduled: [],
    statusUpdates: [],
    notifies: [],
    createdEvents: [],
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

  if (op === "select") {
    return { data: ctrl.dueRows, error: ctrl.queryError };
  }
  if (op === "upsert") {
    ctrl.scheduled.push(state.payload ?? {});
    return { data: ctrl.scheduleConflict ? [] : [{ id: "sched-new" }], error: ctrl.scheduleError };
  }
  if (op === "update") {
    if (hasSelect) {
      const pendingClaim = filters.some((f) => f[0] === "eq" && f[1] === "status" && f[2] === "pending");
      if (pendingClaim) {
        if (id && ctrl.lostClaimIds.has(id)) return { data: [], error: null };
        const row = id ? ctrl.rowsById[id] : undefined;
        return { data: row ? [row] : [], error: null };
      }
      return { data: [], error: null }; // reclaim: none stale in these tests
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

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      deal: { count: async () => ctrl.completedDeals },
      buyerActivityEvent: {
        findFirst: async () => ctrl.priorEvent,
        create: async ({ data }: { data: Record<string, unknown> }) => { ctrl.createdEvents.push(data); return { id: "ev1" }; },
      },
    },
  },
});

mock.module("@/lib/qstash/notify", {
  namedExports: {
    notifyContact: async (input: Record<string, unknown>) => {
      if (ctrl.notifyThrows) throw new Error("notify boom");
      ctrl.notifies.push(input);
    },
    renderEmail: () => "<html>rendered</html>",
  },
});

mock.module("@/lib/services/refinance/refinance-lead.service", {
  namedExports: { buildPartnerRedirectUrl: (leadId: string) => `https://openroad.example/?opt_1=${leadId}` },
});

mock.module("@/lib/logger", {
  namedExports: { logger: { error: () => {}, warn: () => {}, info: () => {} } },
});

async function load() {
  return import("@/lib/services/refinance/refinance-outreach-drain.service");
}

beforeEach(() => {
  ctrl = freshCtrl();
});

const DAY = 24 * 60 * 60 * 1000;

function fullRow(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: "r1",
    buyer_id: "b1",
    first_name: "Sam",
    email: "buyer@example.com",
    lead_id: "b1",
    attempts: 0,
    ...over,
  };
}

// ── enqueueRefinanceOutreach ────────────────────────────────────────────────
test("enqueue inserts one row keyed by buyer at ≈ +60d, pending", async () => {
  const { enqueueRefinanceOutreach } = await load();
  const before = Date.now();
  const r = await enqueueRefinanceOutreach({ buyerId: "b1", firstName: "Sam", email: "buyer@example.com", leadId: "b1" });
  assert.equal(r.scheduled, true);
  assert.equal(ctrl.scheduled.length, 1);
  const p = ctrl.scheduled[0];
  assert.equal(p.buyer_id, "b1");
  assert.equal(p.dedup_key, "refinance-outreach:b1");
  assert.equal(p.status, "pending");
  const runAt = new Date(p.run_at as string).getTime();
  assert.ok(runAt >= before + 60 * DAY - 60000 && runAt <= Date.now() + 60 * DAY + 60000, "run_at ≈ +60d");
});

test("enqueue is idempotent — a conflict reports scheduled:false", async () => {
  ctrl.scheduleConflict = true;
  const { enqueueRefinanceOutreach } = await load();
  const r = await enqueueRefinanceOutreach({ buyerId: "b1", firstName: null, email: "b@x.com", leadId: "b1" });
  assert.equal(r.scheduled, false);
});

test("enqueue surfaces a DB error as a thrown, prefixed error", async () => {
  ctrl.scheduleError = { message: "unique violation" };
  const { enqueueRefinanceOutreach } = await load();
  await assert.rejects(
    () => enqueueRefinanceOutreach({ buyerId: "b1", firstName: null, email: "b@x.com", leadId: "b1" }),
    /refinance_outreach_enqueue_failed: unique violation/,
  );
});

// ── drainDueRefinanceOutreach ───────────────────────────────────────────────
test("drain returns NO_DUE when nothing is due", async () => {
  const { drainDueRefinanceOutreach } = await load();
  const r = await drainDueRefinanceOutreach();
  assert.equal(r.status, "NO_DUE");
  assert.equal(ctrl.notifies.length, 0);
});

test("drain returns NO_TABLE (dormant) when the table doesn't exist yet", async () => {
  ctrl.queryError = { code: "42P01", message: 'relation "refinance_outreach_schedule" does not exist' };
  const { drainDueRefinanceOutreach } = await load();
  const r = await drainDueRefinanceOutreach();
  assert.equal(r.status, "NO_TABLE");
  assert.equal(ctrl.notifies.length, 0);
});

test("drain sends one touch, logs the dedup event, marks done", async () => {
  ctrl.dueRows = [{ id: "r1" }];
  ctrl.rowsById = { r1: fullRow() };
  const { drainDueRefinanceOutreach } = await load();
  const r = await drainDueRefinanceOutreach();
  assert.equal(r.status, "OK");
  assert.equal(r.sent, 1);
  assert.equal(ctrl.notifies.length, 1);
  assert.equal(ctrl.notifies[0].entityId, "b1");
  assert.equal(ctrl.createdEvents.length, 1);
  assert.equal(ctrl.createdEvents[0].eventType, "REFINANCE_EMAIL_SENT");
  assert.ok(ctrl.statusUpdates.some((u) => u.id === "r1" && u.payload.status === "done"));
});

test("drain skips (no send) when the buyer has no completed purchase", async () => {
  ctrl.dueRows = [{ id: "r1" }];
  ctrl.rowsById = { r1: fullRow() };
  ctrl.completedDeals = 0;
  const { drainDueRefinanceOutreach } = await load();
  const r = await drainDueRefinanceOutreach();
  assert.equal(r.skipped, 1);
  assert.equal(ctrl.notifies.length, 0);
  assert.ok(ctrl.statusUpdates.some((u) => u.id === "r1" && u.payload.status === "skipped" && u.payload.last_error === "no_completed_purchase"));
});

test("drain skips (no send) when a prior refinance send/click event exists", async () => {
  ctrl.dueRows = [{ id: "r1" }];
  ctrl.rowsById = { r1: fullRow() };
  ctrl.priorEvent = { id: "prev" };
  const { drainDueRefinanceOutreach } = await load();
  const r = await drainDueRefinanceOutreach();
  assert.equal(r.skipped, 1);
  assert.equal(ctrl.notifies.length, 0);
  assert.ok(ctrl.statusUpdates.some((u) => u.id === "r1" && u.payload.last_error === "already_sent_or_clicked"));
});

test("drain retries a notify failure then dead-ends 'failed' at MAX_ATTEMPTS", async () => {
  ctrl.dueRows = [{ id: "r1" }];
  ctrl.rowsById = { r1: fullRow({ attempts: 0 }) };
  ctrl.notifyThrows = true;
  const { drainDueRefinanceOutreach } = await load();
  const r1 = await drainDueRefinanceOutreach();
  assert.equal(r1.retried, 1);
  assert.equal(r1.failed, 0);
  const retry = ctrl.statusUpdates.find((u) => u.id === "r1");
  assert.equal(retry!.payload.status, "pending");
  assert.equal(retry!.payload.attempts, 1);

  // At MAX: attempts already 3 → 4th attempt is terminal.
  ctrl.statusUpdates.length = 0;
  ctrl.rowsById = { r1: fullRow({ attempts: 3 }) };
  const r2 = await drainDueRefinanceOutreach();
  assert.equal(r2.failed, 1);
  const fail = ctrl.statusUpdates.find((u) => u.id === "r1");
  assert.equal(fail!.payload.status, "failed");
  assert.equal(fail!.payload.attempts, 4);
});

test("drain skips a row whose claim is lost (no send)", async () => {
  ctrl.dueRows = [{ id: "r1" }];
  ctrl.rowsById = { r1: fullRow() };
  ctrl.lostClaimIds = new Set(["r1"]);
  const { drainDueRefinanceOutreach } = await load();
  const r = await drainDueRefinanceOutreach();
  assert.equal(r.skipped, 1);
  assert.equal(ctrl.notifies.length, 0);
});

test("drain throws on a real (non-missing-table) due-query error", async () => {
  ctrl.queryError = { code: "57014", message: "statement timeout" };
  const { drainDueRefinanceOutreach } = await load();
  await assert.rejects(() => drainDueRefinanceOutreach(), /refinance_outreach_due_query_failed: statement timeout/);
});
