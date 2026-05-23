// lib/services/dealer/dealer-deals.service.ts
// Dealer deal data access — keeps business logic out of page files.
// All queries scope by dealerId via offer.dealerId to ensure ownership.

import { prisma } from "@/lib/prisma";
import type { DealStatus } from "@prisma/client";

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
}

export interface DealerPickupDeal {
  id: string;
  status: DealStatus;
  createdAt: Date;
  offer: {
    id: string;
    auctionId: string;
  } | null;
  pickup: {
    id: string;
    status: "NOT_SCHEDULED" | "SCHEDULED" | "COMPLETE" | string;
    scheduledAt: Date | null;
    qrCodeData: string | null;
    qrCodeImage: string | null;
  } | null;
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

/**
 * Returns deals with PICKUP_SCHEDULED status for the given dealer,
 * including pickup details.
 */
export async function getDealerPickupDeals(dealerId: string): Promise<DealerPickupDeal[]> {
  return prisma.deal.findMany({
    where: { offer: { dealerId }, status: "PICKUP_SCHEDULED" },
    select: {
      id: true,
      status: true,
      createdAt: true,
      offer: { select: { id: true, auctionId: true } },
      pickup: {
        select: {
          id: true,
          status: true,
          scheduledAt: true,
          qrCodeData: true,
          qrCodeImage: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });
}
