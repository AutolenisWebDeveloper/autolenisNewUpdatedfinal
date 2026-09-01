// lib/services/ai/action-intent/commands.ts
//
// The command registry: the ONLY place an ActionIntent touches a canonical
// business service. A command runs strictly AFTER catalog validation, actor +
// role authorization, deterministic policy, human approval (where required),
// and activation. Commands do NOT re-implement business logic — they invoke the
// existing authoritative services (which keep their own idempotency, CAS,
// transactions, audit, and comms). Everything is lazy-imported so the pure core
// and its tests never pull the whole service graph.

import type { CommandFn, CommandResult } from "./types";

const ok = (data?: Record<string, unknown>): CommandResult => ({ ok: true, data });
const fail = (failureReason: string): CommandResult => ({ ok: false, failureReason });

export const COMMANDS: Record<string, CommandFn> = {
  // ── BUYER ──────────────────────────────────────────────────────────────────
  "buyer.get_journey_status": async ({ actor }) => {
    const { prisma } = await import("@/lib/prisma");
    const buyer = await prisma.buyer.findUnique({
      where: { id: actor.actorId },
      select: {
        firstName: true,
        preQualification: { select: { tier: true, decision: true } },
        auctions: { where: { status: "ACTIVE" }, take: 1, orderBy: { createdAt: "desc" }, select: { id: true, status: true } },
        deals: { take: 1, orderBy: { createdAt: "desc" }, select: { id: true, status: true } },
      },
    });
    if (!buyer) return fail("Buyer not found.");
    return ok({
      prequalTier: buyer.preQualification?.tier ?? null,
      activeAuctionStatus: buyer.auctions[0]?.status ?? null,
      activeDealStatus: buyer.deals[0]?.status ?? null,
    });
  },

  "buyer.create_vehicle_request": async ({ actor, params }) => {
    const { createVehicleRequest } = await import("@/lib/services/vehicle-request/vehicle-request.service");
    const req = await createVehicleRequest(actor.actorId, {
      makePreference: params.makePreference as string | undefined,
      modelPreference: params.modelPreference as string | undefined,
      yearMin: params.yearMin as number | undefined,
      yearMax: params.yearMax as number | undefined,
      maxBudgetCents: params.maxBudgetCents as number | undefined,
      notes: params.notes as string | undefined,
    });
    return ok({ vehicleRequestId: (req as { id: string }).id, status: (req as { status: string }).status });
  },

  "buyer.select_offer": async ({ actor, params }) => {
    const { commitOfferSelection } = await import("@/lib/services/deal/select-offer.service");
    const result = await commitOfferSelection({
      buyerId: actor.actorId,
      auctionId: String(params.auctionId),
      offerId: String(params.offerId),
    });
    return ok({ dealId: result.dealId });
  },

  // ── DEALER ─────────────────────────────────────────────────────────────────
  "dealer.get_auction_invitations": async ({ actor }) => {
    const { prisma } = await import("@/lib/prisma");
    const [openInvites, pendingOffers] = await Promise.all([
      prisma.auctionInvitation.count({ where: { dealerId: actor.actorId, respondedAt: null } }),
      prisma.offer.count({ where: { dealerId: actor.actorId, status: "SUBMITTED" } }),
    ]);
    return ok({ openInvitations: openInvites, pendingOffers });
  },

  "dealer.submit_offer": async ({ actor, params }) => {
    const { submitOffer } = await import("@/lib/services/offer/offer.service");
    const offer = await submitOffer({
      auctionId: String(params.auctionId),
      dealerId: actor.actorId,
      otdPriceCents: params.otdPriceCents as number,
      vehiclePriceCents: params.vehiclePriceCents as number,
      taxCents: params.taxCents as number,
      feesCents: params.feesCents as number,
      includesFinancing: params.includesFinancing as boolean | undefined,
      aprRate: params.aprRate as number | undefined,
      termMonths: params.termMonths as number | undefined,
    });
    return ok({ offerId: (offer as { id: string }).id, status: (offer as { status: string }).status });
  },

  // ── ADMIN ──────────────────────────────────────────────────────────────────
  "admin.get_platform_snapshot": async () => {
    const { prisma } = await import("@/lib/prisma");
    const [activeDeals, activeAuctions] = await Promise.all([
      prisma.deal.count({ where: { status: { notIn: ["COMPLETED", "CANCELLED", "REFUNDED"] } } }),
      prisma.auction.count({ where: { status: "ACTIVE" } }),
    ]);
    return ok({ activeDeals, activeAuctions });
  },

  "admin.advance_deal_status": async ({ actor, params }) => {
    const { advanceDealStatus } = await import("@/lib/services/deal/deal.service");
    const { DealStatus } = await import("@prisma/client");
    const target = DealStatus[params.newStatus as keyof typeof DealStatus];
    if (!target) return fail(`Unknown deal status ${String(params.newStatus)}.`);
    await advanceDealStatus(String(params.dealId), target, {
      actorId: actor.actorId,
      actorRole: actor.authenticatedRole,
      reason: (params.reason as string | undefined) ?? "AI-proposed, human-approved transition",
    });
    return ok({ dealId: params.dealId, newStatus: params.newStatus });
  },

  "admin.extend_auction": async ({ actor, params }) => {
    const { requestExtension } = await import("@/lib/services/auction/auction-extension.service");
    await requestExtension(
      String(params.auctionId),
      params.hours as number,
      actor.actorId,
      String(params.reason),
    );
    return ok({ auctionId: params.auctionId, hours: params.hours });
  },

  "admin.trigger_deposit_refund": async ({ params }) => {
    const { processRefund } = await import("@/lib/services/payment/refund.service");
    const refunded = await processRefund(String(params.depositId), String(params.reason));
    return refunded ? ok({ depositId: params.depositId, refunded: true }) : fail("Refund did not complete.");
  },

  // ── AFFILIATE ──────────────────────────────────────────────────────────────
  "affiliate.get_commission_summary": async ({ actor }) => {
    const { getCommissionSummary } = await import("@/lib/services/affiliate/commission.service");
    const summary = await getCommissionSummary(actor.actorId);
    return ok({ summary: summary as unknown as Record<string, unknown> });
  },

  // Unavailable — authorize.ts rejects before this is reachable; hard-fail if not.
  "affiliate.request_payout": async () => fail("Affiliate payouts are not available."),

  // ── SHARED ─────────────────────────────────────────────────────────────────
  "system.escalate_to_human": async ({ actor, params }) => {
    const { prisma } = await import("@/lib/prisma");
    const onBehalfType = String(params.onBehalfOfActorType);
    const onBehalfId = String(params.onBehalfOfActorId);
    const created = await prisma.notification.create({
      data: {
        type: "SUPPORT_TICKET",
        channel: "IN_APP",
        title: "AI escalation to human",
        body: String(params.summary),
        buyerId: onBehalfType === "BUYER" ? onBehalfId : null,
        dealerId: onBehalfType === "DEALER" ? onBehalfId : null,
        affiliateId: onBehalfType === "AFFILIATE" ? onBehalfId : null,
        metadata: {
          source: "action-intent",
          proposedByActorType: actor.actorType,
          proposedByActorId: actor.actorId,
          onBehalfOfActorType: onBehalfType,
        },
      },
      select: { id: true },
    });
    return ok({ ticketId: created.id });
  },
};

export function getCommand(intentType: string): CommandFn | undefined {
  return COMMANDS[intentType];
}
