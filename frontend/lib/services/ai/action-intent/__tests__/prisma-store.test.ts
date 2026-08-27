// Durable store semantics: cross-request persistence, idempotency-key dedup,
// and the atomic conditional-claim CAS that guarantees exactly-once.
//
//   npx tsx --test lib/services/ai/action-intent/__tests__/prisma-store.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { PrismaActionIntentStore } from "../prisma-store";
import { ActionIntentRejected, type ActionIntentRecord } from "../types";
import { FakeAiActionIntentDb } from "./_durable-harness";

function baseRecord(over: Partial<ActionIntentRecord> = {}): Omit<ActionIntentRecord, "createdAt" | "updatedAt"> {
  return {
    id: "ai-1",
    intentType: "admin.trigger_deposit_refund",
    status: "PROPOSED",
    actorType: "ADMIN",
    actorId: "admin-1",
    authenticatedRole: "OPERATIONS_ADMIN",
    parameters: { depositId: "dep1", reason: "dup" },
    consequence: "CONSEQUENTIAL",
    requiresHumanApproval: true,
    ...over,
  };
}

test("a record persists and is retrievable through a SEPARATE store instance (cross-request)", async () => {
  const db = new FakeAiActionIntentDb();
  const writer = new PrismaActionIntentStore(db.delegate());
  await writer.create(baseRecord());
  // A different request/process → a brand-new store over the same DB.
  const reader = new PrismaActionIntentStore(db.delegate());
  const got = await reader.get("ai-1");
  assert.ok(got);
  assert.equal(got?.status, "PROPOSED");
  assert.equal(got?.intentType, "admin.trigger_deposit_refund");
});

test("duplicate proposal with same idempotency key collapses to the first row", async () => {
  const db = new FakeAiActionIntentDb();
  const store = new PrismaActionIntentStore(db.delegate());
  const a = await store.create(baseRecord({ id: "ai-A", idempotencyKey: "k1" }));
  const b = await store.create(baseRecord({ id: "ai-B", idempotencyKey: "k1" }));
  assert.equal(a.id, "ai-A");
  assert.equal(b.id, "ai-A"); // second insert hit the unique index → returned existing
  assert.equal(db.rows.size, 1);
});

test("transition is a conditional CAS: wrong 'from' throws INVALID_STATE, row unchanged", async () => {
  const db = new FakeAiActionIntentDb();
  const store = new PrismaActionIntentStore(db.delegate());
  await store.create(baseRecord({ status: "APPROVAL_REQUIRED" }));
  await assert.rejects(() => store.transition("ai-1", "APPROVED", "EXECUTING"), ActionIntentRejected);
  const still = await store.get("ai-1");
  assert.equal(still?.status, "APPROVAL_REQUIRED");
});

test("only ONE of two concurrent claims to EXECUTING wins; attempts increments once", async () => {
  const db = new FakeAiActionIntentDb();
  const store = new PrismaActionIntentStore(db.delegate());
  await store.create(baseRecord({ status: "APPROVED" }));
  const results = await Promise.allSettled([
    store.transition("ai-1", "APPROVED", "EXECUTING"),
    store.transition("ai-1", "APPROVED", "EXECUTING"),
  ]);
  const fulfilled = results.filter((r) => r.status === "fulfilled");
  const rejected = results.filter((r) => r.status === "rejected");
  assert.equal(fulfilled.length, 1, "exactly one claim wins");
  assert.equal(rejected.length, 1, "the loser is rejected, not a second execution");
  const row = db.rows.get("ai-1")!;
  assert.equal(row.status, "EXECUTING");
  assert.equal(row.executionAttempts, 1, "attempt counter incremented exactly once");
  assert.ok(row.executionClaimedAt, "claim timestamp stamped");
});

test("listByStatus returns only rows in that status", async () => {
  const db = new FakeAiActionIntentDb();
  const store = new PrismaActionIntentStore(db.delegate());
  await store.create(baseRecord({ id: "p1", status: "APPROVAL_REQUIRED" }));
  await store.create(baseRecord({ id: "p2", status: "APPROVAL_REQUIRED", idempotencyKey: "z2" }));
  await store.create(baseRecord({ id: "c1", status: "COMPLETED", idempotencyKey: "z3" }));
  const pending = await store.listByStatus("APPROVAL_REQUIRED");
  assert.deepEqual(pending.map((r) => r.id).sort(), ["p1", "p2"]);
});
