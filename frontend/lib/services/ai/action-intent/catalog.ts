// lib/services/ai/action-intent/catalog.ts
//
// THE canonical ActionIntent catalog — the single source of truth for what
// each AI agent is permitted to PROPOSE. The model does not decide what it may
// execute; this catalog does. An intent string that is not a key here is
// unknown and is rejected fail-closed (see `authorize.ts`).
//
// The catalog only DECLARES intents (types, schemas, permitted actors/roles,
// approval requirement, activation key). It does NOT enforce business rules —
// that is `policy.ts` (deterministic) and the canonical services invoked by
// `commands.ts`. Descriptions and guidance are never the enforcement boundary.

import { z } from "zod";
import type { ActorType, IntentDefinition } from "./types";

const BUYER_ROLES = ["BUYER"] as const;
const DEALER_ROLES = ["DEALER"] as const;
const AFFILIATE_ROLES = ["AFFILIATE"] as const;
const ALL_ADMIN = [
  "SUPER_ADMIN",
  "OPERATIONS_ADMIN",
  "COMPLIANCE_ADMIN",
  "FINANCE_ADMIN",
  "SUPPORT_ADMIN",
] as const;

function key(actor: ActorType, type: string): string {
  return `${actor}:${type}`;
}

// A helper so every definition is total and consistent.
function def(d: Omit<IntentDefinition, "activationKey"> & { activationKey?: string }): IntentDefinition {
  return { ...d, activationKey: d.activationKey ?? key(d.actorType, d.type) };
}

// ─────────────────────────────────────────────────────────────────────────────
// The catalog. Grouped by actor. Every consequential intent requires human
// approval AND names the existing RBAC permission a human approver must hold.
// ─────────────────────────────────────────────────────────────────────────────
export const ACTION_INTENT_CATALOG: Record<string, IntentDefinition> = Object.fromEntries(
  [
    // ─── BUYER agent ─────────────────────────────────────────────────────────
    def({
      type: "buyer.get_journey_status",
      title: "Read buyer journey status",
      description:
        "Return the authenticated buyer's own journey stage, active auction status, and active deal status.",
      actorType: "BUYER",
      permittedRoles: BUYER_ROLES,
      parameters: z.object({}).strict(),
      consequence: "READ",
      requiresHumanApproval: false,
      availability: "AVAILABLE",
      canonicalService: "lib/services/buyer (journey) + lib/services/deal",
      idempotency: "none",
    }),
    def({
      type: "buyer.create_vehicle_request",
      title: "Create a vehicle request",
      description:
        "Create a new vehicle request for the authenticated buyer, which begins sourcing. Consequential: it starts an operational pipeline, so it requires the buyer's explicit server-authoritative confirmation.",
      actorType: "BUYER",
      permittedRoles: BUYER_ROLES,
      parameters: z
        .object({
          makePreference: z.string().min(1).max(60).optional(),
          modelPreference: z.string().min(1).max(60).optional(),
          yearMin: z.number().int().min(1980).max(2100).optional(),
          yearMax: z.number().int().min(1980).max(2100).optional(),
          maxBudgetCents: z.number().int().min(100_000).max(50_000_000).optional(),
          notes: z.string().max(1000).optional(),
        })
        .strict(),
      consequence: "CONSEQUENTIAL",
      requiresHumanApproval: true,
      approverPermission: "crm.manage",
      availability: "AVAILABLE",
      canonicalService: "lib/services/vehicle-request/vehicle-request.service.ts#createVehicleRequest",
      idempotency: "delegated",
    }),
    def({
      type: "buyer.select_offer",
      title: "Select a winning dealer offer",
      description:
        "Commit the buyer's selection of a specific dealer offer, which creates a Deal and moves money forward. Highly consequential and irreversible — requires the buyer's explicit server-authoritative confirmation.",
      actorType: "BUYER",
      permittedRoles: BUYER_ROLES,
      parameters: z
        .object({
          auctionId: z.string().min(1),
          offerId: z.string().min(1),
        })
        .strict(),
      consequence: "CONSEQUENTIAL",
      requiresHumanApproval: true,
      approverPermission: "crm.manage",
      availability: "AVAILABLE",
      canonicalService: "lib/services/deal/select-offer.service.ts#commitOfferSelection",
      idempotency: "delegated",
    }),

    // ─── DEALER agent ────────────────────────────────────────────────────────
    def({
      type: "dealer.get_auction_invitations",
      title: "Read dealer auction invitations",
      description:
        "Return the authenticated dealer's own open auction invitations and pending-offer counts.",
      actorType: "DEALER",
      permittedRoles: DEALER_ROLES,
      parameters: z.object({}).strict(),
      consequence: "READ",
      requiresHumanApproval: false,
      availability: "AVAILABLE",
      canonicalService: "lib/services/dealer + lib/services/offer",
      idempotency: "none",
    }),
    def({
      type: "dealer.submit_offer",
      title: "Submit a binding offer",
      description:
        "Submit a binding out-the-door offer from the dealer into a live auction. Consequential (a binding commercial commitment) — requires the dealer's explicit server-authoritative confirmation.",
      actorType: "DEALER",
      permittedRoles: DEALER_ROLES,
      parameters: z
        .object({
          auctionId: z.string().min(1),
          otdPriceCents: z.number().int().min(100),
          vehiclePriceCents: z.number().int().min(100),
          taxCents: z.number().int().min(0),
          feesCents: z.number().int().min(0),
          includesFinancing: z.boolean().optional(),
          aprRate: z.number().min(0).max(100).optional(),
          termMonths: z.number().int().min(1).max(120).optional(),
        })
        .strict(),
      consequence: "CONSEQUENTIAL",
      requiresHumanApproval: true,
      approverPermission: "crm.manage",
      availability: "AVAILABLE",
      canonicalService: "lib/services/offer/offer.service.ts#submitOffer",
      idempotency: "delegated",
    }),

    // ─── ADMIN agent ─────────────────────────────────────────────────────────
    def({
      type: "admin.get_platform_snapshot",
      title: "Read platform operations snapshot",
      description: "Return aggregate platform counts for the admin operations view. No PII.",
      actorType: "ADMIN",
      permittedRoles: ALL_ADMIN,
      parameters: z.object({}).strict(),
      consequence: "READ",
      requiresHumanApproval: false,
      availability: "AVAILABLE",
      canonicalService: "lib/services/admin",
      idempotency: "none",
    }),
    def({
      type: "admin.advance_deal_status",
      title: "Advance a deal's status",
      description:
        "Advance a specific deal to a new status through the guarded deal state machine. Consequential state transition — requires human approval by an operations admin.",
      actorType: "ADMIN",
      permittedRoles: ALL_ADMIN,
      parameters: z
        .object({
          dealId: z.string().min(1),
          newStatus: z.enum([
            "ACTIVE",
            "FINANCING_PENDING",
            "FEE_PENDING",
            "FEE_PAID",
            "INSURANCE_PENDING",
            "CONTRACT_PENDING",
            "CONTRACT_REVIEW",
            "CONTRACT_APPROVED",
            "SIGNING_PENDING",
            "SIGNED",
            "PICKUP_SCHEDULED",
            "PICKUP_COMPLETE",
            "COMPLETED",
            "CANCELLED",
          ]),
          reason: z.string().min(3).max(500).optional(),
        })
        .strict(),
      consequence: "CONSEQUENTIAL",
      requiresHumanApproval: true,
      approverPermission: "crm.manage",
      availability: "AVAILABLE",
      canonicalService: "lib/services/deal/deal.service.ts#advanceDealStatus",
      idempotency: "delegated",
    }),
    def({
      type: "admin.extend_auction",
      title: "Extend an auction",
      description:
        "Extend a live auction by a bounded number of hours. Consequential — requires human approval by an operations admin.",
      actorType: "ADMIN",
      permittedRoles: ALL_ADMIN,
      parameters: z
        .object({
          auctionId: z.string().min(1),
          hours: z.number().int().min(1).max(72),
          reason: z.string().min(3).max(500),
        })
        .strict(),
      consequence: "CONSEQUENTIAL",
      requiresHumanApproval: true,
      approverPermission: "crm.manage",
      availability: "AVAILABLE",
      canonicalService: "lib/services/auction/auction-extension.service.ts#requestExtension",
      idempotency: "delegated",
    }),
    def({
      type: "admin.trigger_deposit_refund",
      title: "Refund a $99 deposit",
      description:
        "Refund a buyer's $99 auction-access deposit through the canonical refund service. Money movement — requires human approval by a finance admin.",
      actorType: "ADMIN",
      permittedRoles: ALL_ADMIN,
      parameters: z
        .object({
          depositId: z.string().min(1),
          reason: z.string().min(3).max(500),
        })
        .strict(),
      consequence: "CONSEQUENTIAL",
      requiresHumanApproval: true,
      approverPermission: "finance.refunds",
      availability: "AVAILABLE",
      canonicalService: "lib/services/payment/refund.service.ts#processRefund",
      idempotency: "delegated",
    }),

    // ─── AFFILIATE agent ─────────────────────────────────────────────────────
    def({
      type: "affiliate.get_commission_summary",
      title: "Read commission summary",
      description: "Return the authenticated affiliate's own commission summary and payout history.",
      actorType: "AFFILIATE",
      permittedRoles: AFFILIATE_ROLES,
      parameters: z.object({}).strict(),
      consequence: "READ",
      requiresHumanApproval: false,
      availability: "AVAILABLE",
      canonicalService: "lib/services/affiliate/commission.service.ts#getCommissionSummary",
      idempotency: "none",
    }),
    def({
      type: "affiliate.request_payout",
      title: "Request an affiliate payout",
      description:
        "Request a payout of settled commissions. Money movement. The self-serve rail is live for the AFFILIATE THEMSELVES in the Finance Hub, but this intent stays UNAVAILABLE for the AI: money movement is never AI-initiated — the AI may recognise the request and must direct the affiliate to the Finance Hub's Request Payout button (or escalate to a human).",
      actorType: "AFFILIATE",
      permittedRoles: AFFILIATE_ROLES,
      parameters: z
        .object({
          amountCents: z.number().int().min(1).optional(),
        })
        .strict(),
      consequence: "CONSEQUENTIAL",
      requiresHumanApproval: true,
      approverPermission: "finance.commissions.settle",
      availability: "UNAVAILABLE",
      canonicalService: "lib/services/affiliate/affiliate-payout.service.ts#requestPayout (human-only; never AI-invoked)",
      idempotency: "delegated",
    }),

    // ─── Shared: human escalation (every actor) ──────────────────────────────
    def({
      type: "system.escalate_to_human",
      title: "Escalate to a human",
      description:
        "The canonical escape hatch. When a situation cannot be confidently classified into a legitimate intent, is missing required information, is ambiguous, or is unsupported, the AI proposes THIS instead of forcing a fit. Creates a support-ticket for human review. Safe (no consequential side effect).",
      actorType: "SYSTEM",
      permittedRoles: [
        "BUYER",
        "DEALER",
        "AFFILIATE",
        ...ALL_ADMIN,
      ],
      parameters: z
        .object({
          summary: z.string().min(3).max(500),
          onBehalfOfActorType: z.enum(["BUYER", "DEALER", "AFFILIATE", "ADMIN"]),
          onBehalfOfActorId: z.string().min(1),
        })
        .strict(),
      consequence: "LOW",
      requiresHumanApproval: false,
      availability: "AVAILABLE",
      canonicalService: "lib/services/admin/admin-queue.service.ts (SUPPORT_TICKET)",
      idempotency: "delegated",
    }),
  ].map((d) => [d.type, d] as const),
);

export function getIntentDefinition(intentType: string): IntentDefinition | undefined {
  return ACTION_INTENT_CATALOG[intentType];
}

export function listIntentsForActor(actorType: ActorType): IntentDefinition[] {
  return Object.values(ACTION_INTENT_CATALOG).filter(
    (d) => d.actorType === actorType || (actorType !== "SYSTEM" && d.type === "system.escalate_to_human"),
  );
}

export function allIntentTypes(): string[] {
  return Object.keys(ACTION_INTENT_CATALOG);
}
