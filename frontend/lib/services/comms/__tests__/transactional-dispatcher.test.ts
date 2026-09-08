// The §27 dispatcher: enqueue, the send-time state recheck, cancellation, backoff,
// and the terminal-failure Operations alert.
//
// The property that matters most is the recheck. An outbox row is written when a
// trigger fires and delivered later; in between, the thing it is about can change.
// Without the recheck the outbox faithfully delivers messages that have become
// false — a "$99 unpaid" reminder to a buyer who paid, a draft-recovery touch to
// someone who finished. So: registration is MANDATORY, an unregistered template
// fails CLOSED, and a recheck that says no writes `skipped` rather than sending.
//
// Run: pnpm test:comms-outbox

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

interface Row { id: string; [k: string]: unknown }

const db = {
  rows: new Map<string, Row>(),
  keys: new Set<string>(),
  queue: [] as Row[],
  queueKeys: new Set<string>(),
  requests: new Map<string, Row>(),
  buyers: new Map<string, Row>(),
  seq: 0,
};

function matches(row: Row, where: Record<string, unknown>): boolean {
  for (const [k, v] of Object.entries(where)) {
    if (v && typeof v === "object" && "in" in (v as Record<string, unknown>)) {
      if (!(v as { in: unknown[] }).in.includes(row[k])) return false;
    } else if (row[k] !== v) return false;
  }
  return true;
}

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      commsOutbox: {
        create: async ({ data, select }: { data: Row; select?: unknown }) => {
          if (db.keys.has(data.dedupKey as string)) {
            const e = new Error("unique") as Error & { code?: string };
            e.code = "P2002";
            throw e;
          }
          db.keys.add(data.dedupKey as string);
          db.rows.set(data.id as string, { ...data });
          return select ? { id: data.id } : { ...data };
        },
        update: async ({ where, data }: { where: Row; data: Row }) => {
          const row = db.rows.get(where.id as string)!;
          Object.assign(row, data);
          return { ...row };
        },
        updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Row }) => {
          let count = 0;
          for (const row of db.rows.values()) {
            if (!matches(row, where)) continue;
            Object.assign(row, data);
            count++;
          }
          return { count };
        },
      },
      queueItem: {
        create: async ({ data }: { data: Row }) => {
          const key = data.idempotencyKey as string | null;
          if (key && db.queueKeys.has(key)) {
            const e = new Error("unique") as Error & { code?: string };
            e.code = "P2002";
            throw e;
          }
          if (key) db.queueKeys.add(key);
          db.queue.push({ ...data });
          return { ...data };
        },
        findFirst: async ({ where }: { where: Record<string, unknown> }) =>
          db.queue.find((q) => matches(q, where)) ?? null,
        findUnique: async ({ where }: { where: Row }) => db.queue.find((q) => q.id === where.id) ?? null,
        findMany: async () => db.queue,
        updateMany: async () => ({ count: 1 }),
      },
      vehicleRequest: {
        findUnique: async ({ where }: { where: Row }) => db.requests.get(where.id as string) ?? null,
      },
      buyer: { findUnique: async ({ where }: { where: Row }) => db.buyers.get(where.id as string) ?? null },
      preQualification: { findFirst: async () => null },
    },
  },
});

mock.module("@/lib/logger", { namedExports: { logger: { info: () => {}, warn: () => {}, error: () => {} } } });

let deliverOutcome: string = "SUCCESS";
let deliverThrows = false;
let deliverCalls = 0;
mock.module("@/lib/services/comms/comms-outbox.service", {
  namedExports: {
    deliverEmail: async () => {
      deliverCalls++;
      if (deliverThrows) throw new Error("provider down");
      return { outcome: deliverOutcome, providerId: "prov_1" };
    },
    deliverSms: async () => {
      deliverCalls++;
      return { outcome: "SUCCESS", providerId: "sms_1" };
    },
  },
});

function svc() {
  return import("@/lib/services/comms/transactional-dispatcher.service");
}
function registry() {
  return import("@/lib/services/comms/state-recheck-registry");
}

beforeEach(() => {
  db.rows.clear();
  db.keys.clear();
  db.queue.length = 0;
  db.queueKeys.clear();
  db.requests.clear();
  db.buyers.clear();
  deliverOutcome = "SUCCESS";
  deliverThrows = false;
  deliverCalls = 0;
});

test("a template with no registered state recheck CANNOT be enqueued", async () => {
  const { enqueueTransactional } = await svc();
  await assert.rejects(
    () =>
      enqueueTransactional({
        triggerEvent: "x",
        templateKey: "not_registered_anywhere",
        channel: "email",
        recipientKind: "buyer",
        to: "b@x.com",
        payload: {},
      }),
    /no state recheck is registered/
  );
});

test("enqueue writes the §27 columns that had no writer before this phase", async () => {
  const { enqueueTransactional } = await svc();
  const { PHASE_2_TEMPLATES } = await registry();
  const r = await enqueueTransactional({
    triggerEvent: "guest_capture",
    templateKey: PHASE_2_TEMPLATES.GUEST_CAPTURE_CLAIM,
    channel: "email",
    recipientKind: "buyer",
    recipientId: "b1",
    to: "b@x.com",
    vehicleRequestId: "vr1",
    cancelKey: "seq:1",
    payload: { email: "b@x.com" },
  });
  assert.equal(r.enqueued, true);
  const row = db.rows.get(r.id!)!;
  assert.equal(row.triggerEvent, "guest_capture");
  assert.equal(row.templateKey, PHASE_2_TEMPLATES.GUEST_CAPTURE_CLAIM);
  assert.equal(row.recipientKind, "buyer");
  assert.equal(row.recipientId, "b1");
  assert.equal(row.vehicleRequestId, "vr1");
  assert.equal(row.cancelKey, "seq:1");
  assert.equal(row.maxAttempts, 5);
  assert.ok(row.nextAttemptAt);
});

test("a duplicate emit adds no row and does not resurrect a completed one", async () => {
  const { enqueueTransactional } = await svc();
  const { PHASE_2_TEMPLATES } = await registry();
  const input = {
    triggerEvent: "guest_capture",
    templateKey: PHASE_2_TEMPLATES.GUEST_CAPTURE_CLAIM,
    channel: "email" as const,
    recipientKind: "buyer" as const,
    recipientId: "b1",
    to: "b@x.com",
    payload: {},
  };
  const a = await enqueueTransactional(input);
  const b = await enqueueTransactional(input);
  assert.equal(a.enqueued, true);
  assert.equal(b.enqueued, false);
  assert.equal(db.rows.size, 1);
});

test("the state recheck runs BEFORE the provider, and a `no` writes skipped", async () => {
  const { enqueueTransactional, dispatchTransactionalRow } = await svc();
  const { PHASE_2_TEMPLATES } = await registry();

  // A draft-recovery touch whose request is no longer a draft.
  db.requests.set("vr1", { id: "vr1", status: "SUBMITTED", abandonedAt: null });
  const r = await enqueueTransactional({
    triggerEvent: "draft_abandoned_recovery_2",
    templateKey: PHASE_2_TEMPLATES.DRAFT_RECOVERY_2,
    channel: "email",
    recipientKind: "buyer",
    to: "b@x.com",
    vehicleRequestId: "vr1",
    payload: {},
  });

  const result = await dispatchTransactionalRow(
    {
      id: r.id!,
      channel: "email",
      attempts: 0,
      max_attempts: 5,
      payload: {},
      template_key: PHASE_2_TEMPLATES.DRAFT_RECOVERY_2,
      trigger_event: "draft_abandoned_recovery_2",
      recipient_kind: "buyer",
      recipient_id: null,
      vehicle_request_id: "vr1",
      deal_id: null,
      auction_id: null,
      dispatched_at: null,
    },
    {} as never
  );

  assert.equal(result, "SKIPPED_BY_RECHECK");
  assert.equal(deliverCalls, 0, "the provider must not be reached for a message that has become false");
  const row = db.rows.get(r.id!)!;
  assert.equal(row.status, "skipped");
  assert.match(String(row.lastError), /advanced to SUBMITTED/);
  assert.equal((row.stateRecheck as { proceed: boolean }).proceed, false);
});

test("a recheck that says yes sends, and records that it checked", async () => {
  const { dispatchTransactionalRow } = await svc();
  const { PHASE_2_TEMPLATES } = await registry();
  db.requests.set("vr1", { id: "vr1", status: "DRAFT", abandonedAt: null });
  db.rows.set("row1", { id: "row1", status: "sending" });

  const result = await dispatchTransactionalRow(
    {
      id: "row1",
      channel: "email",
      attempts: 0,
      max_attempts: 5,
      payload: {},
      template_key: PHASE_2_TEMPLATES.DRAFT_RECOVERY_1,
      trigger_event: "t",
      recipient_kind: "buyer",
      recipient_id: null,
      vehicle_request_id: "vr1",
      deal_id: null,
      auction_id: null,
      dispatched_at: null,
    },
    {} as never
  );
  assert.equal(result, "SENT");
  assert.equal(deliverCalls, 1);
  const row = db.rows.get("row1")!;
  assert.equal(row.status, "sent");
  assert.equal((row.stateRecheck as { proceed: boolean }).proceed, true);
});

test("a failure below max attempts retries with backoff; at max it is terminal and RAISES", async () => {
  const { dispatchTransactionalRow } = await svc();
  const { PHASE_2_TEMPLATES } = await registry();
  db.requests.set("vr1", { id: "vr1", status: "DRAFT", abandonedAt: null });
  deliverThrows = true;

  db.rows.set("row1", { id: "row1", status: "sending" });
  const base = {
    id: "row1",
    channel: "email" as const,
    payload: {},
    template_key: PHASE_2_TEMPLATES.DRAFT_RECOVERY_1,
    trigger_event: "t",
    recipient_kind: "buyer",
    recipient_id: "b1",
    vehicle_request_id: "vr1",
    deal_id: null,
    auction_id: null,
    dispatched_at: null,
  };

  const retry = await dispatchTransactionalRow({ ...base, attempts: 0, max_attempts: 3 } as never, {} as never);
  assert.equal(retry, "RETRY");
  let row = db.rows.get("row1")!;
  assert.equal(row.status, "pending");
  assert.ok(row.nextAttemptAt, "backoff must be written to the persisted column, not only to run_at");
  assert.equal(db.queue.length, 0, "a retryable failure is not an exception yet");

  const terminal = await dispatchTransactionalRow({ ...base, attempts: 2, max_attempts: 3 } as never, {} as never);
  assert.equal(terminal, "FAILED");
  row = db.rows.get("row1")!;
  assert.equal(row.status, "failed");
  assert.ok(row.terminalFailedAt, "the terminal stamp had no writer before this phase");

  // §27's last clause: "a terminal-failure Operations alert".
  assert.equal(db.queue.length, 1);
  assert.equal(db.queue[0]!.exceptionCode, "COMMS_TERMINAL_FAILURE");
  assert.equal(db.queue[0]!.ownerRole, "OPERATIONS");
  assert.equal(db.queue[0]!.buyerId, "b1");
});

test("cancelByKey stops every not-yet-sent row and never touches a sent one", async () => {
  const { enqueueTransactional, cancelByKey } = await svc();
  const { PHASE_2_TEMPLATES } = await registry();
  const templates = [
    PHASE_2_TEMPLATES.DRAFT_RECOVERY_1,
    PHASE_2_TEMPLATES.DRAFT_RECOVERY_2,
    PHASE_2_TEMPLATES.DRAFT_RECOVERY_3,
  ];
  for (const t of templates) {
    await enqueueTransactional({
      triggerEvent: "t",
      templateKey: t,
      channel: "email",
      recipientKind: "buyer",
      to: "b@x.com",
      vehicleRequestId: "vr1",
      cancelKey: "draft_recovery:vr1",
      payload: {},
    });
  }
  // The first one already went out.
  const first = [...db.rows.values()][0]!;
  first.status = "sent";

  const { cancelled } = await cancelByKey("draft_recovery:vr1", "request advanced");
  assert.equal(cancelled, 2, "the sent row is not cancellable — a message that has left cannot be unsent");
  const statuses = [...db.rows.values()].map((r) => r.status).sort();
  assert.deepEqual(statuses, ["cancelled", "cancelled", "sent"]);
  for (const row of db.rows.values()) {
    if (row.status !== "cancelled") continue;
    assert.equal(row.cancelReason, "request advanced");
    assert.ok(row.cancelledAt);
  }
});

test("a reclaimed row that already reached the provider is never re-sent", async () => {
  const { dispatchTransactionalRow } = await svc();
  const { PHASE_2_TEMPLATES } = await registry();
  db.rows.set("row1", { id: "row1", status: "sending" });

  const result = await dispatchTransactionalRow(
    {
      id: "row1",
      channel: "email",
      attempts: 1,
      max_attempts: 5,
      payload: {},
      template_key: PHASE_2_TEMPLATES.DRAFT_RECOVERY_1,
      trigger_event: "t",
      recipient_kind: "buyer",
      recipient_id: null,
      vehicle_request_id: "vr1",
      deal_id: null,
      auction_id: null,
      dispatched_at: new Date(),
    },
    {} as never
  );
  assert.equal(result, "FAILED");
  assert.equal(deliverCalls, 0, "a duplicate transactional message is worse than a reported failure");
  assert.equal(db.rows.get("row1")!.lastResult, "RECLAIM_UNCERTAIN");
});

test("every Phase 2 template has a registered recheck", async () => {
  const { PHASE_2_TEMPLATES, hasStateRecheck } = await registry();
  for (const key of Object.values(PHASE_2_TEMPLATES)) {
    assert.ok(hasStateRecheck(key), `${key} has no registered state recheck and cannot be enqueued`);
  }
});
