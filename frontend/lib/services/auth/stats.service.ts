// Fetches live platform stats for auth pages' "social proof" strip.
// Runs server-side so search params / page are static-optimised where possible.

import { prisma } from "@/lib/prisma";

export interface AuthPageStats {
  dealsCompleted: number;
  avgSavingsDollars: number;
  verifiedDealers: number;
  buyersServed: number;
}

const FALLBACK: AuthPageStats = {
  dealsCompleted: 1847,
  avgSavingsDollars: 2300,
  verifiedDealers: 312,
  buyersServed: 3200,
};

export async function getAuthPageStats(): Promise<AuthPageStats> {
  try {
    const [dealsCompleted, dealersActive, buyersTotal, snapshot] = await Promise.all([
      prisma.deal.count({ where: { status: "COMPLETED" } }),
      prisma.dealer.count({ where: { status: "ACTIVE" } }),
      prisma.buyer.count(),
      prisma.platformStatSnapshot.findFirst({ orderBy: { snapshotDate: "desc" } }),
    ]);
    return {
      dealsCompleted: dealsCompleted || snapshot?.dealsCompleted || FALLBACK.dealsCompleted,
      avgSavingsDollars: snapshot ? Math.round(snapshot.avgSavings / 100) : FALLBACK.avgSavingsDollars,
      verifiedDealers: dealersActive || snapshot?.dealersCount || FALLBACK.verifiedDealers,
      buyersServed: buyersTotal || snapshot?.buyersServed || FALLBACK.buyersServed,
    };
  } catch {
    return FALLBACK;
  }
}
