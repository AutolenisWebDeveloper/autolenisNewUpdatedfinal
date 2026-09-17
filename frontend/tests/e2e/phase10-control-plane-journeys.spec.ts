// Phase 10 — the §24 / §26 / §28.3 control plane, end to end.
//
//   1. §24: a cancellation BEFORE execution cancels, and stops everything it names
//   2. §24: a cancellation AFTER execution routes to FROZEN_PENDING_RELEASE and opens a case
//   3. §28.3 #1: a forced transition cannot cross a terminal state, or the actor matrix
//   4. §8.1 row 10: one exception, rendered from ONE lineage to buyer, dealer and Ops
//
// SCOPE AND HONESTY NOTE, in the style this suite already uses.
//
// These specs assert DATABASE STATE, not pixels. They need DATABASE_URL pointed at an isolated
// database and they SKIP with an explicit reason when it is absent, rather than passing
// vacuously — a green run that checked nothing is worse than a skipped one that says so.
//
// THE PRODUCTION REFERENCE IS A POSITIVE REFUSAL, not a skip, for the reason Phase 9 states: "the
// DSN did not look like production" is not the same claim as "the DSN is not production". This
// suite writes fixtures, cancels transactions and FREEZES deals, and a freeze blocks release —
// a fixture written into the wrong database would hold a real vehicle on a real lot.
//
// THE HONEST LIMITS, stated because they bound what these journeys prove.
//
//   1. Production holds ZERO deals, so every assertion runs against FIXTURES. That proves the
//      surfaces work as built. It does not prove a real buyer's cancellation of a real purchase.
//
//   2. THE BROWSER HALF IS NOT HERE. The buyer exception panel and the dealer notice are React
//      Server Components behind buyer/dealer authentication, and this environment has no
//      Supabase auth stack to mint a session against. The LINEAGE those surfaces render is
//      asserted directly instead (spec 4), which proves the three audiences receive identical
//      facts — it does NOT prove the markup. Narrow-viewport rendering and the visual half are
//      therefore NOT VERIFIED by this suite and must not be reported as though they were.

import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
// STATIC imports, for the reason phases 5-9 record: Playwright applies the `@/*` paths at build
// time, and a runtime `await import("@/…")` escapes that transform.
import { canTransition, advanceDealStatus, ContractExecutedError, TerminalDealError } from "@/lib/services/deal/deal.service";
import { cancelTransaction } from "@/lib/services/transaction/cancellation.service";
import { exceptionLineage } from "@/lib/services/operations/exception-lineage.service";
import { TransitionActorError } from "@/lib/services/deal/transition-authority";

const DB = process.env.DATABASE_URL ?? "";
const HAS_DB = DB.length > 0 && !DB.includes("aieybibvewmvrubcpthm");
const prisma = HAS_DB ? new PrismaClient() : (null as unknown as PrismaClient);

test.beforeAll(() => {
  if (DB.includes("aieybibvewmvrubcpthm")) {
    throw new Error(
      "REFUSED: DATABASE_URL resolves to the PRODUCTION Supabase project. This suite cancels " +
        "transactions and FREEZES deals, and a freeze blocks a real vehicle's release.",
    );
  }
});

test.afterAll(async () => {
  if (HAS_DB) await prisma.$disconnect();
});

/**
 * A deal with the whole lineage behind it, at `status`, optionally with the dealership's
 * executed contract on file — which is §24's execution boundary and the only fact that
 * decides which half of it applies.
 */
async function seedDeal(opts: { status: string; executed: boolean }) {
  const id = randomUUID().slice(0, 8);
  const now = new Date();

  const user = await prisma.user.create({
    data: { id: `u_p10_${id}`, supabaseId: `sb_p10_${id}`, email: `p10_${id}@example.invalid`, role: "BUYER" },
  });
  const buyer = await prisma.buyer.create({
    data: { id: `b_p10_${id}`, userId: user.id, firstName: "Phase", lastName: "Ten" },
  });
  const dealerUser = await prisma.user.create({
    data: { id: `du_p10_${id}`, supabaseId: `sbd_p10_${id}`, email: `sales_${id}@dealer.invalid`, role: "DEALER" },
  });
  const dealer = await prisma.dealer.create({
    data: { id: `dl_p10_${id}`, userId: dealerUser.id, dealershipName: "Riverside Motors" },
  });
  const request = await prisma.vehicleRequest.create({
    data: { id: `vr_p10_${id}`, buyerId: buyer.id, status: "ACTIVE_SOURCING" },
  });
  const deposit = await prisma.deposit.create({
    data: { id: `dep_p10_${id}`, buyerId: buyer.id, amountCents: 9_900, vehicleRequestId: request.id, status: "PAID" },
  });
  const auction = await prisma.auction.create({
    data: {
      id: `au_p10_${id}`, buyerId: buyer.id, depositId: deposit.id,
      vehicleRequestId: request.id, status: "ACTIVE",
    },
  });
  const offer = await prisma.offer.create({
    data: { id: `of_p10_${id}`, auctionId: auction.id, dealerId: dealer.id, otdPriceCents: 3_245_000, vehiclePriceCents: 2_950_000 },
  });
  await prisma.auctionInvitation.create({
    data: { id: `ai_p10_${id}`, auctionId: auction.id, dealerId: dealer.id, status: "SENT" },
  });

  const deal = await prisma.deal.create({
    data: {
      id: `d_p10_${id}`, buyerId: buyer.id, offerId: offer.id, vehicleRequestId: request.id,
      depositId: deposit.id, auctionId: auction.id, dealerId: dealer.id,
      status: opts.status as never, insuranceStatus: "VERIFIED",
    },
  });

  // Two outbox rows: one PENDING (must be cancelled) and one SENT (must not be touched).
  // Without the sent row the "never unsend" rule would be untested, and without the
  // pending row the cancel stop could report success against an empty set.
  await prisma.commsOutbox.create({
    data: {
      channel: "email",
      dedupKey: `p10-pending-${id}`,
      status: "pending",
      templateKey: "recap_ready",
      dealId: deal.id,
      payload: { email: `p10_${id}@example.invalid` },
    },
  });
  await prisma.commsOutbox.create({
    data: {
      channel: "email",
      dedupKey: `p10-sent-${id}`,
      status: "sent",
      templateKey: "recap_ready",
      dealId: deal.id,
      payload: { email: `p10_${id}@example.invalid` },
    },
  });

  if (opts.executed) {
    const contract = await prisma.contractVersion.create({
      data: {
        id: `cv_p10_${id}`, dealId: deal.id, documentUrl: `https://example.invalid/${id}.pdf`,
        uploadedBy: dealer.id, status: "APPROVED", approvedAt: now, version: 1,
      },
    });
    await prisma.deal.update({ where: { id: deal.id }, data: { dealerExecutedContractId: contract.id } });
  }

  return { deal, buyer, dealer, auction, request, id };
}

// ── 1. §24 before execution ─────────────────────────────────────────────────

test("§24: a cancellation before execution cancels, and stops the auction and its invitations", async () => {
  test.skip(!HAS_DB, "needs DATABASE_URL pointed at an isolated database");
  const f = await seedDeal({ status: "CONTRACT_PENDING", executed: false });

  const res = await cancelTransaction({
    dealId: f.deal.id,
    reason: "Buyer changed their mind before the contract was executed",
    actorId: "admin_p10",
    actorRole: "ADMIN",
  });

  expect(res.outcome).toBe("CANCELLED");
  // §24: "the current stage recorded" — captured BEFORE anything moved.
  expect(res.stageAtCancellation).toContain("CONTRACT_PENDING");

  const deal = await prisma.deal.findUniqueOrThrow({ where: { id: f.deal.id } });
  expect(deal.status).toBe("CANCELLED");
  expect(deal.frozenAt).toBeNull();

  // §24: "auction activity closed" and "affected dealerships notified".
  const auction = await prisma.auction.findUniqueOrThrow({ where: { id: f.auction.id } });
  expect(auction.status).toBe("CANCELLED");
  const invitations = await prisma.auctionInvitation.findMany({ where: { auctionId: f.auction.id } });
  expect(invitations.every((i) => i.status === "CANCELLED")).toBe(true);

  // §24: "a required reason" and "full history preserved", in the same transaction as the swap.
  const history = await prisma.dealStatusHistory.findMany({ where: { dealId: f.deal.id, toStatus: "CANCELLED" } });
  expect(history).toHaveLength(1);
  expect(history[0]!.reason).toContain("changed their mind");
  expect(history[0]!.actorRole).toBe("ADMIN");

  // The request is cancelled WITH a reason — the buyer route recorded none before this phase.
  const request = await prisma.vehicleRequest.findUniqueOrThrow({ where: { id: f.request.id } });
  expect(request.status).toBe("CANCELLED");
  expect(request.cancelReason).toContain("changed their mind");

  // EVERY STOP EXCEPT ONE SUCCEEDED, AND THE ONE IS A HARNESS ARTIFACT — the same shape
  // Phase 9's header documents for the completion event.
  //
  // `ESIGN_ENVELOPES` reaches `buyer-signing.service`, and it fails to LOAD under two
  // different harnesses for two different reasons — both of them module resolution, and
  // neither of them a production failure:
  //
  //   · under `tsx`: that service imports `contract-shield/extract-text`, which imports
  //     `server-only`, and that module throws outside a Next server build by design;
  //   · under Playwright: the stop imports it at RUNTIME so the whole module can be
  //     loaded by the Node test runner at all, and a runtime `await import("@/…")`
  //     escapes Playwright's build-time `@/*` mapping — the same transform gap phases
  //     5-9 record in their own headers for `deal-completion-event.service`.
  //
  // So the assertion names both shapes rather than one, and asserts the CLASS: the stop
  // failed to load its module. A test that pinned a single message would go red the next
  // time the harness changed and read as a defect.
  //
  // WHAT THE FAILURE PROVED, USEFULLY AND BY ACCIDENT: the orchestration carries a failed
  // stop rather than swallowing it, every other stop still ran, and §28.3 #8's
  // "every failure has an owner and a return path" fired for real. That is the behaviour
  // this phase exists to add, exercised by an actual failure rather than a simulated one.
  const esign = res.stops.find((s) => s.stop === "ESIGN_ENVELOPES");
  expect(
    /Server Component|Cannot find module/.test(esign?.error ?? ""),
    `expected a module-loading artifact, got: ${esign?.error ?? "(the stop unexpectedly succeeded)"}`,
  ).toBe(true);
  expect(
    res.stops.filter((s) => s.stop !== "ESIGN_ENVELOPES").every((s) => s.ok),
    "every stop that can run in this harness must succeed",
  ).toBe(true);

  // §24 "close scheduled work" — ASSERTED NON-ZERO AGAINST A SEEDED ROW.
  //
  // The first version of this stop built cancel keys (`deal:<id>`) that match none of
  // the six real key builders, so it cancelled nothing and reported ok. `affected: 0` is
  // a legitimate outcome when there is nothing queued, which is exactly what made the
  // failure invisible — so the fixture queues a row and the assertion is that it moved.
  const cancelledRows = await prisma.commsOutbox.findMany({
    where: { dealId: f.deal.id, status: "cancelled" },
  });
  expect(
    cancelledRows.length,
    "the pending outbox row for this deal must be cancelled — a cancelled buyer must not keep receiving reminders",
  ).toBeGreaterThan(0);
  const commsStop = res.stops.find((s) => s.stop === "SCHEDULED_COMMS");
  expect(commsStop?.affected ?? 0).toBeGreaterThan(0);

  // And a SENT row is untouched: a message that has left cannot be unsent.
  const sent = await prisma.commsOutbox.findFirst({ where: { dealId: f.deal.id, status: "sent" } });
  expect(sent, "a sent message must keep its delivery record").toBeTruthy();

  // §28.3 #8 — the failed stop opened a case naming the subsystem, rather than vanishing.
  expect(res.exceptionCode).toBe("CANCELLATION_CLEANUP_INCOMPLETE");
  const cleanup = await prisma.queueItem.findFirst({
    where: { dealId: f.deal.id, exceptionCode: "CANCELLATION_CLEANUP_INCOMPLETE" },
  });
  expect(cleanup, "a stop that did not complete must leave an Operations case").toBeTruthy();
  expect(cleanup!.requiredAction ?? "").toContain("ESIGN_ENVELOPES");
});

// ── 2. §24 after execution — THE boundary ───────────────────────────────────

test("§24: a cancellation AFTER execution freezes instead, and opens the coordination case", async () => {
  test.skip(!HAS_DB, "needs DATABASE_URL pointed at an isolated database");
  const f = await seedDeal({ status: "PICKUP_SCHEDULED", executed: true });

  const res = await cancelTransaction({
    dealId: f.deal.id,
    reason: "Buyer asked to unwind after the dealership executed",
    actorId: "admin_p10",
    actorRole: "ADMIN",
  });

  // NOT cancelled. §24: "AutoLenis cannot unilaterally void it."
  expect(res.outcome).toBe("FROZEN_PENDING_RELEASE");

  const deal = await prisma.deal.findUniqueOrThrow({ where: { id: f.deal.id } });
  expect(deal.status).toBe("FROZEN_PENDING_RELEASE");
  // The freeze is WRITTEN, which is what makes it bite: pickup-readiness and
  // completion-preconditions both read `frozenAt` as a blocking gate.
  expect(deal.frozenAt).not.toBeNull();
  expect(deal.frozenReason).toContain("unwind");

  // §24's coordination has an owner, a deadline and a return point — a queue_items row.
  expect(res.exceptionCode).toBe("DEAL_FROZEN_PENDING_RELEASE");
  const cases = await prisma.queueItem.findMany({
    where: { dealId: f.deal.id, exceptionCode: "DEAL_FROZEN_PENDING_RELEASE" },
  });
  expect(cases).toHaveLength(1);
  expect(cases[0]!.ownerRole).toBe("OPERATIONS");
  expect(cases[0]!.deadlineAt).not.toBeNull();

  // The request is NOT cancelled: the transaction has not ended.
  const request = await prisma.vehicleRequest.findUniqueOrThrow({ where: { id: f.request.id } });
  expect(request.status).not.toBe("CANCELLED");

  // AND THE UNWIND COMPLETES — the freeze is a gate, not a wall.
  //
  // The first independent review found this was a DEAD END: the fact check refused
  // CANCELLED whenever `dealerExecutedContractId` was set, which is true of every frozen
  // deal by construction, so `REFUNDED` worked and `CANCELLED` never did — while the
  // catalogue's required action says "complete the unwind (CANCELLED/REFUNDED)".
  //
  // §24 forbids AutoLenis voiding an executed contract UNILATERALLY. A deal that reached
  // the freeze has been through the coordinated release, which is the opposite.
  const unwound = await advanceDealStatus(f.deal.id, "CANCELLED" as never, {
    actorRole: "ADMIN",
    reason: "Documented release obtained from the buyer and the dealership",
  });
  expect(unwound, "a frozen deal must be able to complete its unwind").toBe(true);
  const after = await prisma.deal.findUniqueOrThrow({ where: { id: f.deal.id } });
  expect(after.status).toBe("CANCELLED");
});

test("§24: an EXECUTED deal that is not yet frozen refuses a direct cancellation", async () => {
  test.skip(!HAS_DB, "needs DATABASE_URL pointed at an isolated database");
  // The boundary itself, asserted on the state it actually guards — before the freeze,
  // not after it. `force` does not open it: §24 is a statement that a second party has
  // signed, which is a FACT, and force overrides ordering only.
  const f = await seedDeal({ status: "PICKUP_SCHEDULED", executed: true });
  await expect(
    advanceDealStatus(f.deal.id, "CANCELLED" as never, {
      actorRole: "ADMIN",
      reason: "try to void it anyway",
      force: true,
    }),
  ).rejects.toThrow(ContractExecutedError);
  const unmoved = await prisma.deal.findUniqueOrThrow({ where: { id: f.deal.id } });
  expect(unmoved.status).toBe("PICKUP_SCHEDULED");
});

// ── 3. §28.3 #1 — force is not a way round the rules that are not about ordering ──

test("§28.3: a forced transition cannot cross a terminal state, nor the actor matrix", async () => {
  test.skip(!HAS_DB, "needs DATABASE_URL pointed at an isolated database");

  // A terminal deal. §Stage 20: "Completed is terminal. Corrections are append-only."
  const done = await seedDeal({ status: "COMPLETED", executed: true });
  await expect(
    advanceDealStatus(done.deal.id, "PICKUP_SCHEDULED" as never, {
      actorRole: "ADMIN",
      reason: "reopen it",
      force: true,
    }),
  ).rejects.toThrow(TerminalDealError);

  // And the actor matrix, which `force` also does not open. §Stage 19: "the Deal never
  // completes automatically on the dealer's word alone."
  const handover = await seedDeal({ status: "HANDOVER_PENDING", executed: true });
  await expect(
    advanceDealStatus(handover.deal.id, "COMPLETED" as never, {
      actorRole: "DEALER",
      reason: "we handed over the keys",
      force: true,
    }),
  ).rejects.toThrow(TransitionActorError);

  const unmoved = await prisma.deal.findUniqueOrThrow({ where: { id: handover.deal.id } });
  expect(unmoved.status).toBe("HANDOVER_PENDING");

  // The pure half of the boundary, with no database at all.
  expect(canTransition("PICKUP_SCHEDULED" as never, "CANCELLED" as never)).toBe(false);
  expect(canTransition("PICKUP_SCHEDULED" as never, "FROZEN_PENDING_RELEASE" as never)).toBe(true);
});

// ── 4. §8.1 row 10 — ONE lineage, three audiences ───────────────────────────

test("§8.1 row 10: one exception reaches buyer, dealer and Ops with identical facts", async () => {
  test.skip(!HAS_DB, "needs DATABASE_URL pointed at an isolated database");
  const f = await seedDeal({ status: "PICKUP_SCHEDULED", executed: true });

  await cancelTransaction({
    dealId: f.deal.id,
    reason: "Coordinated unwind requested",
    actorId: "admin_p10",
    actorRole: "ADMIN",
  });

  const buyerView = await exceptionLineage({ audience: "BUYER", buyerId: f.buyer.id });
  const dealerView = await exceptionLineage({ audience: "DEALER", dealId: f.deal.id });
  const opsView = await exceptionLineage({ audience: "OPS", dealId: f.deal.id });

  const b = buyerView.find((x) => x.exceptionCode === "DEAL_FROZEN_PENDING_RELEASE");
  const d = dealerView.find((x) => x.exceptionCode === "DEAL_FROZEN_PENDING_RELEASE");
  const o = opsView.find((x) => x.exceptionCode === "DEAL_FROZEN_PENDING_RELEASE");
  expect(b, "the buyer must be told their purchase is on hold").toBeTruthy();
  expect(d, "the dealership must be told not to release the vehicle").toBeTruthy();
  expect(o, "Operations must have the case").toBeTruthy();

  // THE FACTS ARE ONE. If these differ, two parties believe different things about the
  // same transaction — which is the failure this lineage exists to make impossible.
  expect(b!.checkpoint).toBe(o!.checkpoint);
  expect(d!.checkpoint).toBe(o!.checkpoint);
  expect(b!.deadlineAt).toBe(o!.deadlineAt);
  expect(d!.deadlineAt).toBe(o!.deadlineAt);
  expect(b!.owner).toBe(o!.owner);

  // What differs is only what each party is told to do about it.
  expect(b!.recovery).not.toBe(d!.recovery);
  expect(b!.recovery.toLowerCase()).toContain("hold");
  expect(d!.recovery.toLowerCase()).toContain("release");

  // §25.1 — the dealership sees THIS row because it is about them. A buyer-owned
  // exception on the same deal must not reach them.
  const { raiseException } = await import("@/lib/services/operations/queue-item.service");
  await raiseException({
    code: "PAYMENT_FAILURE",
    dealId: f.deal.id,
    buyerId: f.buyer.id,
    detail: "fixture — a buyer-owned exception on the same deal",
  });
  const dealerAfter = await exceptionLineage({ audience: "DEALER", dealId: f.deal.id });
  expect(
    dealerAfter.some((x) => x.exceptionCode === "PAYMENT_FAILURE"),
    "a dealership must never be told the buyer's payment failed",
  ).toBe(false);
  const opsAfter = await exceptionLineage({ audience: "OPS", dealId: f.deal.id });
  expect(opsAfter.some((x) => x.exceptionCode === "PAYMENT_FAILURE")).toBe(true);
});
