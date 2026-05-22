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
    <Suspense fallback={<SearchSkeleton />}>
      <BuyerSearchClient
        maxBudgetCents={maxBudgetCents}
        buyerZip={buyerZip}
        availableModelsByMake={availableModelsByMake}
      />
    </Suspense>
  );
}

function SearchSkeleton() {
  return (
    <div className="p-6 md:p-8 max-w-7xl" data-testid="search-skeleton">
      <div className="h-8 w-48 bg-slate-100 rounded-md animate-pulse mb-6" />
      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
        <div className="hidden lg:block space-y-3">
          <div className="h-10 bg-slate-100 rounded-lg animate-pulse" />
          <div className="h-10 bg-slate-100 rounded-lg animate-pulse" />
          <div className="h-10 bg-slate-100 rounded-lg animate-pulse" />
          <div className="h-10 bg-slate-100 rounded-lg animate-pulse" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="bg-white border border-slate-200 rounded-xl h-56 animate-pulse" />
          ))}
        </div>
      </div>
    </div>
  );
}
