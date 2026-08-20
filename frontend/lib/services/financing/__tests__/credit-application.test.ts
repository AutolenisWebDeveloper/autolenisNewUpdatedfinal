// Phase 5 Block 3 — CreditApplication guarded state machine + encrypted PII.
// Mirrors the Deal `canTransition`/CAS idiom: illegal transitions are rejected, and
// advanceApplication uses a compare-and-swap (updateMany where id+expectedStatus,
// count===1) so two concurrent transitions cannot both win. PII (SSN/income) is
// encrypted at rest on create — never stored plaintext.
//
// Run: pnpm test:financing

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

const state = {
  apps: new Map<string, Record<string, unknown>>(),
  created: [] as Array<Record<string, unknown>>,
  updateManyCalls: [] as Array<{ where: Record<string, unknown>; data: Record<string, unknown> }>,
  updateManyResult: 1,
  audit: [] as Array<Record<string, unknown>>,
};

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      creditApplication: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          state.created.push(data);
          const row = { id: "app_1", ...data };
          state.apps.set("app_1", row);
          return row;
        },
        findUnique: async ({ where }: { where: { id: string } }) => state.apps.get(where.id) ?? null,
        updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          state.updateManyCalls.push({ where, data });
          return { count: state.updateManyResult };
        },
      },
    },
  },
});

mock.module("@/lib/security/field-encryption", {
  namedExports: {
    // Base64 fake (like real ciphertext: the plaintext does NOT appear as a
    // substring) so the "no plaintext at rest" assertion is meaningful without a key.
    encryptOptionalField: (v: string | null | undefined) =>
      v == null || v === "" ? null : `ENC:${Buffer.from(String(v)).toString("base64")}`,
    encryptField: (v: string) => `ENC:${Buffer.from(v).toString("base64")}`,
  },
});

mock.module("@/lib/services/financing/financing-audit.service", {
  namedExports: { appendFinancingAuditEvent: async (e: Record<string, unknown>) => { state.audit.push(e); return { id: "evt", ...e }; } },
});

beforeEach(() => {
  state.apps = new Map();
  state.created = [];
  state.updateManyCalls = [];
  state.updateManyResult = 1;
  state.audit = [];
});

test("canTransitionApplication allows the legal path and rejects skips/illegal moves", async () => {
  const { canTransitionApplication } = await import("@/lib/services/financing/credit-application.service");
  assert.equal(canTransitionApplication("DRAFT" as never, "SUBMITTED" as never), true);
  assert.equal(canTransitionApplication("SUBMITTED" as never, "PENDING_LENDER" as never), true);
  assert.equal(canTransitionApplication("PENDING_LENDER" as never, "APPROVED" as never), true);
  assert.equal(canTransitionApplication("DECLINED" as never, "ADVERSE_ACTION_PENDING" as never), true);
  // illegal: skip / backwards / from terminal
  assert.equal(canTransitionApplication("DRAFT" as never, "APPROVED" as never), false);
  assert.equal(canTransitionApplication("APPROVED" as never, "DECLINED" as never), false);
  assert.equal(canTransitionApplication("WITHDRAWN" as never, "SUBMITTED" as never), false);
});

test("createCreditApplication encrypts SSN + income at rest (never plaintext)", async () => {
  const { createCreditApplication } = await import("@/lib/services/financing/credit-application.service");
  await createCreditApplication({
    dealId: "deal_1",
    buyerId: "b1",
    amountRequestedCents: 2_500_000,
    termMonths: 60,
    ssn: "123-45-6789",
    annualIncomeCents: 9_000_000,
    employment: "Acme Corp",
  });
  const row = state.created[0]!;
  assert.equal(row.status, "DRAFT");
  assert.ok(String(row.ssnEncrypted).startsWith("ENC:"), "SSN is stored encrypted");
  assert.ok(String(row.annualIncomeEncrypted).startsWith("ENC:"), "income is stored encrypted");
  assert.notEqual(row.ssnEncrypted, "123-45-6789");
  // The plaintext must NOT appear anywhere in the stored row, and there is no
  // plaintext column.
  const serialized = JSON.stringify(row);
  assert.equal(serialized.includes("123-45-6789"), false, "plaintext SSN must not be stored");
  assert.equal(serialized.includes("9000000"), false, "plaintext income must not be stored");
  assert.equal(Object.prototype.hasOwnProperty.call(row, "ssn"), false, "no plaintext ssn column");
});

test("advanceApplication does a CAS on (id, expectedStatus) and records a STATE_TRANSITION", async () => {
  const { advanceApplication } = await import("@/lib/services/financing/credit-application.service");
  state.apps.set("app_1", { id: "app_1", status: "DRAFT", dealId: "deal_1", buyerId: "b1" });
  await advanceApplication("app_1", "SUBMITTED" as never, { actorType: "BUYER", actorId: "b1" });
  const call = state.updateManyCalls[0]!;
  assert.equal(call.where.id, "app_1");
  assert.equal(call.where.status, "DRAFT", "CAS guards on the expected current status");
  assert.equal(call.data.status, "SUBMITTED");
  assert.equal(state.audit[0]!.eventType, "STATE_TRANSITION");
});

test("advanceApplication throws on an illegal transition (before touching the DB)", async () => {
  const { advanceApplication } = await import("@/lib/services/financing/credit-application.service");
  state.apps.set("app_1", { id: "app_1", status: "DRAFT", dealId: "deal_1", buyerId: "b1" });
  await assert.rejects(() => advanceApplication("app_1", "APPROVED" as never, {}), /transition/i);
  assert.equal(state.updateManyCalls.length, 0, "no DB write on an illegal move");
});

test("advanceApplication cannot leave a terminal state even with force (no resurrecting APPROVED/WITHDRAWN)", async () => {
  const { advanceApplication } = await import("@/lib/services/financing/credit-application.service");
  state.apps.set("app_1", { id: "app_1", status: "APPROVED", dealId: "deal_1", buyerId: "b1" });
  await assert.rejects(() => advanceApplication("app_1", "DECLINED" as never, { force: true }), /transition/i);
  assert.equal(state.updateManyCalls.length, 0, "a terminal is never written out of, even under force");
});

test("advanceApplication throws a concurrency error when the CAS matches 0 rows (lost race)", async () => {
  const { advanceApplication } = await import("@/lib/services/financing/credit-application.service");
  state.apps.set("app_1", { id: "app_1", status: "DRAFT", dealId: "deal_1", buyerId: "b1" });
  state.updateManyResult = 0; // someone else already moved it
  await assert.rejects(() => advanceApplication("app_1", "SUBMITTED" as never, {}), /concurren|conflict/i);
});
