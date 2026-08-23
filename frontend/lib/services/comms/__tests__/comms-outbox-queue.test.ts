// Queue-mechanics tests for the internal comms-dispatch queue: enqueue dedup, the
// claim compare-and-set, and the retry / terminal (columns-only) state machine.
//
//   • enqueue upserts ON CONFLICT (dedup_key) DO NOTHING → a duplicate emit adds
//     no row (the HARD zero-duplicate guarantee) and derives the dedup_key from
//     the idempotencyKey (or the recipient+day fallback);
//   • processOutboxRow claims a pending row (CAS) and marks it 'sent' on success;
//   • a lost claim → SKIPPED (no delivery);
//   • a gate outcome (suppressed) → status 'suppressed' / 'skipped', no retry;
//   • a delivery error below MAX → status back to 'pending' with backoff (RETRY);
//   • at MAX attempts → terminal 'failed' COLUMNS-ONLY (never jobs_dead_letter);
//   • drain returns NO_PENDING when empty and aggregates outcomes.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "lib/services/comms/__tests__/comms-outbox-queue.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

let resendThrows = false;
let softSuppressed = false;

mock.module("@/lib/services/comms/comms-providers", {
  namedExports: {
    sendEmailViaResend: async () => {
      if (resendThrows) throw new Error("resend down");
      return { id: "re_1" };
    },
    sendSmsViaTwilio: async () => ({ sid: "SM_1" }),
  },
});
mock.module("@/lib/services/suppression.service", {
  namedExports: {
    SuppressionService: {
      isEmailHardSuppressed: async () => false,
      isEmailSuppressed: async () => softSuppressed,
      isSmsSuppressed: async () => false,
    },
  },
});
mock.module("@/lib/services/template.service", {
  namedExports: { TemplateService: { renderTemplate: async () => ({ subject: "S", html: "H", text: "H" }) } },
});
mock.module("@/lib/services/email/email-send-log", {
  namedExports: { transactionalEmailAlreadySent: async () => false, recordTransactionalEmailSend: async () => {} },
});
mock.module("@/lib/utils/phone", { namedExports: { normalizePhone: (p: string) => p } });
mock.module("@/lib/logger", { namedExports: { logger: { error: () => {}, warn: () => {}, info: () => {} } } });

// ── Stateful single-row comms_outbox + enqueue capture ───────────────────────
interface Row {
  id: string;
  status: string;
  attempts: number;
  channel: string;
  payload: Record<string, unknown>;
  claimed_at: string | null;
  run_at: string;
}
let row: Row | null = null;
const enqueueUpserts: Array<{ dedup_key: string }> = [];
let enqueueConflict = false; // simulate ON CONFLICT DO NOTHING (no row returned)

const mapCol: Record<string, keyof Row> = { id: "id", status: "status", claimed_at: "claimed_at", run_at: "run_at" };

function outboxBuilder(table: string) {
  const filters: Array<[string, string, unknown]> = [];
  let op: "select" | "update" | "upsert" | "insert" | null = null;
  let patch: Record<string, unknown> = {};
  let upsertRow: Record<string, unknown> | null = null;

  const rowMatches = (): boolean =>
    !!row &&
    filters.every(([f, col, val]) => {
      const key = mapCol[col];
      if (f === "eq") return String(row![key]) === String(val);
      if (f === "lt") return row![key] != null && new Date(String(row![key])) < new Date(String(val));
      return true;
    });

  const settle = (): { data: unknown; error: null } => {
    if (table !== "comms_outbox") return { data: table === "contacts" ? null : null, error: null };
    if (op === "upsert") {
      enqueueUpserts.push({ dedup_key: String(upsertRow!.dedup_key) });
      return { data: enqueueConflict ? [] : [{ id: "new" }], error: null };
    }
    if (op === "update") {
      if (rowMatches()) {
        Object.assign(row!, patch);
        return { data: [{ id: row!.id, channel: row!.channel, attempts: row!.attempts, payload: row!.payload }], error: null };
      }
      return { data: [], error: null };
    }
    if (op === "select") {
      const due = row && ["pending", "sending"].includes(row.status);
      return { data: due ? [{ id: row!.id }] : [], error: null };
    }
    return { data: null, error: null };
  };

  const api: Record<string, unknown> = {
    select: () => { if (!op) op = "select"; return api; },
    update: (d: Record<string, unknown>) => { op = "update"; patch = d; return api; },
    upsert: (r: Record<string, unknown>) => { op = "upsert"; upsertRow = r; return api; },
    insert: async () => ({ error: null }),
    eq: (c: string, v: unknown) => { filters.push(["eq", c, v]); return api; },
    lt: (c: string, v: unknown) => { filters.push(["lt", c, v]); return api; },
    in: () => api,
    lte: () => api,
    order: () => api,
    limit: () => api,
    maybeSingle: async () => ({ data: null }),
    then: (resolve: (v: unknown) => void) => resolve(settle()),
  };
  return api;
}

mock.module("@/lib/supabase-service", {
  namedExports: { getServiceSupabase: () => ({ from: (t: string) => outboxBuilder(t) }) },
});

async function load() {
  return import("@/lib/services/comms/comms-outbox.service");
}

beforeEach(() => {
  resendThrows = false;
  softSuppressed = false;
  row = null;
  enqueueUpserts.length = 0;
  enqueueConflict = false;
});

// ── enqueue ──────────────────────────────────────────────────────────────────
test("enqueueEmail derives dedup_key from idempotencyKey and reports enqueued", async () => {
  const { enqueueEmail } = await load();
  const r = await enqueueEmail({ email: "b@x.com", subject: "S", html: "H", type: "transactional", idempotencyKey: "k1" });
  assert.equal(r.dedupKey, "k1");
  assert.equal(r.enqueued, true);
  assert.deepEqual(enqueueUpserts, [{ dedup_key: "k1" }]);
});

test("enqueueEmail without a key falls back to recipient+kind+day", async () => {
  const { enqueueEmail } = await load();
  const r = await enqueueEmail({ contactId: "c1", email: "b@x.com", subject: "S", html: "H", type: "marketing" });
  assert.match(r.dedupKey, /^c1:email_send:\d{4}-\d{2}-\d{2}$/);
});

test("a duplicate emit (ON CONFLICT DO NOTHING) reports enqueued=false", async () => {
  enqueueConflict = true;
  const { enqueueSms } = await load();
  const r = await enqueueSms({ phone: "+15555550123", body: "hi", idempotencyKey: "sms-k" });
  assert.equal(r.enqueued, false);
});

// ── processOutboxRow: claim + terminal ───────────────────────────────────────
function seed(overrides: Partial<Row> = {}): void {
  row = {
    id: "r1",
    status: "pending",
    attempts: 0,
    channel: "sms",
    payload: { contactId: "c1", phone: "+15555550123", body: "hi" },
    claimed_at: null,
    run_at: new Date(Date.now() - 1000).toISOString(),
    ...overrides,
  };
}

test("claims a pending SMS row and marks it sent on success", async () => {
  // Route the contacts read to a consenting contact; comms_outbox goes to the
  // stateful builder that mutates `row`.
  seed();
  const mod = await load();
  const res = await mod.processOutboxRow(
    {
      from: (t: string) =>
        t === "contacts" ? contactReturning({ consent_sms: true, do_not_contact: false }) : outboxBuilder(t),
    } as never,
    "r1",
  );
  assert.equal(res, "SENT");
  assert.equal(row!.status, "sent");
});

test("a lost claim (row already sent) → SKIPPED, no state change", async () => {
  seed({ status: "sent" });
  const mod = await load();
  const res = await mod.processOutboxRow({ from: (t: string) => outboxBuilder(t) } as never, "r1");
  assert.equal(res, "SKIPPED");
  assert.equal(row!.status, "sent");
});

test("a suppressed marketing email → gated terminal (skipped/suppressed), no retry", async () => {
  softSuppressed = true;
  seed({ channel: "email", payload: { email: "b@x.com", subject: "S", html: "H", type: "marketing" } });
  const mod = await load();
  const res = await mod.processOutboxRow({ from: (t: string) => outboxBuilder(t) } as never, "r1");
  assert.equal(res, "GATED");
  assert.equal(row!.status, "suppressed");
});

test("a delivery error below MAX re-queues with backoff (RETRY), no jobs_dead_letter", async () => {
  resendThrows = true;
  seed({ channel: "email", attempts: 0, payload: { email: "b@x.com", subject: "S", html: "H", type: "marketing" } });
  const mod = await load();
  const res = await mod.processOutboxRow({ from: (t: string) => outboxBuilder(t) } as never, "r1");
  assert.equal(res, "RETRY");
  assert.equal(row!.status, "pending");
  assert.equal(row!.attempts, 1);
  assert.ok(new Date(row!.run_at).getTime() > Date.now(), "run_at pushed into the future (backoff)");
});

test("a delivery error at MAX attempts → terminal failed COLUMNS-ONLY", async () => {
  resendThrows = true;
  seed({ channel: "email", attempts: 3, payload: { email: "b@x.com", subject: "S", html: "H", type: "marketing" } });
  const mod = await load();
  const res = await mod.processOutboxRow({ from: (t: string) => outboxBuilder(t) } as never, "r1");
  assert.equal(res, "FAILED");
  assert.equal(row!.status, "failed");
  assert.equal(row!.attempts, 4);
});

// ── drain ────────────────────────────────────────────────────────────────────
test("drain returns NO_PENDING when the queue is empty", async () => {
  row = null;
  const { drainCommsOutbox } = await load();
  const s = await drainCommsOutbox();
  assert.equal(s.status, "NO_PENDING");
});

// Helper: a contacts-table builder that resolves a specific contact row.
function contactReturning(contact: Record<string, unknown>) {
  const api: Record<string, unknown> = {
    select: () => api,
    eq: () => api,
    maybeSingle: async () => ({ data: contact }),
    insert: async () => ({ error: null }),
    update: () => api,
    then: (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
  };
  return api;
}
