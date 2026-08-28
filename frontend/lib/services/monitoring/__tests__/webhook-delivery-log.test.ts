// Tests for the webhook delivery-rejection log.
//
// THE GAP THIS CLOSES
// -------------------
// A Stripe delivery that is REJECTED leaves no trace anywhere in the platform.
// `payment_provider_events` is only written AFTER signature verification passes,
// and the route's signature-failure branch was a bare `return 400` — no log, no
// row, nothing. So three very different states were indistinguishable from the
// database:
//
//   • Stripe is not delivering at all (endpoint never registered)
//   • Stripe IS delivering and we reject every one (signing secret mismatch)
//   • the endpoint is misconfigured and 500s before it can verify anything
//
// That ambiguity is not academic: it is exactly the question that could not be
// answered when the money path was found dead, and answering it required Stripe
// Dashboard access nobody had at the time. `WebhookEvent` existed for precisely
// this and had zero writers in the entire codebase.
//
// TWO PROPERTIES THAT ARE LOAD-BEARING, NOT NICE-TO-HAVE
// ------------------------------------------------------
// 1. THE UNVERIFIED BODY IS NEVER STORED. On a signature failure the body is
//    unauthenticated and attacker-controlled; if it IS a real Stripe event with
//    a mismatched secret, it carries customer PII. Only bounded, non-sensitive
//    metadata is recorded.
// 2. RECORDING IS THROTTLED. /api/webhooks/stripe is unauthenticated — anyone
//    can POST to it. A row per rejected request turns an observability feature
//    into a storage-amplification vector. One row per (source, reason) per
//    window is enough to prove the condition is occurring.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "lib/services/monitoring/__tests__/webhook-delivery-log.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

interface Row { source: string; eventType: string; payload: Record<string, unknown>; processed: boolean; error: string | null; receivedAt: Date }

interface Ctrl {
  rows: Row[];
  lastFindWhere: Record<string, unknown> | null;
  createThrows: Error | null;
  findThrows: Error | null;
  alerts: Array<Record<string, unknown>>;
  existingAlerts: Array<{ title: string; createdAt: Date }>;
  lastAlertFindWhere: Record<string, unknown> | null;
  alertCreateThrows: Error | null;
}
let ctrl: Ctrl;

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      webhookEvent: {
        findFirst: async (args: { where: Record<string, unknown> }) => {
          ctrl.lastFindWhere = args.where;
          if (ctrl.findThrows) throw ctrl.findThrows;
          const w = args.where as { source?: string; eventType?: string; receivedAt?: { gt?: Date } };
          return (
            ctrl.rows.find(
              (r) =>
                r.source === w.source &&
                r.eventType === w.eventType &&
                (!w.receivedAt?.gt || r.receivedAt > w.receivedAt.gt),
            ) ?? null
          );
        },
        create: async ({ data }: { data: Omit<Row, "receivedAt"> }) => {
          if (ctrl.createThrows) throw ctrl.createThrows;
          const row = { ...data, receivedAt: new Date() };
          ctrl.rows.push(row);
          return row;
        },
      },
      notification: {
        findFirst: async (args: { where: Record<string, unknown> }) => {
          ctrl.lastAlertFindWhere = args.where;
          const w = args.where as { title?: string; createdAt?: { gt?: Date } };
          return (
            ctrl.existingAlerts.find(
              (a) => a.title === w.title && (!w.createdAt?.gt || a.createdAt > w.createdAt.gt),
            ) ?? null
          );
        },
        create: async ({ data }: { data: Record<string, unknown> }) => {
          if (ctrl.alertCreateThrows) throw ctrl.alertCreateThrows;
          ctrl.alerts.push(data);
          ctrl.existingAlerts.push({ title: String(data.title), createdAt: new Date() });
          return data;
        },
      },
    },
  },
});

mock.module("@/lib/logger", {
  namedExports: { logger: { error: () => {}, warn: () => {}, info: () => {} } },
});

async function load() {
  return import("@/lib/services/monitoring/webhook-delivery-log.service");
}

beforeEach(() => {
  ctrl = {
    rows: [], lastFindWhere: null, createThrows: null, findThrows: null,
    alerts: [], existingAlerts: [], lastAlertFindWhere: null, alertCreateThrows: null,
  };
});

// ---------------------------------------------------------------------------
// It records the condition
// ---------------------------------------------------------------------------

test("a rejected delivery is persisted, so it is visible without provider access", async () => {
  const { recordWebhookRejection } = await load();
  const res = await recordWebhookRejection({
    source: "stripe",
    reason: "signature_invalid",
    bodyBytes: 3241,
    hasSignatureHeader: true,
  });

  assert.equal(res, "recorded");
  assert.equal(ctrl.rows.length, 1);
  assert.equal(ctrl.rows[0].source, "stripe");
  assert.equal(ctrl.rows[0].eventType, "rejected.signature_invalid");
  assert.equal(ctrl.rows[0].processed, false, "a rejected delivery was never processed");
  assert.ok(ctrl.rows[0].error, "the human-readable reason belongs in `error`");
});

test("body size and signature presence are recorded — the diagnostic that matters", async () => {
  const { recordWebhookRejection } = await load();
  await recordWebhookRejection({
    source: "stripe",
    reason: "signature_invalid",
    bodyBytes: 3241,
    hasSignatureHeader: true,
  });

  const p = ctrl.rows[0].payload;
  assert.equal(p.bodyBytes, 3241);
  assert.equal(p.hasSignatureHeader, true);
  // This pair is what separates "Stripe is delivering and we reject it" (a real
  // signed event, kilobytes, signature header present) from "a scanner hit the
  // URL" (no signature header, tiny or empty body).
});

// ---------------------------------------------------------------------------
// It never stores the unverified body
// ---------------------------------------------------------------------------

test("the unverified request body is NEVER stored", async () => {
  const { recordWebhookRejection } = await load();
  await recordWebhookRejection({
    source: "stripe",
    reason: "signature_invalid",
    bodyBytes: 3241,
    hasSignatureHeader: true,
  });

  const serialized = JSON.stringify(ctrl.rows[0]);
  assert.ok(!serialized.includes("body\":\""), "no raw body field");
  const keys = Object.keys(ctrl.rows[0].payload).sort();
  assert.deepEqual(
    keys,
    ["bodyBytes", "hasSignatureHeader", "note", "reason"],
    "payload is a fixed, bounded, non-sensitive shape — an allow-list, not a dump",
  );
});

// ---------------------------------------------------------------------------
// It cannot be used to flood the table
// ---------------------------------------------------------------------------

test("a repeat of the same rejection inside the window is throttled", async () => {
  const { recordWebhookRejection } = await load();
  const input = { source: "stripe", reason: "signature_invalid" as const, bodyBytes: 10, hasSignatureHeader: true };

  assert.equal(await recordWebhookRejection(input), "recorded");
  assert.equal(await recordWebhookRejection(input), "throttled");
  assert.equal(await recordWebhookRejection(input), "throttled");
  assert.equal(ctrl.rows.length, 1, "an unauthenticated endpoint must not write a row per request");
});

test("the throttle is scoped by time, not unconditional", async () => {
  const { recordWebhookRejection } = await load();
  await recordWebhookRejection({ source: "stripe", reason: "signature_invalid", bodyBytes: 10, hasSignatureHeader: true });

  const where = ctrl.lastFindWhere as { receivedAt?: { gt?: Date } };
  assert.ok(where?.receivedAt?.gt instanceof Date, "the dedupe window must be a moving cutoff, not 'ever'");
});

test("a DIFFERENT reason is not silenced by the first — they are separate signals", async () => {
  const { recordWebhookRejection } = await load();
  await recordWebhookRejection({ source: "stripe", reason: "signature_invalid", bodyBytes: 10, hasSignatureHeader: true });
  const res = await recordWebhookRejection({ source: "stripe", reason: "webhook_secret_missing", bodyBytes: 10, hasSignatureHeader: true });

  assert.equal(res, "recorded");
  assert.equal(ctrl.rows.length, 2, "a secret-missing 500 and a signature 400 are different diagnoses");
});

// ---------------------------------------------------------------------------
// It can never break the webhook
// ---------------------------------------------------------------------------

test("a failed write never throws — recording must not break the endpoint", async () => {
  ctrl.createThrows = new Error("db down");
  const { recordWebhookRejection } = await load();

  const res = await recordWebhookRejection({
    source: "stripe",
    reason: "signature_invalid",
    bodyBytes: 10,
    hasSignatureHeader: true,
  });
  assert.equal(res, "failed", "reported, not thrown — Stripe's response must not depend on our logging");
});

test("a failed throttle lookup also never throws", async () => {
  ctrl.findThrows = new Error("db down");
  const { recordWebhookRejection } = await load();

  const res = await recordWebhookRejection({
    source: "stripe",
    reason: "signature_invalid",
    bodyBytes: 10,
    hasSignatureHeader: true,
  });
  assert.equal(res, "failed");
});

// ---------------------------------------------------------------------------
// It is visible to an operator, not just to SQL
// ---------------------------------------------------------------------------
//
// A row nobody looks at is a log file in a database. /admin/operations reads
// SYSTEM_ALERT notifications, so the rejection has to reach that rail to close
// the loop the original failure exposed: nobody knew for months.

test("a recorded rejection also raises an operator alert", async () => {
  const { recordWebhookRejection } = await load();
  await recordWebhookRejection({
    source: "stripe",
    reason: "signature_invalid",
    bodyBytes: 3241,
    hasSignatureHeader: true,
  });

  assert.equal(ctrl.alerts.length, 1);
  assert.equal(ctrl.alerts[0].type, "SYSTEM_ALERT");
  assert.equal(ctrl.alerts[0].actionUrl, "/admin/operations");
  assert.equal(ctrl.alerts[0].buyerId, null, "ops-only — never a buyer-facing notification");
  assert.match(String(ctrl.alerts[0].title), /stripe/i);
});

test("the alert names the reason-specific fix, not a generic failure", async () => {
  const { recordWebhookRejection } = await load();
  await recordWebhookRejection({
    source: "stripe",
    reason: "signature_invalid",
    bodyBytes: 3241,
    hasSignatureHeader: true,
  });

  const body = String(ctrl.alerts[0].body);
  assert.match(body, /signing secret/i, "the operator must be told which knob to turn");
  assert.match(body, /3241/, "and the evidence that Stripe really is delivering");
});

test("every rejection reason alerts — all three mean the webhook cannot work", async () => {
  const { recordWebhookRejection } = await load();
  await recordWebhookRejection({ source: "stripe", reason: "webhook_secret_missing", bodyBytes: 10, hasSignatureHeader: true });
  await recordWebhookRejection({ source: "stripe", reason: "provider_client_unavailable", bodyBytes: 0, hasSignatureHeader: false });

  assert.equal(ctrl.alerts.length, 2, "a missing secret is as invisible on the dashboard as a bad signature");
});

test("a throttled rejection raises NO alert — no row, no alarm", async () => {
  const { recordWebhookRejection } = await load();
  const input = { source: "stripe", reason: "signature_invalid" as const, bodyBytes: 10, hasSignatureHeader: true };

  await recordWebhookRejection(input);
  ctrl.alerts = []; // ignore the first, legitimate alert
  const res = await recordWebhookRejection(input);

  assert.equal(res, "throttled");
  assert.equal(ctrl.alerts.length, 0);
});

test("the alert dedupes over a LONGER window than the row", async () => {
  const { recordWebhookRejection, WEBHOOK_REJECTION_THROTTLE_MINUTES, WEBHOOK_REJECTION_ALERT_THROTTLE_MINUTES } = await load();
  await recordWebhookRejection({ source: "stripe", reason: "signature_invalid", bodyBytes: 10, hasSignatureHeader: true });

  assert.ok(
    WEBHOOK_REJECTION_ALERT_THROTTLE_MINUTES > WEBHOOK_REJECTION_THROTTLE_MINUTES,
    "rows give a timeline; alerts must not fire on every one or an outage becomes 96 alerts a day",
  );
  const where = ctrl.lastAlertFindWhere as { createdAt?: { gt?: Date } };
  assert.ok(where?.createdAt?.gt instanceof Date, "the alert dedupe must also be a moving window, not 'ever'");
});

test("an alert failure never throws, and never loses the row", async () => {
  ctrl.alertCreateThrows = new Error("db down");
  const { recordWebhookRejection } = await load();

  const res = await recordWebhookRejection({
    source: "stripe",
    reason: "signature_invalid",
    bodyBytes: 10,
    hasSignatureHeader: true,
  });

  assert.equal(res, "recorded", "the durable record is what matters; the alert is a courtesy on top");
  assert.equal(ctrl.rows.length, 1);
});
