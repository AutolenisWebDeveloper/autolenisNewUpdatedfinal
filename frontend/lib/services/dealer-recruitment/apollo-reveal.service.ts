// Block B / Apollo — gated reveal orchestration.
//
// Ties the credit ledger + reveal-cache/idempotency + adapter together:
//   cache → idempotency-claim → atomic WORST-CASE draw → adapter → refund the
//   unbilled remainder → store.
//
// THE DRAW IS THE WORST CASE, AND IT PRECEDES EVERY PAID CALL. Since the
// API-contract batch, stage 1 (organization resolution) bills a credit on a hit
// and stage 3 (people/match) bills one on a match, so an attempt is worth
// REVEAL_TOTAL_COST_CREDITS. All of it is drawn atomically BEFORE the adapter
// makes its first call; afterwards the adapter reports `creditsBilled` — what
// Apollo charged or may have charged — and exactly `drawn − creditsBilled` is
// refunded. That is the only arithmetic here. There is no path on which a paid
// call runs ahead of its draw, and none on which an unknowable charge is
// refunded.
//
// Guarantees:
//  - OFF until enabled: no key / APOLLO_REVEAL_ENABLED!=="true" → returns null
//    (tier stays capped/off until the live probe sets the cap + it's enabled).
//  - Never overspends: the draw is the atomic ledger draw (apollo-credit-ledger).
//  - Idempotent per rooftop+cycle: the ApolloReveal unique claim means a
//    concurrent/retried reveal cannot double-draw (only the INSERT winner draws).
//  - Reveal-cache: a fresh prior reveal for the rooftop is reused with no draw.
//  - Fail-closed: a miss records EMPTY and returns null; the waterfall falls
//    through to skip. Only what Apollo documents as free is refunded. Never
//    fabricates.
//  - Diagnosable: an EMPTY row records WHICH adapter stage produced it
//    (emptyStage) and what it cost (creditsCost = creditsBilled).

import { logger } from "@/lib/logger";
import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/prisma";
import {
  drawCredits,
  refundCredits,
  cycleKeyFor,
  daysInCycleFor,
  type CreditConsumer,
} from "./apollo-credit-ledger.service";
import {
  apolloResolveAndReveal,
  apolloEnabled,
  ORG_RESOLVE_COST_CREDITS,
  PEOPLE_MATCH_COST_CREDITS,
} from "./apollo.service";

export const REVEAL_FRESHNESS_DAYS = 90;

/** The people/match credit. Kept as the name the enrichment job mirrors. */
export const REVEAL_COST_CREDITS = PEOPLE_MATCH_COST_CREDITS;

/**
 * What one attempt can cost end to end: the organization resolution plus the
 * match. This is what a caller must have available for an attempt to be worth
 * starting, and what is drawn before the first call.
 */
export const REVEAL_TOTAL_COST_CREDITS = ORG_RESOLVE_COST_CREDITS + REVEAL_COST_CREDITS;

const FRESHNESS_MS = REVEAL_FRESHNESS_DAYS * 24 * 60 * 60 * 1000;

export interface RevealInput {
  rooftopId: string;
  name: string;
  website?: string | null;
  city?: string | null;
  state?: string | null;
  consumer?: CreditConsumer;
  /**
   * The sourcing case that authorised this spend (§5 no-spend-before-payment).
   *
   * WHY IT IS HERE AND NOT OPTIONAL-IN-SPIRIT: a `consumer: "live"` reveal is a paid
   * draw made on behalf of one buyer's request. Before Phase 5 nothing recorded WHICH
   * request, so a live credit could be spent with no auditable link to a settled
   * deposit — the credits left the ledger and the only record of why was a log line.
   * `resolveContactableEmail` now REFUSES the live paid tier without this id, and the
   * id is stamped on the claim row, so `apollo_reveals.sourcing_case_id` is the
   * standing proof that every live spend traces to a case whose deposit settled.
   *
   * `consumer: "backfill"` is the other, separate rail: it has no per-request caller
   * by design (it is an unattended gap-fill behind `backfillSpendEnabled()`), so it
   * carries no case id and none is demanded of it.
   */
  sourcingCaseId?: string | null;
}

export interface RevealResult {
  email: string;
  status: "VERIFIED";
  contactName: string | null;
  contactTitle: string | null;
}

export interface RevealDeps {
  prisma: PrismaClient;
  now: Date;
  enabled: () => boolean;
  resolveAndReveal: typeof apolloResolveAndReveal;
}

/** Clamp what the adapter reports to what was actually drawn — never refund below zero, never keep above the draw. */
function clampBilled(creditsBilled: number, drawn: number): number {
  if (!Number.isFinite(creditsBilled)) return drawn;
  return Math.max(0, Math.min(Math.floor(creditsBilled), drawn));
}

export async function revealRooftopContact(
  input: RevealInput,
  deps?: Partial<RevealDeps>,
): Promise<RevealResult | null> {
  const prisma = deps?.prisma ?? defaultPrisma;
  const now = deps?.now ?? new Date();
  const enabled = deps?.enabled ?? apolloEnabled;
  const resolveAndReveal = deps?.resolveAndReveal ?? apolloResolveAndReveal;

  if (!enabled()) return null; // tier off/capped until enabled + probe cap set

  const cycleKey = cycleKeyFor(now);
  const day = now.getUTCDate();
  const daysInCycle = daysInCycleFor(now);
  const consumer: CreditConsumer = input.consumer ?? "live";

  // 1. Reveal-cache — a fresh prior reveal for this rooftop → reuse, no draw.
  const cached = await prisma.apolloReveal.findFirst({
    where: { rooftopId: input.rooftopId, status: "REVEALED", email: { not: null } },
    orderBy: { revealedAt: "desc" },
  });
  if (cached?.email && now.getTime() - new Date(cached.revealedAt).getTime() <= FRESHNESS_MS) {
    return { email: cached.email, status: "VERIFIED", contactName: cached.contactName, contactTitle: cached.contactTitle };
  }

  // 2. Idempotency claim — unique(rooftopId, cycleKey). Only the INSERT winner
  // proceeds to draw; a concurrent/retried reveal cannot double-draw.
  let claimId: string;
  try {
    const claim = await prisma.apolloReveal.create({
      data: {
        rooftopId: input.rooftopId,
        cycleKey,
        consumer,
        status: "PENDING",
        creditsCost: 0,
        // Stamped on the CLAIM, not on the success path: the claim is the row that
        // exists for every attempt that could draw, including the ones that end EMPTY
        // or PENDING. Linking only successful reveals would leave drawn-but-empty
        // credits unattributed, which is precisely the spend hardest to account for.
        sourcingCaseId: input.sourcingCaseId ?? null,
      },
    });
    claimId = claim.id;
  } catch {
    const existing = await prisma.apolloReveal.findFirst({
      where: { rooftopId: input.rooftopId, cycleKey },
      orderBy: { revealedAt: "desc" },
    });
    if (existing?.status === "REVEALED" && existing.email) {
      return { email: existing.email, status: "VERIFIED", contactName: existing.contactName, contactTitle: existing.contactTitle };
    }
    return null; // another worker holds the claim (PENDING) or it came back EMPTY
  }

  // 3. Atomic WORST-CASE budget draw, before any paid call. Stage 1 bills on a
  // hit and stage 3 bills on a match, so the whole attempt is reserved up front;
  // what Apollo documents as free comes back in step 5. No budget → release the
  // claim, no reveal (fail closed).
  const drawn = REVEAL_TOTAL_COST_CREDITS;
  const draw = await drawCredits({ cycleKey, cost: drawn, consumer, day, daysInCycle }, { prisma });
  if (!draw.drawn) {
    // RELEASE the claim (do NOT mark EMPTY): we never actually queried Apollo —
    // the cap wasn't set yet (no_ledger) or budget was momentarily exhausted.
    // EMPTY is terminal-for-cycle and must be reserved for a genuine adapter miss;
    // deleting lets the rooftop re-claim once the cap is set / budget frees up.
    await prisma.apolloReveal.delete({ where: { id: claimId } }).catch(() => {});
    logger.info(`[apollo-reveal] no budget (${draw.reason}) for rooftop ${input.rooftopId} — claim released`);
    return null;
  }

  // 4. Adapter (stage 1 paid → stage 2 free → stage 3 paid). The outcome carries
  // creditsBilled: what Apollo charged or MAY have charged. Only the remainder of
  // the draw is refunded, so an unknowable is never refunded and the ledger
  // never undercounts real spend.
  let outcome: Awaited<ReturnType<typeof apolloResolveAndReveal>>;
  try {
    // rooftopId is passed for the adapter's funnel logs only — it is never sent
    // to Apollo and does not alter the request or its cost.
    outcome = await resolveAndReveal({
      rooftopId: input.rooftopId,
      name: input.name,
      website: input.website,
      city: input.city,
      state: input.state,
    });
  } catch (err) {
    // The adapter is fail-closed and shouldn't throw; if it does we can't know
    // which paid calls ran or billed, so assume all of them did (never
    // undercount). Recorded as match_error: the conservative reading, matching
    // the full charge.
    logger.warn(`[apollo-reveal] adapter threw for rooftop ${input.rooftopId}:`, err);
    outcome = { kind: "empty", creditsBilled: drawn, stage: "match_error" };
  }

  // 5. Settle: keep exactly what was billed, refund the rest of the draw.
  const billed = clampBilled(outcome.creditsBilled, drawn);
  const unbilled = drawn - billed;
  if (unbilled > 0) await refundCredits(cycleKey, unbilled, { prisma });

  if (outcome.kind === "empty") {
    logger.info(
      `[apollo-reveal] empty — rooftop=${input.rooftopId} stage=${outcome.stage} billed=${billed} refunded=${unbilled}`,
    );
    await prisma.apolloReveal
      .update({
        where: { id: claimId },
        data: {
          status: "EMPTY",
          creditsCost: billed,
          // WHICH stage produced the empty. Diagnostic; creditsCost above is
          // decided solely by what the adapter reported billed.
          emptyStage: outcome.stage,
        },
      })
      .catch(() => {});
    return null;
  }
  const revealed = outcome; // kind === "revealed"

  // 6. Store the reveal (reveal-cache) + return. If the store throws AFTER a
  // successful paid draw, KEEP the credits — Apollo already charged for this
  // reveal, so refunding would undercount real spend. We only RELEASE the claim
  // (delete) so the rooftop can re-resolve later; that re-resolve will draw +
  // charge again, and the ledger will count both — accurate. The paid data is
  // still returned to this caller.
  try {
    await prisma.apolloReveal.update({
      where: { id: claimId },
      data: {
        status: "REVEALED",
        email: revealed.email,
        emailStatus: "verified",
        contactName: revealed.name ?? null,
        contactTitle: revealed.title ?? null,
        creditsCost: billed,
        revealedAt: now,
      },
    });
  } catch (err) {
    logger.warn(`[apollo-reveal] store failed after paid draw for rooftop ${input.rooftopId} — keeping the credits (Apollo charged), releasing claim:`, err);
    await prisma.apolloReveal.delete({ where: { id: claimId } }).catch(() => {});
  }
  return { email: revealed.email, status: "VERIFIED", contactName: revealed.name ?? null, contactTitle: revealed.title ?? null };
}
