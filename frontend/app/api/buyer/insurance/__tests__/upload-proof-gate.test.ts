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
let existingPolicy: { id: string } | null = null; // a prior external proof, for the re-upload path
let dealUpdates: Array<Record<string, unknown>> = [];
let policyUpdates: Array<{ where?: unknown; data: Record<string, unknown> }> = [];
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

// The route writes the proof and flips the gate inside ONE prisma.$transaction,
// so the mock must model both the transaction client and every method called on
// it — findFirst (is there a prior external proof?), update (supersede it) or
// create (first proof), then deal.update. A mock missing $transaction fails with
// "prisma.$transaction is not a function" before any assertion runs.
const prismaMock = {
  deal: {
    findFirst: async () => (dealRow ? { ...dealRow } : null),
    update: async (a: { data: Record<string, unknown> }) => {
      order.push("deal.update");
      dealUpdates.push(a.data);
      return {};
    },
  },
  insurancePolicy: {
    // No prior external proof by default, so the create branch is exercised;
    // set existingPolicy to reach the supersede-in-place branch instead.
    findFirst: async () => existingPolicy,
    update: async (a: { data: Record<string, unknown> }) => {
      order.push("policy.update");
      policyUpdates.push(a);
      return a.data;
    },
    create: async (a: { data: Record<string, unknown> }) => {
      order.push("policy.create");
      if (policyCreateThrows) throw new Error("db down");
      policyCreates.push(a.data);
      return a.data;
    },
  },
  notification: { create: async () => ({}) },
};

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      ...prismaMock,
      // Run the callback against the same mock. This models PROPAGATION — a
      // throw inside the callback escapes $transaction, which is what "if the
      // proof cannot be recorded, the gate is NOT released" turns on. It does
      // NOT model rollback; no test here depends on rollback, because the only
      // throwing write is the first one, so there is nothing to roll back.
      $transaction: async (fn: (tx: typeof prismaMock) => Promise<unknown>) => fn(prismaMock),
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
  policyUpdates = [];
  policyCreateThrows = false;
  existingPolicy = null;
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

test("a re-upload SUPERSEDES the existing proof in place instead of creating a second one", async () => {
  // Two external proofs for one deal would leave a reviewer guessing which is
  // current. The route's findFirst/update branch prevents that, and had no
  // coverage — the create branch was the only one any test reached.
  existingPolicy = { id: "policy_1" };
  const res = await post();
  assert.equal(res.status, 201);
  assert.equal(policyCreates.length, 0, "must not create a second proof row");
  assert.equal(policyUpdates.length, 1, "must update the existing proof in place");
  assert.deepEqual(policyUpdates[0]?.where, { id: "policy_1" });
  assert.equal(policyUpdates[0]?.data.status, "ACTIVE");
  assert.equal(
    policyUpdates[0]?.data.verifiedAt,
    null,
    "a superseded proof is unverified again — a stale verification must not carry over",
  );
  assert.deepEqual(order, ["policy.update", "deal.update", "gate.advance"]);
});

test("a failed proof write returns a structured 500, not an unhandled throw", async () => {
  // The write is inside prisma.$transaction; without the route's try/catch the
  // error escapes POST entirely, so the buyer gets an unstructured framework 500
  // with no error envelope and nothing names the deal in the logs.
  policyCreateThrows = true;
  const res = await post();
  assert.equal(res.status, 500);
  const body = (await res.json()) as { error?: { code?: string; message?: string } };
  assert.equal(body.error?.code, "INTERNAL_ERROR");
  assert.match(body.error?.message ?? "", /proof of insurance/i);
});
