// lib/ai/context-builder.ts — System 16 ENH
// Proactive context injection at every conversation start
// Reads current platform state and builds a rich system context for all agents
// Groq API ONLY — no other LLM providers

import { prisma } from "@/lib/prisma";
import { AUCTION_DURATION_HOURS, DEPOSIT_AMOUNT_CENTS, PREMIUM_FEE_CENTS } from "@/lib/constants";

export interface PlatformContext {
  role: "BUYER" | "DEALER" | "ADMIN" | "PUBLIC";
  userId?: string;
  entityId?: string; // buyerId, dealerId, or adminId
  journeyStage?: string;
  activeDeal?: { id: string; status: string; otdCents: number };
  activeAuction?: { id: string; status: string; endsAt?: Date; offerCount: number };
  prequal?: { approved: boolean; tier?: string | null; maxOtdCents?: number };
  dealerTier?: string;
  adminRole?: string;
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

export async function buildDealerContext(dealerId: string): Promise<PlatformContext> {
  const dealer = await prisma.dealer.findUnique({ where: { id: dealerId } });
  return {
    role: "DEALER",
    entityId: dealerId,
    dealerTier: dealer?.tier ?? "STANDARD",
  };
}

export async function buildAdminContext(adminId: string, role: string): Promise<PlatformContext> {
  return { role: "ADMIN", entityId: adminId, adminRole: role };
}

// Build the system prompt with full context injection
export function buildSystemPromptFromContext(ctx: PlatformContext, agentRole: string): string {
  const platformInfo = `AutoLenis Platform:
- $${DEPOSIT_AMOUNT_CENTS / 100} Auction Access Fee (refundable if no valuable offer) → ${AUCTION_DURATION_HOURS}h private auction → select deal → $${PREMIUM_FEE_CENTS / 100} Premium concierge fee (only the $${DEPOSIT_AMOUNT_CENTS / 100} is credited toward it if Premium is purchased)
- Contract Shield reviews every document before signing
- DocuSign e-signing — no paperwork at dealership`;

  if (ctx.role === "BUYER") {
    const budgetStr = ctx.prequal?.maxOtdCents ? `$${(ctx.prequal.maxOtdCents / 100).toLocaleString()}` : "not yet determined (prequal needed)";
    const auctionStr = ctx.activeAuction ? `Active auction — ${ctx.activeAuction.offerCount} offers, closes ${ctx.activeAuction.endsAt?.toLocaleDateString() ?? "soon"}` : "No active auction";
    const dealStr = ctx.activeDeal ? `Active deal — Stage: ${ctx.activeDeal.status}, OTD: $${(ctx.activeDeal.otdCents / 100).toLocaleString()}` : "No active deal";

    return `${agentRole}

CURRENT BUYER STATE (injected at session start — proactively reference this):
- Journey stage: ${ctx.journeyStage ?? "unknown"}
- Pre-qual budget ceiling: ${budgetStr} (READ-ONLY — never suggest this can be changed)
- Pre-qual tier: ${ctx.prequal?.tier ?? "not completed"}
- Auction: ${auctionStr}
- Deal: ${dealStr}

${platformInfo}

RULES:
- Reference buyer's actual stage and data proactively
- Never reveal dealer identities during active auction
- Never suggest budget ceiling can be changed — it is immutable from iPredict
- Keep responses under 3 sentences unless complex question warrants more
- Always end with a clear next action`;
  }

  if (ctx.role === "DEALER") {
    return `${agentRole}

DEALER CONTEXT:
- Dealer tier: ${ctx.dealerTier}
- Single DEALER role — full platform access

${platformInfo}

You help dealers understand AutoLenis auction mechanics, offer strategy, and scorecard improvement. Be professional and data-driven.`;
  }

  if (ctx.role === "ADMIN") {
    return `${agentRole}

ADMIN CONTEXT: Role = ${ctx.adminRole}
${platformInfo}

You are the AutoLenis operations intelligence agent. Help with platform analytics, deal oversight, and exception management. Be concise and precise.`;
  }

  return `${agentRole}\n${platformInfo}`;
}
