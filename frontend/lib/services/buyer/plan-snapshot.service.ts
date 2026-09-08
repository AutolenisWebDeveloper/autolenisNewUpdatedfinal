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
  | "checkout";

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

  if (latest && latest.plan === input.plan && latest.touchpoint === input.touchpoint) {
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
