// Block B / Apollo — gated reveal orchestration.
//
// Ties the credit ledger + reveal-cache/idempotency + adapter together:
//   cache → idempotency-claim → atomic budget draw → adapter reveal → store.
//
// Guarantees:
//  - OFF until enabled: no key / APOLLO_REVEAL_ENABLED!=="true" → returns null
//    (tier stays capped/off until the live probe sets the cap + it's enabled).
//  - Never overspends: the draw is the atomic ledger draw (apollo-credit-ledger).
//  - Idempotent per rooftop+cycle: the ApolloReveal unique claim means a
//    concurrent/retried reveal cannot double-draw (only the INSERT winner draws).
//  - Reveal-cache: a fresh prior reveal for the rooftop is reused with no draw.
//  - Fail-closed: a missing hit / adapter error refunds the credit + records EMPTY
//    and returns null; the waterfall falls through to skip. Never fabricates.

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
import { apolloResolveAndReveal, apolloEnabled } from "./apollo.service";

export const REVEAL_FRESHNESS_DAYS = 90;
export const REVEAL_COST_CREDITS = 1;
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

  // 3. Atomic budget draw. No budget → EMPTY, no reveal (fail closed).
  const draw = await drawCredits({ cycleKey, cost: REVEAL_COST_CREDITS, consumer, day, daysInCycle }, { prisma });
  if (!draw.drawn) {
    // RELEASE the claim (do NOT mark EMPTY): we never actually queried Apollo —
    // the cap wasn't set yet (no_ledger) or budget was momentarily exhausted.
    // EMPTY is terminal-for-cycle and must be reserved for a genuine adapter miss;
    // deleting lets the rooftop re-claim once the cap is set / budget frees up.
    await prisma.apolloReveal.delete({ where: { id: claimId } }).catch(() => {});
    logger.info(`[apollo-reveal] no budget (${draw.reason}) for rooftop ${input.rooftopId} — claim released`);
    return null;
  }

  // 4. Adapter reveal (the paid call already paid for by the draw). The outcome
  // carries whether Apollo was BILLED: refund ONLY a genuinely free no-op
  // (billed:false). A matched-but-emailless reveal (billed:true) keeps the credit —
  // Apollo charges for the match, so refunding it would let the ledger undercount
  // real spend and overspend the cap.
  let outcome: Awaited<ReturnType<typeof apolloResolveAndReveal>>;
  try {
    outcome = await resolveAndReveal({ name: input.name, website: input.website, city: input.city, state: input.state });
  } catch (err) {
    // The adapter is fail-closed and shouldn't throw; if it does we can't know
    // whether the paid call billed, so assume it did (never undercount).
    logger.warn(`[apollo-reveal] adapter threw for rooftop ${input.rooftopId}:`, err);
    outcome = { kind: "empty", billed: true };
  }
  if (outcome.kind === "empty") {
    if (!outcome.billed) await refundCredits(cycleKey, REVEAL_COST_CREDITS, { prisma });
    await prisma.apolloReveal
      .update({ where: { id: claimId }, data: { status: "EMPTY", creditsCost: outcome.billed ? REVEAL_COST_CREDITS : 0 } })
      .catch(() => {});
    return null;
  }
  const revealed = outcome; // kind === "revealed"

  // 5. Store the reveal (reveal-cache) + return. If the store throws AFTER a
  // successful paid draw, refund + release the claim so the credit isn't lost and
  // the rooftop isn't blocked — but still return the paid data to this caller
  // (it was already paid for; a future reveal will re-resolve cleanly).
  try {
    await prisma.apolloReveal.update({
      where: { id: claimId },
      data: {
        status: "REVEALED",
        email: revealed.email,
        emailStatus: "verified",
        contactName: revealed.name ?? null,
        contactTitle: revealed.title ?? null,
        creditsCost: REVEAL_COST_CREDITS,
        revealedAt: now,
      },
    });
  } catch (err) {
    logger.warn(`[apollo-reveal] store failed after paid draw for rooftop ${input.rooftopId} — refunding + releasing:`, err);
    await refundCredits(cycleKey, REVEAL_COST_CREDITS, { prisma });
    await prisma.apolloReveal.delete({ where: { id: claimId } }).catch(() => {});
  }
  return { email: revealed.email, status: "VERIFIED", contactName: revealed.name ?? null, contactTitle: revealed.title ?? null };
}
