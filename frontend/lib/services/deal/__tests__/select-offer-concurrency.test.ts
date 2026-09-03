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
// Requires a REAL Postgres, and specifically a DISPOSABLE one. Run:
//   DATABASE_URL=postgresql://.../autolenis_e2e pnpm test:concurrency
//
// SAFETY. This suite seeds users, buyers, deposits, auctions, dealers and offers. Its earlier
// guard was `!dsn.includes("placeholder")`, which any reachable database satisfied — including
// production, since CI supplies `secrets.DATABASE_URL || <placeholder>`. The guard is now an
// allowlist (lib/testing/isolated-database): loopback host plus the reserved `autolenis_e2e`
// database name, with the production project reference, the Supabase host family and production
// database names refused explicitly. Anything else — including missing or unparseable
// configuration — skips before a connection is opened, so a refusal writes nothing. Every row is
// tagged with a unique run id and removed on success AND on failure, and the run asserts that no
// tagged row survives.

import test from "node:test";
import assert from "node:assert/strict";

import {
  isolatedDatabaseOrNull,
  describeTarget,
  withTaggedRun,
  type CleanupClient,
} from "@/lib/testing/isolated-database";

const target = isolatedDatabaseOrNull(process.env.DATABASE_URL);
const hasRealDb = target !== null;

test(
  "commitOfferSelection: N concurrent selections of different offers → exactly one Deal per auction",
  {
    skip: hasRealDb
      ? false
      : "DATABASE_URL is not a positively identified disposable database — REQUIRES LIVE INFRASTRUCTURE",
  },
  async () => {
    const { prisma } = await import("@/lib/prisma");
    // eslint-disable-next-line no-console
    console.log(`[concurrency] isolated target confirmed: ${describeTarget(target!)}`);
    const { commitOfferSelection, OfferSelectionRaceLostError } = await import(
      "@/lib/services/deal/select-offer.service"
    );

    const ROUNDS = 5;
    const OFFERS_PER_AUCTION = 8;

    await withTaggedRun(prisma as unknown as CleanupClient, async (runTag) => {
    for (let round = 0; round < ROUNDS; round++) {
      // Every natural key carries the run tag, so cleanup finds this run's rows and only this
      // run's rows even when several runs share the disposable database.
      const uniq = `${runTag}-race-${round}`;

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
    });
  },
);
