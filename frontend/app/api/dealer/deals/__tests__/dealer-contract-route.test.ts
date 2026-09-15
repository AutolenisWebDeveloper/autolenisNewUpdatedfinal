// §6 dealer executed-contract copy route — role-scoped access + IDOR.
// The dealer receives a COPY of the buyer-signed contract; a dealer can only reach
// a deal that belongs to their own accepted offer (offer.dealerId). A mismatched
// dealer gets 404, never another dealer's document.
//
// Run: npx tsx --test --experimental-test-module-mocks \
//   "app/api/dealer/deals/__tests__/dealer-contract-route.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

// Executed copies only exist once migrations 20261014 + 20261015 are applied, so
// the happy paths below run with the schema gate open. The final test closes it.
process.env.ESIGN_EXECUTED_ARTIFACT_ENABLED = "true";

let dealer: { id: string } | null = { id: "dealer_1" };
// §13-D30: a deal carries one envelope per required signer, so the route selects a LIST and
// the co-buyer flag that says who is required. These fixtures are buyer-only deals.
let dealRow: {
  id: string;
  eSignEnvelopes: { id: string; status: string; signerKind: string; executedDocumentKey: string | null }[];
  coBuyer: { isRequiredSigner: boolean } | null;
} | null = null;
let signedUrlCalls = 0;

mock.module("@/lib/auth/dealer-api", {
  namedExports: {
    getRequestDealer: async () => dealer,
    successResponse: (data: unknown, status = 200) => Response.json({ success: true, data }, { status }),
    errorResponse: (code: string, message: string, status = 400) => Response.json({ error: { code, message } }, { status }),
  },
});

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      deal: {
        // Ownership: findFirst({ where: { id, offer: { dealerId } } }) — a deal that
        // isn't THIS dealer's accepted offer returns null → 404 (IDOR-safe).
        findFirst: async ({ where }: { where: { id: string; offer: { dealerId: string } } }) =>
          dealRow && where.offer.dealerId === "dealer_1" ? dealRow : null,
        // §25.1 + §13-D30. `allRequiredSignaturesComplete` resolves the required signers
        // through its OWN server-side read rather than the route selecting the co-buyer
        // relation onto a dealer-facing projection — the identity-firewall guard flags any
        // dealer surface that reads a protected relation, and it flagged the first version
        // of that line. This mock stands in for that internal read.
        findUnique: async () => ({
          buyer: { firstName: "Sam", lastName: "Buyer", user: { email: "sam@example.com" } },
          coBuyer: null,
        }),
      },
      // The executed-artifact key is read in a second, gate-guarded query so the
      // column is never named while migrations 20261014/20261015 are unapplied.
      eSignEnvelope: {
        findUnique: async () => ({ executedDocumentKey: dealRow?.eSignEnvelopes?.[0]?.executedDocumentKey ?? null }),
        findMany: async () => (dealRow?.eSignEnvelopes ?? []).map((e) => ({ signerKind: e.signerKind, status: e.status })),
      },
    },
  },
});

mock.module("@/lib/services/esign/executed-contract.service", {
  namedExports: {
    getExecutedContractUrl: async () => { signedUrlCalls += 1; return "https://signed/executed"; },
  },
});

const params = { params: Promise.resolve({ dealId: "d1" }) };
const request = () => new NextRequest("http://localhost/api/dealer/deals/d1/contract");

beforeEach(() => {
  dealer = { id: "dealer_1" };
  dealRow = { id: "d1", coBuyer: null, eSignEnvelopes: [{ id: "env_1", status: "COMPLETED", signerKind: "BUYER", executedDocumentKey: "executed/d1/env_1.pdf" }] };
  signedUrlCalls = 0;
  process.env.ESIGN_EXECUTED_ARTIFACT_ENABLED = "true";
});

test("requires authentication (401)", async () => {
  dealer = null;
  const { GET } = await import("@/app/api/dealer/deals/[dealId]/contract/route");
  const res = await GET(request(), params);
  assert.equal(res.status, 401);
});

test("authorized dealer with an executed contract → redirect to a signed URL", async () => {
  const { GET } = await import("@/app/api/dealer/deals/[dealId]/contract/route");
  const res = await GET(request(), params);
  assert.equal(res.status, 307, "redirect to the signed download URL");
  assert.equal(res.headers.get("location"), "https://signed/executed");
  assert.equal(signedUrlCalls, 1);
});

test("a DIFFERENT dealer cannot retrieve the contract → 404 (IDOR blocked, no signed URL)", async () => {
  dealer = { id: "dealer_2" };
  const { GET } = await import("@/app/api/dealer/deals/[dealId]/contract/route");
  const res = await GET(request(), params);
  assert.equal(res.status, 404);
  assert.equal(signedUrlCalls, 0, "never mint a signed URL for a non-owner");
});

test("before the buyer signs (no executed artifact) → 404 not-available", async () => {
  dealRow = { id: "d1", coBuyer: null, eSignEnvelopes: [{ id: "env_1", status: "SENT", signerKind: "BUYER", executedDocumentKey: null }] };
  const { GET } = await import("@/app/api/dealer/deals/[dealId]/contract/route");
  const res = await GET(request(), params);
  assert.equal(res.status, 404);
  assert.equal(signedUrlCalls, 0);
});
