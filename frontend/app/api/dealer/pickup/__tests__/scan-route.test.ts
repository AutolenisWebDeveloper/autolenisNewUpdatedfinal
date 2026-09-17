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
let releaseCalls: Array<Record<string, unknown>> = [];
let releaseThrows: Error | null = null;
let releaseOutcome: Record<string, unknown> = { ok: true, alreadyReleased: false, releasedAt: new Date("2026-09-22T15:30:00.000Z") };
let consumeCalls: Array<{ pickupId: string; rawToken: string }> = [];
let pickupCasWheres: Array<Record<string, unknown>> = [];
let activityEvents = 0;
/** Simulates another scan (or an admin) having already completed the pickup row. */
let pickupAlreadyCompleted = false;
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
      buyerActivityEvent: { create: async () => { activityEvents += 1; return {}; } },
      // Interactive form — the route needs to know WHO WON the pickup compare-and-swap, which the
      // array form cannot report while staying atomic with the activity event.
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
        return fn({
          pickup: {
            updateMany: async ({ where }: { where: Record<string, unknown> }) => {
              pickupCasWheres.push(where);
              return { count: pickupAlreadyCompleted ? 0 : 1 };
            },
          },
          buyerActivityEvent: { create: async () => { activityEvents += 1; return {}; } },
        });
      },
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
    consumeReleaseToken: async ({ pickupId, rawToken }: { pickupId: string; rawToken: string }) => {
      consumeCalls.push({ pickupId, rawToken });
      return consumeSucceeds;
    },
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
    DealTransitionError,
    InsuranceRequiredError,
    ReleaseNotClearedError,
  },
});

// PHASE 9. The route no longer completes anything — it records a HANDOVER through the one
// completion service, which owns the transaction, the gates and the token spend together.
mock.module("@/lib/services/pickup/pickup-completion.service", {
  namedExports: {
    recordDealerRelease: async (input: Record<string, unknown>) => {
      releaseCalls.push(input);
      if (releaseThrows) throw releaseThrows;
      return releaseOutcome;
    },
  },
});

/**
 * THE BODY THE REAL DEALER UI SENDS. This helper used to build `{ qrToken }` and nothing else,
 * which is what let the identity defect through every test in this file: `recordDealerRelease` is
 * mocked here, and the stub ignores `identityVerified`, so the route returned 200 for exactly the
 * body the production service refuses. Every assertion below was true of the route and false of
 * the system.
 *
 * `identityVerified` defaults TRUE because these tests mean "a dealership completed the form".
 * The default is not the fix — the fix is the test below that pins what the route FORWARDS, and
 * the one that posts the old body and expects the refusal.
 */
const req = (qrToken?: string, extra: Record<string, unknown> = {}) =>
  new NextRequest("http://localhost/api/dealer/pickup/scan", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(
      qrToken === undefined ? {} : { qrToken, identityVerified: true, ...extra },
    ),
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
  releaseCalls = [];
  releaseThrows = null;
  consumeCalls = [];
  pickupWheres = [];
  pickupCasWheres = [];
  activityEvents = 0;
  pickupAlreadyCompleted = false;
});

async function scan(token = "a".repeat(64), extra: Record<string, unknown> = {}) {
  const { POST } = await import("@/app/api/dealer/pickup/scan/route");
  return POST(req(token, extra));
}

test("requires authentication (401)", async () => {
  authedDealer = null;
  const res = await scan();
  assert.equal(res.status, 401);
  assert.equal(releaseCalls.length, 0);
});

test("a valid scan records HANDOVER — it does NOT complete the deal", async () => {
  // §8.2 defect (3). This route used to advance the Deal to COMPLETED as a DEALER actor.
  // §Stage 19: "the Deal never completes automatically on the dealer's word alone."
  const res = await scan();
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.data.status, "HANDOVER_PENDING", "the scan records a release, not a completion");
  assert.equal(body.data.awaitingBuyerConfirmation, true);
  assert.equal(releaseCalls.length, 1);
  assert.equal(
    "to" in releaseCalls[0]! && releaseCalls[0]!.to === "COMPLETED",
    false,
    "nothing on this path may ask for COMPLETED",
  );
});

test("the PRESENTED code is handed to the release service to be spent in its transaction", async () => {
  // The code that was scanned, not whatever the pickup row happens to hold now — a buyer who
  // re-revealed between the resolve and the write has replaced it. Spending it inside the
  // release transaction is what makes a refused release leave the code usable, so the route
  // must pass it rather than spending it itself.
  await scan();
  assert.equal(releaseCalls[0]!.pickupId, "pickup_1");
  assert.equal(releaseCalls[0]!.rawToken, "a".repeat(64));
  assert.deepEqual(consumeCalls, [], "the route must never spend the code outside that transaction");
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
  assert.equal(releaseCalls.length, 0, "the route refuses before the release service is reached");
  assert.deepEqual(consumeCalls, [], "a rejected scan must not spend someone else's code");
});

test("CONCIERGE deal (no dealer on the deal) can never be completed by a dealer scan", async () => {
  pickupRow = conciergePickup();
  const res = await scan();
  assert.equal(releaseCalls.length, 0, "a dealer must never complete a deal that has no dealer");
  assert.equal(releaseCalls.length, 0, "and must never reach the release service");
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
  assert.equal(releaseCalls.length, 0);
  assert.deepEqual(consumeCalls, []);
});

test("insurance revoked between the pre-check and the advance → 409, not a 500", async () => {
  // TOCTOU: the pre-check passed, then the seam's hard gate rejected.
  releaseThrows = new InsuranceRequiredError();
  const res = await scan();
  assert.equal(res.status, 409, "the seam's insurance rejection must be mapped, not thrown as a 500");
  const body = await res.json();
  assert.equal(body.error.code, "INSURANCE_REQUIRED");
  assert.equal(releaseCalls.length, 1, "the release service is reached, and its rejection is mapped rather than thrown");
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
  releaseThrows = new ReleaseNotClearedError("funding has not been cleared for this deal");
  const res = await scan();
  assert.equal(res.status, 409, "the seam's release rejection must be mapped, not thrown as a 500");
  const body = await res.json();
  assert.equal(body.error.code, "RELEASE_NOT_CLEARED");
  assert.equal(releaseCalls.length, 1, "the release service is reached, and its rejection is mapped rather than thrown");
  assert.equal(
    body.error.message.includes("funding has not been cleared"),
    true,
    "the detail says who has to act; a generic message sends the dealer to the wrong party",
  );
});

test("a REFUSED release does not burn the buyer's code", async () => {
  // The ordering decision, and in Phase 9 it is STRUCTURAL rather than a matter of where the
  // route puts the call. Every rejection here is something the DEALERSHIP or AutoLenis has to
  // fix while the buyer stands there, and a spent code would leave them revealing a new one for
  // a handover that is still blocked. The spend now happens INSIDE the release transaction, so
  // a throw rolls it back; this route cannot burn a code even by accident, because it never
  // spends one.
  for (const err of [
    new ReleaseNotClearedError("funding has not been cleared for this deal"),
    new ReleaseNotClearedError("the dealership's fully executed contract is not on file"),
    new InsuranceRequiredError(),
  ]) {
    consumeCalls = [];
    releaseThrows = err;
    await scan();
    assert.deepEqual(consumeCalls, [], `${err.name} must leave the code usable`);
  }
  // ANTI-VACUITY: the loop above proves nothing if the route never spends a code on ANY path.
  // It does not — which is the point — so the guarantee is pinned in the release service's own
  // suite instead: `pickup-completion.test.ts` asserts a thrown gate leaves token_consumed_at
  // null after the rollback. This assertion records that the route's half is "never directly".
  releaseThrows = null;
  consumeCalls = [];
  await scan();
  assert.deepEqual(consumeCalls, [], "not even on the success path");
});

test("the dealership's executed contract not on file → 409, not a 500", async () => {
  releaseThrows = new ReleaseNotClearedError("the dealership's fully executed contract is not on file");
  const res = await scan();
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.equal(body.error.code, "RELEASE_NOT_CLEARED");
  assert.equal(releaseCalls.length, 1);
});

test("a deal that is not scheduled → 409 NOT_READY_FOR_PICKUP, nothing recorded", async () => {
  releaseOutcome = { ok: false, reason: "not_scheduled" };
  const res = await scan();
  assert.equal(res.status, 409);
  assert.equal((await res.json()).error.code, "NOT_READY_FOR_PICKUP");
});

test("an unverified identity BLOCKS the handover — §Stage 18's first named failure", async () => {
  // "An identity mismatch ... blocks handover and creates an urgent exception with an owner and
  // an immediate buyer and dealership notification." The exception is raised by the service; the
  // dealer is told plainly rather than handed a generic refusal they cannot act on.
  releaseOutcome = { ok: false, reason: "identity_unverified" };
  const res = await scan();
  assert.equal(res.status, 409);
  assert.equal((await res.json()).error.code, "IDENTITY_NOT_VERIFIED");
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
  assert.equal(releaseCalls.length, 0);
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
  assert.equal(releaseCalls.length, 0);
});

test("a code already spent reads as ALREADY_SCANNED, not as an invalid one", async () => {
  // These send the dealer to two different places: "invalid" starts a support call, "already
  // scanned" ends one.
  resolveReason = "consumed";
  const res = await scan();
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.equal(body.error.code, "ALREADY_SCANNED");
  assert.equal(releaseCalls.length, 0);
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
  assert.equal(releaseCalls.length, 0);
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

test("a code already spent → ALREADY_SCANNED, and nothing is recorded", async () => {
  // Two simultaneous scans both resolve (resolution is a read) and both reach the release
  // service; exactly one wins the consume compare-and-swap inside the transaction. The loser is
  // told the truth, and — unlike the pre-Phase-9 ordering — has written nothing to undo.
  releaseOutcome = { ok: false, reason: "code_already_spent" };
  const res = await scan();
  assert.equal(res.status, 409);
  assert.equal((await res.json()).error.code, "ALREADY_SCANNED");
});

test("THE HALF-WRITE IS NOW STRUCTURALLY IMPOSSIBLE, not handled", async () => {
  // WHAT THIS REPLACES. Until Phase 9 the token swap ran AFTER `advanceDealStatus` had
  // committed: the deal was COMPLETED, DealStatusHistory written, the exactly-once
  // purchase_completed event fired. A lost swap there left the deal COMPLETED with a pickup that
  // was not — no completedAt, no activity event, no email — recoverable only through the admin
  // route. #440 handled that case carefully and correctly.
  //
  // It cannot arise any more. The consume, the gates, the status change, the pickup evidence and
  // the outbox rows are one transaction, so a lost swap rolls back everything rather than
  // stranding half of it. The route's whole contribution is a refusal, and the loser of a race
  // leaves no state behind to reconcile.
  releaseOutcome = { ok: false, reason: "code_already_spent" };
  const res = await scan();
  assert.equal(res.status, 409, "the loser is refused");
  assert.equal(activityEvents, 0, "and writes nothing — there is no partial completion to repair");
  assert.deepEqual(consumeCalls, [], "the route never spent the code, so it has none to unspend");
});

test("the route FORWARDS §Stage 18's recorded facts — not just the token", async () => {
  // THE REGRESSION FOR THE DEFECT THIS FILE COULD NOT SEE. `recordDealerRelease` is mocked, so
  // asserting the route's STATUS proves nothing about what the service was asked to do. The only
  // thing worth asserting through a mocked seam is what crossed it.
  await scan("b".repeat(64), {
    odometerAtRelease: 12480,
    conditionAtRelease: "Two stone chips on the bonnet.",
    fundsCollectedMethod: "cashier's check",
    tradeReceived: true,
  });

  assert.equal(releaseCalls.length, 1);
  const call = releaseCalls[0]!;
  assert.equal(call.identityVerified, true, "§Stage 18 blocks a handover on an identity mismatch — the flag must reach the service");
  assert.equal(call.odometerAtRelease, 12480);
  assert.equal(call.conditionAtRelease, "Two stone chips on the bonnet.");
  assert.equal(call.fundsCollectedMethod, "cashier's check");
  assert.equal(call.tradeReceived, true);
});

test("a body with NO identityVerified is forwarded as false — the shape the old UI sent", async () => {
  // This is the exact request `PickupActionsClient` used to make: `{ qrToken }` alone. The route
  // reads `body.identityVerified === true`, so it forwards FALSE, and the real service refuses
  // and raises ID_MISMATCH_AT_HANDOVER. Pinned so a future UI regressing to that body fails here
  // rather than at a dealership counter.
  const { POST } = await import("@/app/api/dealer/pickup/scan/route");
  await POST(
    new NextRequest("http://localhost/api/dealer/pickup/scan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ qrToken: "c".repeat(64) }),
    }),
  );

  assert.equal(releaseCalls.length, 1);
  assert.equal(
    releaseCalls[0]!.identityVerified,
    false,
    "an absent flag is not a confirmed identity, and the route must not default it to true",
  );
});
