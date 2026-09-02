// lib/services/shortlist/shortlist.service.ts
//
// The shortlist is the buyer's hand-picked set of vehicles an auction is later
// activated against, so what may ENTER it is a correctness question, not a UI one.
//
// Two things were wrong before:
//
//  1. Nothing checked eligibility. `addToShortlist` accepted any inventory item id
//     — including a listing the aggregator stopped carrying months ago. Production
//     held 95 active rows last seen up to four months earlier; every one was
//     shortlistable, and shortlisting one sends a buyer after a car that is gone.
//  2. `app/api/buyer/shortlist/route.ts` reimplemented this file's logic inline
//     rather than calling it, so this service had no callers at all. A gate added
//     to one copy would not have applied to the path buyers actually use.
//
// The gate now lives here, once, and the route delegates (`autolenis-system-
// architecture` rule 3: thin handler, fat service). Freshness policy itself is
// owned by lib/services/inventory/inventory-eligibility.ts — this file decides
// what to DO about it, not what "stale" means.

import { prisma } from "@/lib/prisma";
import { MAX_SHORTLIST_ITEMS } from "@/lib/constants";
import {
  isShortlistEligible,
  listingFreshness,
  SHORTLIST_MAX_AGE_MS,
} from "@/lib/services/inventory/inventory-eligibility";

export type AddToShortlistFailure =
  | "VEHICLE_NOT_FOUND"
  | "SHORTLIST_FULL"
  | "ALREADY_IN_SHORTLIST"
  | "LISTING_NOT_SHORTLIST_ELIGIBLE";

export type AddToShortlistResult =
  | { ok: true; item: { id: string; shortlistId: string; inventoryItemId: string } }
  | { ok: false; reason: AddToShortlistFailure; message: string };

const SHORTLIST_MAX_AGE_DAYS = Math.round(SHORTLIST_MAX_AGE_MS / (24 * 60 * 60 * 1000));

export async function getOrCreateShortlist(buyerId: string) {
  return prisma.shortlist.upsert({ where: { buyerId }, create: { buyerId }, update: {}, include: { items: true } });
}

/**
 * Add a vehicle to a buyer's shortlist, or say precisely why not.
 *
 * Returns a result rather than throwing so the route can map each failure to its
 * own error code without string-matching an exception message.
 */
export async function addToShortlist(
  buyerId: string,
  inventoryItemId: string,
  now: Date = new Date(),
): Promise<AddToShortlistResult> {
  const vehicle = await prisma.inventoryItem.findUnique({
    where: { id: inventoryItemId },
    select: { id: true, isActive: true, lastSeenAt: true, createdAt: true },
  });
  if (!vehicle) {
    return { ok: false, reason: "VEHICLE_NOT_FOUND", message: "Vehicle not found" };
  }

  // FRESHNESS GATE. Display is deliberately untouched by this — every listing
  // stays visible and searchable; only entry to the shortlist is gated.
  if (!isShortlistEligible(vehicle, now)) {
    const freshness = listingFreshness(vehicle, now);
    return {
      ok: false,
      reason: "LISTING_NOT_SHORTLIST_ELIGIBLE",
      message: vehicle.isActive
        ? `This listing has not been confirmed by its source in over ${SHORTLIST_MAX_AGE_DAYS} days` +
          `${freshness.lastSeenAt ? ` (last seen ${freshness.lastSeenAt.toISOString().slice(0, 10)})` : ""}` +
          ", so it can no longer be shortlisted."
        : "This listing is no longer available from its source, so it can no longer be shortlisted.",
    };
  }

  const shortlist = await getOrCreateShortlist(buyerId);

  if (shortlist.items.length >= MAX_SHORTLIST_ITEMS) {
    return {
      ok: false,
      reason: "SHORTLIST_FULL",
      message: `Shortlist is limited to ${MAX_SHORTLIST_ITEMS} vehicles`,
    };
  }
  if (shortlist.items.some((i) => i.inventoryItemId === inventoryItemId)) {
    return { ok: false, reason: "ALREADY_IN_SHORTLIST", message: "Vehicle already in shortlist" };
  }

  const item = await prisma.shortlistItem.create({
    data: { shortlistId: shortlist.id, inventoryItemId, readinessState: "AUCTION_READY" },
  });
  return { ok: true, item };
}

export async function removeFromShortlist(buyerId: string, itemId: string) {
  const shortlist = await prisma.shortlist.findUnique({ where: { buyerId } });
  if (!shortlist) throw new Error("Shortlist not found");
  return prisma.shortlistItem.deleteMany({ where: { id: itemId, shortlistId: shortlist.id } });
}

export async function getShortlistReadiness(buyerId: string) {
  const buyer = await prisma.buyer.findUnique({ where: { id: buyerId }, include: { preQualification: true } });
  const shortlist = await prisma.shortlist.findUnique({ where: { buyerId }, include: { items: true } });
  const hasPrequal = buyer?.preQualification && buyer.preQualification.expiresAt > new Date();
  const itemCount = shortlist?.items.length ?? 0;
  return {
    isReady: hasPrequal && itemCount > 0,
    itemCount, hasPrequal: !!hasPrequal,
    nextStep: !hasPrequal ? "complete-prequal" : itemCount === 0 ? "add-vehicles" : "activate-auction",
  };
}
