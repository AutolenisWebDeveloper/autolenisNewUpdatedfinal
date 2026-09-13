// §8.2 Phase 6 defect (4) — SELECTION REQUIRES A CLOSED AUCTION, A VALID UNEXPIRED OFFER, AND
// THE APPROVAL RECHECK.
//
// The route rejected only `CANCELLED`. Every other non-selectable state was selectable: a buyer
// could create a Deal on a `PENDING` auction that had never been launched, on an `EXPIRED` one
// whose window lapsed without close processing ever running, or on a `REOPENED` one. §9's entry
// condition is "offers ready", which is a CLOSED auction — with one sanctioned exception, the
// explicit and audited early accept on a still-live ACTIVE auction.
//
// Two further gates had no reader at all. `offers.expires_at` shipped in the Phase 1 wave and
// nothing ever consulted it, so a lapsed offer stayed selectable and committed a dealership to a
// price it had withdrawn. `offers.is_disqualified` is §13-D40's recoverable over-ceiling marker;
// §8c says such offers are "never presented as qualified", and excluding them from the ranked
// report without refusing them here would leave them selectable by anyone holding the offer id.
//
//   npx tsx --test --experimental-test-module-mocks \
//     app/api/buyer/auctions/__tests__/select-offer-gates.test.ts

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
// Imported from the concrete module path so the `next/server` mock below (which exists only
// to neutralise `after()`) does not also replace NextRequest with undefined.
import { NextRequest } from "next/dist/server/web/spec-extension/request";

type Rec = Record<string, unknown>;

let auction: Rec | null;
let offer: Rec | null;
let acceptedOffer: Rec | null;
let approvalOk: boolean;
let committed: Rec[];

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      auction: { findFirst: async () => auction },
      offer: {
        findFirst: async ({ where }: { where: Rec }) =>
          where.status === "ACCEPTED" ? acceptedOffer : offer,
      },
      buyer: { findUnique: async () => ({ id: "b1", firstName: "Ada", user: { email: "a@x.test" }, phone: null, lastName: "L" }) },
      notification: { create: async () => ({ id: "n1" }) },
      auditLog: { create: async () => ({ id: "a1" }) },
      vehicleRequest: { findFirst: async () => null },
    },
  },
});

mock.module("@/lib/auth/api", {
  namedExports: {
    getRequestBuyer: async () => ({ id: "b1" }),
    successResponse: (data: unknown) => Response.json({ success: true, data }),
    errorResponse: (code: string, message: string, status: number) =>
      Response.json({ success: false, error: { code, message } }, { status }),
  },
});

mock.module("@/lib/services/prequal/approval-recheck", {
  namedExports: {
    recheckApproval: async () =>
      approvalOk
        ? { ok: true, approvedAmountCents: 4_000_000, expiresAt: null }
        : { ok: false, message: "Your approval has expired." },
  },
});

mock.module("@/lib/services/deal/select-offer.service", {
  namedExports: {
    commitOfferSelection: async (p: Rec) => {
      committed.push(p);
      return { dealId: "deal_1", declinedOfferIds: [], closedCandidateIds: [] };
    },
    OfferSelectionRaceLostError: class extends Error {},
  },
});

// `after()` needs a request scope Next only provides in a real server. Captured rather than
// discarded, so a test can still assert that the tail work was scheduled — following
// `app/api/concierge/__tests__/concierge-hardening.test.ts:173`.
const afterTasks: Array<() => unknown> = [];
mock.module("next/server", { namedExports: { after: (fn: () => unknown) => { afterTasks.push(fn); } } });

mock.module("@/lib/services/email/resend.service", { namedExports: { sendDealSelectedEmail: async () => {} } });
mock.module("@/lib/services/ghl/tag-sync", { namedExports: { syncGhlTag: () => {} } });
mock.module("@/lib/amips/pipelines/marketplace-intelligence.recorder", {
  namedExports: { recordMarketplaceFromAuction: async () => {} },
});

const FUTURE = new Date(Date.now() + 86_400_000);
const PAST = new Date(Date.now() - 86_400_000);

function liveOffer(over: Rec = {}): Rec {
  return { id: "off_1", auctionId: "auc_1", status: "SUBMITTED", expiresAt: null, isDisqualified: false, disqualifiedReason: null, ...over };
}

beforeEach(() => {
  auction = { id: "auc_1", buyerId: "b1", status: "CLOSED", endsAt: PAST, vehicleRequestId: "vr_1" };
  offer = liveOffer();
  acceptedOffer = null;
  approvalOk = true;
  committed = [];
});

async function select(body: Rec = { offerId: "off_1" }) {
  const { POST } = await import("../[auctionId]/select-offer/route");
  const req = new NextRequest("http://localhost/api/buyer/auctions/auc_1/select-offer", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
  const res = await POST(req, { params: Promise.resolve({ auctionId: "auc_1" }) });
  return { status: res.status, json: (await res.json()) as { error?: { code?: string } } };
}

// ── the auction-status gate ─────────────────────────────────────────────────────────────────────

test("a CLOSED auction is selectable — the normal path still works", async () => {
  const { status } = await select();
  assert.equal(status, 200);
  assert.equal(committed.length, 1, "the selection never reached commitOfferSelection");
});

for (const [state, code] of [
  ["PENDING", "AUCTION_NOT_STARTED"],
  ["EXPIRED", "AUCTION_EXPIRED"],
  ["REOPENED", "AUCTION_REOPENED"],
  ["CANCELLED", "AUCTION_CANCELLED"],
] as const) {
  test(`a ${state} auction is NOT selectable and says so by name`, async () => {
    auction = { ...auction!, status: state };
    const { status, json } = await select();
    assert.equal(status, 409, `${state} was accepted`);
    assert.equal(json.error?.code, code);
    assert.equal(committed.length, 0, `${state} reached commitOfferSelection`);
  });
}

test("an ACTIVE auction still requires the explicit, audited early accept", async () => {
  auction = { ...auction!, status: "ACTIVE", endsAt: FUTURE };
  const blocked = await select({ offerId: "off_1" });
  assert.equal(blocked.json.error?.code, "AUCTION_LIVE");
  assert.equal(committed.length, 0);

  const allowed = await select({ offerId: "off_1", forceEarly: true });
  assert.equal(allowed.status, 200, "forceEarly must still permit the early accept");
  assert.equal(committed.length, 1);
});

// ── the offer gates ─────────────────────────────────────────────────────────────────────────────

test("an EXPIRED offer is refused — expires_at finally has a reader", async () => {
  offer = liveOffer({ expiresAt: PAST });
  const { status, json } = await select();
  assert.equal(status, 409);
  assert.equal(json.error?.code, "OFFER_EXPIRED");
  assert.equal(committed.length, 0);
});

test("an offer expiring in the future is still selectable", async () => {
  offer = liveOffer({ expiresAt: FUTURE });
  assert.equal((await select()).status, 200);
});

test("a DISQUALIFIED offer is refused, and the reason reaches the buyer", async () => {
  // §13-D40: recorded and disqualified rather than rejected at submit, so the reason is available
  // to say. Saying "this offer cannot be selected" without it sends the buyer to support.
  offer = liveOffer({ isDisqualified: true, disqualifiedReason: "Out-the-door exceeds your approved amount." });
  const { status, json } = await select();
  assert.equal(status, 409);
  assert.equal(json.error?.code, "OFFER_DISQUALIFIED");
  assert.match(String((json.error as { message?: string })?.message), /exceeds your approved amount/);
  assert.equal(committed.length, 0);
});

// ── the approval recheck ────────────────────────────────────────────────────────────────────────

test("a lapsed approval refuses the selection rather than creating the Deal", async () => {
  approvalOk = false;
  const { status, json } = await select();
  assert.equal(status, 409);
  assert.equal(json.error?.code, "APPROVAL_REQUIRED");
  assert.equal(committed.length, 0);
});

// ── the anti-double-deal guard, unchanged but re-pinned ─────────────────────────────────────────

test("an auction with an already-ACCEPTED offer refuses a second selection", async () => {
  acceptedOffer = { id: "off_other" };
  const { status, json } = await select();
  assert.equal(status, 409);
  assert.equal(json.error?.code, "ALREADY_SELECTED");
  assert.equal(committed.length, 0);
});
