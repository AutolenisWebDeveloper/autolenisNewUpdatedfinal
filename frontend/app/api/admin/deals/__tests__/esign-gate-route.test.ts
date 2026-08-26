// Route contract tests for POST /api/admin/deals/[dealId]/esign — the admin
// "send signing envelope" endpoint.
//
// Lives here (not co-located under the [dealId] segment) because node:test
// treats "[" as a glob metacharacter, so a path containing the [dealId] segment
// cannot be passed to the runner. The route is imported via the @/ alias, which
// tsx resolves from tsconfig paths without shell globbing.
//
// Regression target (Wave 2B): this route was admin-authenticated but created a
// signing envelope WITHOUT verifying the deal passed Contract Shield review.
// An admin could send an envelope before legal review — a compliance-gate
// bypass. These tests pin the gate: an envelope is only prepared when the deal is
// CONTRACT_APPROVED (or already SIGNING_PENDING, the re-send case), in parity
// with the buyer path (app/api/buyer/esign/[dealId]/route.ts). Any earlier state
// must short-circuit with 409 and never reach envelope preparation.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "app/api/admin/deals/__tests__/esign-gate-route.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest, NextResponse } from "next/server";

// ── Controllable deal state + prepare-envelope spy ───────────────────────────
let dealStatus: string | null = "CONTRACT_APPROVED";
let createEnvelopeCalls = 0;

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      deal: {
        findUnique: async () =>
          dealStatus === null
            ? null
            : {
                id: "deal_1",
                status: dealStatus,
                buyer: { firstName: "Sam", lastName: "Buyer", user: { email: "buyer@example.com" } },
                offer: { dealer: { dealershipName: "Acme Motors", user: { email: "dealer@example.com" } } },
              },
      },
    },
  },
});

mock.module("@/lib/services/esign/buyer-signing.service", {
  namedExports: {
    // In-house signing envelope preparation (replaces DocuSign createEnvelope).
    prepareBuyerSigningEnvelope: async () => {
      createEnvelopeCalls += 1;
      return { envelopeId: "env_1", documentVersionId: "cv_1", documentHash: "hash", status: "SENT" };
    },
    NoSignableDocumentError: class NoSignableDocumentError extends Error {},
  },
});

// Notification email is a non-blocking tail call — stub it out.
mock.module("@/lib/services/email/resend.service", {
  namedExports: { sendDealerEsignInitiatedEmail: async () => undefined },
});

// Authenticated admin, real envelope shapes so we exercise the actual contract.
mock.module("@/lib/auth/admin-api", {
  namedExports: {
    getAdminFromRequest: async () => ({
      adminId: "admin_1",
      email: "ops@autolenis.com",
      role: "SUPER_ADMIN",
      mfaVerified: true,
    }),
    adminSuccess: (data: unknown, status = 200) =>
      NextResponse.json({ success: true, data }, { status }),
    adminError: (code: string, message: string, status = 400) =>
      NextResponse.json({ error: { code, message }, correlationId: "test-corr-id" }, { status }),
  },
});

async function loadPOST() {
  const mod = await import("@/app/api/admin/deals/[dealId]/esign/route");
  return mod.POST;
}

function req() {
  return new NextRequest("http://localhost/api/admin/deals/deal_1/esign", { method: "POST" });
}

beforeEach(() => {
  dealStatus = "CONTRACT_APPROVED";
  createEnvelopeCalls = 0;
});

test("pre-approval deal → 409 and createEnvelope is NEVER reached", async () => {
  dealStatus = "CONTRACT_REVIEW"; // not yet through Contract Shield

  const POST = await loadPOST();
  const res = await POST(req(), { params: Promise.resolve({ dealId: "deal_1" }) });

  assert.equal(res.status, 409);
  const body = JSON.parse((await res.text()).trim());
  assert.equal(body.error.code, "CONTRACT_NOT_APPROVED");
  assert.equal(createEnvelopeCalls, 0, "envelope must NOT be created before Contract Shield approval");
});

test("CONTRACT_APPROVED deal → envelope is created (no regression)", async () => {
  dealStatus = "CONTRACT_APPROVED";

  const POST = await loadPOST();
  const res = await POST(req(), { params: Promise.resolve({ dealId: "deal_1" }) });

  assert.equal(res.status, 200);
  assert.equal(createEnvelopeCalls, 1, "approved deal must still create the envelope");
});

test("SIGNING_PENDING deal → envelope re-send allowed (parity with buyer path)", async () => {
  dealStatus = "SIGNING_PENDING";

  const POST = await loadPOST();
  const res = await POST(req(), { params: Promise.resolve({ dealId: "deal_1" }) });

  assert.equal(res.status, 200);
  assert.equal(createEnvelopeCalls, 1);
});

test("missing deal → 404 before the gate, createEnvelope not reached", async () => {
  dealStatus = null; // findUnique miss

  const POST = await loadPOST();
  const res = await POST(req(), { params: Promise.resolve({ dealId: "missing" }) });

  assert.equal(res.status, 404);
  const body = JSON.parse((await res.text()).trim());
  assert.equal(body.error.code, "NOT_FOUND");
  assert.equal(createEnvelopeCalls, 0);
});
