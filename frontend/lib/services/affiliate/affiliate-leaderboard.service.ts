// lib/services/affiliate/affiliate-leaderboard.service.ts
import { prisma } from "@/lib/prisma";

export interface LeaderboardEntry {
  rank: number;
  id: string;
  maskedCode: string;
  totalCents: number;
  networkCount: number;
  isCurrentUser: boolean;
}

export interface LeaderboardResult {
  top: LeaderboardEntry[];
  currentRank: LeaderboardEntry | null;
  totalAffiliates: number;
}

export async function getLeaderboard(
  currentAffiliateId: string,
  limit = 10
): Promise<LeaderboardResult> {
  const affiliates = await prisma.affiliate.findMany({
    where: { status: "ACTIVE" },
    select: {
      id: true,
      referralCode: true,
      commissions: {
        where: { status: { not: "REVERSED" } },
        select: { amountCents: true },
      },
      children: { select: { id: true } },
    },
  });

  const ranked = affiliates
    .map((a) => ({
      id: a.id,
      maskedCode: maskCode(a.referralCode),
      totalCents: a.commissions.reduce((s, c) => s + c.amountCents, 0),
      networkCount: a.children.length,
      isCurrentUser: a.id === currentAffiliateId,
    }))
    .sort((a, b) => b.totalCents - a.totalCents)
    .map((a, i) => ({ ...a, rank: i + 1 }));

  const top = ranked.slice(0, limit);
  const currentRank = ranked.find((a) => a.isCurrentUser) ?? null;

  return { top, currentRank, totalAffiliates: ranked.length };
}

function maskCode(code: string): string {
  if (code.length <= 4) return code.slice(0, 2) + "**";
  return code.slice(0, 2) + "****";
}
