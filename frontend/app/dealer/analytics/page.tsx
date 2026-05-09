import { requireDealer } from "@/lib/auth/dealer-session";
import { computeDealerScorecard } from "@/lib/services/dealer/dealer-scorecard.service";
import { BarChart2 } from "lucide-react";
import AnalyticsChart from "@/components/dealer/AnalyticsChart";

export const dynamic = "force-dynamic";

export default async function DealerAnalyticsPage() {
  const dealer = await requireDealer();
  const scorecard = await computeDealerScorecard(dealer.id, 90);

  const summaryStats = [
    { label: "Invitations", value: scorecard.invitationsReceived, color: "#0B5FD1" },
    { label: "Offers Submitted", value: scorecard.offersSubmitted, color: "#2196F3" },
    { label: "Deals Won", value: scorecard.dealsWon, color: "#50D14E" },
  ];

  const chartData = scorecard.snapshots.slice(0, 10).reverse().map(s => ({
    date: s.date.toLocaleDateString("en-US", { month: "short" }),
    winRate: Math.round(s.offerWinRate),
  }));

  return (
    <div className="p-6 md:p-8 max-w-4xl" data-testid="dealer-analytics-page">
      <div className="flex items-center gap-3 mb-6">
        <BarChart2 size={22} className="text-[#0B5FD1]" />
        <h1 className="text-xl font-bold text-slate-900">Analytics</h1>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-8">
        {summaryStats.map(s => (
          <div key={s.label} data-testid={`analytics-stat-${s.label.toLowerCase().replace(/\s+/g, "-")}`}
            className="bg-white border border-slate-200 rounded-xl p-5 text-center">
            <p className="text-3xl font-bold mb-1" style={{ color: s.color }}>{s.value}</p>
            <p className="text-xs text-slate-500">{s.label} (90 days)</p>
          </div>
        ))}
      </div>

      {chartData.length > 1 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-5" data-testid="analytics-chart">
          <p className="font-semibold text-slate-800 text-sm mb-4">Win Rate % by Period</p>
          <AnalyticsChart data={chartData} />
        </div>
      ) : (
        <div className="text-center py-12 text-slate-400 bg-white border border-slate-200 rounded-xl" data-testid="analytics-no-data">
          <p>Analytics will appear after your first offers are submitted.</p>
        </div>
      )}
    </div>
  );
}
