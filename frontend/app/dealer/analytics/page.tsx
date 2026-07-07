import { requireDealer } from "@/lib/auth/dealer-session";
import { computeDealerScorecard } from "@/lib/services/dealer/dealer-scorecard.service";
import { BarChart2 } from "lucide-react";
import AnalyticsChart from "@/components/dealer/AnalyticsChart";
import { PageContainer, PageHeader, EmptyState, CARD, FIGURE } from "@/components/ui/patterns";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function DealerAnalyticsPage() {
  const dealer = await requireDealer();
  const scorecard = await computeDealerScorecard(dealer.id, 90);

  // Sanctioned tone colors only (brand / indigo / emerald) — no Material blue
  // or lime.
  const summaryStats = [
    { label: "Invitations", value: scorecard.invitationsReceived, color: "#0B5FD1" },
    { label: "Offers Submitted", value: scorecard.offersSubmitted, color: "#4f46e5" },
    { label: "Deals Won", value: scorecard.dealsWon, color: "#059669" },
  ];

  const chartData = scorecard.snapshots.slice(0, 10).reverse().map(s => ({
    date: s.date.toLocaleDateString("en-US", { month: "short" }),
    winRate: Math.round(s.offerWinRate),
  }));

  return (
    <PageContainer testId="dealer-analytics-page">
      <PageHeader
        title="Analytics"
        subtitle="Your invitation, offer, and win performance over the last 90 days."
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        {summaryStats.map(s => (
          <div key={s.label} data-testid={`analytics-stat-${s.label.toLowerCase().replace(/\s+/g, "-")}`}
            className={cn(CARD, "p-5 text-center")}>
            <p className={cn("text-3xl mb-1", FIGURE)} style={{ color: s.color }}>{s.value}</p>
            <p className="text-xs text-slate-500">{s.label} (90 days)</p>
          </div>
        ))}
      </div>

      {chartData.length > 1 ? (
        <div className={cn(CARD, "p-5")} data-testid="analytics-chart">
          <p className="font-semibold text-slate-800 text-sm mb-4">Win Rate % by Period</p>
          <AnalyticsChart data={chartData} />
        </div>
      ) : (
        <EmptyState
          icon={BarChart2}
          title="No analytics yet"
          body="Analytics will appear after your first offers are submitted."
          testId="analytics-no-data"
        />
      )}
    </PageContainer>
  );
}
