import type { Metadata } from "next";

export const metadata: Metadata = { title: "Vehicle Search" };

import { Suspense } from "react";
import { getAuthenticatedBuyer } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import BuyerSearchClient, { type PrequalBudgetState } from "@/components/buyer/BuyerSearchClient";
import { isPrequalValid } from "@/lib/services/prequal/prequal.service";

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

/**
 * Describe the buyer's prequal WITHOUT inventing a budget.
 *
 * `maxOtdAmountCents` is 0 on every non-approved row, so reading it
 * unconditionally (as this page used to) turns "not decided yet" into an
 * approved budget of $0. A number is returned only for a live approval.
 */
function resolvePrequalBudget(
  prequal: { decision: string; expiresAt: Date; maxOtdAmountCents: number } | null,
): { maxBudgetCents: number | null; prequalState: PrequalBudgetState } {
  if (isPrequalValid(prequal) && prequal !== null) {
    // A zero amount on an APPROVED row is an anomaly, never a real budget of
    // nothing. Report the approval without claiming a figure rather than
    // rendering "$0" — the banner simply stays silent in that case.
    const maxBudgetCents = prequal.maxOtdAmountCents > 0 ? prequal.maxOtdAmountCents : null;
    return { maxBudgetCents, prequalState: "APPROVED" };
  }
  if (!prequal) return { maxBudgetCents: null, prequalState: "NONE" };
  if (prequal.decision === "DECLINED") return { maxBudgetCents: null, prequalState: "DECLINED" };
  // APPROVED but past expiresAt — a real approval that has simply lapsed.
  if (prequal.decision === "APPROVED") return { maxBudgetCents: null, prequalState: "EXPIRED" };
  // PENDING / MANUAL_REVIEW / OFAC_REVIEW / OFAC_ESCALATED all read to the buyer
  // as "still being reviewed" — the OFAC cause is never surfaced.
  return { maxBudgetCents: null, prequalState: "PENDING" };
}

export default async function SearchPage() {
  const buyer            = await getAuthenticatedBuyer();
  const { maxBudgetCents, prequalState } = resolvePrequalBudget(
    buyer?.preQualification ?? null,
  );
  const buyerZip         = buyer?.zip ?? null;
  const availableModelsByMake = await getModelsByMake();

  return (
    <Suspense fallback={<SearchSkeleton />}>
      <BuyerSearchClient
        maxBudgetCents={maxBudgetCents}
        prequalState={prequalState}
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
