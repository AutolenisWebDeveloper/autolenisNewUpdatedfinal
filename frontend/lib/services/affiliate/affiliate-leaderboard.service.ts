// lib/services/affiliate/affiliate-leaderboard.service.ts
//
// H-12: the previous implementation loaded EVERY active affiliate with ALL of
// their commission rows and children into JS on each leaderboard view — an
// unbounded full-table scan that grows with the ledger. Ranking now happens in
// one SQL aggregate (grouped sum + window functions); only the top rows plus
// the caller's own row cross the wire.
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

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

interface RawRow {
  id: string;
  referral_code: string;
  total_cents: bigint;
  network_count: bigint;
  rank: bigint;
  total_affiliates: bigint;
}

export async function getLeaderboard(
  currentAffiliateId: string,
  limit = 10
): Promise<LeaderboardResult> {
  // Lifetime earned = the shared ledger rule (M1): PENDING/APPROVED/PAID rows
  // plus negative REVERSED clawback offsets — the same basis as
  // getCommissionSummary.totalCents (ledgerEarnedWhere in SQL form).
  // ROW_NUMBER keeps the original deterministic dense ordering (id tiebreak).
  const rows = await prisma.$queryRaw<RawRow[]>(Prisma.sql`
    WITH totals AS (
      SELECT
        a.id,
        a.referral_code,
        COALESCE(SUM(c.amount_cents) FILTER (
          WHERE c.status IN ('PENDING', 'APPROVED', 'PAID')
             OR (c.status = 'REVERSED' AND c.amount_cents < 0)
        ), 0)::bigint AS total_cents,
        (SELECT COUNT(*) FROM affiliates ch WHERE ch.parent_id = a.id)::bigint         AS network_count
      FROM affiliates a
      LEFT JOIN commissions c ON c.affiliate_id = a.id
      WHERE a.status = 'ACTIVE'
      GROUP BY a.id, a.referral_code
    ),
    ranked AS (
      SELECT
        *,
        ROW_NUMBER() OVER (ORDER BY total_cents DESC, id ASC)::bigint AS rank,
        COUNT(*) OVER ()::bigint AS total_affiliates
      FROM totals
    )
    SELECT * FROM ranked
    WHERE rank <= ${limit} OR id = ${currentAffiliateId}
    ORDER BY rank ASC
  `);

  const entries: LeaderboardEntry[] = rows.map((r) => ({
    rank: Number(r.rank),
    id: r.id,
    maskedCode: maskCode(r.referral_code),
    totalCents: Number(r.total_cents),
    networkCount: Number(r.network_count),
    isCurrentUser: r.id === currentAffiliateId,
  }));

  const top = entries.filter((e) => e.rank <= limit);
  const currentRank = entries.find((e) => e.isCurrentUser) ?? null;
  const totalAffiliates = rows.length > 0 ? Number(rows[0].total_affiliates) : 0;

  return { top, currentRank, totalAffiliates };
}

function maskCode(code: string): string {
  if (code.length <= 4) return code.slice(0, 2) + "**";
  return code.slice(0, 2) + "****";
}
