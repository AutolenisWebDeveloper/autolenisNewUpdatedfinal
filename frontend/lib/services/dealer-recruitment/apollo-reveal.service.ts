// Block B / Apollo — gated reveal orchestration.
//
// Ties the credit ledger + reveal-cache/idempotency + adapter together:
<<<<<<< HEAD
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
=======
//   cache → idempotency-claim → atomic budget draw → adapter reveal → store.
>>>>>>> 92c9fdf4 (Phase 1 (§13-D2): record that the cancel path does not exist, and carry the admin cancel action into Phase 2)
//
// Guarantees:
//  - OFF until enabled: no key / APOLLO_REVEAL_ENABLED!=="true" → returns null
//    (tier stays capped/off until the live probe sets the cap + it's enabled).
//  - Never overspends: the draw is the atomic ledger draw (apollo-credit-ledger).
//  - Idempotent per rooftop+cycle: the ApolloReveal unique claim means a
//    concurrent/retried reveal cannot double-draw (only the INSERT winner draws).
//  - Reveal-cache: a fresh prior reveal for the rooftop is reused with no draw.
<<<<<<< HEAD
//  - Fail-closed: a miss records EMPTY and returns null; the waterfall falls
//    through to skip. Only what Apollo documents as free is refunded. Never
//    fabricates.
//  - Diagnosable: an EMPTY row records WHICH adapter stage produced it
//    (emptyStage) and what it cost (creditsCost = creditsBilled).
=======
//  - Fail-closed: a missing hit / adapter error refunds the credit + records EMPTY
//    and returns null; the waterfall falls through to skip. Never fabricates.
//  - Diagnosable: an EMPTY row records WHICH adapter stage produced it
//    (emptyStage), so a cycle of empties can be told apart from a cycle that
//    never resolved an organization. Diagnostic only — it changes nothing about
//    what is drawn, refunded, or asked of Apollo.
>>>>>>> 92c9fdf4 (Phase 1 (§13-D2): record that the cancel path does not exist, and carry the admin cancel action into Phase 2)

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
<<<<<<< HEAD
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

=======
import { apolloResolveAndReveal, apolloEnabled } from "./apollo.service";

export const REVEAL_FRESHNESS_DAYS = 90;
export const REVEAL_COST_CREDITS = 1;
>>>>>>> 92c9fdf4 (Phase 1 (§13-D2): record that the cancel path does not exist, and carry the admin cancel action into Phase 2)
const FRESHNESS_MS = REVEAL_FRESHNESS_DAYS * 24 * 60 * 60 * 1000;

export interface RevealInput {
  rooftopId: string;
  name: string;
  website?: string | null;
  city?: string | null;
  state?: string | null;
  consumer?: CreditConsumer;
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

<<<<<<< HEAD
/** Clamp what the adapter reports to what was actually drawn — never refund below zero, never keep above the draw. */
function clampBilled(creditsBilled: number, drawn: number): number {
  if (!Number.isFinite(creditsBilled)) return drawn;
  return Math.max(0, Math.min(Math.floor(creditsBilled), drawn));
}

=======
>>>>>>> 92c9fdf4 (Phase 1 (§13-D2): record that the cancel path does not exist, and carry the admin cancel action into Phase 2)
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
      data: { rooftopId: input.rooftopId, cycleKey, consumer, status: "PENDING", creditsCost: 0 },
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

<<<<<<< HEAD
  // 3. Atomic WORST-CASE budget draw, before any paid call. Stage 1 bills on a
  // hit and stage 3 bills on a match, so the whole attempt is reserved up front;
  // what Apollo documents as free comes back in step 5. No budget → release the
  // claim, no reveal (fail closed).
  const drawn = REVEAL_TOTAL_COST_CREDITS;
  const draw = await drawCredits({ cycleKey, cost: drawn, consumer, day, daysInCycle }, { prisma });
=======
  // 3. Atomic budget draw. No budget → EMPTY, no reveal (fail closed).
  const draw = await drawCredits({ cycleKey, cost: REVEAL_COST_CREDITS, consumer, day, daysInCycle }, { prisma });
>>>>>>> 92c9fdf4 (Phase 1 (§13-D2): record that the cancel path does not exist, and carry the admin cancel action into Phase 2)
  if (!draw.drawn) {
    // RELEASE the claim (do NOT mark EMPTY): we never actually queried Apollo —
    // the cap wasn't set yet (no_ledger) or budget was momentarily exhausted.
    // EMPTY is terminal-for-cycle and must be reserved for a genuine adapter miss;
    // deleting lets the rooftop re-claim once the cap is set / budget frees up.
    await prisma.apolloReveal.delete({ where: { id: claimId } }).catch(() => {});
    logger.info(`[apollo-reveal] no budget (${draw.reason}) for rooftop ${input.rooftopId} — claim released`);
    return null;
  }

<<<<<<< HEAD
  // 4. Adapter (stage 1 paid → stage 2 free → stage 3 paid). The outcome carries
  // creditsBilled: what Apollo charged or MAY have charged. Only the remainder of
  // the draw is refunded, so an unknowable is never refunded and the ledger
  // never undercounts real spend.
  let outcome: Awaited<ReturnType<typeof apolloResolveAndReveal>>;
  try {
    // rooftopId is passed for the adapter's funnel logs only — it is never sent
    // to Apollo and does not alter the request or its cost.
=======
  // 4. Adapter reveal (the paid call already paid for by the draw). The outcome
  // carries whether Apollo was BILLED: refund ONLY a genuinely free no-op
  // (billed:false). A matched-but-emailless reveal (billed:true) keeps the credit —
  // Apollo charges for the match, so refunding it would let the ledger undercount
  // real spend and overspend the cap.
  let outcome: Awaited<ReturnType<typeof apolloResolveAndReveal>>;
  try {
    // rooftopId is passed for the adapter's free-stage funnel logs only — it is
    // never sent to Apollo and does not alter the request or its cost.
>>>>>>> 92c9fdf4 (Phase 1 (§13-D2): record that the cancel path does not exist, and carry the admin cancel action into Phase 2)
    outcome = await resolveAndReveal({
      rooftopId: input.rooftopId,
      name: input.name,
      website: input.website,
      city: input.city,
      state: input.state,
    });
  } catch (err) {
    // The adapter is fail-closed and shouldn't throw; if it does we can't know
<<<<<<< HEAD
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
=======
    // whether the paid call billed, so assume it did (never undercount). The
    // stage is recorded as match_error for the same reason: an unknown failure
    // past the free stages is treated as the paid stage, which is the
    // conservative reading and the one that matches billed:true.
    logger.warn(`[apollo-reveal] adapter threw for rooftop ${input.rooftopId}:`, err);
    outcome = { kind: "empty", billed: true, stage: "match_error" };
  }
  if (outcome.kind === "empty") {
    if (!outcome.billed) await refundCredits(cycleKey, REVEAL_COST_CREDITS, { prisma });
    logger.info(
      `[apollo-reveal] empty — rooftop=${input.rooftopId} stage=${outcome.stage} billed=${outcome.billed}`,
>>>>>>> 92c9fdf4 (Phase 1 (§13-D2): record that the cancel path does not exist, and carry the admin cancel action into Phase 2)
    );
    await prisma.apolloReveal
      .update({
        where: { id: claimId },
        data: {
          status: "EMPTY",
<<<<<<< HEAD
          creditsCost: billed,
          // WHICH stage produced the empty. Diagnostic; creditsCost above is
          // decided solely by what the adapter reported billed.
=======
          creditsCost: outcome.billed ? REVEAL_COST_CREDITS : 0,
          // WHICH stage produced the empty. Diagnostic; creditsCost above is
          // still decided solely by `billed` and is untouched by this field.
>>>>>>> 92c9fdf4 (Phase 1 (§13-D2): record that the cancel path does not exist, and carry the admin cancel action into Phase 2)
          emptyStage: outcome.stage,
        },
      })
      .catch(() => {});
    return null;
  }
  const revealed = outcome; // kind === "revealed"

<<<<<<< HEAD
  // 6. Store the reveal (reveal-cache) + return. If the store throws AFTER a
  // successful paid draw, KEEP the credits — Apollo already charged for this
  // reveal, so refunding would undercount real spend. We only RELEASE the claim
  // (delete) so the rooftop can re-resolve later; that re-resolve will draw +
  // charge again, and the ledger will count both — accurate. The paid data is
  // still returned to this caller.
=======
  // 5. Store the reveal (reveal-cache) + return. If the store throws AFTER a
  // successful paid draw, KEEP the credit — Apollo already charged for this reveal,
  // so refunding it would undercount real spend (the same invariant fix #3 enforces
  // everywhere else). We only RELEASE the claim (delete) so the rooftop can
  // re-resolve later; that re-resolve will draw + charge again, and the ledger will
  // count both — accurate. The paid data is still returned to this caller.
>>>>>>> 92c9fdf4 (Phase 1 (§13-D2): record that the cancel path does not exist, and carry the admin cancel action into Phase 2)
  try {
    await prisma.apolloReveal.update({
      where: { id: claimId },
      data: {
        status: "REVEALED",
        email: revealed.email,
        emailStatus: "verified",
        contactName: revealed.name ?? null,
        contactTitle: revealed.title ?? null,
<<<<<<< HEAD
        creditsCost: billed,
=======
        creditsCost: REVEAL_COST_CREDITS,
>>>>>>> 92c9fdf4 (Phase 1 (§13-D2): record that the cancel path does not exist, and carry the admin cancel action into Phase 2)
        revealedAt: now,
      },
    });
  } catch (err) {
<<<<<<< HEAD
    logger.warn(`[apollo-reveal] store failed after paid draw for rooftop ${input.rooftopId} — keeping the credits (Apollo charged), releasing claim:`, err);
=======
    logger.warn(`[apollo-reveal] store failed after paid draw for rooftop ${input.rooftopId} — keeping the credit (Apollo charged), releasing claim:`, err);
>>>>>>> 92c9fdf4 (Phase 1 (§13-D2): record that the cancel path does not exist, and carry the admin cancel action into Phase 2)
    await prisma.apolloReveal.delete({ where: { id: claimId } }).catch(() => {});
  }
  return { email: revealed.email, status: "VERIFIED", contactName: revealed.name ?? null, contactTitle: revealed.title ?? null };
}
