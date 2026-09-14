// §29 PRESERVE, DO NOT REGRESS — P3 and P4, pinned.
//
// The Phase 6 brief names four safeguards that Stage 8c already built and that this phase must not
// weaken. Two of them had NO TEST ANYWHERE, which is what this file is for: a safeguard that is
// only a property of code nobody asserts is one refactor away from being gone, and both of these
// are the kind that fail silently — nobody notices a dealer CAN see something.
//
//   P3  "Dealers never see competing offers, counts, or rankings."
//   P4  "Dealers may revise before the deadline and EVERY VERSION IS RETAINED."
//
// P3 IS NOW SHARPER THAN WHEN IT WAS WRITTEN, and Phase 6 is why: `persistRanking` writes
// `rank_cash`, `rank_monthly`, `rank_balanced` and `best_price_score` onto the `offers` rows
// themselves at close. Before this phase those columns were written only by an admin re-run, so a
// careless `include: { offers: true }` on the dealer route would have leaked mostly nulls. Now it
// would leak the dealership's own position in a sealed ranking — and, by subtraction, information
// about the others.
//
//   npx tsx --test --experimental-test-module-mocks \
//     app/api/dealer/__tests__/dealer-isolation-pins.test.ts

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/dist/server/web/spec-extension/request";

type Rec = Record<string, unknown>;

let invitation: Rec | null;
let auction: Rec | null;
let myOffer: Rec | null;
let prequal: Rec | null;
let offerFindFirstArgs: Rec[];
let auctionFindArgs: Rec[];

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      auctionInvitation: { findFirst: async () => invitation, update: async () => ({}) },
      auction: {
        findUnique: async (args: Rec) => {
          auctionFindArgs.push(args);
          return auction;
        },
      },
      offer: {
        findFirst: async (args: Rec) => {
          offerFindFirstArgs.push(args);
          return myOffer;
        },
      },
      preQualification: { findUnique: async () => prequal },
    },
  },
});

mock.module("@/lib/auth/dealer-api", {
  namedExports: {
    getRequestDealer: async () => ({ id: "dealer_me" }),
    successResponse: (data: unknown) => Response.json({ success: true, data }),
    errorResponse: (code: string, message: string, status: number) =>
      Response.json({ success: false, error: { code, message } }, { status }),
  },
});

beforeEach(() => {
  invitation = { id: "inv_1", sentAt: new Date(), viewedAt: new Date(), respondedAt: null };
  auction = {
    id: "auc_1",
    status: "ACTIVE",
    startedAt: new Date(),
    endsAt: new Date(Date.now() + 3_600_000),
    closedAt: null,
    buyerId: "buyer_secret",
    vehicles: [],
    _count: { offers: 7 },
  };
  myOffer = { id: "off_mine", status: "SUBMITTED", otdPriceCents: 3_000_000, version: 2 };
  prequal = { maxOtdAmountCents: 4_237_500 };
  offerFindFirstArgs = [];
  auctionFindArgs = [];
});

async function get() {
  const { GET } = await import("../auctions/[auctionId]/route");
  const res = await GET(new NextRequest("http://localhost/api/dealer/auctions/auc_1"), {
    params: Promise.resolve({ auctionId: "auc_1" }),
  });
  return { status: res.status, json: (await res.json()) as Rec };
}

// ── P3 — NEVER A COMPETING OFFER ────────────────────────────────────────────────────────────────

test("the only offer returned is the dealership's OWN — the query is scoped by dealerId", async () => {
  await get();
  assert.equal(offerFindFirstArgs.length, 1);
  assert.equal((offerFindFirstArgs[0].where as Rec).dealerId, "dealer_me", "the offer lookup is not dealer-scoped");
});

test("no ranking reaches the dealership — not even its own position", async () => {
  // Phase 6 writes rank_cash / rank_monthly / rank_balanced / best_price_score onto `offers` at
  // close. A dealership that learns it ranked #1 of 7 learns something about the other six.
  await get();
  const select = (offerFindFirstArgs[0].select ?? {}) as Rec;
  for (const field of ["rankCash", "rankMonthly", "rankBalanced", "bestPriceScore"]) {
    assert.equal(select[field], undefined, `${field} was selected into a dealer-facing response`);
  }
  // An explicit `select` is itself the safeguard: an `include`, or no projection at all, would
  // return every column the model grows from now on.
  assert.ok(Object.keys(select).length > 0, "the dealer offer lookup has no explicit projection");
  assert.equal((offerFindFirstArgs[0] as Rec).include, undefined);
});

// ── P3 — THE SEALED COUNT ───────────────────────────────────────────────────────────────────────

test("the offer count is SEALED while the auction is live", async () => {
  // §13-D35: a dealership that knows it is the only bidder bids differently from one that knows
  // there are seven. The buyer sees the count — it is their auction — and that is not the same
  // disclosure.
  const data = (await get()).json.data as Rec;
  assert.equal((data.auction as Rec).offerCount, null, "a live offer count reached a dealer");
  assert.equal(JSON.stringify(data).includes('"_count"'), false, "the raw _count was serialised through");
});

test("the count is published once the auction closes", async () => {
  auction = { ...auction!, status: "CLOSED", closedAt: new Date() };
  const data = (await get()).json.data as Rec;
  assert.equal((data.auction as Rec).offerCount, 7, "the other half of the ruling — publish after close");
});

// ── P3 — NO BUYER IDENTITY, NO EXACT BUDGET, NO INTERNAL KEYS ───────────────────────────────────

test("the buyer's internal id never leaves the route", async () => {
  const body = JSON.stringify((await get()).json);
  assert.equal(body.includes("buyer_secret"), false, "buyerId reached a dealer and can be correlated elsewhere");
});

test("the approved ceiling is coarsened, never returned exactly", async () => {
  // §25.1 gives dealerships a budget RANGE. The exact figure is the buyer's approved amount and
  // would let a dealership price to the ceiling.
  const body = JSON.stringify((await get()).json);
  assert.equal(body.includes("4237500"), false, "the exact approved amount reached a dealer");
  assert.ok(((await get()).json.data as Rec).budgetRange, "the range itself must still be provided");
});

test("the auction query asks for no buyer relation at all", async () => {
  await get();
  const select = ((auctionFindArgs[0] as Rec).select ?? {}) as Rec;
  assert.equal(select.buyer, undefined, "the dealer route joined the buyer");
  assert.equal((auctionFindArgs[0] as Rec).include, undefined);
});

// ── P4 — EVERY VERSION RETAINED ─────────────────────────────────────────────────────────────────

test("a revision SUPERSEDES its predecessor and never deletes it", async () => {
  // §29: "dealers may revise before the deadline and every version is retained." The superseded
  // row is WITHDRAWN, which keeps the audit trail and keeps §8b's live-offer cap honest — a
  // deleted predecessor would leave no record of what was offered first.
  //
  // Asserted against the service rather than the route, because the retention is the service's
  // behaviour. The statement ORDER — withdraw, then insert — is proven separately against a real
  // index in `lib/services/offer/__tests__/destructive/offer-revision-index.test.ts`.
  const src = await import("node:fs").then((fs) =>
    fs.readFileSync("lib/services/offer/offer.service.ts", "utf8"),
  );
  const revise = src.slice(src.indexOf("export async function reviseOffer"));
  assert.equal(/\.delete\(|deleteMany/.test(revise), false, "reviseOffer deletes something");
  assert.match(revise, /status: OfferStatus\.WITHDRAWN/, "the predecessor is no longer withdrawn");
  assert.match(revise, /originalOfferId: offerId/, "the version chain is no longer walkable");
  assert.match(revise, /version: original\.version \+ 1/, "versions are no longer numbered");
});

test("the dealer sees only the LATEST of its own versions, not the whole chain", async () => {
  // Retention is for AutoLenis and the audit trail. The dealership's own screen shows the offer
  // that stands; surfacing the chain would invite a dealer to reason about revision behaviour that
  // §8b caps deliberately.
  await get();
  assert.deepEqual((offerFindFirstArgs[0] as Rec).orderBy, { createdAt: "desc" });
});
