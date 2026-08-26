// Route contract tests for the in-house buyer signing endpoints — authorization
// (IDOR), the CONTRACT_APPROVED gate, and the affirmative-consent requirement.
// Placed here (not under the [dealId] segment) because node:test treats "[" as a
// glob metacharacter; routes are imported via the @/ alias.
//
// Run: npx tsx --test --experimental-test-module-mocks \
//   "app/api/buyer/esign/__tests__/buyer-esign-routes.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

let buyer: { id: string } | null = { id: "b1" };
let dealRow: { id: string; status: string; buyer?: unknown } | null = null;
let signCalls: Array<Record<string, unknown>> = [];

mock.module("@/lib/auth/api", {
  namedExports: {
    getRequestBuyer: async () => buyer,
    // Match the real helper shapes closely enough for assertions.
    successResponse: (data: unknown, status = 200) => Response.json({ success: true, data }, { status }),
    errorResponse: (code: string, message: string, status = 400) => Response.json({ error: { code, message } }, { status }),
  },
});

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      // Ownership is enforced by findFirst({ where: { id, buyerId } }) — a deal the
      // buyer doesn't own returns null → 404.
      deal: {
        findFirst: async ({ where }: { where: { id: string; buyerId: string } }) =>
          dealRow && where.buyerId === "b1" ? { ...dealRow, buyer: { firstName: "Sam", lastName: "Buyer", phone: null, user: { email: "sam@example.com" } } } : null,
      },
      contractVersion: { findUnique: async () => ({ id: "cv_1", documentUrl: "p/c.pdf" }) },
      eSignEnvelope: { findUnique: async () => null, update: async () => ({}) },
    },
  },
});

mock.module("@/lib/services/esign/buyer-signing.service", {
  namedExports: {
    recordBuyerSignature: async (params: Record<string, unknown>) => { signCalls.push(params); return { status: "COMPLETED", envelopeId: "env_1", alreadySigned: false }; },
    finalizeSignedContract: async () => ({ artifactReady: true, certificateReady: true, confirmationsSent: true }),
    prepareBuyerSigningEnvelope: async () => ({ envelopeId: "env_1", documentVersionId: "cv_1", documentHash: "h", status: "SENT" }),
    getContractViewUrl: async () => "https://signed/view",
    ensureDealSigned: async () => {},
    expireIfElapsed: async () => false,
    NoSignableDocumentError: class extends Error {},
    ConsentRequiredError: class extends Error {},
    DocumentChangedError: class extends Error {},
    EnvelopeNotSignableError: class extends Error {},
  },
});

mock.module("@/lib/services/deal/deal.service", {
  namedExports: { advanceDealStatus: async () => {}, DealTransitionError: class extends Error {} },
});
mock.module("@/lib/security/request-attribution", { namedExports: { getRequestAttribution: () => ({ ipAddress: "1.2.3.4", userAgent: "UA" }) } });
mock.module("@/lib/logger", { namedExports: { logger: { error: () => {}, warn: () => {}, info: () => {} } } });

function req(body?: unknown) {
  return new NextRequest("http://localhost/api/buyer/esign/d1", {
    method: "POST",
    ...(body !== undefined ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } } : {}),
  });
}
const params = { params: Promise.resolve({ dealId: "d1" }) };

// The four required acknowledgments, all affirmatively accepted.
const ALL_ACKS = [
  "ELECTRONIC_RECORDS_AND_SIGNATURE",
  "CONTRACT_REVIEW_AND_INDEPENDENT_ADVICE",
  "ACCEPTANCE_AND_INTENT_TO_BE_BOUND",
  "ELECTRONIC_COPY_AND_ACCESS",
].map((key) => ({ key, accepted: true }));

beforeEach(() => { buyer = { id: "b1" }; dealRow = { id: "d1", status: "CONTRACT_APPROVED" }; signCalls = []; });

test("GET requires authentication (401)", async () => {
  buyer = null;
  const { GET } = await import("@/app/api/buyer/esign/[dealId]/route");
  const res = await GET(new NextRequest("http://localhost/api/buyer/esign/d1"), params);
  assert.equal(res.status, 401);
});

test("GET on a deal the buyer does not own → 404 (IDOR blocked)", async () => {
  buyer = { id: "someone-else" };
  const { GET } = await import("@/app/api/buyer/esign/[dealId]/route");
  const res = await GET(new NextRequest("http://localhost/api/buyer/esign/d1"), params);
  assert.equal(res.status, 404);
});

test("POST begin requires CONTRACT_APPROVED (409 before approval)", async () => {
  dealRow = { id: "d1", status: "INSURANCE_PENDING" };
  const { POST } = await import("@/app/api/buyer/esign/[dealId]/route");
  const res = await POST(req(), params);
  assert.equal(res.status, 409);
});

test("sign requires authentication (401)", async () => {
  buyer = null;
  const { POST } = await import("@/app/api/buyer/esign/[dealId]/sign/route");
  const res = await POST(req({ acknowledgments: ALL_ACKS, signatureText: "Sam Buyer" }), params);
  assert.equal(res.status, 401);
});

test("sign with an invalid acknowledgment key is rejected (400) and records no signature", async () => {
  const { POST } = await import("@/app/api/buyer/esign/[dealId]/sign/route");
  const res = await POST(req({ acknowledgments: [{ key: "BOGUS", accepted: true }], signatureText: "Sam Buyer" }), params);
  assert.equal(res.status, 400);
  assert.equal(signCalls.length, 0, "no signature recorded on an invalid consent payload");
});

test("sign with no acknowledgments is rejected (400)", async () => {
  const { POST } = await import("@/app/api/buyer/esign/[dealId]/sign/route");
  const res = await POST(req({ acknowledgments: [], signatureText: "Sam Buyer" }), params);
  assert.equal(res.status, 400);
  assert.equal(signCalls.length, 0);
});

test("sign without a typed name is rejected (400)", async () => {
  const { POST } = await import("@/app/api/buyer/esign/[dealId]/sign/route");
  const res = await POST(req({ acknowledgments: ALL_ACKS, signatureText: "" }), params);
  assert.equal(res.status, 400);
  assert.equal(signCalls.length, 0);
});

test("sign on a deal the buyer does not own → 404 (IDOR blocked, no signature)", async () => {
  buyer = { id: "someone-else" };
  const { POST } = await import("@/app/api/buyer/esign/[dealId]/sign/route");
  const res = await POST(req({ acknowledgments: ALL_ACKS, signatureText: "Sam Buyer" }), params);
  assert.equal(res.status, 404);
  assert.equal(signCalls.length, 0);
});

test("valid consented signature is recorded server-side (200) with server attribution + all acknowledgments", async () => {
  const { POST } = await import("@/app/api/buyer/esign/[dealId]/sign/route");
  const res = await POST(req({ acknowledgments: ALL_ACKS, signatureText: "Sam Buyer" }), params);
  assert.equal(res.status, 200);
  assert.equal(signCalls.length, 1);
  assert.equal(signCalls[0]?.signerUserId, "b1", "signer identity from session, not the body");
  assert.equal(signCalls[0]?.ipAddress, "1.2.3.4", "IP from server attribution");
  assert.equal(signCalls[0]?.userAgent, "UA");
  assert.equal((signCalls[0]?.acknowledgments as unknown[])?.length, 4, "all four acknowledgments forwarded");
});
