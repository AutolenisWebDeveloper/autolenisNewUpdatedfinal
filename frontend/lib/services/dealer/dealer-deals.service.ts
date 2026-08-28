// lib/services/dealer/dealer-deals.service.ts
// Dealer deal data access — keeps business logic out of page files.
// All queries scope by dealerId via offer.dealerId to ensure ownership.

import { prisma } from "@/lib/prisma";
import { PickupStatus, type DealStatus } from "@prisma/client";
import { isExecutedArtifactEnabled } from "@/lib/services/esign/esign-schema-gate";

export interface DealerDealSummary {
  id: string;
  status: DealStatus;
  createdAt: Date;
  offer: {
    id: string;
    otdPriceCents: number;
    auctionId: string;
  } | null;
}

export interface DealerDealDetail {
  id: string;
  status: DealStatus;
  createdAt: Date;
  contractShieldScore: number | null;
  contractShieldStatus: string | null;
  financingPath: string | null;
  offer: {
    id: string;
    otdPriceCents: number;
    vehiclePriceCents: number;
    taxCents: number;
    feesCents: number;
    includesFinancing: boolean;
    aprRate: number | null;
    termMonths: number | null;
    auctionId: string;
    dealerId: string;
  } | null;
  // Buyer contact is included here ONLY for deals where the dealer's offer
  // was the accepted one. The findFirst query below filters by
  // offer.dealerId so a dealer can never reach a Deal record that isn't
  // their own win. Buyer identity is therefore safe to expose on this
  // endpoint.
  buyer: {
    firstName: string;
    lastName: string;
    phone: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
    email: string | null;
  } | null;
  pickup: {
    id: string;
    status: "NOT_SCHEDULED" | "SCHEDULED" | "COMPLETE" | string;
    scheduledAt: Date | null;
    qrCodeData: string | null;
  } | null;
  // Whether the buyer-signed EXECUTED contract copy is available to this dealer.
  // A privacy-safe boolean only (§11) — the storage key/hash and any signer
  // forensic evidence are never exposed here; the copy is fetched via the
  // role-scoped, signed-URL download route.
  executedContractAvailable: boolean;
}

/**
 * Returns up to 50 of the dealer's deals (most recent first),
 * scoped via the accepted offer's dealerId.
 */
export async function getDealerDeals(dealerId: string): Promise<DealerDealSummary[]> {
  return prisma.deal.findMany({
    where: { offer: { dealerId } },
    select: {
      id: true,
      status: true,
      createdAt: true,
      offer: { select: { id: true, otdPriceCents: true, auctionId: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
}

/**
 * Returns a single deal for the given dealer, or null if not found / not owned.
 */
export async function getDealerDealById(dealId: string, dealerId: string): Promise<DealerDealDetail | null> {
  const deal = await prisma.deal.findFirst({
    where: { id: dealId, offer: { dealerId } },
    select: {
      id: true,
      status: true,
      createdAt: true,
      contractShieldScore: true,
      contractShieldStatus: true,
      financingPath: true,
      offer: {
        select: {
          id: true,
          otdPriceCents: true,
          vehiclePriceCents: true,
          taxCents: true,
          feesCents: true,
          includesFinancing: true,
          aprRate: true,
          termMonths: true,
          auctionId: true,
          dealerId: true,
        },
      },
      buyer: {
        select: {
          firstName: true,
          lastName: true,
          phone: true,
          city: true,
          state: true,
          zip: true,
          user: { select: { email: true } },
        },
      },
      pickup: {
        select: {
          id: true,
          status: true,
          scheduledAt: true,
          qrCodeData: true,
        },
      },
      // Executed-copy availability only — never the storage key/hash or forensic
      // signer evidence (§11). executedDocumentKey is projected ONLY while the
      // executed-artifact schema gate is open; with migrations 20261014/20261015
      // unapplied the column does not exist and no executed copy can exist either.
      eSignEnvelope: {
        select: isExecutedArtifactEnabled()
          ? { status: true, executedDocumentKey: true }
          : { status: true },
      },
    },
  });
  if (!deal) return null;

  return {
    id: deal.id,
    status: deal.status,
    createdAt: deal.createdAt,
    contractShieldScore: deal.contractShieldScore,
    contractShieldStatus: deal.contractShieldStatus,
    financingPath: deal.financingPath,
    offer: deal.offer,
    executedContractAvailable:
      deal.eSignEnvelope?.status === "COMPLETED" &&
      !!(deal.eSignEnvelope as { executedDocumentKey?: string | null } | null)?.executedDocumentKey,
    buyer: deal.buyer
      ? {
          firstName: deal.buyer.firstName,
          lastName: deal.buyer.lastName,
          phone: deal.buyer.phone,
          city: deal.buyer.city,
          state: deal.buyer.state,
          zip: deal.buyer.zip,
          email: deal.buyer.user?.email ?? null,
        }
      : null,
    pickup: deal.pickup,
  };
}


// D2 — a dealer pickup awaiting or in the confirm/propose round-trip, or already
// confirmed (ready to scan). Isolation: exposes buyer city/state ONLY — never
// name/email/phone. `proposedAt` is the CAS token the client echoes on confirm/
// counter so a stale action loses cleanly.
export interface DealerPickupAction {
  id: string; // dealId
  createdAt: Date;
  buyerCity: string | null;
  buyerState: string | null;
  pickup: {
    status: PickupStatus;
    scheduledAt: Date | null;
    proposedTime: Date | null;
    proposedAt: Date | null;
    proposedBy: string | null;
    counterCount: number;
    qrCodeImage: string | null;
  };
}

const DEALER_PICKUP_ACTION_STATUSES: PickupStatus[] = [
  PickupStatus.PROPOSED,
  PickupStatus.DEALER_COUNTERED,
  PickupStatus.SCHEDULED,
  PickupStatus.CHECKED_IN,
];

/**
 * Pickups needing the dealer's attention (PROPOSED / DEALER_COUNTERED) or ready
 * for handoff (SCHEDULED / CHECKED_IN), scoped by the accepted offer's dealerId.
 */
export async function getDealerPickupActions(dealerId: string): Promise<DealerPickupAction[]> {
  const deals = await prisma.deal.findMany({
    where: { offer: { dealerId }, pickup: { status: { in: DEALER_PICKUP_ACTION_STATUSES } } },
    select: {
      id: true,
      createdAt: true,
      buyer: { select: { city: true, state: true } },
      pickup: {
        select: {
          status: true,
          scheduledAt: true,
          proposedTime: true,
          proposedAt: true,
          proposedBy: true,
          counterCount: true,
          qrCodeImage: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return deals
    .filter((d) => d.pickup)
    .map((d) => ({
      id: d.id,
      createdAt: d.createdAt,
      buyerCity: d.buyer?.city ?? null,
      buyerState: d.buyer?.state ?? null,
      pickup: d.pickup!,
    }));
}
