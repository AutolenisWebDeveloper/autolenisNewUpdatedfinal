"use client";

import { useEffect, useState } from "react";
import { TrendingUp, Users, Building2, Award, Clock } from "lucide-react";

interface PlatformStats {
  dealsCompleted: number;
  avgSavingsDollars: number;
  verifiedDealers: number;
  buyersServed: number;
  avgAuctionBids: number;
}

// Initial values are zero — they match the brand-new platform state and avoid
// the SSR/CSR mismatch that would arise from hardcoded marketing numbers
// (1,847 deals, 312 dealers, etc.). The strip itself stays hidden until the
// /api/public/platform-stats response confirms there is real activity to show.
const INITIAL: PlatformStats = {
  dealsCompleted: 0,
  avgSavingsDollars: 0,
  verifiedDealers: 0,
  buyersServed: 0,
  avgAuctionBids: 0,
};

function StatItem({ icon: Icon, value, label }: { icon: React.ElementType; value: string; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1 px-6" data-testid={`stat-${label.toLowerCase().replace(/\s+/g, "-")}`}>
      <div className="flex items-center gap-2">
        <Icon size={15} className="text-[#4DA3FF]" aria-hidden />
        <span className="text-xl font-bold text-white tracking-tight">{value}</span>
      </div>
      <span className="text-[11px] text-white/60 font-medium uppercase tracking-wider">{label}</span>
    </div>
  );
}

export default function StatsStrip() {
  const [stats, setStats] = useState<PlatformStats>(INITIAL);

  useEffect(() => {
    fetch("/api/public/platform-stats")
      .then((r) => r.json())
      .then((d: { success?: boolean; data?: PlatformStats }) => {
        if (d.success && d.data) setStats(d.data);
      })
      .catch(() => {});
  }, []);

  // Hide the entire stats banner until the platform has real activity.
  // For a brand-new platform every counter is zero — showing "0 Deals
  // Completed · $0 Avg Savings · 0 Verified Dealers" undermines marketing
  // credibility. Once any counter goes positive, the banner appears.
  const hasLiveActivity =
    stats.dealsCompleted > 0 ||
    stats.buyersServed > 0 ||
    stats.verifiedDealers > 0;

  if (!hasLiveActivity) return null;

  return (
    <section data-testid="stats-strip" className="bg-[#0B5FD1]">
      <div className="mx-auto max-w-7xl px-6 py-5">
        <div className="flex flex-wrap items-center justify-center gap-y-4 divide-x divide-white/15">
          <StatItem icon={Award} value={stats.dealsCompleted.toLocaleString()} label="Deals Completed" />
          <StatItem icon={TrendingUp} value={`$${stats.avgSavingsDollars.toLocaleString()}`} label="Avg Buyer Savings" />
          <StatItem icon={Building2} value={stats.verifiedDealers.toLocaleString()} label="Verified Dealers" />
          <StatItem icon={Users} value={`${stats.avgAuctionBids}x`} label="Avg Offers Per Buyer" />
          <StatItem icon={Clock} value="48hr" label="Offer Window" />
        </div>
      </div>
    </section>
  );
}
