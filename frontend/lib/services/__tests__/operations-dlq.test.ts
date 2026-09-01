// DLQ replay/drain invariants AFTER Inngest removal (operations.service).
//
// Proves the hard requirement: NO dead-letter recovery path requires Inngest.
//   1. recognized migrated events replay to their INTERNAL owner (email/sms →
//      outbox, dealer.award → emitDealerAwardOutcomes, lead.* → scheduleLeadNurture);
//   2. qstash:* rows TERMINALIZE — QStash has been removed from the stack, so
//      re-publishing them was worse than a no-op: dispatch() swallows its own
//      failure and writes a FRESH dead-letter row, while the drainer deleted the
//      old one and counted a success. The retry cap never bit (each cycle created
//      a row with auto_retry_count 0), so every abandoned deposit left a row
//      churning forever. They are now pinned terminal and kept for visibility;
//   3. an UNKNOWN event never dispatches anywhere and is terminalized in place
//      (auto_retry_count pinned at the cap + a sanitized TERMINAL reason) — no
//      silent loss, no infinite loop;
//   4. a lost claim is skipped (no duplicate side effect);
//   5. manual retry of an unknown event returns {retried:false} and restores the
//      row with a sanitized terminal reason;
//   6. structural: the Inngest client/module is gone and nothing imports it.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks lib/services/__tests__/operations-dlq.test.ts

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

mock.module("server-only", { namedExports: {} });
mock.module("@/lib/logger", { namedExports: { logger: { error: () => {}, warn: () => {}, info: () => {} } } });

const calls = {
  email: [] as unknown[],
  sms: [] as unknown[],
  dealer: [] as unknown[],
  nurture: [] as { sequence: string; input: Record<string, unknown> }[],
  dispatch: [] as unknown[],
};

mock.module("@/lib/services/comms/comms-outbox.service", {
  namedExports: {
    enqueueEmail: async (p: unknown) => { calls.email.push(p); },
    enqueueSms: async (p: unknown) => { calls.sms.push(p); },
  },
});
mock.module("@/lib/services/notifications/dealer-award", {
  namedExports: { emitDealerAwardOutcomes: async (p: unknown) => { calls.dealer.push(p); } },
});
mock.module("@/lib/services/crm/lead-nurture.service", {
  namedExports: { scheduleLeadNurture: async (sequence: string, input: Record<string, unknown>) => { calls.nurture.push({ sequence, input }); return { scheduled: true }; } },
});
mock.module("@/lib/qstash/dispatch", {
  namedExports: { dispatch: async (p: unknown) => { calls.dispatch.push(p); } },
});
mock.module("@/lib/services/affiliate/commission.service", {
  namedExports: {
    processFeeCommission: async (p: Record<string, unknown>) => { commissionCalls.push(p); },
  },
});

const commissionCalls: Record<string, unknown>[] = [];

// ── Controllable fake Supabase for jobs_dead_letter ──────────────────────────
interface Ctrl {
  dueRows: Array<Record<string, unknown>>;
  lostClaim: boolean;
  retryRow: Record<string, unknown> | null;
  terminalized: Array<{ id: unknown; payload: Record<string, unknown> }>;
  deleted: unknown[];
  inserted: Array<Record<string, unknown>>;
}
let ctrl: Ctrl;

function fakeSupabase() {
  return {
    from(table: string) {
      const st = { table, op: "select", filters: [] as Array<[string, unknown]>, hasSelect: false, payload: null as Record<string, unknown> | null };
      const idVal = () => st.filters.find((f) => f[0] === "id")?.[1];
      const b: Record<string, unknown> = {
        select: () => { st.hasSelect = true; return b; },
        update: (d: Record<string, unknown>) => { st.op = "update"; st.payload = d; return b; },
        delete: () => { st.op = "delete"; return b; },
        insert: (d: Record<string, unknown>) => { st.op = "insert"; st.payload = d; return b; },
        eq: (c: string, v: unknown) => { st.filters.push([c, v]); return b; },
        lt: () => b,
        order: () => b,
        limit: () => b,
        then: (res: (v: unknown) => void) => {
          if (st.table !== "jobs_dead_letter") return res({ data: null, error: null });
          if (st.op === "select") return res({ data: ctrl.dueRows, error: null });
          if (st.op === "update") {
            if (st.hasSelect) return res({ data: ctrl.lostClaim ? [] : [{ id: idVal() }], error: null }); // claim
            ctrl.terminalized.push({ id: idVal(), payload: st.payload ?? {} }); // terminalize
            return res({ data: null, error: null });
          }
          if (st.op === "delete") {
            if (st.hasSelect) return res({ data: ctrl.retryRow ? [ctrl.retryRow] : [], error: null }); // retry claim
            ctrl.deleted.push(idVal()); // success delete
            return res({ data: null, error: null });
          }
          if (st.op === "insert") { ctrl.inserted.push(st.payload ?? {}); return res({ data: null, error: null }); }
          return res({ data: null, error: null });
        },
      };
      return b;
    },
  };
}

async function newOps() {
  const { OperationsService } = await import("@/lib/services/operations.service");
  return new OperationsService(fakeSupabase() as never);
}

beforeEach(() => {
  calls.email = []; calls.sms = []; calls.dealer = []; calls.nurture = []; calls.dispatch = [];
  commissionCalls.length = 0;
  ctrl = { dueRows: [], lostClaim: false, retryRow: null, terminalized: [], deleted: [], inserted: [] };
});

function due(event_name: string, payload: Record<string, unknown> = {}, id = "r1"): Record<string, unknown> {
  return { id, job_id: "j1", event_name, payload, auto_retry_count: 0 };
}

test("email.send / sms.send replay to the comms outbox (never Inngest), row removed", async () => {
  ctrl.dueRows = [due("autolenis/email.send", { to: "a@b.com" }, "r1")];
  const ops = await newOps();
  const r = await ops.autoDrainDeadLetterJobs({ minAgeMs: 0 });
  assert.equal(calls.email.length, 1);
  assert.equal(calls.dispatch.length, 0);
  assert.deepEqual(ctrl.deleted, ["r1"]);
  assert.equal(r.reemitted, 1);

  ctrl.dueRows = [due("autolenis/sms.send", { to: "+1" }, "r2")];
  const ops2 = await newOps();
  await ops2.autoDrainDeadLetterJobs({ minAgeMs: 0 });
  assert.equal(calls.sms.length, 1);
});

test("dealer.award replays via emitDealerAwardOutcomes; lead.* via scheduleLeadNurture", async () => {
  ctrl.dueRows = [due("autolenis/dealer.award", { auctionId: "a", winningOfferId: "o", dealId: "d" }, "r1")];
  await (await newOps()).autoDrainDeadLetterJobs({ minAgeMs: 0 });
  assert.equal(calls.dealer.length, 1);

  ctrl.dueRows = [due("autolenis/lead.form_abandoned", { contact_id: "c", idempotency_key: "k" }, "r2")];
  await (await newOps()).autoDrainDeadLetterJobs({ minAgeMs: 0 });
  assert.equal(calls.nurture.length, 1);
  assert.equal(calls.nurture[0].sequence, "form_abandonment");
});

test("qstash:* rows TERMINALIZE — never re-published into the removed service", async () => {
  ctrl.dueRows = [due("qstash:/api/jobs/deposit-reminder", { path: "/api/jobs/deposit-reminder", body: { buyerId: "b" } }, "r1")];
  const r = await (await newOps()).autoDrainDeadLetterJobs({ minAgeMs: 0, maxAutoRetries: 3 });

  assert.equal(calls.dispatch.length, 0, "QStash is gone — re-publishing enqueues into nothing");
  assert.equal(calls.email.length + calls.sms.length + calls.dealer.length + calls.nurture.length, 0,
    "and a qstash row has no internal owner to re-drive either");
  assert.deepEqual(ctrl.deleted, [], "kept for operator visibility rather than silently dropped");
  assert.equal(ctrl.terminalized.length, 1, "pinned terminal so no future scan picks it up");
  assert.equal(ctrl.terminalized[0].payload.auto_retry_count, 3);
  assert.match(String(ctrl.terminalized[0].payload.error_message), /TERMINAL/);
  assert.equal(r.failed, 1);
});

test("the churn loop is closed: a qstash row cannot spawn a replacement row", async () => {
  // The loop was: drainer re-publishes -> dispatch throws -> dispatch writes a NEW
  // dead-letter row (auto_retry_count 0) -> drainer deletes the OLD row and counts
  // a success. The cap never applied because every cycle produced a fresh row.
  // Terminalizing in place breaks it: nothing is dispatched, so nothing new is
  // written, and the original row is excluded from every later scan.
  ctrl.dueRows = [due("qstash:/api/jobs/deposit-reminder", { path: "/api/jobs/deposit-reminder", body: { buyerId: "b" } }, "r1")];
  const r = await (await newOps()).autoDrainDeadLetterJobs({ minAgeMs: 0, maxAutoRetries: 3 });

  assert.equal(calls.dispatch.length, 0, "no dispatch means no replacement row can be created");
  assert.equal(r.reemitted, 0, "a terminalized row is not a re-emission");
  assert.deepEqual(ctrl.deleted, []);
});

test("UNKNOWN event: never dispatched, terminalized in place (no loss, no loop)", async () => {
  ctrl.dueRows = [due("autolenis/legacy.unknown", { x: 1 }, "r9")];
  const r = await (await newOps()).autoDrainDeadLetterJobs({ minAgeMs: 0, maxAutoRetries: 3 });
  // No external dispatch of any kind.
  assert.equal(calls.email.length + calls.sms.length + calls.dealer.length + calls.nurture.length + calls.dispatch.length, 0);
  // Not deleted (kept for operator visibility), and terminalized (retry cap pinned + sanitized reason).
  assert.deepEqual(ctrl.deleted, []);
  assert.equal(ctrl.terminalized.length, 1);
  assert.equal(ctrl.terminalized[0].payload.auto_retry_count, 3);
  assert.match(String(ctrl.terminalized[0].payload.error_message), /TERMINAL — no internal owner/);
  assert.equal(r.failed, 1);
});

test("a lost claim is skipped — no reemit, no duplicate side effect", async () => {
  ctrl.dueRows = [due("autolenis/email.send", { to: "a@b.com" }, "r1")];
  ctrl.lostClaim = true;
  await (await newOps()).autoDrainDeadLetterJobs({ minAgeMs: 0 });
  assert.equal(calls.email.length, 0);
  assert.deepEqual(ctrl.deleted, []);
});

test("manual retry of an unknown event → {retried:false}, row restored with terminal reason", async () => {
  ctrl.retryRow = { id: "r1", job_id: "j1", event_name: "autolenis/legacy.unknown", payload: {}, error_message: "orig", failed_at: "2026-01-01T00:00:00Z" };
  const r = await (await newOps()).retryDeadLetterJob("r1");
  assert.equal(r.retried, false);
  assert.equal(calls.email.length + calls.dispatch.length, 0);
  assert.equal(ctrl.inserted.length, 1, "row restored, not lost");
  assert.match(String(ctrl.inserted[0].error_message), /TERMINAL — no internal owner/);
});

test("manual retry of a recognized event → replays internally, {retried:true}", async () => {
  ctrl.retryRow = { id: "r1", job_id: "j1", event_name: "autolenis/email.send", payload: { to: "a@b.com" }, error_message: "orig", failed_at: "2026-01-01T00:00:00Z" };
  const r = await (await newOps()).retryDeadLetterJob("r1");
  assert.equal(r.retried, true);
  assert.equal(calls.email.length, 1);
  assert.equal(ctrl.inserted.length, 0, "no restore on success");
});

test("affiliate.commission_walk replays via processFeeCommission (durable recovery), row removed", async () => {
  ctrl.dueRows = [due("autolenis/affiliate.commission_walk", {
    dealId: "deal_1", buyerId: "buyer_1", qualifyingEventId: "pi_123", feeBasisCents: 40000,
  }, "r1")];
  const r = await (await newOps()).autoDrainDeadLetterJobs({ minAgeMs: 0 });
  assert.equal(commissionCalls.length, 1);
  assert.deepEqual(commissionCalls[0], {
    dealId: "deal_1", buyerId: "buyer_1", qualifyingEventId: "pi_123", feeBasisCents: 40000,
  });
  // No legacy transport touched, and the row is cleared on success.
  assert.equal(calls.email.length + calls.sms.length + calls.dealer.length + calls.dispatch.length, 0);
  assert.deepEqual(ctrl.deleted, ["r1"]);
  assert.equal(r.reemitted, 1);
});

test("malformed commission_walk (missing buyerId) is terminalized, never walked", async () => {
  ctrl.dueRows = [due("autolenis/affiliate.commission_walk", { dealId: "deal_1", qualifyingEventId: "pi_123" }, "r9")];
  const r = await (await newOps()).autoDrainDeadLetterJobs({ minAgeMs: 0, maxAutoRetries: 3 });
  assert.equal(commissionCalls.length, 0, "never invokes the walk with an incomplete payload");
  assert.deepEqual(ctrl.deleted, []);
  assert.equal(ctrl.terminalized.length, 1);
  assert.equal(ctrl.terminalized[0].payload.auto_retry_count, 3);
  assert.match(String(ctrl.terminalized[0].payload.error_message), /TERMINAL — no internal owner/);
  assert.equal(r.failed, 1);
});

// ── getHealth: terminal DLQ rows must not pin the status at 'critical' forever ──
function healthFake(counts: {
  dlqTotal: number; dlqTerminal: number; failed: number; active: number; pendingIdem: number; refreshDay?: string | null;
}) {
  return {
    from(table: string) {
      const st = { table, filters: [] as Array<[string, unknown]>, gteCol: null as string | null };
      const b: Record<string, unknown> = {
        select: () => b,
        in: (c: string, v: unknown) => { st.filters.push([c, v]); return b; },
        eq: (c: string, v: unknown) => { st.filters.push([c, v]); return b; },
        gte: (c: string) => { st.gteCol = c; return b; },
        order: () => b,
        limit: () => b,
        maybeSingle: async () => ({ data: counts.refreshDay ? { day: counts.refreshDay } : null, error: null }),
        then: (res: (v: unknown) => void) => {
          if (st.table === "jobs_dead_letter") {
            return res({ count: st.gteCol === "auto_retry_count" ? counts.dlqTerminal : counts.dlqTotal, error: null });
          }
          if (st.table === "workflow_enrollments") {
            const active = st.filters.some((f) => f[0] === "status" && f[1] === "active");
            return res({ count: active ? counts.active : counts.failed, error: null });
          }
          if (st.table === "idempotency_keys") return res({ count: counts.pendingIdem, error: null });
          return res({ count: 0, data: null, error: null });
        },
      };
      return b;
    },
  };
}
async function health(counts: Parameters<typeof healthFake>[0]) {
  const { OperationsService } = await import("@/lib/services/operations.service");
  return new OperationsService(healthFake(counts) as never).getHealth();
}

test("getHealth: a pile of TERMINAL dlq rows is 'degraded', not 'critical' (no permanent pin)", async () => {
  const h = await health({ dlqTotal: 30, dlqTerminal: 30, failed: 0, active: 5, pendingIdem: 0 });
  assert.equal(h.dead_letter_count, 30);
  assert.equal(h.terminal_dead_letter_count, 30);
  assert.equal(h.retryable_dead_letter_count, 0);
  assert.equal(h.status, "degraded"); // visible, but not screaming critical forever
});

test("getHealth: live retryable backlog still escalates to 'critical'", async () => {
  const h = await health({ dlqTotal: 30, dlqTerminal: 0, failed: 0, active: 5, pendingIdem: 0 });
  assert.equal(h.retryable_dead_letter_count, 30);
  assert.equal(h.status, "critical");
});

test("getHealth: mixed — few terminal + few live is 'degraded'; empty is 'ok'", async () => {
  const mixed = await health({ dlqTotal: 5, dlqTerminal: 3, failed: 0, active: 0, pendingIdem: 0 });
  assert.equal(mixed.retryable_dead_letter_count, 2);
  assert.equal(mixed.terminal_dead_letter_count, 3);
  assert.equal(mixed.status, "degraded");

  const clean = await health({ dlqTotal: 0, dlqTerminal: 0, failed: 0, active: 10, pendingIdem: 0 });
  assert.equal(clean.status, "ok");
});

test("STRUCTURAL: the Inngest client/module is gone and nothing imports @/lib/inngest", async () => {
  const frontend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  assert.ok(!existsSync(path.join(frontend, "lib/inngest")), "lib/inngest directory is deleted");
  assert.ok(!existsSync(path.join(frontend, "app/api/inngest")), "app/api/inngest route is deleted");
  // operations.service must not import the (deleted) Inngest client.
  const opsSrc = readFileSync(path.join(frontend, "lib/services/operations.service.ts"), "utf8");
  assert.ok(!/from ['"]@\/lib\/inngest|from ['"]inngest/.test(opsSrc), "operations.service imports no Inngest module");
  assert.ok(!/inngest\.send\(/.test(opsSrc), "operations.service makes no inngest.send call");
});
