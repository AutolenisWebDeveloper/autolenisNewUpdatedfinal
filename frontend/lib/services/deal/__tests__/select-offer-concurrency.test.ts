// P0 concurrency proof (Phase 1 E-1): competing, genuinely-parallel selections
// of DIFFERENT offers on the SAME auction must produce EXACTLY ONE Deal.
//
// This is a PERSISTENCE-LAYER test: it runs real transactions against a real
// Postgres (the FOR UPDATE row lock only exists in the database), fires N
// selections concurrently via Promise.allSettled, and asserts at the DB layer
// that exactly one Deal / one ACCEPTED offer persists and the losers reject with
// OfferSelectionRaceLostError. It is repeated across several rounds so the guard
// — not a single timing coincidence — is what produces the result.
//
// Requires a REAL Postgres. Not part of `pnpm test:all` (which runs against a
// placeholder DSN). Run:
//   DATABASE_URL=postgresql://.../db DIRECT_URL=... pnpm test:concurrency
// When DATABASE_URL is unset or a placeholder, the suite skips (documented
// NOT VERIFIED — REQUIRES LIVE INFRASTRUCTURE in any environment without a DB).

import test from "node:test";
import assert from "node:assert/strict";

const dsn = process.env.DATABASE_URL ?? "";
const hasRealDb = dsn.length > 0 && !dsn.includes("placeholder");

test(
  "commitOfferSelection: N concurrent selections of different offers → exactly one Deal per auction",
  { skip: hasRealDb ? false : "no real DATABASE_URL — REQUIRES LIVE INFRASTRUCTURE" },
  async () => {
    const { prisma } = await import("@/lib/prisma");
    const { commitOfferSelection, OfferSelectionRaceLostError } = await import(
      "@/lib/services/deal/select-offer.service"
    );

    const ROUNDS = 5;
    const OFFERS_PER_AUCTION = 8;

    for (let round = 0; round < ROUNDS; round++) {
      const uniq = `race-${round}-${crypto.randomUUID()}`;

      // ── Seed: buyer, deposit, CLOSED auction, N dealers + SUBMITTED offers ──
      const buyerUser = await prisma.user.create({
        data: { supabaseId: `${uniq}-buyer`, email: `${uniq}-buyer@test.local`, role: "BUYER" },
      });
      const buyer = await prisma.buyer.create({
        data: { userId: buyerUser.id, firstName: "Race", lastName: "Buyer" },
      });
      const deposit = await prisma.deposit.create({
        data: { buyerId: buyer.id, amountCents: 9900, status: "PAID" },
      });
      const auction = await prisma.auction.create({
        // CLOSED is the normal pre-selection state (buyer picks after the window).
        data: { buyerId: buyer.id, depositId: deposit.id, status: "CLOSED", closedAt: new Date() },
      });

      const offerIds: string[] = [];
      for (let i = 0; i < OFFERS_PER_AUCTION; i++) {
        const dealerUser = await prisma.user.create({
          data: { supabaseId: `${uniq}-dealer-${i}`, email: `${uniq}-dealer-${i}@test.local`, role: "DEALER" },
        });
        const dealer = await prisma.dealer.create({
          data: { userId: dealerUser.id, dealershipName: `Dealer ${i}` },
        });
        const offer = await prisma.offer.create({
          data: {
            auctionId: auction.id,
            dealerId: dealer.id,
            status: "SUBMITTED",
            otdPriceCents: 3_000_000 + i,
            vehiclePriceCents: 2_800_000 + i,
          },
        });
        offerIds.push(offer.id);
      }

      // ── Fire all selections concurrently ──────────────────────────────────
      const results = await Promise.allSettled(
        offerIds.map((offerId) =>
          commitOfferSelection({ buyerId: buyer.id, auctionId: auction.id, offerId }),
        ),
      );

      const winners = results.filter((r) => r.status === "fulfilled");
      const losers = results.filter((r) => r.status === "rejected");

      // Exactly one winner; every loser rejects with the typed race error.
      assert.equal(winners.length, 1, `round ${round}: expected 1 winner, got ${winners.length}`);
      assert.equal(losers.length, OFFERS_PER_AUCTION - 1, `round ${round}: loser count`);
      for (const l of losers as PromiseRejectedResult[]) {
        assert.ok(
          l.reason instanceof OfferSelectionRaceLostError,
          `round ${round}: loser rejected with unexpected error: ${l.reason}`,
        );
      }

      // ── Persistence-layer invariant: exactly one Deal / one ACCEPTED offer ─
      const deals = await prisma.deal.findMany({ where: { offer: { auctionId: auction.id } } });
      assert.equal(deals.length, 1, `round ${round}: expected exactly 1 Deal, found ${deals.length}`);

      const acceptedOffers = await prisma.offer.findMany({
        where: { auctionId: auction.id, status: "ACCEPTED" },
      });
      assert.equal(acceptedOffers.length, 1, `round ${round}: expected exactly 1 ACCEPTED offer`);
      assert.equal(deals[0].offerId, acceptedOffers[0].id, `round ${round}: Deal ↔ accepted offer mismatch`);

      const winningDealId = (winners[0] as PromiseFulfilledResult<{ dealId: string }>).value.dealId;
      assert.equal(deals[0].id, winningDealId, `round ${round}: winner dealId must be the persisted Deal`);

      const finalAuction = await prisma.auction.findUnique({ where: { id: auction.id } });
      assert.equal(finalAuction?.status, "CLOSED", `round ${round}: auction must be CLOSED`);
    }
  },
);
