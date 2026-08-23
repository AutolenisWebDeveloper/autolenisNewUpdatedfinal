// Unit tests for the LP lead-nurture durable scheduler — migrated off the Inngest
// `formAbandonmentFn` (3-touch) / `exitIntentFn` (1-touch) workers onto the
// internal Vercel-Cron substrate with durable `lead_nurture_schedule` rows.
//
// Pins:
//   scheduleLeadNurture
//     • form_abandonment schedules step 1 at +1h; exit_intent at +30m;
//     • idempotent — a conflicting (already-scheduled) trigger reports scheduled:false;
//     • a DB error surfaces as a thrown, prefixed error.
//   drainDueLeadNurture
//     • NO_DUE when nothing is due;
//     • a due touch, lead still 'lead', active template, not suppressed → ONE
//       outbox email keyed `${idempotency_key}-touch1`, status→done, next touch
//       scheduled at the configured delay;
//     • a converted lead cancels the sequence (no email, no next touch);
//     • a suppressed recipient sends NO email but still advances + schedules next;
//     • an inactive template sends NO email but still advances (marketing paused);
//     • the final form touch marks the lead inactive and schedules NO next touch;
//     • a missing template throws → the touch retries (attempts++, back to pending)
//       and only dead-ends ('failed') after MAX_TOUCH_ATTEMPTS;
//     • a lost claim is skipped (no email);
//     • a due-query error throws (→ cron FAILED / HTTP 500).
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "lib/services/crm/__tests__/lead-nurture.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

// ── Controllable fake state ────────────────────────────────────────────────
interface Ctrl {
  dueRows: Array<{ id: string }>;
  rowsById: Record<string, Record<string, unknown>>;
  queryError: { message: string } | null;
  scheduleConflict: boolean;
  scheduleError: { message: string } | null;
  lostClaimIds: Set<string>;
  reclaimIds: Set<string>;
  contactStage: string | null; // lifecycle_stage returned by contacts.select().single()
  suppressed: boolean;
  template: { status: string } | null;
  // recorders
  scheduled: Array<{ payload: Record<string, unknown> }>;
  nextScheduled: Array<{ payload: Record<string, unknown> }>;
  statusUpdates: Array<{ id: string | undefined; payload: Record<string, unknown> }>;
  contactUpdates: Array<{ id: string | undefined; payload: Record<string, unknown> }>;
  emails: Array<Record<string, unknown>>;
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
    reclaimIds: new Set(),
    contactStage: "lead",
    suppressed: false,
    template: { status: "active" },
    scheduled: [],
    nextScheduled: [],
    statusUpdates: [],
    contactUpdates: [],
    emails: [],
  };
}

function resolve(state: {
  table: string;
  op: string;
  filters: Array<[string, string, unknown]>;
  hasSelect: boolean;
  payload: Record<string, unknown> | null;
}) {
  const { table, op, filters, hasSelect } = state;
  const idFilter = filters.find((f) => f[0] === "eq" && f[1] === "id");
  const id = idFilter?.[2] as string | undefined;

  if (table === "contacts") {
    if (op === "select") {
      return { data: ctrl.contactStage === null ? null : { lifecycle_stage: ctrl.contactStage }, error: null };
    }
    // update (markInactive)
    ctrl.contactUpdates.push({ id, payload: state.payload ?? {} });
    return { data: null, error: null };
  }

  if (table === "lead_nurture_schedule") {
    if (op === "select") {
      return { data: ctrl.dueRows, error: ctrl.queryError };
    }
    if (op === "upsert") {
      if (hasSelect) {
        // scheduleLeadNurture (step 1)
        ctrl.scheduled.push({ payload: state.payload ?? {} });
        return { data: ctrl.scheduleConflict ? [] : [{ id: "sched-new" }], error: ctrl.scheduleError };
      }
      // schedule-next
      ctrl.nextScheduled.push({ payload: state.payload ?? {} });
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
        // reclaim (status 'sending' + stale claimed_at)
        if (id && ctrl.reclaimIds.has(id)) {
          const row = ctrl.rowsById[id];
          return { data: row ? [row] : [], error: null };
        }
        return { data: [], error: null };
      }
      // markStatus / retry
      ctrl.statusUpdates.push({ id, payload: state.payload ?? {} });
      return { data: null, error: null };
    }
  }
  return { data: null, error: null };
}

function fakeSupabase() {
  return {
    from(table: string) {
      const state = {
        table,
        op: "select",
        filters: [] as Array<[string, string, unknown]>,
        hasSelect: false,
        payload: null as Record<string, unknown> | null,
      };
      const b: Record<string, unknown> = {
        insert: (d: Record<string, unknown>) => { state.op = "insert"; state.payload = d; return b; },
        upsert: (d: Record<string, unknown>) => { state.op = "upsert"; state.payload = d; return b; },
        update: (d: Record<string, unknown>) => { state.op = "update"; state.payload = d; return b; },
        select: () => { state.hasSelect = true; return b; },
        eq: (c: string, v: unknown) => { state.filters.push(["eq", c, v]); return b; },
        in: (c: string, v: unknown) => { state.filters.push(["in", c, v]); return b; },
        lte: (c: string, v: unknown) => { state.filters.push(["lte", c, v]); return b; },
        lt: (c: string, v: unknown) => { state.filters.push(["lt", c, v]); return b; },
        order: () => b,
        limit: () => b,
        single: () => Promise.resolve(resolve(state)),
        then: (res: (v: unknown) => void, rej?: (e: unknown) => void) => {
          try { res(resolve(state)); } catch (e) { if (rej) rej(e); else throw e; }
        },
      };
      return b;
    },
  };
}

// ── Module mocks ───────────────────────────────────────────────────────────
mock.module("@/lib/supabase-service", {
  namedExports: { getServiceSupabase: () => fakeSupabase() },
});

mock.module("@/lib/services/suppression.service", {
  namedExports: {
    SuppressionService: { isEmailSuppressed: async () => ctrl.suppressed },
  },
});

mock.module("@/lib/services/template.service", {
  namedExports: {
    TemplateService: {
      getTemplateByKey: async () => ctrl.template,
      renderInline: () => ({ subject: "S", html: "<p>H</p>", text: "T" }),
    },
  },
});

mock.module("@/lib/services/comms/comms-outbox.service", {
  namedExports: {
    enqueueEmail: async (input: Record<string, unknown>) => { ctrl.emails.push(input); },
  },
});

mock.module("@/lib/logger", {
  namedExports: { logger: { error: () => {}, warn: () => {}, info: () => {} } },
});

async function load() {
  return import("@/lib/services/crm/lead-nurture.service");
}

beforeEach(() => {
  ctrl = freshCtrl();
});

const HOUR = 60 * 60 * 1000;
const MIN = 60 * 1000;

function fullRow(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: "r1",
    sequence: "form_abandonment",
    step: 1,
    contact_id: "c1",
    contact_email: "buyer@example.com",
    first_name: "Sam",
    campaign: "spring",
    idempotency_key: "form-abandon-c1-2026-08-23",
    attempts: 0,
    ...over,
  };
}

// ── scheduleLeadNurture ─────────────────────────────────────────────────────
test("scheduleLeadNurture(form_abandonment) inserts step 1 at +1h, pending", async () => {
  const { scheduleLeadNurture } = await load();
  const before = Date.now();
  const r = await scheduleLeadNurture("form_abandonment", {
    contactId: "c1",
    contactEmail: "buyer@example.com",
    firstName: "Sam",
    campaign: "spring",
    idempotencyKey: "form-abandon-c1-2026-08-23",
  });
  assert.equal(r.scheduled, true);
  assert.equal(ctrl.scheduled.length, 1);
  const p = ctrl.scheduled[0].payload;
  assert.equal(p.sequence, "form_abandonment");
  assert.equal(p.step, 1);
  assert.equal(p.contact_id, "c1");
  assert.equal(p.status, "pending");
  assert.equal(p.idempotency_key, "form-abandon-c1-2026-08-23");
  const runAt = new Date(p.run_at as string).getTime();
  assert.ok(runAt >= before + HOUR - 5000 && runAt <= Date.now() + HOUR + 5000, "run_at ≈ +1h");
});

test("scheduleLeadNurture(exit_intent) schedules step 1 at +30m", async () => {
  const { scheduleLeadNurture } = await load();
  const before = Date.now();
  await scheduleLeadNurture("exit_intent", {
    contactId: "c9",
    contactEmail: "exit@example.com",
    firstName: null,
    campaign: null,
    idempotencyKey: "exit-intent-c9-2026-08-23",
  });
  const p = ctrl.scheduled[0].payload;
  assert.equal(p.sequence, "exit_intent");
  const runAt = new Date(p.run_at as string).getTime();
  assert.ok(runAt >= before + 30 * MIN - 5000 && runAt <= Date.now() + 30 * MIN + 5000, "run_at ≈ +30m");
});

test("scheduleLeadNurture is idempotent — a conflict reports scheduled:false", async () => {
  ctrl.scheduleConflict = true;
  const { scheduleLeadNurture } = await load();
  const r = await scheduleLeadNurture("form_abandonment", {
    contactId: "c1", contactEmail: "b@x.com", firstName: null, campaign: null, idempotencyKey: "k1",
  });
  assert.equal(r.scheduled, false);
});

test("scheduleLeadNurture surfaces a DB error as a thrown, prefixed error", async () => {
  ctrl.scheduleError = { message: "unique violation" };
  const { scheduleLeadNurture } = await load();
  await assert.rejects(
    () => scheduleLeadNurture("form_abandonment", {
      contactId: "c1", contactEmail: "b@x.com", firstName: null, campaign: null, idempotencyKey: "k1",
    }),
    /lead_nurture_schedule_failed: unique violation/,
  );
});

// ── drainDueLeadNurture ─────────────────────────────────────────────────────
test("drain returns NO_DUE when nothing is due", async () => {
  const { drainDueLeadNurture } = await load();
  const r = await drainDueLeadNurture();
  assert.equal(r.status, "NO_DUE");
  assert.equal(r.due, 0);
  assert.equal(ctrl.emails.length, 0);
});

test("drain sends touch 1, marks done, schedules touch 2 at +23h", async () => {
  ctrl.dueRows = [{ id: "r1" }];
  ctrl.rowsById = { r1: fullRow() };
  const { drainDueLeadNurture } = await load();
  const before = Date.now();
  const r = await drainDueLeadNurture();
  assert.equal(r.status, "OK");
  assert.equal(r.sent, 1);
  // exactly one email, keyed for touch 1
  assert.equal(ctrl.emails.length, 1);
  assert.equal(ctrl.emails[0].idempotencyKey, "form-abandon-c1-2026-08-23-touch1");
  assert.equal(ctrl.emails[0].type, "marketing");
  // status → done
  assert.ok(ctrl.statusUpdates.some((u) => u.id === "r1" && u.payload.status === "done"));
  // next touch scheduled: step 2, ≈ +23h
  assert.equal(ctrl.nextScheduled.length, 1);
  const np = ctrl.nextScheduled[0].payload;
  assert.equal(np.step, 2);
  const runAt = new Date(np.run_at as string).getTime();
  assert.ok(runAt >= before + 23 * HOUR - 10000 && runAt <= Date.now() + 23 * HOUR + 10000, "next ≈ +23h");
});

test("drain cancels the sequence when the lead has converted (no email, no next)", async () => {
  ctrl.dueRows = [{ id: "r1" }];
  ctrl.rowsById = { r1: fullRow() };
  ctrl.contactStage = "qualified"; // advanced past 'lead'
  const { drainDueLeadNurture } = await load();
  const r = await drainDueLeadNurture();
  assert.equal(r.canceled, 1);
  assert.equal(ctrl.emails.length, 0);
  assert.equal(ctrl.nextScheduled.length, 0);
  assert.ok(ctrl.statusUpdates.some((u) => u.id === "r1" && u.payload.status === "canceled"));
});

test("drain suppresses the email but still advances + schedules next", async () => {
  ctrl.dueRows = [{ id: "r1" }];
  ctrl.rowsById = { r1: fullRow() };
  ctrl.suppressed = true;
  const { drainDueLeadNurture } = await load();
  const r = await drainDueLeadNurture();
  assert.equal(ctrl.emails.length, 0, "no send to a suppressed recipient");
  assert.equal(r.skipped, 1);
  assert.ok(ctrl.statusUpdates.some((u) => u.id === "r1" && u.payload.status === "done"));
  assert.equal(ctrl.nextScheduled.length, 1, "sequence still advances");
});

test("drain skips the email when the template is inactive but still advances", async () => {
  ctrl.dueRows = [{ id: "r1" }];
  ctrl.rowsById = { r1: fullRow() };
  ctrl.template = { status: "draft" }; // marketing paused it
  const { drainDueLeadNurture } = await load();
  const r = await drainDueLeadNurture();
  assert.equal(ctrl.emails.length, 0);
  assert.equal(r.skipped, 1);
  assert.equal(ctrl.nextScheduled.length, 1);
});

test("drain marks the lead inactive on the final form touch and schedules NO next", async () => {
  ctrl.dueRows = [{ id: "r3" }];
  ctrl.rowsById = { r3: fullRow({ id: "r3", step: 3, idempotency_key: "form-abandon-c1-2026-08-23" }) };
  const { drainDueLeadNurture } = await load();
  const r = await drainDueLeadNurture();
  assert.equal(r.sent, 1);
  assert.equal(ctrl.emails[0].idempotencyKey, "form-abandon-c1-2026-08-23-touch3");
  assert.equal(ctrl.nextScheduled.length, 0, "terminal touch — no next");
  // contacts.update({lifecycle_stage:'inactive'}) guarded on still-'lead'
  assert.equal(ctrl.contactUpdates.length, 1);
  assert.equal(ctrl.contactUpdates[0].payload.lifecycle_stage, "inactive");
});

test("drain retries a missing-template touch (attempts++, back to pending) instead of failing", async () => {
  ctrl.dueRows = [{ id: "r1" }];
  ctrl.rowsById = { r1: fullRow({ attempts: 0 }) };
  ctrl.template = null; // getTemplateByKey → null → renderRecoveryTemplate throws
  const { drainDueLeadNurture } = await load();
  const r = await drainDueLeadNurture();
  assert.equal(r.retried, 1);
  assert.equal(r.failed, 0);
  assert.equal(ctrl.emails.length, 0);
  const retry = ctrl.statusUpdates.find((u) => u.id === "r1");
  assert.ok(retry, "a status update was written");
  assert.equal(retry!.payload.status, "pending");
  assert.equal(retry!.payload.attempts, 1);
});

test("drain dead-ends a touch to 'failed' after MAX_TOUCH_ATTEMPTS", async () => {
  ctrl.dueRows = [{ id: "r1" }];
  ctrl.rowsById = { r1: fullRow({ attempts: 3 }) }; // 4th attempt = MAX
  ctrl.template = null;
  const { drainDueLeadNurture } = await load();
  const r = await drainDueLeadNurture();
  assert.equal(r.failed, 1);
  assert.equal(r.retried, 0);
  const fail = ctrl.statusUpdates.find((u) => u.id === "r1");
  assert.equal(fail!.payload.status, "failed");
  assert.equal(fail!.payload.attempts, 4);
});

test("drain skips a row whose claim is lost (no email)", async () => {
  ctrl.dueRows = [{ id: "r1" }];
  ctrl.rowsById = { r1: fullRow() };
  ctrl.lostClaimIds = new Set(["r1"]);
  const { drainDueLeadNurture } = await load();
  const r = await drainDueLeadNurture();
  assert.equal(r.skipped, 1);
  assert.equal(ctrl.emails.length, 0);
  assert.equal(ctrl.nextScheduled.length, 0);
});

test("drain throws when the due-query errors (→ cron FAILED / 500)", async () => {
  ctrl.queryError = { message: "connection reset" };
  const { drainDueLeadNurture } = await load();
  await assert.rejects(() => drainDueLeadNurture(), /lead_nurture_due_query_failed: connection reset/);
});
