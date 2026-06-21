import type { Metadata } from "next";

export const metadata: Metadata = { title: "My Shortlist" };

import { requireBuyer } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import type { ShortlistItem, InventoryItem } from "@prisma/client";
import ShortlistClient from "@/components/buyer/ShortlistClient";

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
  const canActivate = items.length >= 1 && prequalActive;

  // ShortlistItem.inventoryItemId is a plain string — no Prisma relation exists,
  // so we fetch the inventory records separately.
  const inventoryIds = items.map((i: ShortlistItem) => i.inventoryItemId);
  const inventoryItems = inventoryIds.length > 0
    ? await prisma.inventoryItem.findMany({ where: { id: { in: inventoryIds } } })
    : [];
  const inventoryMap = new Map<string, InventoryItem>(
    inventoryItems.map((v: InventoryItem) => [v.id, v]),
  );

  const vehicles = items
    .map((item: ShortlistItem) => {
      // inventoryItemId is a plain string with no FK, so the referenced
      // InventoryItem may have been deleted. Skip orphans instead of crashing
      // the whole shortlist page on an undefined dereference.
      const inv = inventoryMap.get(item.inventoryItemId);
      if (!inv) return null;
      return {
        itemId: item.id,
        inventoryItemId: item.inventoryItemId,
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
      };
    })
    .filter((v): v is NonNullable<typeof v> => v !== null);

  return (
    <ShortlistClient
      initialItems={vehicles}
      canActivate={canActivate}
      hasPrequal={prequalActive}
    />
  );
}
