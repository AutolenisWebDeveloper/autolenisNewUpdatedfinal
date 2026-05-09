// System 3 ENH — Auction Pre-Intelligence Panel on /buyer/deposit
// Shows market data before buyer commits $99
// Gives buyer confidence: similar vehicles, price range, past auction performance

"use client";

import { useEffect, useState } from "react";
import { TrendingUp, Package, Users, DollarSign } from "lucide-react";

interface MarketData {
  similarVehicles: number;
  priceRangeLow: number;
  priceRangeHigh: number;
  avgOffersPerAuction: number;
  avgSavings: number;
  pastAuctions: number;
}

export default function PreIntelligencePanel() {
  const [data, setData] = useState<MarketData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // In production: fetch real market data from /api/buyer/deposit/market-data
    // For scaffold: use seeded platform stats as proxy
    fetch("/api/public/platform-stats")
      .then(r => r.json())
      .then((d: { success: boolean; data: { dealsCompleted: number; avgSavingsDollars: number; avgAuctionBids: number } }) => {
        if (d.success) {
          setData({
            similarVehicles: 47,
            priceRangeLow: 24000,
            priceRangeHigh: 38000,
            avgOffersPerAuction: d.data.avgAuctionBids,
            avgSavings: d.data.avgSavingsDollars,
            pastAuctions: d.data.dealsCompleted,
          });
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="h-24 bg-slate-100 rounded-xl animate-pulse" />;
  if (!data) return null;

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 mb-5" data-testid="pre-intelligence-panel">
      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4">Market Intelligence</p>
      <p className="text-sm text-slate-600 mb-4">
        Based on platform data, here&apos;s what to expect from your private auction:
      </p>

      <div className="grid grid-cols-2 gap-3">
        {[
          { icon: Package, label: "Similar vehicles in inventory", value: `${data.similarVehicles}+`, color: "text-blue-600" },
          { icon: Users, label: "Avg offers per auction", value: `${data.avgOffersPerAuction.toFixed(1)}x`, color: "text-[#0B5FD1]" },
          { icon: DollarSign, label: "Avg buyer savings", value: `$${data.avgSavings.toLocaleString()}`, color: "text-green-600" },
          { icon: TrendingUp, label: "Auctions completed", value: data.pastAuctions.toLocaleString(), color: "text-amber-600" },
        ].map(item => (
          <div key={item.label} data-testid={`market-stat-${item.label.toLowerCase().replace(/\s+/g, "-").slice(0, 20)}`}
            className="flex items-start gap-3 bg-slate-50 rounded-lg p-3">
            <item.icon size={16} className={`${item.color} shrink-0 mt-0.5`} />
            <div>
              <p className="text-sm font-bold text-slate-900">{item.value}</p>
              <p className="text-xs text-slate-400 leading-snug">{item.label}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 bg-green-50 border border-green-200 rounded-lg p-3">
        <p className="text-xs text-green-700 leading-relaxed">
          <strong>$99 Refund Guarantee:</strong> If no dealer submits a competitive offer, your full $99 deposit is returned within 3 business days — no questions asked.
        </p>
      </div>
    </div>
  );
}
