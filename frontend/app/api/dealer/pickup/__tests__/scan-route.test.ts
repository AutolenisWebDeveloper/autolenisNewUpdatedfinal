// Route contract tests for POST /api/dealer/pickup/scan — the dealer scan that completes a deal.
//
// REWRITTEN 2026-09-16, because the thing being scanned changed. The route used to resolve the
// scanned string by equality against `pickups.qr_code_data`: a `Math.random()` payload stored in
// plaintext, with no consumed_at, expiring off a second column (`qr_expires_at`) that nothing
// re-checked against the pickup's own state. It now resolves through the release-token service —
// SHA-256 lookup, expiry bound to the appointment, single use enforced by a compare-and-swap.
//
// WHAT THIS FILE STILL PINS FROM BEFORE: the authorization boundary, and the CONCIERGE case — a
// vehicle-request deal has offerId = null and VehicleRequestOffer carries NO dealer identity, so
// `deal.offer?.dealerId` is undefined and the strict `!== dealer.id` comparison always rejects.
// Correctly (there is no dealer to authorize), and INDISTINGUISHABLY from a wrong-dealer token,
// so the endpoint cannot be used to ask which deals have dealerships.
//
// WHAT IS NEW: the consume is a separate, LATER step than the resolve, and the ordering is
// load-bearing in both directions — a look must not spend the code, and a rejected release must
// not spend it either. Both are asserted.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "app/api/dealer/pickup/__tests__/scan-route.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest, NextResponse } from "next/server";

class InsuranceRequiredError extends Error {
  code = "INSURANCE_REQUIRED";
  constructor() { super("Insurance proof is required"); this.name = "InsuranceRequiredError"; }
}
class ReleaseNotClearedError extends Error {
  constructor(public readonly detail: string) {
    super(`This deal is not cleared for release: ${detail}.`);
    this.name = "ReleaseNotClearedError";
  }
}
class DealTransitionError extends Error {
  code = "INVALID_TRANSITION";
  constructor() { super("Invalid transition"); this.name = "DealTransitionError"; }
}

type Reason = "not_found" | "consumed" | "revoked" | "expired" | "pickup_not_releasable";

interface PickupRow {
  id: string;
  dealId: string;
  status: string;
  deal: {
    status: string;
    buyerId: string;
    insuranceStatus: string;
    offer: { dealerId: string } | null;
    buyer: { firstName: string; user: { email: string } };
  };
}

let authedDealer: { id: string } | null = { id: "dealer_1" };
let pickupRow: PickupRow | null = null;
let resolveReason: Reason | null = null;
let consumeSucceeds = true;
let advanceCalls: Array<{ dealId: string; to: string }> = [];
let advanceThrows: Error | null = null;
let txCalls = 0;
let consumeCalls: string[] = [];
let pickupWheres: Array<Record<string, unknown>> = [];

mock.module("@/lib/auth/dealer-api", {
  namedExports: {
    getRequestDealer: async () => authedDealer,
    successResponse: (data: unknown, status = 200) => NextResponse.json({ success: true, data }, { status }),
    errorResponse: (code: string, message: string, status = 400) =>
      NextResponse.json({ error: { code, message } }, { status }),
  },
});

mock.module("@/lib/logger", {
  namedExports: { logger: { error: () => {}, warn: () => {}, info: () => {} } },
});

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      pickup: {
        findUnique: async ({ where }: { where: Record<string, unknown> }) => {
          pickupWheres.push(where);
          return pickupRow ? { ...pickupRow } : null;
        },
        update: async () => ({}),
      },
      buyerActivityEvent: { create: async () => ({}) },
      $transaction: async (ops: unknown[]) => { txCalls += 1; return ops; },
    },
  },
});

mock.module("@/lib/services/pickup/release-token.service", {
  namedExports: {
    resolveReleaseToken: async () =>
      resolveReason
        ? { ok: false, reason: resolveReason }
        : {
            ok: true,
            view: {
              pickupId: "pickup_1",
              dealId: "deal_1",
              status: "SCHEDULED",
              scheduledAt: new Date("2026-09-22T15:00:00.000Z"),
              expiresAt: new Date("2026-09-23T03:00:00.000Z"),
            },
          },
    consumeReleaseToken: async (pickupId: string) => { consumeCalls.push(pickupId); return consumeSucceeds; },
  },
});

mock.module("@/lib/services/deal/deal.service", {
  namedExports: {
    // MUST MATCH lib/services/deal/deal.service.ts. This list read
    // ["VERIFIED", "POLICY_BOUND", "EXTERNAL_UPLOADED"] until 2026-09-15 — a stale COPY of a
    // constant §13-D31 had already narrowed. EXTERNAL_UPLOADED now means "Operations owes a
    // decision" (INSURANCE_AWAITING_REVIEW), not "released". A mock that grants the gate the
    // real code refuses is a test asserting against a world that does not exist.
    INSURANCE_SATISFIED: ["VERIFIED", "POLICY_BOUND"],
    advanceDealStatus: async (dealId: string, to: string) => {
      if (advanceThrows) throw advanceThrows;
      advanceCalls.push({ dealId, to });
    },
    DealTransitionError,
    InsuranceRequiredError,
    ReleaseNotClearedError,
  },
});

const req = (qrToken?: string) =>
  new NextRequest("http://localhost/api/dealer/pickup/scan", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(qrToken === undefined ? {} : { qrToken }),
  });

function dealerPickup(): PickupRow {
  return {
    id: "pickup_1",
    dealId: "deal_1",
    status: "SCHEDULED",
    deal: {
      status: "PICKUP_SCHEDULED",
      buyerId: "b1",
      insuranceStatus: "VERIFIED",
      offer: { dealerId: "dealer_1" },
      buyer: { firstName: "Sam", user: { email: "sam@example.com" } },
    },
  };
}

/** A concierge deal: no Offer at all, therefore no dealer identity anywhere. */
function conciergePickup(): PickupRow {
  const p = dealerPickup();
  p.deal.offer = null;
  return p;
}

beforeEach(() => {
  authedDealer = { id: "dealer_1" };
  pickupRow = dealerPickup();
  resolveReason = null;
  consumeSucceeds = true;
  advanceCalls = [];
  advanceThrows = null;
  txCalls = 0;
  consumeCalls = [];
  pickupWheres = [];
});

async function scan(token = "a".repeat(64)) {
  const { POST } = await import("@/app/api/dealer/pickup/scan/route");
  return POST(req(token));
}

test("requires authentication (401)", async () => {
  authedDealer = null;
  const res = await scan();
  assert.equal(res.status, 401);
  assert.equal(advanceCalls.length, 0);
});

test("the owning dealer completes the deal on a valid scan, and the code is SPENT", async () => {
  const res = await scan();
  assert.equal(res.status, 200);
  assert.deepEqual(advanceCalls, [{ dealId: "deal_1", to: "COMPLETED" }]);
  assert.deepEqual(consumeCalls, ["pickup_1"], "a completed handover must burn the code");
});

test("the scanned string is NEVER used as a database predicate", async () => {
  // The structural half of the change. `where: { qrCodeData: qrToken }` is what made the column
  // a credential; the pickup is now located by the id the token RESOLVED to. Pinning the WHERE
  // means reintroducing the plaintext lookup fails here rather than in review.
  await scan("a".repeat(64));
  assert.deepEqual(pickupWheres, [{ id: "pickup_1" }]);
  for (const w of pickupWheres) {
    assert.equal("qrCodeData" in w, false);
    assert.equal("qrCodeImage" in w, false);
  }
});

test("another dealer's code is rejected and completes nothing (IDOR blocked)", async () => {
  authedDealer = { id: "dealer_2" };
  const res = await scan();
  assert.equal(res.status, 422);
  const body = await res.json();
  assert.equal(body.error.code, "INVALID_TOKEN");
  assert.equal(advanceCalls.length, 0);
  assert.deepEqual(consumeCalls, [], "a rejected scan must not spend someone else's code");
});

test("CONCIERGE deal (no dealer on the deal) can never be completed by a dealer scan", async () => {
  pickupRow = conciergePickup();
  const res = await scan();
  assert.equal(advanceCalls.length, 0, "a dealer must never complete a deal that has no dealer");
  assert.equal(txCalls, 0, "and must never mark the pickup row complete");
  assert.equal(res.status, 422);
  const body = await res.json();
  // Deliberately the SAME response as a wrong-dealer token. The original reason (a guessable
  // Math.random nonce) no longer holds, but the conclusion does on its own footing: possession
  // of a code proves possession of a code, never entitlement to the DEAL behind it, so a dealer
  // holding one that is not theirs must not learn from us whether it has a dealership at all.
  assert.equal(body.error.code, "INVALID_TOKEN", "must not leak the dealer-less state to the caller");
  const wrongDealerBody = await (async () => {
    pickupRow = dealerPickup();
    authedDealer = { id: "dealer_2" };
    return (await scan()).json();
  })();
  assert.deepEqual(
    body.error,
    wrongDealerBody.error,
    "concierge and wrong-dealer rejections must be indistinguishable to the caller",
  );
});

test("insurance proof missing → 409, deal not completed, code not spent", async () => {
  pickupRow!.deal.insuranceStatus = "NOT_STARTED";
  const res = await scan();
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.equal(body.error.code, "INSURANCE_REQUIRED");
  assert.equal(advanceCalls.length, 0);
  assert.deepEqual(consumeCalls, []);
});

test("insurance revoked between the pre-check and the advance → 409, not a 500", async () => {
  // TOCTOU: the pre-check passed, then the seam's hard gate rejected.
  advanceThrows = new InsuranceRequiredError();
  const res = await scan();
  assert.equal(res.status, 409, "the seam's insurance rejection must be mapped, not thrown as a 500");
  const body = await res.json();
  assert.equal(body.error.code, "INSURANCE_REQUIRED");
  assert.equal(txCalls, 0, "pickup must not be marked complete when the deal did not advance");
});

// ── The release gate Phase 8 added ───────────────────────────────────────────────────────
//
// Phase 8 gave `advanceDealStatus` a third rejection at COMPLETED: `ReleaseNotClearedError`,
// thrown when the dealership's executed contract is not on file or funding is not cleared. It
// was unmapped until 2026-09-15 and surfaced as an unhandled 500 — to a dealer standing at the
// vehicle with the buyer.
//
// It is not the TOCTOU case above. Until #438 `deals.funding_cleared_at` had NO satisfiable
// writer at all, so for a non-forced completion this was not an edge case but the ONLY outcome.
// Which is also why the code is not spent on the way past it: see the next test.

test("funding not cleared → 409, not a 500", async () => {
  advanceThrows = new ReleaseNotClearedError("funding has not been cleared for this deal");
  const res = await scan();
  assert.equal(res.status, 409, "the seam's release rejection must be mapped, not thrown as a 500");
  const body = await res.json();
  assert.equal(body.error.code, "RELEASE_NOT_CLEARED");
  assert.equal(txCalls, 0, "pickup must not be marked complete when the deal did not advance");
  assert.equal(
    body.error.message.includes("funding has not been cleared"),
    true,
    "the detail says who has to act; a generic message sends the dealer to the wrong party",
  );
});

test("a REFUSED release does not burn the buyer's code", async () => {
  // The ordering decision, pinned. Consuming before the advance would be the tidier concurrency
  // story and the wrong one for the people involved: every rejection here is something the
  // DEALERSHIP or AutoLenis has to fix while the buyer stands there, and a spent code would
  // leave them revealing a new one for a handover that is still blocked.
  for (const err of [
    new ReleaseNotClearedError("funding has not been cleared for this deal"),
    new ReleaseNotClearedError("the dealership's fully executed contract is not on file"),
    new InsuranceRequiredError(),
    new DealTransitionError(),
  ]) {
    consumeCalls = [];
    advanceThrows = err;
    await scan();
    assert.deepEqual(consumeCalls, [], `${err.name} must leave the code usable`);
  }
});

test("the dealership's executed contract not on file → 409, not a 500", async () => {
  advanceThrows = new ReleaseNotClearedError("the dealership's fully executed contract is not on file");
  const res = await scan();
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.equal(body.error.code, "RELEASE_NOT_CLEARED");
  assert.equal(txCalls, 0);
});

test("an illegal deal transition → 409 and the pickup row is not marked complete", async () => {
  advanceThrows = new DealTransitionError();
  const res = await scan();
  assert.equal(res.status, 409);
  assert.equal(txCalls, 0);
});

test("a deal already completed elsewhere is rejected (no double completion)", async () => {
  // THE REACHABLE CASE. `POST /api/admin/deals/[dealId]/action` advances a deal to COMPLETED
  // without touching the pickup row, so a live code can outlive the completion it belonged to.
  // (The route also checks `pickup.status === "COMPLETED"`; that half is now unreachable through
  // a real token — `resolveReleaseToken` refuses a COMPLETED pickup as `pickup_not_releasable`
  // before this code runs — and is kept as belt and braces rather than asserted as behaviour. A
  // test that constructs an impossible state is asserting against a world that does not exist.)
  pickupRow!.deal.status = "COMPLETED";
  const res = await scan();
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.equal(body.error.code, "ALREADY_SCANNED");
  assert.equal(advanceCalls.length, 0);
  assert.deepEqual(consumeCalls, [], "and the code is not burned on the way past");
});

// ── Token rejections: each reason gets its own truthful answer ───────────────────────────

test("an expired code is rejected, and says so", async () => {
  resolveReason = "expired";
  const res = await scan();
  assert.equal(res.status, 422);
  const body = await res.json();
  assert.equal(body.error.code, "INVALID_TOKEN");
  assert.match(body.error.message, /expired/i);
  assert.equal(advanceCalls.length, 0);
});

test("a code already spent reads as ALREADY_SCANNED, not as an invalid one", async () => {
  // These send the dealer to two different places: "invalid" starts a support call, "already
  // scanned" ends one.
  resolveReason = "consumed";
  const res = await scan();
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.equal(body.error.code, "ALREADY_SCANNED");
  assert.equal(advanceCalls.length, 0);
});

test("a revoked code says it was cancelled and points at the remedy", async () => {
  resolveReason = "revoked";
  const res = await scan();
  assert.equal(res.status, 422);
  const body = await res.json();
  assert.equal(body.error.code, "INVALID_TOKEN");
  assert.match(body.error.message, /cancelled/i);
});

test("a code whose pickup is no longer releasable → NOT_READY_FOR_PICKUP", async () => {
  resolveReason = "pickup_not_releasable";
  const res = await scan();
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.equal(body.error.code, "NOT_READY_FOR_PICKUP");
  assert.equal(advanceCalls.length, 0);
});

test("an unknown code is rejected without touching the pickup table", async () => {
  resolveReason = "not_found";
  const res = await scan();
  assert.equal(res.status, 422);
  assert.deepEqual(pickupWheres, [], "a bad code must not become a database round trip");
});

test("a missing qrToken is a 400 before anything is resolved", async () => {
  const { POST } = await import("@/app/api/dealer/pickup/scan/route");
  const res = await POST(req());
  assert.equal(res.status, 400);
  assert.deepEqual(pickupWheres, []);
});

test("losing the consume race → ALREADY_SCANNED, and the pickup row is not written twice", async () => {
  // Two simultaneous scans of the same code both resolve (resolution is a read) and both reach
  // the compare-and-swap. Exactly one wins; the loser must be told the truth rather than
  // double-writing the completion.
  consumeSucceeds = false;
  const res = await scan();
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.equal(body.error.code, "ALREADY_SCANNED");
  assert.equal(txCalls, 0, "the loser must not mark the pickup complete a second time");
});
