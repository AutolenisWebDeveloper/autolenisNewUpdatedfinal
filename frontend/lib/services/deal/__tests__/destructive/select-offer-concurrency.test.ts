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
// database names refused explicitly. A refusal is decided from the connection string alone, before
// any connection is opened, so it writes nothing.
//
// FAIL-CLOSED IN CI. A refusal is NOT uniformly a skip. In CI this suite is an acceptance gate, so
// a missing, unparseable or unapproved target FAILS the run — a green pipeline must never mean
// "the destructive test quietly did not execute". On a developer machine the same refusal skips,
// but reports NOT VERIFIED and satisfies no gate. CI points this at the job's own ephemeral
// postgres service, never at a stored secret.
//
// Every row is tagged with a unique run id and removed on success AND on failure, and both paths
// assert that no tagged row survives.

import test from "node:test";
import assert from "node:assert/strict";

import {
  resolveDestructiveTarget,
  describeTarget,
  withTaggedRun,
  type CleanupClient,
} from "@/lib/testing/isolated-database";

const decision = resolveDestructiveTarget(process.env.DATABASE_URL);

// The gate itself. In CI a refused target fails HERE, having opened nothing.
test("the destructive suite has an approved, positively identified database target", () => {
  assert.notEqual(decision.mode, "fail", decision.reason);
  if (decision.mode === "skip") {
    // eslint-disable-next-line no-console
    console.log(`# ${decision.reason}`);
  }
});

test(
  "commitOfferSelection: N concurrent selections of different offers → exactly one Deal per auction",
  {
    skip:
      decision.mode === "run"
        ? false
        : decision.mode === "skip"
          ? decision.reason
          : "target refused — the enforcement test above has failed this run",
  },
  async () => {
    const target = decision.mode === "run" ? decision.target : null;
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
            // Phase 6 §9a lineage: the Deal copies VIN and out-the-door from the offer it binds.
            vin: `1HGCM82633A${String(i).padStart(6, "0")}`,
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

      // ── PHASE 6, Stage 9 / §9a — the lineage, asserted against a REAL database ────────────
      //
      // This is the only database-backed exercise of the selection path, so it is where the
      // Stage 9 record is proved rather than mocked. Every claim below was false before Phase 6:
      // the transaction wrote `{ buyerId, offerId, status }` and nothing else.
      const won = deals[0];

      // §13-D41: new deals enter at DEALER_CONFIRMATION, not FINANCING_PENDING — a Deal created
      // straight into financing asserts a dealership confirmation that has not happened.
      assert.equal(won.status, "DEALER_CONFIRMATION", `round ${round}: Deal entry state`);

      assert.equal(won.auctionId, auction.id, `round ${round}: lineage — auction`);
      assert.equal(won.depositId, deposit.id, `round ${round}: lineage — deposit (the $99)`);
      assert.equal(won.dealerId, acceptedOffers[0].dealerId, `round ${round}: lineage — dealership`);
      assert.equal(won.vin, acceptedOffers[0].vin, `round ${round}: lineage — VIN`);
      assert.equal(
        won.otdCentsConfirmed, acceptedOffers[0].otdPriceCents,
        `round ${round}: lineage — out-the-door amount`,
      );

      // §9a's thirteenth lineage item, and §11.6 ruling 8's Phase 6 half. The composite FK
      // `deals.(id, current_plan_snapshot_id) -> plan_snapshots.(deal_id, id)` means a snapshot
      // pointed at by a Deal necessarily belongs to it — so this also proves the write ORDER.
      assert.ok(won.currentPlanSnapshotId, `round ${round}: no locked plan snapshot on the Deal`);
      const snapshot = await prisma.planSnapshot.findUnique({
        where: { id: won.currentPlanSnapshotId! },
      });
      assert.equal(snapshot?.dealId, won.id, `round ${round}: plan snapshot is not bound to this Deal`);
      assert.equal(snapshot?.touchpoint, "deal_created", `round ${round}: snapshot touchpoint`);

      // The transition INTO the first state — previously the only one with no history row.
      const history = await prisma.dealStatusHistory.findMany({ where: { dealId: won.id } });
      assert.equal(history.length, 1, `round ${round}: expected one creation history row`);
      assert.equal(history[0].toStatus, "DEALER_CONFIRMATION", `round ${round}: history target state`);

      // Selection IS this auction's post-close processing. Without the marker the close
      // reconciler claims the auction on its next tick and tells a buyer who has already
      // selected that their offers are ready.
      assert.ok(
        finalAuction?.postCloseProcessedAt,
        `round ${round}: postCloseProcessedAt not stamped — the close cron would re-process this auction`,
      );

      // §9: "Every non-selected candidate closes." DECLINED, not NOT_SELECTED — §8.1a keeps that
      // label WITHHELD and the D39 ruling did not change it.
      const declined = await prisma.offer.findMany({
        where: { auctionId: auction.id, status: "DECLINED" },
      });
      assert.equal(
        declined.length, OFFERS_PER_AUCTION - 1,
        `round ${round}: every losing offer must close, found ${declined.length}`,
      );
      const stillLive = await prisma.offer.findMany({
        where: { auctionId: auction.id, status: "SUBMITTED" },
      });
      assert.equal(stillLive.length, 0, `round ${round}: a losing offer outlived the selection`);
    }
    });
  },
);
