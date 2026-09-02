import type { Metadata } from "next";

export const metadata: Metadata = { title: "My Shortlist" };

import { requireBuyer } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import type { ShortlistItem, InventoryItem } from "@prisma/client";
import ShortlistClient from "@/components/buyer/ShortlistClient";
import {
  isShortlistItemAvailable,
  buildSimilarRequestHref,
} from "@/lib/services/shortlist/shortlist-availability";

export const dynamic = "force-dynamic";

export default async function ShortlistPage() {
  const buyer = await requireBuyer();
  const shortlist = await prisma.shortlist.findUnique({
    where: { buyerId: buyer.id },
    include: {
      items: {
        orderBy: { addedAt: "asc" },
      },
    },
  });

  const items = shortlist?.items ?? [];
  const prequal = buyer.preQualification;
  const prequalActive = !!prequal && prequal.decision === "APPROVED" && prequal.expiresAt > new Date();

  // ShortlistItem.inventoryItemId is a plain string — no Prisma relation exists,
  // so we fetch the inventory records separately.
  const inventoryIds = items.map((i: ShortlistItem) => i.inventoryItemId);
  const inventoryItems = inventoryIds.length > 0
    ? await prisma.inventoryItem.findMany({ where: { id: { in: inventoryIds } } })
    : [];
  const inventoryMap = new Map<string, InventoryItem>(
    inventoryItems.map((v: InventoryItem) => [v.id, v]),
  );

  // An unavailable item stays VISIBLE and is EXCLUDED from the request.
  //
  // This used to `return null` for a missing inventory row and filter it out, so a buyer's
  // saved car silently vanished; and a deactivated-but-present row rendered as a live card
  // linking to a page that 404s. Neither told the buyer what actually happened. The stale
  // sweep makes this common rather than exotic: 10 of the 15 shortlist rows in production
  // point at listings the corrected sweep deactivates.
  const vehicles = items.map((item: ShortlistItem) => {
    const inv = inventoryMap.get(item.inventoryItemId);
    const available = isShortlistItemAvailable(inv ?? null);

    // The row is gone entirely — there are no last-known details to show. Render the
    // placement so the buyer knows a saved vehicle was there, and route them to a request.
    if (!inv) {
      return {
        itemId: item.id,
        inventoryItemId: item.inventoryItemId,
        available: false as const,
        year: 0, make: "", model: "", trim: null,
        mileage: null, priceCents: 0, lane: "LANE_3", bodyType: null,
        images: [] as string[],
        readinessState: item.readinessState,
        similarRequestHref: null,
      };
    }

    return {
      itemId: item.id,
      inventoryItemId: item.inventoryItemId,
      available,
      year: inv.year,
      make: inv.make,
      model: inv.model,
      trim: inv.trim ?? null,
      mileage: inv.mileage ?? null,
      priceCents: inv.priceCents,
      lane: inv.lane,
      bodyType: inv.bodyType ?? null,
      images: inv.images as string[],
      readinessState: item.readinessState,
      // Only the unavailable ones need the escape hatch; building it for available cars
      // would put a "find another one" CTA on a car the buyer can still have.
      similarRequestHref: available ? null : buildSimilarRequestHref({
        year: inv.year, make: inv.make, model: inv.model, trim: inv.trim,
        mileage: inv.mileage, priceCents: inv.priceCents,
      }),
    };
  });

  // Activation is gated on AVAILABLE candidates. `items.length >= 1` would let a buyer whose
  // every saved car has sold pay a deposit to auction nothing.
  const availableCount = vehicles.filter((v) => v.available).length;
  const canActivate = availableCount >= 1 && prequalActive;

  return (
    <ShortlistClient
      initialItems={vehicles}
      canActivate={canActivate}
      hasPrequal={prequalActive}
    />
  );
}
