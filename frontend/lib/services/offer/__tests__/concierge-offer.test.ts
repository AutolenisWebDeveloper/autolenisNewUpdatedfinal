// Batch 4 — concierge → canonical Deal convergence (Deal.offerId spine).
//
//   npx tsx --test --experimental-test-module-mocks \
//     lib/services/offer/__tests__/concierge-offer.test.ts
//
// Covers: honest OTD (vehiclePrice=otd, tax=0, fees=0, junkFeeItems=[]),
// deposit-OPTIONAL closed auction, idempotency by conciergeSourceRef, outside
// (placeholder) dealer identity, input validation, and the P2002 concurrency race.

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

// ── Mutable fixture state driving the mocked prisma ──────────────────────────
interface OfferRow {
  id: string;
  auctionId: string;
  conciergeSourceRef: string | null;
  deal: { id: string } | null;
  status: string;
}
let existingOffer: OfferRow | null;        // returned by offer.findUnique
let dealerExists: boolean;                 // dealer.findUnique resolves a row?
let outsideDealerCalls: number;
let txThrows: null | { code: string };     // simulate a unique-violation inside the txn
let winnerAfterRace: OfferRow | null;      // the row a concurrent winner left behind
let findUniqueCalls: number;               // distinguishes the idempotency vs post-race lookup

const created: {
  auctions: Array<Record<string, unknown>>;
  offers: Array<Record<string, unknown>>;
  deals: Array<Record<string, unknown>>;
  offerUpdates: Array<{ where: unknown; data: Record<string, unknown> }>;
} = { auctions: [], offers: [], deals: [], offerUpdates: [] };

// A Prisma-like P2002 error the service's isUniqueViolation() recognizes.
class FakeKnownRequestError extends Error {
  code: string;
  constructor(code: string) { super(code); this.code = code; }
}

let seq = 0;
const nextId = (p: string) => `${p}_${++seq}`;

const txClient = {
  auction: {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      if (txThrows) { const e = new FakeKnownRequestError(txThrows.code); throw e; }
      const row = { id: nextId("auction"), ...data };
      created.auctions.push(row);
      return { id: row.id };
    },
  },
  offer: {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: nextId("offer"), ...data };
      created.offers.push(row);
      return { id: row.id };
    },
    update: async (args: { where: unknown; data: Record<string, unknown> }) => {
      created.offerUpdates.push(args);
      return {};
    },
  },
  deal: {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: nextId("deal"), ...data };
      created.deals.push(row);
      return { id: row.id };
    },
  },
};

mock.module("@prisma/client", {
  namedExports: {
    Prisma: { PrismaClientKnownRequestError: FakeKnownRequestError },
  },
});

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      offer: {
        findUnique: async () => {
          // The fast idempotency lookup (first call) sees `existingOffer`. Only
          // the post-race lookup — after the txn threw P2002 — sees the winner.
          findUniqueCalls++;
          if (findUniqueCalls > 1 && winnerAfterRace) return winnerAfterRace;
          return existingOffer;
        },
      },
      dealer: {
        findUnique: async () => (dealerExists ? { id: "dealer_real" } : null),
      },
      $transaction: async (fn: (tx: typeof txClient) => Promise<unknown>) => fn(txClient),
    },
  },
});

mock.module("@/lib/services/offer/outside-dealer", {
  namedExports: {
    getOrCreateOutsideDealerId: async () => { outsideDealerCalls++; return "dealer_outside"; },
  },
});

async function load() { return import("@/lib/services/offer/concierge-offer.service"); }

beforeEach(() => {
  existingOffer = null;
  dealerExists = true;
  outsideDealerCalls = 0;
  txThrows = null;
  winnerAfterRace = null;
  findUniqueCalls = 0;
  created.auctions.length = 0;
  created.offers.length = 0;
  created.deals.length = 0;
  created.offerUpdates.length = 0;
  seq = 0;
});

test("happy path (real dealer): honest OTD, deposit-optional CLOSED auction, canonical Deal", async () => {
  const { convertConciergeOfferToDeal } = await load();
  const r = await convertConciergeOfferToDeal({
    buyerId: "buyer_1",
    sourceRef: "vehicle_request_offer:o1",
    dealerId: "dealer_real",
    otdPriceCents: 2_500_000,
    vehicleSummary: "2022 Toyota Camry",
  });

  assert.equal(r.alreadyConverted, false);
  assert.ok(r.dealId && r.offerId && r.auctionId);

  // Deposit-OPTIONAL auction: no depositId, already CLOSED.
  assert.equal(created.auctions.length, 1);
  assert.equal(created.auctions[0]!.status, "CLOSED");
  assert.ok(!("depositId" in created.auctions[0]!), "concierge auction carries no depositId");

  // Honest OTD: vehiclePrice == otd, tax=0, fees=0, no junk fees.
  const offer = created.offers[0]!;
  assert.equal(offer.otdPriceCents, 2_500_000);
  assert.equal(offer.vehiclePriceCents, 2_500_000);
  assert.equal(offer.taxCents, 0);
  assert.equal(offer.feesCents, 0);
  assert.deepEqual(offer.junkFeeItems, []);
  assert.equal(offer.dealerId, "dealer_real");
  assert.equal(offer.conciergeSourceRef, "vehicle_request_offer:o1");
  assert.equal(offer.status, "SUBMITTED");
  // Real dealer → no external identity fields written.
  assert.ok(!("externalDealerName" in offer), "no external identity for a registered dealer");

  // Canonical spine: Deal.offerId set, FINANCING_PENDING; offer flipped ACCEPTED.
  assert.equal(created.deals.length, 1);
  assert.equal(created.deals[0]!.offerId, offer.id);
  assert.equal(created.deals[0]!.status, "FINANCING_PENDING");
  assert.equal(created.offerUpdates.length, 1);
  assert.equal(created.offerUpdates[0]!.data.status, "ACCEPTED");
  assert.equal(outsideDealerCalls, 0);
});

test("idempotent: an already-converted sourceRef mints nothing and returns the existing Deal", async () => {
  existingOffer = { id: "offer_x", auctionId: "auction_x", conciergeSourceRef: "vehicle_request_offer:o1", deal: { id: "deal_x" }, status: "ACCEPTED" };
  const { convertConciergeOfferToDeal } = await load();
  const r = await convertConciergeOfferToDeal({
    buyerId: "buyer_1",
    sourceRef: "vehicle_request_offer:o1",
    dealerId: "dealer_real",
    otdPriceCents: 2_500_000,
  });
  assert.equal(r.alreadyConverted, true);
  assert.equal(r.dealId, "deal_x");
  assert.equal(r.offerId, "offer_x");
  assert.equal(r.auctionId, "auction_x");
  assert.equal(created.auctions.length, 0);
  assert.equal(created.offers.length, 0);
  assert.equal(created.deals.length, 0);
});

test("outside dealer: null/unknown dealerId resolves the placeholder and stores external identity", async () => {
  dealerExists = false; // even if an id were passed, it doesn't resolve
  const { convertConciergeOfferToDeal } = await load();
  const r = await convertConciergeOfferToDeal({
    buyerId: "buyer_1",
    sourceRef: "vehicle_request_offer:o2",
    dealerId: null,
    externalDealerName: "Outside Motors",
    externalDealerEmail: "sales@outside.example",
    otdPriceCents: 1_999_900,
  });
  assert.equal(r.alreadyConverted, false);
  assert.equal(outsideDealerCalls, 1);
  const offer = created.offers[0]!;
  assert.equal(offer.dealerId, "dealer_outside");
  assert.equal(offer.externalDealerName, "Outside Motors");
  assert.equal(offer.externalDealerEmail, "sales@outside.example");
});

test("rejects a non-positive OTD price", async () => {
  const { convertConciergeOfferToDeal } = await load();
  await assert.rejects(
    () => convertConciergeOfferToDeal({ buyerId: "b", sourceRef: "s", dealerId: "dealer_real", otdPriceCents: 0 }),
    /positive integer/,
  );
  assert.equal(created.deals.length, 0);
});

test("rejects a financing offer missing aprRate/termMonths", async () => {
  const { convertConciergeOfferToDeal } = await load();
  await assert.rejects(
    () => convertConciergeOfferToDeal({ buyerId: "b", sourceRef: "s", dealerId: "dealer_real", otdPriceCents: 100, includesFinancing: true }),
    /aprRate and termMonths/,
  );
  assert.equal(created.deals.length, 0);
});

test("financing offer with complete terms records financing on the Offer", async () => {
  const { convertConciergeOfferToDeal } = await load();
  await convertConciergeOfferToDeal({
    buyerId: "b", sourceRef: "s-fin", dealerId: "dealer_real",
    otdPriceCents: 3_000_000, includesFinancing: true, aprRate: 6.9, termMonths: 72,
  });
  const offer = created.offers[0]!;
  assert.equal(offer.includesFinancing, true);
  assert.equal(offer.aprRate, 6.9);
  assert.equal(offer.termMonths, 72);
});

test("concurrency: a P2002 race returns the winning caller's Deal without duplicating", async () => {
  txThrows = { code: "P2002" };
  winnerAfterRace = { id: "offer_win", auctionId: "auction_win", conciergeSourceRef: "vehicle_request_offer:o3", deal: { id: "deal_win" }, status: "ACCEPTED" };
  const { convertConciergeOfferToDeal } = await load();
  const r = await convertConciergeOfferToDeal({
    buyerId: "buyer_1",
    sourceRef: "vehicle_request_offer:o3",
    dealerId: "dealer_real",
    otdPriceCents: 2_000_000,
  });
  assert.equal(r.alreadyConverted, true);
  assert.equal(r.dealId, "deal_win");
  assert.equal(r.offerId, "offer_win");
  // No deal was created locally — the winner already owns it.
  assert.equal(created.deals.length, 0);
});
