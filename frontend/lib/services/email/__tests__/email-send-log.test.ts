// S3 decision 1 — EmailSendLog parity. recordTransactionalEmailSend must upsert
// the SAME EmailSendLog row (keyed on idempotencyKey) the direct resend rail
// produced pre-migration — so admin views / reporting / dedup that read
// EmailSendLog keep working, and a retry updates (not duplicates) the row.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks lib/services/email/__tests__/email-send-log.test.ts

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

let upsertArgs: Record<string, unknown> | null = null;
let upsertCalls = 0;
let findUniqueRow: { status: string } | null = null;
let findUniqueArgs: Record<string, unknown> | null = null;

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      emailSendLog: {
        upsert: async (args: Record<string, unknown>) => {
          upsertArgs = args;
          upsertCalls += 1;
          return {};
        },
        findUnique: async (args: Record<string, unknown>) => {
          findUniqueArgs = args;
          return findUniqueRow;
        },
      },
    },
  },
});

async function load() {
  const mod = await import("@/lib/services/email/email-send-log");
  return mod.recordTransactionalEmailSend;
}

async function loadAlreadySent() {
  const mod = await import("@/lib/services/email/email-send-log");
  return mod.transactionalEmailAlreadySent;
}

beforeEach(() => {
  upsertArgs = null;
  upsertCalls = 0;
  findUniqueRow = null;
  findUniqueArgs = null;
});

test("upserts EmailSendLog keyed on idempotencyKey (parity, not a new key)", async () => {
  const record = await load();
  await record({
    idempotencyKey: "deal-selected-deal_1",
    recipient: "buyer@example.com",
    templateId: "deal-selected",
    resendId: "re_123",
  });

  assert.equal(upsertCalls, 1);
  assert.deepEqual((upsertArgs!.where as Record<string, unknown>), { idempotencyKey: "deal-selected-deal_1" });
  const create = upsertArgs!.create as Record<string, unknown>;
  assert.equal(create.idempotencyKey, "deal-selected-deal_1");
  assert.equal(create.recipient, "buyer@example.com");
  assert.equal(create.templateId, "deal-selected");
  assert.equal(create.status, "SENT");
  assert.equal(create.resendId, "re_123");
  // update path keeps the same key implicitly (where clause) and refreshes fields
  const update = upsertArgs!.update as Record<string, unknown>;
  assert.equal(update.status, "SENT");
  assert.equal(update.resendId, "re_123");
});

test("defaults status to SENT and tolerates a null resendId", async () => {
  const record = await load();
  await record({
    idempotencyKey: "offers-ready-auc_1",
    recipient: "b@x.com",
    templateId: "offers-ready",
  });
  const create = upsertArgs!.create as Record<string, unknown>;
  assert.equal(create.status, "SENT");
  assert.equal(create.resendId, null);
});

// ── transactionalEmailAlreadySent — the retriable SENT-precheck ──────────────
// S3 HIGH regression: the migrated transactional senders dedup on this, NOT on
// the insert-once idempotency_keys guard (which emailSendFn never releases).
// Only a genuinely-SENT prior attempt may block a re-send; a FAILED attempt
// (transient outage) MUST stay retriable — otherwise one blip permanently
// poisons a deal-selected / offers-ready / dealer-award email.

test("already-sent is TRUE only when a prior row is status SENT", async () => {
  findUniqueRow = { status: "SENT" };
  const alreadySent = await loadAlreadySent();
  assert.equal(await alreadySent("deal-selected-deal_1"), true);
  // keyed on idempotencyKey (parity), reading only the status column
  assert.deepEqual((findUniqueArgs!.where as Record<string, unknown>), {
    idempotencyKey: "deal-selected-deal_1",
  });
});

test("a prior FAILED attempt does NOT block — the send stays retriable", async () => {
  findUniqueRow = { status: "FAILED" };
  const alreadySent = await loadAlreadySent();
  assert.equal(await alreadySent("offers-ready-auc_1"), false);
});

test("a DEV_SKIPPED attempt does NOT block", async () => {
  findUniqueRow = { status: "DEV_SKIPPED" };
  const alreadySent = await loadAlreadySent();
  assert.equal(await alreadySent("dealer-offer-won-deal_1"), false);
});

test("no prior row → not already sent (first attempt proceeds)", async () => {
  findUniqueRow = null;
  const alreadySent = await loadAlreadySent();
  assert.equal(await alreadySent("dealer-offer-lost-auc_1-x@y.com"), false);
});
