// Feature 20 — Dealer Performance Scorecard with Gamification
// Tier progression bar and achievement badges based on real computed metrics
// No fake rankings or percentiles — individual dealer data only

import { requireDealer } from "@/lib/auth/dealer-session";
import { computeDealerScorecard } from "@/lib/services/dealer/dealer-scorecard.service";
import { Badge } from "@/components/ui/badge";
import { Star, TrendingUp, CheckCircle2, Clock, AlertTriangle, Lightbulb, Trophy, Zap, Target, Award } from "lucide-react";
import ScorecardChart from "@/components/dealer/ScorecardChart";
import { getDealerViolationSummary } from "@/lib/services/contract-shield/violation-pattern.service";
import { PageContainer, PageHeader, FIGURE } from "@/components/ui/patterns";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

// Sanctioned tones only (indigo/amber/slate/red) — no off-system purple.
const TIER_COLORS: Record<string, string> = {
  PLATINUM: "bg-indigo-100 text-indigo-800 border-indigo-200",
  GOLD: "bg-amber-100 text-amber-800 border-amber-200",
  STANDARD: "bg-slate-100 text-slate-700 border-slate-200",
  PROBATION: "bg-red-100 text-red-700 border-red-200",
};

const TIER_ORDER = ["PROBATION", "STANDARD", "GOLD", "PLATINUM"];

// Compute a composite score 0–100 from real scorecard metrics (no cross-dealer comparison)
function computeCompositeScore(s: {
  offerWinRate: number;
  dealCompletionRate: number;
  auctionResponseRate: number;
  junkFeeRatio: number;
}): number {
  // Weights: response rate 30%, win rate 30%, completion rate 30%, junk fee penalty 10%
  const responseScore = Math.min(s.auctionResponseRate, 100) * 0.30;
  const winScore = Math.min(s.offerWinRate * 2, 100) * 0.30; // scale: 50% win rate = 100pts
  const completionScore = Math.min(s.dealCompletionRate, 100) * 0.30;
  const junkPenalty = Math.min(s.junkFeeRatio, 100) * 0.10;
  return Math.max(0, Math.round(responseScore + winScore + completionScore - junkPenalty));
}

// Achievements based on real computed metrics — no fake badges
interface Achievement { id: string; label: string; desc: string; unlocked: boolean; icon: React.ElementType }
function computeAchievements(s: {
  dealsWon: number;
  offersSubmitted: number;
  auctionResponseRate: number;
  offerWinRate: number;
  invitationsReceived: number;
}): Achievement[] {
  return [
    {
      id: "first-deal",
      label: "First Deal",
      desc: "Won your first auction deal",
      unlocked: s.dealsWon >= 1,
      icon: Trophy,
    },
    {
      id: "active-bidder",
      label: "Active Bidder",
      desc: "Submitted 5+ offers",
      unlocked: s.offersSubmitted >= 5,
      icon: Zap,
    },
    {
      id: "responsive",
      label: "Responsive Dealer",
      desc: "80%+ auction response rate",
      unlocked: s.auctionResponseRate >= 80,
      icon: Target,
    },
    {
      id: "sharp-shooter",
      label: "Sharp Shooter",
      desc: "25%+ offer win rate",
      unlocked: s.offerWinRate >= 25,
      icon: Award,
    },
    {
      id: "veteran",
      label: "Veteran",
      desc: "Received 20+ invitations",
      unlocked: s.invitationsReceived >= 20,
      icon: Star,
    },
  ];
}

export default async function DealerScorecardPage() {
  const dealer = await requireDealer();
  const scorecard = await computeDealerScorecard(dealer.id);
  const violations = await getDealerViolationSummary(dealer.id);

  const compositeScore = computeCompositeScore(scorecard);
  const achievements = computeAchievements(scorecard);
  const unlockedCount = achievements.filter(a => a.unlocked).length;

  // Tier progression
  const currentTierIdx = TIER_ORDER.indexOf(scorecard.tier);
  const nextTier = currentTierIdx < TIER_ORDER.length - 1 ? TIER_ORDER[currentTierIdx + 1] : null;

  const metrics = [
    { icon: TrendingUp, label: "Offer Win Rate", value: `${scorecard.offerWinRate.toFixed(1)}%`, benchmark: "Platform median: 23%" },
    { icon: CheckCircle2, label: "Deal Completion", value: `${scorecard.dealCompletionRate.toFixed(1)}%`, benchmark: "Platform median: 78%" },
    { icon: Star, label: "Auction Response Rate", value: `${scorecard.auctionResponseRate.toFixed(1)}%`, benchmark: "Target: 80%+" },
    { icon: Clock, label: "Avg Response Time", value: `${scorecard.avgResponseHours}h`, benchmark: "Target: <6 hours" },
    { icon: TrendingUp, label: "Invitations Received", value: scorecard.invitationsReceived.toString(), benchmark: `${scorecard.offersSubmitted} offers submitted` },
    { icon: CheckCircle2, label: "Deals Won", value: scorecard.dealsWon.toString(), benchmark: "In last 90 days" },
  ];

  const chartData = scorecard.snapshots.slice(0, 12).reverse().map(s => ({
    date: s.date.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    winRate: Math.round(s.offerWinRate),
    completion: Math.round(s.dealCompletionRate),
  }));

  return (
    <PageContainer testId="dealer-scorecard-page">
      <PageHeader
        title="Performance Scorecard"
        subtitle="Your tier, composite score, and 90-day performance — your data only."
      />

      {/* Tier badge + composite score */}
      <div className="flex flex-col sm:flex-row gap-4 mb-8">
        <div className={`inline-flex items-center gap-3 border-2 rounded-2xl px-6 py-4 ${TIER_COLORS[scorecard.tier] ?? TIER_COLORS.STANDARD}`}
          data-testid="tier-badge">
          <Star size={24} />
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider opacity-70">Current Tier</p>
            <p className="text-2xl font-bold capitalize">{scorecard.tier}</p>
          </div>
        </div>

        {/* Composite score card (computed from own metrics — no cross-dealer comparison) */}
        <div className="flex-1 bg-white border border-slate-200 rounded-2xl px-6 py-4 flex items-center gap-4"
          data-testid="composite-score-card">
          <div className="relative w-16 h-16 shrink-0">
            <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
              <circle cx="18" cy="18" r="15.9" fill="none" stroke="#e2e8f0" strokeWidth="3.2" />
              <circle cx="18" cy="18" r="15.9" fill="none" stroke="#0B5FD1" strokeWidth="3.2"
                strokeDasharray={`${compositeScore} ${100 - compositeScore}`}
                strokeLinecap="round" />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-sm font-mono tabular-nums font-bold text-al-primary">
              {compositeScore}
            </span>
          </div>
          <div>
            <p className="text-xs text-slate-500 font-medium">Performance Score</p>
            <p className={cn("text-lg", FIGURE)}>{compositeScore}/100</p>
            <p className="text-xs text-slate-500">Based on your 90-day metrics</p>
          </div>
        </div>
      </div>

      {/* Tier progression */}
      <div className="bg-white border border-slate-200/80 rounded-2xl shadow-sm p-5 mb-8" data-testid="tier-progression">
        <p className="text-sm font-semibold text-slate-800 mb-4 flex items-center gap-2">
          <Trophy size={15} className="text-amber-500" />Tier Progression
        </p>
        <div className="flex items-center gap-2">
          {TIER_ORDER.filter(t => t !== "PROBATION").map((tier, i) => {
            const tierIdx = TIER_ORDER.indexOf(tier);
            const isCurrent = tier === scorecard.tier;
            const isPast = tierIdx < currentTierIdx;
            return (
              <div key={tier} className="flex items-center gap-2 flex-1">
                <div className={`flex-1 flex flex-col items-center gap-1 px-2 py-2 rounded-xl border-2 transition-colors ${
                  isCurrent ? "border-al-primary bg-al-primary/5" :
                  isPast ? "border-emerald-300 bg-emerald-50" :
                  "border-slate-200 bg-slate-50"
                }`} data-testid={`tier-step-${tier.toLowerCase()}`}>
                  <span className={`text-xs font-bold uppercase ${isCurrent ? "text-al-primary" : isPast ? "text-emerald-700" : "text-slate-400"}`}>
                    {tier}
                  </span>
                  {isCurrent && <span className="text-[10px] text-al-primary font-semibold">← You are here</span>}
                  {isPast && <CheckCircle2 size={12} className="text-emerald-500" />}
                </div>
                {i < 2 && <div className={`w-4 h-0.5 ${isPast || isCurrent ? "bg-al-primary" : "bg-slate-200"}`} />}
              </div>
            );
          })}
        </div>
        {nextTier && nextTier !== "PROBATION" && (
          <p className="text-xs text-slate-500 mt-3 flex items-center gap-1.5">
            <Lightbulb size={12} className="text-amber-400" />
            To reach <strong>{nextTier}</strong>: improve your response rate, win rate, and deal completion rate.
          </p>
        )}
      </div>

      {/* Core metrics grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-8">
        {metrics.map((m, i) => (
          <div key={i} data-testid={`scorecard-metric-${m.label.toLowerCase().replace(/\s+/g, "-")}`}
            className="bg-white border border-slate-200/80 rounded-2xl shadow-sm p-5">
            <div className="flex items-center gap-2 mb-2">
              <m.icon size={16} className="text-al-primary" />
              <p className="text-xs text-slate-500 font-medium">{m.label}</p>
            </div>
            <p className={cn("text-2xl mb-1", FIGURE)}>{m.value}</p>
            <p className="text-xs text-slate-500">{m.benchmark}</p>
          </div>
        ))}
      </div>

      {/* Achievements */}
      <div className="bg-white border border-slate-200/80 rounded-2xl shadow-sm p-5 mb-8" data-testid="achievements-section">
        <p className="font-semibold text-slate-800 text-sm mb-4 flex items-center gap-2">
          <Award size={15} className="text-al-primary" />
          Achievements
          <Badge variant="secondary" className="ml-auto">{unlockedCount}/{achievements.length}</Badge>
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
          {achievements.map(ach => (
            <div key={ach.id} data-testid={`achievement-${ach.id}`}
              className={`flex flex-col items-center gap-2 p-3 rounded-xl border text-center transition-opacity ${
                ach.unlocked
                  ? "border-al-primary/20 bg-al-primary/5 opacity-100"
                  : "border-slate-200 bg-slate-50 opacity-40"
              }`}>
              <div className={`w-9 h-9 rounded-full flex items-center justify-center ${ach.unlocked ? "bg-al-primary text-white" : "bg-slate-200 text-slate-400"}`}>
                <ach.icon size={16} />
              </div>
              <p className={`text-xs font-semibold ${ach.unlocked ? "text-al-primary" : "text-slate-400"}`}>{ach.label}</p>
              <p className="text-[10px] text-slate-400 leading-tight">{ach.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* 90-day trend chart */}
      {chartData.length > 1 && (
        <div className="bg-white border border-slate-200/80 rounded-2xl shadow-sm p-5 mb-8" data-testid="scorecard-trend-chart">
          <p className="font-semibold text-slate-800 text-sm mb-4">90-Day Performance Trend</p>
        <ScorecardChart data={chartData} />
        </div>
      )}

      {/* Improvement tips */}
      <div data-testid="improvement-tips">
        <p className="font-semibold text-slate-800 text-sm mb-3 flex items-center gap-2">
          <Lightbulb size={16} className="text-amber-500" />Improvement Tips
        </p>
        <div className="space-y-2">
          {scorecard.improvementTips.map((tip, i) => (
            <div key={i} data-testid={`tip-${i}`} className="flex items-start gap-3 bg-amber-50 border border-amber-100 rounded-lg p-3">
              <AlertTriangle size={14} className="text-amber-500 shrink-0 mt-0.5" />
              <p className="text-sm text-amber-800">{tip}</p>
            </div>
          ))}
        </div>
      </div>

      {/* System 8 ENH — Violation pattern tracking */}
      {violations.patterns.length > 0 && (
        <div className="mt-6" data-testid="violation-patterns">
          <p className="font-semibold text-slate-800 text-sm mb-3 flex items-center gap-2">
            <AlertTriangle size={16} className="text-red-500" />Contract Violation Patterns
          </p>
          <div className="space-y-2">
            {violations.patterns.map((p, i) => (
              <div key={i} data-testid={`violation-pattern-${i}`}
                className={`flex items-center justify-between px-4 py-3 rounded-xl border text-sm ${p.flagged ? "bg-red-50 border-red-200" : "bg-slate-50 border-slate-200"}`}>
                <div>
                  <p className={`font-semibold ${p.flagged ? "text-red-800" : "text-slate-700"}`}>{p.ruleName}</p>
                  <p className="text-xs text-slate-500 mt-0.5 tabular-nums">First seen: {p.firstSeen.toLocaleDateString()}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-bold tabular-nums px-2 py-0.5 rounded-full ${p.flagged ? "bg-red-200 text-red-800" : "bg-slate-200 text-slate-600"}`}>
                    {p.count}x
                  </span>
                  {p.flagged && <span className="text-xs text-red-600 font-bold">PATTERN VIOLATION</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </PageContainer>
  );
}
