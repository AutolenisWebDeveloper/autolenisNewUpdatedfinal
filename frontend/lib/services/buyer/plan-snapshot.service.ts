// lib/services/buyer/plan-snapshot.service.ts
//
// STAGE 1 — "plan election recorded as a `plan_snapshots` row".
//
// §11.5 ruling 3 settles what this replaces: "`plan_snapshots` MISSING governs —
// no such table exists in the schema or in production. The payment row's 'table
// exists' reading was the Buyer `plan` FLAG, which is the thing being replaced."
// Phase 1 created the table; it has had zero writers since, and every plan
// question in the system still reads a single mutable boolean-ish column on
// `buyers`.
//
// WHY A SNAPSHOT AND NOT A FLAG. `Buyer.plan` answers "what plan are they on now"
// and destroys the answer to "what plan were they on when this happened". §23
// turns on the second question: the upgrade window opens at settlement and closes
// at funding clearance, a Premium balance can fail and revert the buyer to
// Standard, a downgrade after settlement is a manual refund review "against the
// record of service delivered" — and none of those can be adjudicated from a
// column that was overwritten. A snapshot per election, with the actor and the
// touchpoint that caused it, is that record.
//
// THE FLAG IS NOT REMOVED. `Buyer.plan` keeps working and keeps being written —
// every existing reader is untouched, and removing it is a later phase's job with
// its own capability map. This ADDS the history the flag cannot hold. Phase 3 owns
// the money (`settledDepositCents` / `settledPremiumCents` stay null here, because
// at Stage 1 nothing has settled), and Phase 6 owns the Deal-level snapshot
// (§11.6 ruling 8 splits `intake/R23` exactly that way).
//
// Run: pnpm test:buyer-plan

import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { BuyerPlan, PlanSnapshot, Prisma } from "@prisma/client";
import { logger } from "@/lib/logger";

type Db = typeof prisma | Prisma.TransactionClient;

/** Where the election happened. Free text, but stable per surface. */
export type PlanTouchpoint =
  | "signup"
  | "buyer_dashboard_upgrade"
  | "premium_upgrade_page"
  | "admin_override"
  | "checkout"
  /** Phase 3 — the $99 settling. §23.2a touchpoint 1, the receipt line. */
  | "settlement"
  /** Phase 3 — §23.3, a downgrade back to Standard. */
  | "downgrade";

export interface RecordPlanElectionInput {
  buyerId: string;
  plan: BuyerPlan;
  /** Where the election was made. */
  touchpoint: PlanTouchpoint;
  /** Who made it: a buyer id, an admin id, or "system". */
  actor: string;
  /** The request the election applies to, when one exists. */
  vehicleRequestId?: string | null;
  /** Why, when it is not simply "the buyer chose this". */
  reason?: string | null;
  /** Overrides "now", for backfills and tests. */
  effectiveAt?: Date;
}

/**
 * Record a plan election.
 *
 * Idempotent by VALUE rather than by key: re-electing the plan the buyer is
 * already on at the same touchpoint writes nothing, so a double-submitted form
 * does not produce two identical rows. A genuine CHANGE always writes, because the
 * point of the table is that every transition is recoverable.
 */
export async function recordPlanElection(input: RecordPlanElectionInput, db: Db = prisma): Promise<PlanSnapshot | null> {
  const latest = await db.planSnapshot.findFirst({
    where: { buyerId: input.buyerId },
    orderBy: { effectiveAt: "desc" },
  });

  // Deduped on the PLAN alone, not on (plan, touchpoint). A buyer who elects
  // PREMIUM at signup and then re-elects PREMIUM from the upgrade page has not
  // changed plan, and writing a second row would make `planHistory` show a
  // transition that never happened — which is the one thing this table exists to
  // get right.
  if (latest && latest.plan === input.plan) {
    return null;
  }

  const snapshot = await db.planSnapshot.create({
    data: {
      id: randomUUID(),
      buyerId: input.buyerId,
      vehicleRequestId: input.vehicleRequestId ?? null,
      plan: input.plan,
      effectiveAt: input.effectiveAt ?? new Date(),
      actor: input.actor,
      touchpoint: input.touchpoint,
      reason: input.reason ?? null,
      // Phase 3 owns settlement. At Stage 1 nothing has settled, and writing a
      // zero here would assert that it had.
      settledDepositCents: null,
      settledPremiumCents: null,
    },
  });

  logger.info("[plan-snapshot] election recorded", {
    buyerId: input.buyerId,
    plan: input.plan,
    touchpoint: input.touchpoint,
    from: latest?.plan ?? null,
  });
  return snapshot;
}

/** The plan in force at a moment. The question `Buyer.plan` cannot answer. */
export async function planInForceAt(buyerId: string, at: Date, db: Db = prisma): Promise<BuyerPlan | null> {
  const snapshot = await db.planSnapshot.findFirst({
    where: { buyerId, effectiveAt: { lte: at } },
    orderBy: { effectiveAt: "desc" },
    select: { plan: true },
  });
  return snapshot?.plan ?? null;
}

/** Every election for a buyer, oldest first. The audit trail §23.5 asks for. */
export async function planHistory(buyerId: string, db: Db = prisma): Promise<PlanSnapshot[]> {
  return db.planSnapshot.findMany({ where: { buyerId }, orderBy: { effectiveAt: "asc" } });
}


// ═════════════════════════════════════════════════════════════════════════════
// PHASE 3 — the same table, asked the questions §23 actually turns on.
//
// Everything above is Stage 1's BUYER-level election history. Phase 3 adds three
// things it deliberately left for here, and each is a §23 rule the buyer-level
// chain cannot express:
//
//   1. PER-REQUEST BINDING. §23.1: "Plan is elected per Vehicle Request, not held
//      permanently on the buyer. A new request means a new $99 and a fresh election.
//      The buyer record carries the current default; the Vehicle Request and the Deal
//      carry the binding snapshot." The buyer-level dedupe above would swallow the
//      fresh election on a second request, because the PLAN did not change — and it is
//      right to, at buyer level. At request level that same write is the whole point.
//   2. THE MONEY FIELDS. `settled_deposit_cents` and `settled_premium_cents` were
//      deliberately left null at Stage 1, because nothing had settled. Settlement is
//      this phase.
//   3. THE POINTERS. `vehicle_requests.current_plan_snapshot_id` and
//      `deals.current_plan_snapshot_id` had no writer, so the composite foreign keys
//      the Phase 1 wave provisioned — which make a request pointing at another
//      request's snapshot unrepresentable — were inert.
//
// AND THE SPLIT THAT MONEY-PATH DEFECT 2 IS ABOUT:
//
//   ELECTION    what the buyer chose. `electedPlanForRequest`.
//   ENTITLEMENT what they have paid for. `entitledPlanForRequest`.
//
// `buyers.plan` was written free from `user_metadata.plan` at signup and flipped free
// by the self-serve upgrade route, and then gated the deal at FEE_PENDING — so a buyer
// who elected Premium and never paid a balance read as Premium at a money gate. PAY-57
// rules it: "Premium entitlements begin at settlement, not at election." Two functions
// with two names is how that stops being a thing a reader can get wrong.
// ═════════════════════════════════════════════════════════════════════════════

import { depositNotOnHold } from "@/lib/payments/deposit-state";

export interface RecordRequestPlanElectionInput {
  buyerId: string;
  /** The request this election binds to. */
  vehicleRequestId: string;
  dealId?: string | null;
  plan: BuyerPlan;
  touchpoint: PlanTouchpoint;
  actor: string;
  reason?: string | null;
  /** What had ACTUALLY settled at this moment. Never a projection. */
  settledDepositCents?: number | null;
  settledPremiumCents?: number | null;
}

export interface RecordRequestPlanElectionResult {
  /** Null when the request's latest snapshot already carried this plan. */
  snapshot: PlanSnapshot | null;
  /** The snapshot now bound to the request — the new one, or the existing one. */
  boundSnapshotId: string | null;
}

/**
 * Record a plan election BOUND TO A REQUEST, and point the request at it.
 *
 * Deduped against the REQUEST's latest snapshot, not the buyer's. A buyer who paid for
 * one request and starts a second elects afresh (§23.1), and the buyer-level dedupe
 * would have discarded that election precisely because the plan was unchanged.
 *
 * The pointer is written even when the snapshot is deduped, because a request can hold
 * a snapshot with no pointer — every row written before Phase 3 does, since nothing
 * wrote `current_plan_snapshot_id` at all.
 *
 * APPEND-ONLY, and enforced below this code: the Phase 1 wave put a trigger on
 * `plan_snapshots` that raises on any UPDATE ("supersede % with a new version instead
 * of editing it"). Nothing here updates a snapshot; a correction is a new row.
 */
export async function recordRequestPlanElection(
  input: RecordRequestPlanElectionInput,
  db: Db = prisma,
): Promise<RecordRequestPlanElectionResult> {
  const latest = await db.planSnapshot.findFirst({
    where: { vehicleRequestId: input.vehicleRequestId },
    orderBy: { effectiveAt: "desc" },
    select: { id: true, plan: true },
  });

  if (latest && latest.plan === input.plan) {
    await bindSnapshot(input.vehicleRequestId, input.dealId ?? null, latest.id, db);
    return { snapshot: null, boundSnapshotId: latest.id };
  }

  const snapshot = await db.planSnapshot.create({
    data: {
      id: randomUUID(),
      buyerId: input.buyerId,
      vehicleRequestId: input.vehicleRequestId,
      dealId: input.dealId ?? null,
      plan: input.plan,
      effectiveAt: new Date(),
      actor: input.actor,
      touchpoint: input.touchpoint,
      reason: input.reason ?? null,
      settledDepositCents: input.settledDepositCents ?? null,
      settledPremiumCents: input.settledPremiumCents ?? null,
    },
  });

  await bindSnapshot(input.vehicleRequestId, input.dealId ?? null, snapshot.id, db);

  logger.info("[plan-snapshot] request election recorded", {
    vehicleRequestId: input.vehicleRequestId,
    plan: input.plan,
    touchpoint: input.touchpoint,
    from: latest?.plan ?? null,
  });
  return { snapshot, boundSnapshotId: snapshot.id };
}

/**
 * Point the request (and the deal, when there is one) at a snapshot.
 *
 * `updateMany` rather than `update` so a request that has since been deleted is a
 * no-op rather than a throw: binding a pointer is bookkeeping, and it must never fail
 * the settlement it rides with.
 */
async function bindSnapshot(
  vehicleRequestId: string,
  dealId: string | null,
  snapshotId: string,
  db: Db,
): Promise<void> {
  await db.vehicleRequest.updateMany({
    where: { id: vehicleRequestId },
    data: { currentPlanSnapshotId: snapshotId },
  });
  if (dealId) {
    await db.deal.updateMany({ where: { id: dealId }, data: { currentPlanSnapshotId: snapshotId } });
  }
}

export interface ElectedPlan {
  plan: BuyerPlan;
  snapshotId: string | null;
  /**
   * `snapshot` — a real election bound to this request.
   * `buyer_default` — no snapshot exists for it, so `buyers.plan` is being read as the
   *   DEFAULT §23.1 says it is. Every request that predates Phase 3 is in this state.
   *   Labelled rather than silent, so a caller deciding money can tell the difference
   *   between "they chose this" and "nobody has chosen yet".
   */
  source: "snapshot" | "buyer_default";
}

/** What the buyer ELECTED for this request. NOT what they are entitled to. */
export async function electedPlanForRequest(
  vehicleRequestId: string,
  db: Db = prisma,
): Promise<ElectedPlan> {
  const vr = await db.vehicleRequest.findUnique({
    where: { id: vehicleRequestId },
    select: { buyerId: true, currentPlanSnapshot: { select: { id: true, plan: true } } },
  });
  if (!vr) throw new Error(`electedPlanForRequest: vehicle request ${vehicleRequestId} not found`);

  if (vr.currentPlanSnapshot) {
    return { plan: vr.currentPlanSnapshot.plan, snapshotId: vr.currentPlanSnapshot.id, source: "snapshot" };
  }

  // No pointer. Fall back to the request's own latest snapshot before the buyer
  // default: a snapshot written before Phase 3 exists but was never bound.
  const orphan = await db.planSnapshot.findFirst({
    where: { vehicleRequestId },
    orderBy: { effectiveAt: "desc" },
    select: { id: true, plan: true },
  });
  if (orphan) return { plan: orphan.plan, snapshotId: orphan.id, source: "snapshot" };

  const buyer = await db.buyer.findUnique({ where: { id: vr.buyerId }, select: { plan: true } });
  return { plan: buyer?.plan ?? "STANDARD", snapshotId: null, source: "buyer_default" };
}

export interface EntitledPlan {
  /** What has been PAID for. */
  plan: BuyerPlan;
  /** What was chosen, when it differs — "elected Premium, balance unpaid". */
  elected: BuyerPlan;
  /** Cents of Premium balance actually settled. */
  settledPremiumCents: number;
  reason: string;
}

/**
 * What the buyer is ENTITLED to, which is what has been paid for.
 *
 * PAY-57: "Premium entitlements begin at settlement, not at election. A buyer who chose
 * Premium at registration and has not paid the balance is Standard until it settles, so
 * concierge service is never delivered unpaid."
 *
 * The authority is the LEDGER — a `service_fee_payments` row with `paid_at` set —
 * never `buyers.plan`, never the snapshot's plan, and never `deals.fee_paid_at` alone.
 * §23.5: "Fee reconciliation always computes from the ledger of settled payments,
 * never from the current plan flag."
 *
 * STANDARD IS NOT A LESSER ANSWER. §23.1: the $99 IS the Standard plan, paid in full.
 * A buyer who elected Premium and has not paid the balance is a fully paid Standard
 * buyer, not an unpaid Premium one, and §23.2 is explicit that the unpaid balance never
 * gates the transaction.
 *
 * REPORTED, NOT WORKED AROUND: `service_fee_payments` has no reversal or refund column,
 * so a REFUNDED $400 still reads as settled here. The §23.3 post-settlement downgrade is
 * a manual Finance review that produces a Stripe refund and, today, no ledger fact this
 * function could read. Inferring one from Stripe on every entitlement check would put a
 * provider round-trip on a hot path; inventing a column is a migration this phase does
 * not have. It is named here rather than silently mis-answered.
 */
export async function entitledPlanForRequest(
  vehicleRequestId: string,
  db: Db = prisma,
): Promise<EntitledPlan> {
  const elected = await electedPlanForRequest(vehicleRequestId, db);

  // `service_fee_payments` carries no relation to `deals` in the schema, so this is two
  // reads rather than a join. A request can carry more than one deal historically, so
  // the lookup is `in`, not a point read.
  const deals = await db.deal.findMany({ where: { vehicleRequestId }, select: { id: true } });
  const settled = deals.length
    ? await db.serviceFeePayment.findFirst({
        where: { dealId: { in: deals.map((d) => d.id) }, paidAt: { not: null } },
        select: { netAmountCents: true },
      })
    : null;

  if (!settled) {
    return {
      plan: "STANDARD",
      elected: elected.plan,
      settledPremiumCents: 0,
      reason:
        elected.plan === "PREMIUM"
          ? "Premium was elected but the balance has not settled — Standard until it does (§23.1, PAY-57)"
          : "Standard, elected and paid in full",
    };
  }

  return {
    plan: "PREMIUM",
    elected: elected.plan,
    settledPremiumCents: settled.netAmountCents,
    reason: "the Premium balance has settled",
  };
}

/**
 * Cents of $99 that have SETTLED for this request and are not refunded, disputed or on
 * hold. Zero is a real answer: it means there is no credit basis (PAY-61).
 *
 * `depositNotOnHold()` is the shared negation of the derived hold rule, defined once
 * beside the transition matrix, so this and the fulfilment gate cannot drift into two
 * readings of "undisputed".
 */
export async function settledDepositCentsForRequest(
  vehicleRequestId: string,
  db: Db = prisma,
): Promise<number> {
  const deposits = await db.deposit.findMany({
    where: { vehicleRequestId, status: "PAID", refundedAt: null, ...depositNotOnHold() },
    select: { amountCents: true },
  });
  if (deposits.length > 1) {
    // One settled $99 per request is the intent — PAY-11b, and the payment gate refuses
    // a second intent for a request that already has an obligation. More than one is a
    // real condition worth naming rather than silently summing into a larger credit.
    logger.warn(
      `[plan-snapshot] request ${vehicleRequestId} has ${deposits.length} settled deposits; ` +
        `summing them for the credit basis, but this should not happen`,
    );
  }
  return deposits.reduce((sum, d) => sum + d.amountCents, 0);
}
