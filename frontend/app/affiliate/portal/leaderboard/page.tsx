// app/affiliate/portal/leaderboard/page.tsx
// Elite Affiliate Leaderboard — shows top earners, current rank, and motivational tier context

import { requireAffiliate } from "@/lib/auth/affiliate-session";
import { getLeaderboard } from "@/lib/services/affiliate/affiliate-leaderboard.service";
import { getCommissionSummary } from "@/lib/services/affiliate/commission.service";
import { Trophy, Medal, Star, TrendingUp, Crown } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

function rankIcon(rank: number) {
  if (rank === 1) return <Crown size={16} className="text-yellow-500" />;
  if (rank === 2) return <Medal size={16} className="text-slate-400" />;
  if (rank === 3) return <Medal size={16} className="text-amber-600" />;
  return <span className="text-xs font-bold text-slate-400 w-4 text-center">#{rank}</span>;
}

function rankBg(rank: number, isCurrentUser: boolean) {
  if (isCurrentUser) return "bg-[#0B5FD1]/10 border-[#0B5FD1]/40 ring-1 ring-[#0B5FD1]/30";
  if (rank === 1) return "bg-yellow-50 border-yellow-200";
  if (rank === 2) return "bg-slate-50 border-slate-200";
  if (rank === 3) return "bg-amber-50 border-amber-200";
  return "bg-white border-slate-200";
}

export default async function AffiliateLeaderboardPage() {
  const affiliate = await requireAffiliate();
  const [board, summary] = await Promise.all([
    getLeaderboard(affiliate.id, 10),
    getCommissionSummary(affiliate.id),
  ]);

  const currentRank = board.currentRank;
  const totalAffiliates = board.totalAffiliates;
  const topPercentile =
    currentRank && totalAffiliates > 0
      ? Math.ceil((currentRank.rank / totalAffiliates) * 100)
      : null;

  return (
    <div className="p-6 md:p-8 max-w-2xl" data-testid="affiliate-leaderboard-page">
      {/* Header */}
      <div className="flex items-center gap-3 mb-2">
        <Trophy size={22} className="text-[#0B5FD1]" />
        <h1 className="text-xl font-bold text-slate-900">Leaderboard</h1>
      </div>
      <p className="text-sm text-slate-500 mb-8">
        Top earners ranked by lifetime commissions. Keep growing to climb the ranks.
      </p>

      {/* Your rank card */}
      {currentRank && (
        <div
          className="bg-gradient-to-r from-[#0B5FD1] to-[#0A4DB8] text-white rounded-2xl p-6 mb-8"
          data-testid="your-rank-card"
        >
          <p className="text-xs font-bold uppercase tracking-widest text-white/60 mb-3">
            Your Standing
          </p>
          <div className="flex items-end justify-between">
            <div>
              <p className="text-5xl font-black mb-1">#{currentRank.rank}</p>
              <p className="text-sm text-white/70">
                of {totalAffiliates.toLocaleString()} active affiliates
              </p>
              {topPercentile !== null && topPercentile <= 10 && (
                <div className="mt-2 inline-flex items-center gap-1.5 bg-yellow-400/20 border border-yellow-400/30 px-2.5 py-1 rounded-full">
                  <Star size={12} className="text-yellow-400" />
                  <span className="text-xs font-semibold text-yellow-300">
                    Top {topPercentile}%
                  </span>
                </div>
              )}
            </div>
            <div className="text-right">
              <p className="text-3xl font-bold">
                ${(summary.totalCents / 100).toLocaleString()}
              </p>
              <p className="text-xs text-white/60 mt-0.5">lifetime earned</p>
            </div>
          </div>
        </div>
      )}

      {/* Top 10 list */}
      <div data-testid="leaderboard-list">
        <p className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">
          Top Earners
        </p>
        {board.top.length === 0 ? (
          <div
            className="text-center py-12 bg-white border border-slate-200 rounded-xl text-slate-400"
            data-testid="leaderboard-empty"
          >
            <TrendingUp size={28} className="mx-auto mb-2 text-slate-300" />
            <p>No rankings yet. Be the first to earn commissions.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {board.top.map((entry) => (
              <div
                key={entry.id}
                data-testid={`leaderboard-row-${entry.rank}`}
                className={`flex items-center gap-4 px-5 py-4 rounded-xl border transition-all ${rankBg(entry.rank, entry.isCurrentUser)}`}
              >
                {/* Rank */}
                <div className="w-6 flex items-center justify-center shrink-0">
                  {rankIcon(entry.rank)}
                </div>

                {/* Identity */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-mono text-sm font-semibold text-slate-700">
                      {entry.maskedCode}
                    </p>
                    {entry.isCurrentUser && (
                      <Badge variant="secondary" className="text-xs text-[#0B5FD1]">
                        You
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {entry.networkCount} direct referral{entry.networkCount !== 1 ? "s" : ""}
                  </p>
                </div>

                {/* Earnings */}
                <div className="text-right shrink-0">
                  <p className="font-bold text-slate-900">
                    ${(entry.totalCents / 100).toLocaleString()}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Outside top 10 — show current affiliate's position if not in list */}
      {currentRank && !board.top.some((e) => e.isCurrentUser) && (
        <div className="mt-4 space-y-1" data-testid="your-rank-below-top">
          <div className="flex items-center gap-2 px-4 py-2">
            <div className="flex-1 h-px bg-slate-200" />
            <p className="text-xs text-slate-400 shrink-0">your position</p>
            <div className="flex-1 h-px bg-slate-200" />
          </div>
          <div
            className={`flex items-center gap-4 px-5 py-4 rounded-xl border ${rankBg(currentRank.rank, true)}`}
            data-testid="your-rank-row"
          >
            <div className="w-6 flex items-center justify-center shrink-0">
              {rankIcon(currentRank.rank)}
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <p className="font-mono text-sm font-semibold text-slate-700">
                  {currentRank.maskedCode}
                </p>
                <Badge variant="secondary" className="text-xs text-[#0B5FD1]">
                  You
                </Badge>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                {currentRank.networkCount} direct referral{currentRank.networkCount !== 1 ? "s" : ""}
              </p>
            </div>
            <div className="text-right">
              <p className="font-bold text-slate-900">
                ${(summary.totalCents / 100).toLocaleString()}
              </p>
            </div>
          </div>
        </div>
      )}

      <p className="text-xs text-slate-300 text-center mt-8">
        Rankings update in real time. Identities are masked. Earn more to climb.
      </p>
    </div>
  );
}
