// lib/ai/context-builder.ts — the ONE shared context abstraction.
//
// Adopted and extended (Phase 2 §1.3a). Three extensions over the dormant
// original:
//   • an AFFILIATE role, which did not exist;
//   • a DEALER context richer than the single `tier` field it returned, because
//     the live dealer agent already read more than that and adopting the thin
//     version would have been a regression;
//   • a `location` dimension (surface / pageLabel / entityRef).
//
// ONE FIELD IS REMOVED FROM THE PROMPT PROJECTION (Phase 2 §8.5 #10):
// `prequal.tier`. It is an iPredict internal and the prequal persona explicitly
// forbids exposing iPredict specifics. The buyer's own approved ceiling STAYS,
// with its READ-ONLY framing — it is the buyer's own data and is already shown
// to them in the portal. The tier is still carried on `PlatformContext` for
// server-side use; it simply never reaches a model.
//
// Everything here is built from a SERVER-RESOLVED id. Nothing in this file
// accepts an identity, a role, or an entity reference from a request body.

import { prisma } from "@/lib/prisma";
import { AUCTION_DURATION_HOURS, DEPOSIT_AMOUNT_CENTS, PREMIUM_FEE_CENTS } from "@/lib/constants";

export type ZuraSurface =
  | "public-web"
  | "voice"
  | "buyer"
  | "dealer"
  | "affiliate"
  | "admin";

export interface PlatformContext {
  role: "BUYER" | "DEALER" | "ADMIN" | "AFFILIATE" | "PUBLIC";
  userId?: string;
  entityId?: string; // buyerId, dealerId, affiliateId, or adminId
  displayName?: string; // given name only — never a full name, never an email
  journeyStage?: string;
  activeDeal?: { id: string; status: string; otdCents: number };
  activeAuction?: { id: string; status: string; endsAt?: Date; offerCount: number };
  /**
   * `tier` is SERVER-SIDE ONLY. `buildSystemPromptFromContext` never prints it —
   * see the header note and Phase 2 §8.5 #10.
   */
  prequal?: { approved: boolean; tier?: string | null; maxOtdCents?: number };
  dealer?: {
    dealershipName: string;
    tier: string;
    inventoryCount: number;
    openInvitationCount: number;
    pendingOfferCount: number;
  };
  affiliate?: { status: string; commissionCount: number };
  adminRole?: string;
}

/** The untrusted half of the context — cosmetic only. See §4.4. */
export interface ZuraLocation {
  /** SERVER-derived from the route the request arrived on. Never from a body. */
  surface: ZuraSurface;
  /** Client-supplied. Used only to pick suggestions and render a header line. */
  pageLabel?: string;
  /** Client-supplied. NEVER a query parameter — it may narrow, never widen. */
  entityRef?: { type: string; id: string };
}

// Build buyer context from current DB state
export async function buildBuyerContext(buyerId: string): Promise<PlatformContext> {
  const buyer = await prisma.buyer.findUnique({
    where: { id: buyerId },
    include: {
      preQualification: true,
      auctions: { where: { status: "ACTIVE" }, take: 1, orderBy: { createdAt: "desc" }, include: { _count: { select: { offers: true } } } },
      deals: { where: { status: { notIn: ["COMPLETED", "CANCELLED", "REFUNDED"] } }, take: 1, orderBy: { createdAt: "desc" }, include: { offer: { select: { otdPriceCents: true } } } },
    },
  });

  if (!buyer) return { role: "BUYER" };

  const activeAuction = buyer.auctions[0];
  const activeDeal = buyer.deals[0];

  const journeyStage = activeDeal ? "deal-active"
    : activeAuction ? "auction-active"
    : buyer.preQualification?.expiresAt && buyer.preQualification.expiresAt > new Date() ? "searching"
    : buyer.onboardingComplete ? "prequal-needed"
    : "onboarding";

  return {
    role: "BUYER",
    userId: buyer.userId,
    entityId: buyerId,
    displayName: buyer.firstName ?? undefined,
    journeyStage,
    prequal: buyer.preQualification ? {
      approved: buyer.preQualification.decision === "APPROVED",
      tier: buyer.preQualification.tier,
      maxOtdCents: buyer.preQualification.maxOtdAmountCents,
    } : undefined,
    activeAuction: activeAuction ? {
      id: activeAuction.id,
      status: activeAuction.status,
      endsAt: activeAuction.endsAt ?? undefined,
      offerCount: activeAuction._count.offers,
    } : undefined,
    activeDeal: activeDeal ? {
      id: activeDeal.id,
      status: activeDeal.status,
      otdCents: activeDeal.offer?.otdPriceCents ?? 0,
    } : undefined,
  };
}

/**
 * Dealer context, extended from the original single-`tier` version.
 *
 * `openInvitationCount` counts OPEN invitations rather than the all-time
 * `_count.invitations` the live agent used — that count grows forever and was
 * shown to dealers as "auction invitations", which read as a current workload.
 * (Phase 1 §A.2 recorded this as a defect; correcting it here is why the richer
 * context is an extension rather than a copy.)
 */
export async function buildDealerContext(dealerId: string): Promise<PlatformContext> {
  const [dealer, openInvitationCount, pendingOfferCount] = await Promise.all([
    prisma.dealer.findUnique({
      where: { id: dealerId },
      select: { dealershipName: true, tier: true, _count: { select: { inventory: true } } },
    }),
    prisma.auctionInvitation.count({
      where: { dealerId, auction: { status: "ACTIVE" } },
    }),
    prisma.offer.count({ where: { dealerId, status: "SUBMITTED" } }),
  ]);

  if (!dealer) {
    return {
      role: "DEALER",
      entityId: dealerId,
      dealer: {
        dealershipName: "Your dealership",
        tier: "STANDARD",
        inventoryCount: 0,
        openInvitationCount: 0,
        pendingOfferCount: 0,
      },
    };
  }

  return {
    role: "DEALER",
    entityId: dealerId,
    displayName: dealer.dealershipName ?? undefined,
    dealer: {
      dealershipName: dealer.dealershipName ?? "Your dealership",
      tier: dealer.tier ?? "STANDARD",
      inventoryCount: dealer._count.inventory,
      openInvitationCount,
      pendingOfferCount,
    },
  };
}

/**
 * Affiliate context — new; the original had no AFFILIATE branch at all.
 *
 * A missing affiliate DEGRADES rather than throwing. The live affiliate agent
 * threw on a missing row (Phase 1 §A.4), which turned a stale session into a
 * 500 instead of a conversation. Nothing here needs the row to exist.
 *
 * The affiliate's EMAIL is deliberately not read: it went into the system prompt
 * before, and it is PII with no functional need (Phase 2 §8.5 #9).
 */
export async function buildAffiliateContext(affiliateId: string): Promise<PlatformContext> {
  const affiliate = await prisma.affiliate.findUnique({
    where: { id: affiliateId },
    select: { status: true, _count: { select: { commissions: true } } },
  });

  return {
    role: "AFFILIATE",
    entityId: affiliateId,
    affiliate: affiliate
      ? { status: affiliate.status, commissionCount: affiliate._count.commissions }
      : { status: "UNKNOWN", commissionCount: 0 },
  };
}

/** Admin context — platform-wide aggregates. No PII, by construction. */
export async function buildAdminContext(adminId: string, role: string): Promise<PlatformContext> {
  return { role: "ADMIN", entityId: adminId, adminRole: role };
}

/** Public context — anonymous. There is no entity to read and none is read. */
export async function buildPublicContext(): Promise<PlatformContext> {
  return { role: "PUBLIC" };
}

const PLATFORM_INFO = `AutoLenis Platform:
- $${DEPOSIT_AMOUNT_CENTS / 100} deposit → ${AUCTION_DURATION_HOURS}h private auction → select deal → $${PREMIUM_FEE_CENTS / 100} flat concierge fee
- Contract Shield reviews every document before signing
- secure in-app e-signing — no paperwork at dealership`;

/**
 * The prompt PROJECTION — a deliberate narrowing, not a serialisation.
 *
 * Hard rule: no record is ever dumped into a prompt. Everything below is a fixed
 * set of scalar fields. There is no path here that serialises a Prisma row, a
 * JSON blob, or a query result into prompt text.
 */
export function buildSystemPromptFromContext(ctx: PlatformContext, agentRole: string): string {
  const platformInfo = PLATFORM_INFO;

  if (ctx.role === "BUYER") {
    const budgetStr = ctx.prequal?.maxOtdCents ? `$${(ctx.prequal.maxOtdCents / 100).toLocaleString()}` : "not yet determined (prequal needed)";
    const auctionStr = ctx.activeAuction ? `Active auction — ${ctx.activeAuction.offerCount} offers, closes ${ctx.activeAuction.endsAt?.toLocaleDateString() ?? "soon"}` : "No active auction";
    const dealStr = ctx.activeDeal ? `Active deal — Stage: ${ctx.activeDeal.status}, OTD: $${(ctx.activeDeal.otdCents / 100).toLocaleString()}` : "No active deal";

    // NOTE: no `Pre-qual tier` line. It was here, and it is gone on purpose —
    // the tier is an iPredict internal (Phase 2 §8.5 #10).
    return `${agentRole}

CURRENT BUYER STATE (injected at session start — proactively reference this):
- Journey stage: ${ctx.journeyStage ?? "unknown"}
- Pre-qual budget ceiling: ${budgetStr} (READ-ONLY — never suggest this can be changed)
- Auction: ${auctionStr}
- Deal: ${dealStr}

${platformInfo}

RULES:
- Reference buyer's actual stage and data proactively
- Never reveal dealer identities during active auction
- Never suggest budget ceiling can be changed — it is immutable
- Never access or share any other buyer's information
- Keep responses under 3 sentences unless complex question warrants more
- Always end with a clear next action`;
  }

  if (ctx.role === "DEALER") {
    const d = ctx.dealer;
    return `${agentRole}

DEALER CONTEXT:
- Dealership: ${d?.dealershipName ?? "Your dealership"}
- Dealer tier: ${d?.tier ?? "STANDARD"}
- Inventory listed: ${d?.inventoryCount ?? 0} vehicles
- Open auction invitations: ${d?.openInvitationCount ?? 0}
- Offers awaiting a buyer decision: ${d?.pendingOfferCount ?? 0}

${platformInfo}

You help dealers understand AutoLenis auction mechanics, offer strategy, and scorecard improvement. Be professional and data-driven.`;
  }

  if (ctx.role === "AFFILIATE") {
    return `${agentRole}

AFFILIATE CONTEXT:
- Status: ${ctx.affiliate?.status ?? "UNKNOWN"}
- Commissions earned: ${ctx.affiliate?.commissionCount ?? 0} total

${platformInfo}`;
  }

  if (ctx.role === "ADMIN") {
    return `${agentRole}

ADMIN CONTEXT: Role = ${ctx.adminRole}
${platformInfo}

You are the AutoLenis operations intelligence agent. Help with platform analytics, deal oversight, and exception management. Be concise and precise.`;
  }

  return `${agentRole}\n${platformInfo}`;
}
