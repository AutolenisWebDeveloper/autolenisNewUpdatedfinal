// Feature 29 — Dealer Health Monitor
// Shows real dealer metrics from DealerScorecardSnapshot and live Offer/Deal counts.
// No rankings are fabricated; if data is insufficient, shows empty state with label.

import { requireAdmin } from "@/lib/auth/admin-session";
import { getDealerHealthData } from "@/lib/services/admin/admin-ops.service";
import Link from "next/link";
import { Building2, TrendingUp, AlertTriangle, CheckCircle2 } from "lucide-react";

export const dynamic = "force-dynamic";

const TIER_COLOR: Record<string, string> = {
  GOLD: "bg-yellow-100 text-yellow-800 border-yellow-200",
  SILVER: "bg-slate-100 text-slate-700 border-slate-200",
  BRONZE: "bg-orange-100 text-orange-700 border-orange-200",
  STANDARD: "bg-slate-50 text-slate-600 border-slate-200",
};

export default async function DealerHealthPage() {
  await requireAdmin();

  const dealersWithHealth = await getDealerHealthData();
  const dealers = dealersWithHealth;
  const hasAnySnapshot = dealersWithHealth.some(d => d.snap !== null);

  return (
    <div className="p-6 md:p-8 max-w-6xl" data-testid="dealer-health-page">
      <div className="flex items-center gap-3 mb-6">
        <Building2 size={22} className="text-al-primary" />
        <div>
          <h1 className="text-xl font-bold text-slate-900">Dealer Health Monitor</h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Metrics from latest scorecard snapshot · Feature 29
          </p>
        </div>
      </div>

      {dealers.length === 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center" data-testid="dealer-health-empty">
          <Building2 size={32} className="text-slate-200 mx-auto mb-3" />
          <p className="text-slate-500 text-sm">No active dealers found.</p>
        </div>
      )}

      {dealers.length > 0 && !hasAnySnapshot && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6 flex items-start gap-3" data-testid="dealer-health-no-snapshots">
          <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
          <p className="text-sm text-amber-800">
            No scorecard snapshots exist yet. Metrics will appear once the scorecard job runs.
            Active dealer count is shown without scoring.
          </p>
        </div>
      )}

      {dealers.length > 0 && (
        <div className="space-y-3">
          {dealersWithHealth.map(dealer => {
            const snap = dealer.snap;
            const tier = snap?.tier ?? dealer.scorecardTier ?? "STANDARD";
            const tierClass = TIER_COLOR[tier] ?? TIER_COLOR.STANDARD;

            return (
              <div
                key={dealer.id}
                data-testid={`dealer-health-row-${dealer.id}`}
                className="bg-white border border-slate-200 rounded-xl p-5"
              >
                <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-slate-900 text-sm">{dealer.dealershipName}</p>
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${tierClass}`}>
                        {tier}
                      </span>
                    </div>
                    {(dealer.city || dealer.state) && (
                      <p className="text-xs text-slate-400 mt-0.5">
                        {[dealer.city, dealer.state].filter(Boolean).join(", ")}
                      </p>
                    )}
                  </div>
                  <Link
                    href={`/admin/dealers/${dealer.id}`}
                    className="text-xs text-al-primary hover:underline"
                    data-testid={`dealer-health-detail-${dealer.id}`}
                  >
                    View dealer →
                  </Link>
                </div>

                {snap ? (
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                    {[
                      {
                        label: "Win Rate",
                        value: `${Math.round(snap.offerWinRate * 100)}%`,
                        ok: snap.offerWinRate >= 0.3,
                        testid: "win-rate",
                      },
                      {
                        label: "Deal Completion",
                        value: `${Math.round(snap.dealCompletionRate * 100)}%`,
                        ok: snap.dealCompletionRate >= 0.7,
                        testid: "deal-completion",
                      },
                      {
                        label: "Response Rate",
                        value: `${Math.round(snap.auctionResponseRate * 100)}%`,
                        ok: snap.auctionResponseRate >= 0.6,
                        testid: "response-rate",
                      },
                      {
                        label: "Avg Response",
                        value: `${snap.avgResponseHours.toFixed(1)}h`,
                        ok: snap.avgResponseHours <= 24,
                        testid: "avg-response",
                      },
                      {
                        label: "Junk Fee Ratio",
                        value: `${(snap.junkFeeRatio * 100).toFixed(1)}%`,
                        ok: snap.junkFeeRatio <= 0.1,
                        testid: "junk-fee-ratio",
                      },
                    ].map(metric => (
                      <div
                        key={metric.label}
                        data-testid={`dealer-metric-${metric.testid}-${dealer.id}`}
                        className="text-center bg-slate-50 rounded-lg py-2 px-3"
                      >
                        <div className="flex items-center justify-center gap-1 mb-0.5">
                          {metric.ok ? (
                            <CheckCircle2 size={11} className="text-green-500" />
                          ) : (
                            <AlertTriangle size={11} className="text-amber-500" />
                          )}
                          <p className="text-sm font-bold text-slate-900">{metric.value}</p>
                        </div>
                        <p className="text-xs text-slate-500">{metric.label}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-xs text-slate-400" data-testid={`dealer-health-no-snap-${dealer.id}`}>
                    <TrendingUp size={13} />
                    <span>No scorecard data — {dealer._count.offers} offer(s) recorded</span>
                  </div>
                )}

                {snap && (
                  <p className="text-xs text-slate-400 mt-3">
                    Last snapshot: {new Date(snap.snapshotDate).toLocaleDateString()}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
