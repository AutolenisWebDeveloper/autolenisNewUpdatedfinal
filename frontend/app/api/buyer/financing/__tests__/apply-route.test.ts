// Route contract for POST /api/buyer/financing/apply — auth, PII-encryption gate,
// deal ownership + FINANCING_PENDING gate, and that PII is handed to the (encrypting)
// service and never returned to the client.
//
// Run: pnpm test:financing-routes

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

const state = {
  buyer: { id: "buyer_1" } as { id: string } | null,
  deal: { id: "deal_1", status: "FINANCING_PENDING" } as Record<string, unknown> | null,
  encConfigured: true,
  prequal: { decision: "APPROVED", expiresAt: new Date(Date.now() + 86400000), maxOtdAmountCents: 3_000_000 } as Record<string, unknown> | null,
  prequalValid: true,
  created: [] as Array<Record<string, unknown>>,
  submitted: [] as string[],
};

mock.module("@/lib/auth/api", {
  namedExports: {
    getRequestBuyer: async () => state.buyer,
    successResponse: (data: unknown, status = 200) => ({ __ok: true, status, data }),
    errorResponse: (code: string, message: string, status = 400) => ({ __ok: false, status, code, message }),
  },
});
mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      deal: { findFirst: async () => state.deal },
      preQualification: { findUnique: async () => state.prequal },
    },
  },
});
mock.module("@/lib/security/field-encryption", {
  namedExports: { isFinancingEncryptionConfigured: () => state.encConfigured },
});
mock.module("@/lib/services/prequal/prequal.service", {
  namedExports: { isPrequalValid: () => state.prequalValid },
});
mock.module("@/lib/services/financing/credit-application.service", {
  namedExports: {
    createCreditApplication: async (input: Record<string, unknown>) => { state.created.push(input); return { id: "app_1" }; },
    submitApplication: async (id: string) => { state.submitted.push(id); },
  },
});

function req(body: unknown) {
  return new NextRequest("http://localhost/api/buyer/financing/apply", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}
const VALID = { dealId: "11111111-1111-1111-1111-111111111111", amountRequestedCents: 2_500_000, termMonths: 60, ssn: "123-45-6789", annualIncomeCents: 9_000_000, employment: "Acme" };

beforeEach(() => {
  state.buyer = { id: "buyer_1" };
  state.deal = { id: "deal_1", status: "FINANCING_PENDING" };
  state.encConfigured = true;
  state.prequal = { decision: "APPROVED", expiresAt: new Date(Date.now() + 86400000), maxOtdAmountCents: 3_000_000 };
  state.prequalValid = true;
  state.created = [];
  state.submitted = [];
});

async function POST(body: unknown) {
  const mod = await import("@/app/api/buyer/financing/apply/route");
  return (await mod.POST(req(body))) as unknown as { __ok: boolean; status: number; code?: string; data?: Record<string, unknown> };
}

test("401 when not authenticated", async () => {
  state.buyer = null;
  const res = await POST(VALID);
  assert.equal(res.status, 401);
});

test("503 fail-closed when the PII encryption key is not configured", async () => {
  state.encConfigured = false;
  const res = await POST(VALID);
  assert.equal(res.status, 503);
  assert.equal(res.code, "NOT_CONFIGURED");
  assert.equal(state.created.length, 0, "no application is created without encryption");
});

test("400 on invalid input (bad SSN)", async () => {
  const res = await POST({ ...VALID, ssn: "not-an-ssn" });
  assert.equal(res.status, 400);
});

test("404 when the deal is not the buyer's", async () => {
  state.deal = null;
  const res = await POST(VALID);
  assert.equal(res.status, 404);
});

test("400 when the deal is not in FINANCING_PENDING", async () => {
  state.deal = { id: "deal_1", status: "FEE_PAID" };
  const res = await POST(VALID);
  assert.equal(res.status, 400);
  assert.equal(res.code, "INVALID_STATE");
});

test("400 PREQUAL_REQUIRED when there is no current pre-qualification", async () => {
  state.prequalValid = false;
  const res = await POST(VALID);
  assert.equal(res.status, 400);
  assert.equal(res.code, "PREQUAL_REQUIRED");
  assert.equal(state.created.length, 0, "no application without a valid prequal");
});

test("400 BUDGET_EXCEEDED when the requested amount is over the approved budget", async () => {
  state.prequal = { decision: "APPROVED", expiresAt: new Date(Date.now() + 86400000), maxOtdAmountCents: 2_000_000 };
  const res = await POST({ ...VALID, amountRequestedCents: 2_500_000 });
  assert.equal(res.status, 400);
  assert.equal(res.code, "BUDGET_EXCEEDED");
  assert.equal(state.created.length, 0, "no application when over budget");
});

test("happy path creates + submits, hands PII to the service, returns no PII", async () => {
  const res = await POST(VALID);
  assert.equal(res.status, 200);
  assert.equal(res.data!.applicationId, "app_1");
  assert.equal(res.data!.status, "SUBMITTED");
  assert.equal(state.created.length, 1);
  assert.equal((state.created[0] as Record<string, unknown>).ssn, "123-45-6789", "PII passed to the encrypting service");
  assert.equal(state.submitted[0], "app_1");
  // The response must not echo the SSN/income back.
  assert.equal(JSON.stringify(res.data).includes("123-45-6789"), false);
});
