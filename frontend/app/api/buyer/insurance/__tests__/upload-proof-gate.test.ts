// Route contract tests for POST /api/buyer/insurance/upload-proof — the WIRING
// between capturing insurance proof and releasing the deal's insurance gate.
//
// This is the only buyer-facing path that reaches an INSURANCE_SATISFIED state, and
// it previously wrote insuranceStatus with a raw prisma.deal.update and never
// advanced the deal — so every self-service deal stalled at INSURANCE_PENDING.
// These tests pin the wiring itself (the gap that let that ship): the proof is
// persisted BEFORE the status flip, and the gate driver is actually invoked.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "app/api/buyer/insurance/__tests__/upload-proof-gate.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest, NextResponse } from "next/server";

let dealRow: { id: string; insuranceStatus: string } | null = null;
let policyCreates: Array<Record<string, unknown>> = [];
let policyCreateThrows = false;
let dealUpdates: Array<Record<string, unknown>> = [];
let gateCalls: Array<{ dealId: string }> = [];
let uploadError: unknown = null;
const order: string[] = [];

mock.module("@/lib/auth/api", {
  namedExports: {
    getRequestBuyer: async () => ({ id: "buyer_1" }),
    successResponse: (data: unknown, status = 200) => NextResponse.json({ success: true, data }, { status }),
    errorResponse: (code: string, message: string, status = 400) =>
      NextResponse.json({ error: { code, message } }, { status }),
  },
});

mock.module("@/lib/logger", { namedExports: { logger: { error: () => {}, warn: () => {}, info: () => {} } } });

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      deal: {
        findFirst: async () => (dealRow ? { ...dealRow } : null),
        update: async (a: { data: Record<string, unknown> }) => {
          order.push("deal.update");
          dealUpdates.push(a.data);
          return {};
        },
      },
      insurancePolicy: {
        create: async (a: { data: Record<string, unknown> }) => {
          order.push("policy.create");
          if (policyCreateThrows) throw new Error("db down");
          policyCreates.push(a.data);
          return a.data;
        },
      },
      notification: { create: async () => ({}) },
    },
  },
});

mock.module("@/lib/supabase", {
  namedExports: {
    createServiceSupabaseClient: () => ({
      storage: { from: () => ({ upload: async () => ({ error: uploadError }) }) },
    }),
  },
});

mock.module("@/lib/services/deal/deal.service", {
  namedExports: {
    advanceOnInsuranceSatisfied: async (dealId: string) => {
      order.push("gate.advance");
      gateCalls.push({ dealId });
      return true;
    },
  },
});

function upload() {
  const form = new FormData();
  form.append("file", new File([new Uint8Array([1, 2, 3])], "proof.pdf", { type: "application/pdf" }));
  form.append("dealId", "deal_1");
  return new NextRequest("http://localhost/api/buyer/insurance/upload-proof", { method: "POST", body: form });
}

async function post() {
  const { POST } = await import("@/app/api/buyer/insurance/upload-proof/route");
  return POST(upload());
}

beforeEach(() => {
  dealRow = { id: "deal_1", insuranceStatus: "NOT_STARTED" };
  policyCreates = [];
  policyCreateThrows = false;
  dealUpdates = [];
  gateCalls = [];
  uploadError = null;
  order.length = 0;
});

test("a successful upload releases the insurance gate (the wiring that was missing)", async () => {
  const res = await post();
  assert.equal(res.status, 201);
  assert.deepEqual(gateCalls, [{ dealId: "deal_1" }], "the gate driver must be invoked after the status flip");
  assert.equal(dealUpdates[0]?.insuranceStatus, "EXTERNAL_UPLOADED");
});

test("the proof is PERSISTED before the gate-releasing status flip", async () => {
  await post();
  assert.equal(policyCreates.length, 1, "the uploaded proof must be recorded, not just the status flag");
  assert.equal(policyCreates[0]?.dealId, "deal_1");
  assert.equal(policyCreates[0]?.isExternal, true);
  assert.ok(policyCreates[0]?.proofUrl, "the storage path must be retrievable afterwards");
  assert.deepEqual(
    order,
    ["policy.create", "deal.update", "gate.advance"],
    "record proof → flip status → release gate; never release a gate on unretrievable evidence",
  );
});

test("if the proof cannot be recorded, the gate is NOT released", async () => {
  policyCreateThrows = true;
  const res = await post();
  assert.equal(res.status, 500);
  assert.equal(dealUpdates.length, 0, "insuranceStatus must not flip when the proof was not recorded");
  assert.equal(gateCalls.length, 0, "and the deal must not advance");
});

test("a deal the buyer does not own is rejected before anything is written", async () => {
  dealRow = null;
  const res = await post();
  assert.equal(res.status, 404);
  assert.equal(policyCreates.length, 0);
  assert.equal(dealUpdates.length, 0);
  assert.equal(gateCalls.length, 0);
});

test("a storage failure writes nothing and does not release the gate", async () => {
  uploadError = { message: "bucket unavailable" };
  const res = await post();
  assert.equal(res.status, 500);
  assert.equal(policyCreates.length, 0);
  assert.equal(dealUpdates.length, 0);
  assert.equal(gateCalls.length, 0);
});
