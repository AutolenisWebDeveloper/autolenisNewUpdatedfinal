// §28.3 #4 — THE STATUS CHANGE AND ITS AUDIT ROW COMMIT TOGETHER, OR NEITHER DOES.
//
// ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
//
// Phase 10 moved the CAS `updateMany` and the `DealStatusHistory.create` into one
// `prisma.$transaction`. Before that the history write ran on the bare client, after the
// swap, ending `.catch(() => {})` — so a failed history write left the deal MOVED and the
// move UNRECORDED, silently. For a cancellation that is §24's "full history preserved"
// quietly not happening.
//
// The unit tests mock `$transaction` by handing the callback the same client, which
// proves the CALL SHAPE and cannot prove ROLLBACK. Their comments said the rollback proof
// "lives in `advance-deal-status-atomicity.test.ts`" — AND THAT FILE DID NOT EXIST. The
// first independent review found the citation pointing at nothing, which made the phase's
// headline atomicity guarantee a claim with no executable evidence behind it.
//
// This is that evidence, against a real PostgreSQL. Atomicity is a property of the
// database; asserting it against a fake that cannot roll back asserts nothing.
//
// ── HOW THE FAILURE IS FORCED ───────────────────────────────────────────────
//
// `deal_status_history.deal_id` has a foreign key to `deals`. Writing a history row for a
// deal id that does not exist violates it and aborts the transaction — a REAL database
// error raised by the database, not a stubbed throw. The deal is created, then deleted
// out from under the seam between its read and its write, which is exactly the shape the
// swallowed `.catch` used to hide.
//
// Needs DATABASE_URL on an isolated database; SKIPS with a reason otherwise.

import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";

const DB = process.env.DATABASE_URL ?? "";
const HAS_DB = DB.length > 0 && !DB.includes("aieybibvewmvrubcpthm");
const prisma = HAS_DB ? new PrismaClient() : (null as unknown as PrismaClient);

test.beforeAll(() => {
  if (DB.includes("aieybibvewmvrubcpthm")) {
    throw new Error("REFUSED: DATABASE_URL resolves to the PRODUCTION Supabase project.");
  }
});
test.afterAll(async () => {
  if (HAS_DB) await prisma.$disconnect();
});

test("§28.3 #4: a failed history write rolls the status change back", async () => {
  test.skip(!HAS_DB, "needs DATABASE_URL pointed at an isolated database");
  const id = randomUUID().slice(0, 8);

  // The same transaction shape `advanceDealStatus` uses: guarded update, then the audit
  // row, in one interactive transaction. Exercised directly rather than through the seam
  // because the seam reads the deal first and would refuse a deal that no longer exists —
  // and the property under test is the TRANSACTION, not the seam's preconditions.
  const user = await prisma.user.create({
    data: { id: `u_at_${id}`, supabaseId: `sb_at_${id}`, email: `at_${id}@example.invalid`, role: "BUYER" },
  });
  const buyer = await prisma.buyer.create({
    data: { id: `b_at_${id}`, userId: user.id, firstName: "Atom", lastName: "Icity" },
  });
  const request = await prisma.vehicleRequest.create({ data: { id: `vr_at_${id}`, buyerId: buyer.id } });
  const deposit = await prisma.deposit.create({
    data: { id: `dep_at_${id}`, buyerId: buyer.id, amountCents: 9_900, vehicleRequestId: request.id, status: "PAID" },
  });
  const auction = await prisma.auction.create({
    data: { id: `au_at_${id}`, buyerId: buyer.id, depositId: deposit.id, vehicleRequestId: request.id },
  });
  const dealerUser = await prisma.user.create({
    data: { id: `du_at_${id}`, supabaseId: `sbd_at_${id}`, email: `d_${id}@dealer.invalid`, role: "DEALER" },
  });
  const dealer = await prisma.dealer.create({
    data: { id: `dl_at_${id}`, userId: dealerUser.id, dealershipName: "Atomic Motors" },
  });
  const offer = await prisma.offer.create({
    data: { id: `of_at_${id}`, auctionId: auction.id, dealerId: dealer.id, otdPriceCents: 1_000_000, vehiclePriceCents: 900_000 },
  });
  const deal = await prisma.deal.create({
    data: {
      id: `d_at_${id}`, buyerId: buyer.id, offerId: offer.id, vehicleRequestId: request.id,
      depositId: deposit.id, auctionId: auction.id, status: "CONTRACT_PENDING",
    },
  });

  // ── The control: the same transaction SUCCEEDS and writes both halves ──────
  await prisma.$transaction(async (tx) => {
    const res = await tx.deal.updateMany({
      where: { id: deal.id, status: "CONTRACT_PENDING" },
      data: { status: "CONTRACT_REVIEW" },
    });
    expect(res.count).toBe(1);
    await tx.dealStatusHistory.create({
      data: { dealId: deal.id, fromStatus: "CONTRACT_PENDING", toStatus: "CONTRACT_REVIEW", reason: "control" },
    });
  });
  expect((await prisma.deal.findUniqueOrThrow({ where: { id: deal.id } })).status).toBe("CONTRACT_REVIEW");
  expect(await prisma.dealStatusHistory.count({ where: { dealId: deal.id } })).toBe(1);

  // ── The proof: the history write FAILS, and the status change must not survive ──
  //
  // A foreign-key violation on an id that does not exist. The database raises it, so the
  // abort is real rather than simulated.
  const before = await prisma.deal.findUniqueOrThrow({ where: { id: deal.id } });
  await expect(
    prisma.$transaction(async (tx) => {
      const res = await tx.deal.updateMany({
        where: { id: deal.id, status: "CONTRACT_REVIEW" },
        data: { status: "CONTRACT_APPROVED" },
      });
      expect(res.count).toBe(1);
      // This is the write that fails.
      await tx.dealStatusHistory.create({
        data: {
          dealId: `d_at_${id}_does_not_exist`,
          fromStatus: "CONTRACT_REVIEW",
          toStatus: "CONTRACT_APPROVED",
          reason: "forced failure",
        },
      });
    }),
  ).rejects.toThrow();

  const after = await prisma.deal.findUniqueOrThrow({ where: { id: deal.id } });
  expect(
    after.status,
    "the status change MUST roll back when its audit row cannot be written — a transition nobody " +
      "can account for is worse than a transition that did not happen (§28.3 #4)",
  ).toBe(before.status);
  expect(
    await prisma.dealStatusHistory.count({ where: { dealId: deal.id } }),
    "and no partial history row survives",
  ).toBe(1);
});
