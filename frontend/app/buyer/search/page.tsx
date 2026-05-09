import type { Metadata } from "next";

export const metadata: Metadata = { title: "Vehicle Search" };

import { Suspense } from "react";
import { getAuthenticatedBuyer } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import BuyerSearchClient from "@/components/buyer/BuyerSearchClient";

export const dynamic = "force-dynamic";

async function getModelsByMake(): Promise<Record<string, string[]>> {
  try {
    const items = await prisma.inventoryItem.findMany({
      where: { isActive: true },
      select: { make: true, model: true },
      distinct: ["make", "model"],
      take: 1000,
    });
    const modelsByMake: Record<string, string[]> = {};
    for (const i of items) {
      if (!modelsByMake[i.make]) modelsByMake[i.make] = [];
      if (!modelsByMake[i.make].includes(i.model)) modelsByMake[i.make].push(i.model);
    }
    for (const m of Object.keys(modelsByMake)) modelsByMake[m].sort();
    return modelsByMake;
  } catch {
    return {};
  }
}

export default async function SearchPage() {
  const buyer            = await getAuthenticatedBuyer();
  const maxBudgetCents   = buyer?.preQualification?.maxOtdAmountCents ?? null;
  const buyerZip         = buyer?.zip ?? null;
  const availableModelsByMake = await getModelsByMake();

  return (
    <Suspense>
      <BuyerSearchClient
        maxBudgetCents={maxBudgetCents}
        buyerZip={buyerZip}
        availableModelsByMake={availableModelsByMake}
      />
    </Suspense>
  );
}
