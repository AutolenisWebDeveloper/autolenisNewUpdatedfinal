// §8b — REVISING A ROOFTOP-BOUND OFFER, AGAINST THE REAL PARTIAL UNIQUE INDEX.
//
// `offers_one_live_per_rooftop_candidate_key` is a partial unique over
// `(auction_id, rooftop_id, auction_vehicle_id) WHERE status = 'SUBMITTED'`
// (20261106000100_transaction_spine_foundation/migration.sql:1099-1101). Phase 6 finally writes all
// three columns, which is what makes §8b's "one live offer per rooftop per candidate" enforceable
// at the database rather than only in code — and it is also what made the index able to reject a
// statement order that had been safe while every value was NULL.
//
// THE DEFECT THIS PINS. `reviseOffer` inserted the superseding row and THEN withdrew the original.
// With both scope columns carried forward, the insert collides with the still-SUBMITTED original:
// 23505 → P2002 → the whole Serializable transaction rolls back → the dealer's revise endpoint
// answers "Failed to revise offer. Please try again." for every rooftop-bound offer on a candidate
// auction. That is the mainline, not an edge case.
//
// IT CANNOT BE CAUGHT BY A UNIT TEST, and that is why this file exists in `destructive/`. The unit
// fake in `offer-submission.test.ts` implements `offer.create` as `array.push`; an array has no
// index, so the suite passes with the defect fully present. Only a real PostgreSQL can fail it.
//
// Requires a REAL, DISPOSABLE Postgres (the `autolenis_e2e` allowlist in
// `lib/testing/isolated-database`). Run:
//   DATABASE_URL=postgresql://.../autolenis_e2e pnpm test:concurrency

import test from "node:test";
import assert from "node:assert/strict";

import {
  resolveDestructiveTarget,
  describeTarget,
  withTaggedRun,
  type CleanupClient,
} from "@/lib/testing/isolated-database";

const decision = resolveDestructiveTarget(process.env.DATABASE_URL);

test("the revision suite has an approved, positively identified database target", () => {
  assert.notEqual(decision.mode, "fail", decision.reason);
  if (decision.mode === "skip") {
    // eslint-disable-next-line no-console
    console.log(`# ${decision.reason}`);
  }
});

const skip =
  decision.mode === "run"
    ? false
    : decision.mode === "skip"
      ? decision.reason
      : "target refused — the enforcement test above has failed this run";

test("a rooftop-bound offer on a candidate can be revised", { skip }, async () => {
  const target = decision.mode === "run" ? decision.target : null;
  const { prisma } = await import("@/lib/prisma");
  // eslint-disable-next-line no-console
  console.log(`[revision-index] isolated target confirmed: ${describeTarget(target!)}`);
  const { reviseOffer } = await import("@/lib/services/offer/offer.service");

  await withTaggedRun(prisma as unknown as CleanupClient, async (runTag) => {
    const uniq = `${runTag}-revise`;

    const buyerUser = await prisma.user.create({
      data: { supabaseId: `${uniq}-buyer`, email: `${uniq}-buyer@test.local`, role: "BUYER" },
    });
    const buyer = await prisma.buyer.create({
      data: { userId: buyerUser.id, firstName: "Revise", lastName: "Buyer" },
    });
    const deposit = await prisma.deposit.create({
      data: { buyerId: buyer.id, amountCents: 9900, status: "PAID" },
    });
    const auction = await prisma.auction.create({
      data: {
        buyerId: buyer.id,
        depositId: deposit.id,
        status: "ACTIVE",
        endsAt: new Date(Date.now() + 24 * 3_600_000),
      },
    });
    const candidate = await prisma.auctionVehicle.create({
      data: { auctionId: auction.id, year: 2023, make: "Honda", model: "Accord", candidateStatus: "ACTIVE" },
    });
    const rooftop = await prisma.dealerRooftop.create({
      data: { displayName: `${uniq} Rooftop`, nameKey: `${uniq}-rooftop`, city: "Austin", state: "TX", zip: "78701" },
    });
    const dealerUser = await prisma.user.create({
      data: { supabaseId: `${uniq}-dealer`, email: `${uniq}-dealer@test.local`, role: "DEALER" },
    });
    const dealer = await prisma.dealer.create({
      data: { userId: dealerUser.id, dealershipName: "Revise Motors" },
    });

    const original = await prisma.offer.create({
      data: {
        auctionId: auction.id,
        dealerId: dealer.id,
        status: "SUBMITTED",
        version: 1,
        otdPriceCents: 3_000_000,
        vehiclePriceCents: 2_800_000,
        taxCents: 150_000,
        feesCents: 50_000,
        junkFeeItems: [],
        // The three columns the index is over. All written from Phase 6 onward.
        rooftopId: rooftop.id,
        auctionVehicleId: candidate.id,
        submittedAt: new Date(),
        expiresAt: new Date(Date.now() + 96 * 3_600_000),
      },
    });

    // THE ASSERTION. With the insert before the withdraw this rejects with P2002 and the dealer
    // can never lower their price.
    const revised = await reviseOffer(original.id, dealer.id, {
      otdPriceCents: 2_900_000,
      vehiclePriceCents: 2_700_000,
      taxCents: 150_000,
      feesCents: 50_000,
    });

    assert.equal(revised.version, 2);
    assert.equal(revised.otdPriceCents, 2_900_000);
    // The scope columns survive, or §8b's cap stops binding and the index goes inert again.
    assert.equal(revised.rooftopId, rooftop.id, "the revision lost its rooftop — the cap no longer binds");
    assert.equal(revised.auctionVehicleId, candidate.id, "the revision lost its candidate binding");

    // Exactly ONE live offer for this (auction, rooftop, candidate) — which is the index's whole
    // point, and the reason the withdraw has to come first rather than merely eventually.
    const live = await prisma.offer.findMany({
      where: { auctionId: auction.id, rooftopId: rooftop.id, auctionVehicleId: candidate.id, status: "SUBMITTED" },
    });
    assert.equal(live.length, 1, "the rooftop holds two live offers on one vehicle");
    assert.equal(live[0].id, revised.id);

    const superseded = await prisma.offer.findUnique({ where: { id: original.id } });
    assert.equal(superseded!.status, "WITHDRAWN", "the superseded version must be retained, not deleted (§29)");

    // ── A SECOND revision, because the cap is about LIVE offers and the first revision is now the
    // live one. This is where an implementation that withdrew by id rather than by the live row
    // would come apart.
    const again = await reviseOffer(revised.id, dealer.id, {
      otdPriceCents: 2_850_000,
      vehiclePriceCents: 2_650_000,
      taxCents: 150_000,
      feesCents: 50_000,
    }).catch((e: Error) => e);
    // MAX_OFFER_REVISIONS caps the chain, so either a third version exists or the refusal is the
    // documented cap — never a unique-violation.
    if (again instanceof Error) {
      assert.match(again.message, /Max revisions reached/, `unexpected revise failure: ${again.message}`);
    } else {
      assert.equal(again.version, 3);
    }
  });
});
