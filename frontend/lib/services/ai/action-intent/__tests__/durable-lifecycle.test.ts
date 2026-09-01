// The full durable lifecycle driven through the ENGINE over the durable store:
// proposal survives a separate request/process, approval executes across that
// boundary, and terminal states cannot re-execute. Exactly-once holds under
// concurrent approvals. Audit history reconstructs the whole path.
//
//   npx tsx --test lib/services/ai/action-intent/__tests__/durable-lifecycle.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { proposeIntent, approveIntent, rejectIntent, type EngineDeps } from "../engine";
import { PrismaActionIntentStore } from "../prisma-store";
import type { ActionIntentStore } from "../store";
import { FakeAiActionIntentDb } from "./_durable-harness";
import {
  activationKeyFor,
  capturingAudit,
  makeActor,
  permissivePolicyDeps,
  recordingCommands,
  type CapturingAudit,
} from "./_harness";

// Build engine deps whose STORE is the durable Prisma-backed store over a shared
// fake DB. Each call can share `db` (same database) but use its own store
// instance (separate request/process).
function durableDeps(
  db: FakeAiActionIntentDb,
  opts: { activeIntents?: string[]; audit?: CapturingAudit; commandResult?: (t: string) => { ok: boolean; data?: Record<string, unknown>; failureReason?: string } } = {},
): EngineDeps & { calls: string[]; store: ActionIntentStore } {
  const active = new Set((opts.activeIntents ?? []).map(activationKeyFor));
  const rec = recordingCommands(opts.commandResult);
  let counter = 0;
  return {
    store: new PrismaActionIntentStore(db.delegate()),
    audit: opts.audit ?? capturingAudit(),
    activation: async (key: string) => active.has(key),
    policyDeps: permissivePolicyDeps(),
    commands: rec.commands,
    genId: () => `ai-${++counter}-${Math.random().toString(36).slice(2, 8)}`,
    calls: rec.calls,
  };
}

const adminActor = (id = "admin-1") => makeActor({ actorType: "ADMIN", actorId: id, authenticatedRole: "OPERATIONS_ADMIN", actorEmail: "a@x.com" });

test("proposal persists durably; a SEPARATE request approves and executes it", async () => {
  const db = new FakeAiActionIntentDb();
  // Request 1: propose (agent surface, admin proposer).
  const d1 = durableDeps(db, { activeIntents: ["admin.advance_deal_status"] });
  const out = await proposeIntent(
    { intentType: "admin.advance_deal_status", parameters: { dealId: "d1", newStatus: "FEE_PENDING" }, actor: adminActor("admin-1") },
    d1,
  );
  assert.equal(out.status, "APPROVAL_REQUIRED");
  const intentId = out.status === "APPROVAL_REQUIRED" ? out.intentId : "";
  assert.deepEqual(d1.calls, []); // nothing executed at proposal time

  // Request 2: a DIFFERENT store instance (new process) retrieves + approves.
  const d2 = durableDeps(db, { activeIntents: ["admin.advance_deal_status"] });
  const persisted = await d2.store.get(intentId);
  assert.ok(persisted, "record survived the request boundary");
  assert.equal(persisted?.status, "APPROVAL_REQUIRED");
  const approved = await approveIntent(intentId, adminActor("admin-2"), d2);
  assert.equal(approved.status, "COMPLETED");
  assert.deepEqual(d2.calls, ["admin.advance_deal_status"]);
  assert.equal(db.rows.get(intentId)?.status, "COMPLETED");
  assert.ok(db.rows.get(intentId)?.approverId === "admin-2");
});

test("a COMPLETED intent cannot execute again across requests", async () => {
  const db = new FakeAiActionIntentDb();
  const d1 = durableDeps(db, { activeIntents: ["admin.advance_deal_status"] });
  const out = await proposeIntent(
    { intentType: "admin.advance_deal_status", parameters: { dealId: "d1", newStatus: "FEE_PENDING" }, actor: adminActor("admin-1") },
    d1,
  );
  const intentId = out.status === "APPROVAL_REQUIRED" ? out.intentId : "";
  await approveIntent(intentId, adminActor("admin-2"), d1);
  // A replayed approval from yet another request must NOT execute again.
  const d2 = durableDeps(db, { activeIntents: ["admin.advance_deal_status"] });
  const replay = await approveIntent(intentId, adminActor("admin-3"), d2);
  assert.equal(replay.status, "COMPLETED");
  assert.deepEqual(d2.calls, []); // d2 never executed — d1 already did, once
});

test("a REJECTED intent cannot be executed by a later approval", async () => {
  const db = new FakeAiActionIntentDb();
  const d1 = durableDeps(db, { activeIntents: ["admin.extend_auction"] });
  const out = await proposeIntent(
    { intentType: "admin.extend_auction", parameters: { auctionId: "a1", hours: 12, reason: "buyer travel" }, actor: adminActor("admin-1") },
    d1,
  );
  const intentId = out.status === "APPROVAL_REQUIRED" ? out.intentId : "";
  await rejectIntent(intentId, adminActor("admin-2"), "not warranted", d1);
  const d2 = durableDeps(db, { activeIntents: ["admin.extend_auction"] });
  const late = await approveIntent(intentId, adminActor("admin-3"), d2);
  assert.equal(late.status, "REJECTED");
  assert.deepEqual(d2.calls, []);
});

test("concurrent approvals across two requests execute the command exactly once", async () => {
  const db = new FakeAiActionIntentDb();
  const seed = durableDeps(db, { activeIntents: ["admin.advance_deal_status"] });
  const out = await proposeIntent(
    { intentType: "admin.advance_deal_status", parameters: { dealId: "d1", newStatus: "FEE_PENDING" }, actor: adminActor("admin-1") },
    seed,
  );
  const intentId = out.status === "APPROVAL_REQUIRED" ? out.intentId : "";
  // Two independent requests approve the same intent at the same time.
  const reqA = durableDeps(db, { activeIntents: ["admin.advance_deal_status"] });
  const reqB = durableDeps(db, { activeIntents: ["admin.advance_deal_status"] });
  const [a, b] = await Promise.all([
    approveIntent(intentId, adminActor("admin-2"), reqA),
    approveIntent(intentId, adminActor("admin-3"), reqB),
  ]);
  const totalCalls = reqA.calls.length + reqB.calls.length;
  assert.equal(totalCalls, 1, "canonical command invoked exactly once across both requests");
  assert.ok([a.status, b.status].includes("COMPLETED"));
  assert.equal(db.rows.get(intentId)?.status, "COMPLETED");
});

test("audit history reconstructs proposal → approval → execution → completion", async () => {
  const db = new FakeAiActionIntentDb();
  const audit = capturingAudit();
  const deps = durableDeps(db, { activeIntents: ["admin.advance_deal_status"], audit });
  const out = await proposeIntent(
    { intentType: "admin.advance_deal_status", parameters: { dealId: "d1", newStatus: "FEE_PENDING" }, actor: adminActor("admin-1") },
    deps,
  );
  const intentId = out.status === "APPROVAL_REQUIRED" ? out.intentId : "";
  await approveIntent(intentId, adminActor("admin-2"), deps);
  const seq = audit.events.filter((e) => e.intentId === intentId).map((e) => e.status);
  assert.deepEqual(seq, ["PROPOSED", "APPROVAL_REQUIRED", "APPROVED", "EXECUTING", "COMPLETED"]);
  // The approver identity is captured on the APPROVED event.
  const approvedEvt = audit.events.find((e) => e.status === "APPROVED");
  assert.equal(approvedEvt?.approverId, "admin-2");
});

test("CONCURRENT same-key proposals collapse idempotently — no throw, one row, one execution", async () => {
  const db = new FakeAiActionIntentDb();
  const deps = durableDeps(db, { activeIntents: ["buyer.get_journey_status"] });
  const p = { intentType: "buyer.get_journey_status", parameters: {}, actor: makeActor(), idempotencyKey: "race-1" };
  // Two requests propose the same idempotency key at the same time.
  const results = await Promise.allSettled([proposeIntent(p, deps), proposeIntent(p, deps)]);
  assert.ok(results.every((r) => r.status === "fulfilled"), "neither proposal throws");
  const rows = [...db.rows.values()].filter((r) => r.idempotencyKey === "race-1");
  assert.equal(rows.length, 1, "exactly one durable row for the key");
  assert.equal(deps.calls.length, 1, "the read command executed exactly once");
});

test("failed idempotency-keyed proposal is not created twice durably", async () => {
  const db = new FakeAiActionIntentDb();
  const deps = durableDeps(db, { activeIntents: ["buyer.get_journey_status"] });
  const p = { intentType: "buyer.get_journey_status", parameters: {}, actor: makeActor(), idempotencyKey: "req-9" };
  await proposeIntent(p, deps);
  await proposeIntent(p, deps);
  // Only one row for the idempotency key.
  const matching = [...db.rows.values()].filter((r) => r.idempotencyKey === "req-9");
  assert.equal(matching.length, 1);
});
