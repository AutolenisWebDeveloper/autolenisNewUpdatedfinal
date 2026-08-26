// Unit tests for handleEnvelopeDeclined / handleEnvelopeVoidedByProvider —
// Program 4's truthful terminal-exception handling for DocuSign. Proves a
// declined/voided envelope becomes DECLINED/VOIDED, the deal is NOT advanced to
// SIGNED (no false completion, no silent limbo), the exception is surfaced
// (buyer notification + audit log), the handler is idempotent on replay, and a
// COMPLETED envelope is authoritative and never downgraded.
//
// Run: npx tsx --test --experimental-test-module-mocks \
//   lib/services/esign/__tests__/esign-declined.test.ts

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

interface EnvRow { id: string; dealId: string; docusignEnvelopeId: string; status: string; }
interface Ctrl {
  env: EnvRow | null;
  envUpdates: Array<Record<string, unknown>>;
  notifications: Array<Record<string, unknown>>;
  audits: Array<Record<string, unknown>>;
  advanceCalls: Array<{ dealId: string; status: string }>;
}
let ctrl: Ctrl;

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      eSignEnvelope: {
        findFirst: async () => (ctrl.env ? { ...ctrl.env } : null),
        update: async ({ data }: { data: Record<string, unknown> }) => {
          ctrl.envUpdates.push(data);
          if (ctrl.env) Object.assign(ctrl.env, data);
          return { ...(ctrl.env as EnvRow) };
        },
      },
      deal: { findUnique: async () => ({ buyerId: "b1" }) },
      notification: { create: async ({ data }: { data: Record<string, unknown> }) => { ctrl.notifications.push(data); } },
      adminAuditLog: { create: async ({ data }: { data: Record<string, unknown> }) => { ctrl.audits.push(data); } },
    },
  },
});

// Guard: the deal must NEVER be advanced from a decline/void. If the handler
// calls advanceDealStatus, this mock records it and the test fails.
mock.module("@/lib/services/deal/deal.service", {
  namedExports: {
    advanceDealStatus: async (dealId: string, status: string) => { ctrl.advanceCalls.push({ dealId, status }); },
    INSURANCE_SATISFIED: [],
    DealTransitionError: class extends Error {},
    InsuranceRequiredError: class extends Error {},
  },
});

mock.module("@/lib/logger", { namedExports: { logger: { error: () => {}, warn: () => {}, info: () => {} } } });

async function load() { return import("@/lib/services/esign/esign.service"); }

beforeEach(() => {
  ctrl = { env: null, envUpdates: [], notifications: [], audits: [], advanceCalls: [] };
});

test("declined: sets DECLINED, does NOT advance the deal, surfaces the exception", async () => {
  ctrl.env = { id: "e1", dealId: "d1", docusignEnvelopeId: "ds1", status: "SENT" };
  const { handleEnvelopeDeclined } = await load();
  await handleEnvelopeDeclined("ds1", "signer declined");
  assert.equal(ctrl.envUpdates[0]!.status, "DECLINED");
  assert.deepEqual(ctrl.advanceCalls, [], "a declined envelope must NEVER advance the deal to SIGNED");
  assert.equal(ctrl.notifications.length, 1, "buyer is told signing was not completed");
  assert.equal(ctrl.audits[0]!.action, "ESIGN_ENVELOPE_DECLINED");
});

test("declined: idempotent — a replay on an already-DECLINED envelope is a no-op", async () => {
  ctrl.env = { id: "e1", dealId: "d1", docusignEnvelopeId: "ds1", status: "DECLINED" };
  const { handleEnvelopeDeclined } = await load();
  await handleEnvelopeDeclined("ds1");
  assert.equal(ctrl.envUpdates.length, 0);
  assert.equal(ctrl.audits.length, 0);
});

test("declined: never downgrades a COMPLETED (authoritative) envelope", async () => {
  ctrl.env = { id: "e1", dealId: "d1", docusignEnvelopeId: "ds1", status: "COMPLETED" };
  const { handleEnvelopeDeclined } = await load();
  await handleEnvelopeDeclined("ds1");
  assert.equal(ctrl.envUpdates.length, 0, "a signed document is authoritative and immutable to a late decline");
});

test("voided: sets VOIDED with voidedAt, does NOT advance, audits", async () => {
  ctrl.env = { id: "e1", dealId: "d1", docusignEnvelopeId: "ds1", status: "DELIVERED" };
  const { handleEnvelopeVoidedByProvider } = await load();
  await handleEnvelopeVoidedByProvider("ds1", "expired");
  assert.equal(ctrl.envUpdates[0]!.status, "VOIDED");
  assert.ok(ctrl.envUpdates[0]!.voidedAt, "voidedAt is stamped");
  assert.deepEqual(ctrl.advanceCalls, []);
  assert.equal(ctrl.audits[0]!.action, "ESIGN_ENVELOPE_VOIDED");
});

test("unknown envelope id → no-op (no crash, no writes)", async () => {
  ctrl.env = null;
  const { handleEnvelopeDeclined } = await load();
  await handleEnvelopeDeclined("nope");
  assert.equal(ctrl.envUpdates.length, 0);
});
