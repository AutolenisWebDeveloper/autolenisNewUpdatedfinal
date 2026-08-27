// lib/services/ai/action-intent/policy.ts
//
// Deterministic business policy. This is where consequential rules are
// ENFORCED (ownership/IDOR, eligibility, money preconditions, state gates) —
// never in AI guidance or catalog prose. Every policy reads AUTHORITATIVE state
// and returns a boolean decision with zero side effects. If a rule getting it
// wrong could cause unauthorized execution, financial loss, or incorrect state,
// it lives HERE (or in the canonical command), not in a prompt.
//
// Policies take an injectable `PolicyDeps` so they are unit-testable; the
// default deps resolve to the real canonical services via lazy import.

import type { ActorContext, PolicyDeps, PolicyFn, PolicyResult } from "./types";

const ALLOW: PolicyResult = { allowed: true };

function deny(code: PolicyResult["code"], reason: string): PolicyResult {
  return { allowed: false, code, reason };
}

// Self-service actors may only ever act on their own subject.
function ownsSelf(actor: ActorContext): boolean {
  return !actor.subjectId || actor.subjectId === actor.actorId;
}

export const POLICIES: Record<string, PolicyFn> = {
  // ── BUYER ──────────────────────────────────────────────────────────────────
  "buyer.get_journey_status": async ({ actor }) =>
    ownsSelf(actor) ? ALLOW : deny("OWNERSHIP_DENIED", "Buyer may only read their own journey."),

  "buyer.create_vehicle_request": async ({ actor }) =>
    ownsSelf(actor) ? ALLOW : deny("OWNERSHIP_DENIED", "Buyer may only create their own request."),

  // The consequential offer-selection gate — enforced deterministically here,
  // and again atomically inside `commitOfferSelection` (row-lock + invariant).
  "buyer.select_offer": async ({ params, actor }, deps) => {
    const offer = await deps.getOfferContext(String(params.offerId));
    if (!offer) return deny("POLICY_DENIED", "Offer not found.");
    // IDOR: the offer's auction must belong to this buyer.
    if (offer.auctionBuyerId !== actor.actorId) {
      return deny("OWNERSHIP_DENIED", "Offer does not belong to this buyer's auction.");
    }
    if (String(params.auctionId) !== offer.auctionId) {
      return deny("POLICY_DENIED", "auctionId does not match the offer.");
    }
    if (offer.auctionStatus !== "ACTIVE" && offer.auctionStatus !== "CLOSED") {
      return deny("POLICY_DENIED", `Auction is not selectable (status ${offer.auctionStatus}).`);
    }
    if (offer.offerStatus !== "SUBMITTED") {
      return deny("POLICY_DENIED", `Offer is not selectable (status ${offer.offerStatus}).`);
    }
    // Money gate: the $99 deposit must be paid for fulfillment to be unlocked.
    const unlocked = await deps.isFulfillmentUnlocked(actor.actorId);
    if (!unlocked) return deny("POLICY_DENIED", "Fulfillment is locked (deposit not paid).");
    return ALLOW;
  },

  // ── DEALER ─────────────────────────────────────────────────────────────────
  "dealer.get_auction_invitations": async ({ actor }) =>
    ownsSelf(actor) ? ALLOW : deny("OWNERSHIP_DENIED", "Dealer may only read their own invitations."),

  // Dealer must be invited to a live auction. Invitation + budget + one-per-dealer
  // are ALSO enforced atomically by the canonical `submitOffer` service.
  "dealer.submit_offer": async ({ params, actor }, deps) => {
    const auction = await deps.getAuctionContext(String(params.auctionId));
    if (!auction) return deny("POLICY_DENIED", "Auction not found.");
    if (auction.status !== "ACTIVE") {
      return deny("POLICY_DENIED", `Auction is not active (status ${auction.status}).`);
    }
    const invited = await deps.getDealerInvited(String(params.auctionId), actor.actorId);
    if (!invited) return deny("OWNERSHIP_DENIED", "Dealer is not invited to this auction.");
    return ALLOW;
  },

  // ── ADMIN ──────────────────────────────────────────────────────────────────
  "admin.get_platform_snapshot": async () => ALLOW,

  "admin.advance_deal_status": async ({ params }, deps) => {
    const deal = await deps.getDealContext(String(params.dealId));
    if (!deal) return deny("POLICY_DENIED", "Deal not found.");
    // Transition legality (canTransition), insurance gate, and CAS are enforced
    // by the canonical `advanceDealStatus`. Terminal deals cannot be advanced.
    if (["COMPLETED", "CANCELLED", "REFUNDED"].includes(deal.status)) {
      return deny("POLICY_DENIED", `Deal is terminal (status ${deal.status}).`);
    }
    return ALLOW;
  },

  "admin.extend_auction": async ({ params }, deps) => {
    const auction = await deps.getAuctionContext(String(params.auctionId));
    if (!auction) return deny("POLICY_DENIED", "Auction not found.");
    if (auction.status !== "ACTIVE") {
      return deny("POLICY_DENIED", `Only active auctions can be extended (status ${auction.status}).`);
    }
    return ALLOW;
  },

  // Money movement: a deposit can only be refunded if it is currently PAID.
  "admin.trigger_deposit_refund": async ({ params }, deps) => {
    const deposit = await deps.getDepositContext(String(params.depositId));
    if (!deposit) return deny("POLICY_DENIED", "Deposit not found.");
    if (deposit.status !== "PAID") {
      return deny("POLICY_DENIED", `Only PAID deposits can be refunded (status ${deposit.status}).`);
    }
    return ALLOW;
  },

  // ── AFFILIATE ──────────────────────────────────────────────────────────────
  "affiliate.get_commission_summary": async ({ actor }) =>
    ownsSelf(actor) ? ALLOW : deny("OWNERSHIP_DENIED", "Affiliate may only read their own commissions."),

  // Defense in depth: even if it were ever activated, payouts are gated off.
  "affiliate.request_payout": async () =>
    deny("POLICY_DENIED", "Affiliate payouts are not available."),

  // ── SHARED ─────────────────────────────────────────────────────────────────
  // Non-admin actors may only escalate on behalf of themselves.
  "system.escalate_to_human": async ({ params, actor }) => {
    const onBehalfId = String(params.onBehalfOfActorId);
    const isAdmin = actor.actorType === "ADMIN";
    if (!isAdmin && onBehalfId !== actor.actorId) {
      return deny("OWNERSHIP_DENIED", "May only escalate on your own behalf.");
    }
    return ALLOW;
  },
};

export async function evaluatePolicy(
  intentType: string,
  ctx: { params: Record<string, unknown>; actor: ActorContext },
  deps: PolicyDeps,
): Promise<PolicyResult> {
  const policy = POLICIES[intentType];
  // Fail closed: an intent with no registered policy is denied, never allowed.
  if (!policy) return deny("POLICY_DENIED", `No policy registered for "${intentType}".`);
  return policy(ctx, deps);
}

// ─── Default deps: real canonical services (lazy-imported) ───────────────────
// Reads authoritative Prisma state. Never trusts the model.
export function defaultPolicyDeps(): PolicyDeps {
  return {
    isFulfillmentUnlocked: async (buyerId) => {
      const { isFulfillmentUnlocked } = await import("@/lib/services/payment/fulfillment-gate");
      return isFulfillmentUnlocked(buyerId);
    },
    getOfferContext: async (offerId) => {
      const { prisma } = await import("@/lib/prisma");
      const offer = await prisma.offer.findUnique({
        where: { id: offerId },
        select: { auctionId: true, status: true, auction: { select: { buyerId: true, status: true } } },
      });
      if (!offer) return null;
      return {
        auctionId: offer.auctionId,
        auctionBuyerId: offer.auction.buyerId,
        auctionStatus: offer.auction.status,
        offerStatus: offer.status,
      };
    },
    getDealContext: async (dealId) => {
      const { prisma } = await import("@/lib/prisma");
      const deal = await prisma.deal.findUnique({ where: { id: dealId }, select: { buyerId: true, status: true } });
      return deal ? { buyerId: deal.buyerId, status: deal.status } : null;
    },
    getAuctionContext: async (auctionId) => {
      const { prisma } = await import("@/lib/prisma");
      const auction = await prisma.auction.findUnique({
        where: { id: auctionId },
        select: { buyerId: true, status: true },
      });
      return auction ? { buyerId: auction.buyerId, status: auction.status } : null;
    },
    getDepositContext: async (depositId) => {
      const { prisma } = await import("@/lib/prisma");
      const deposit = await prisma.deposit.findUnique({
        where: { id: depositId },
        select: { buyerId: true, status: true },
      });
      return deposit ? { buyerId: deposit.buyerId, status: deposit.status } : null;
    },
    getDealerInvited: async (auctionId, dealerId) => {
      const { prisma } = await import("@/lib/prisma");
      const invite = await prisma.auctionInvitation.findFirst({
        where: { auctionId, dealerId },
        select: { id: true },
      });
      return invite !== null;
    },
  };
}
