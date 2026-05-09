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

const DEFAULT: PlatformStats = {
  dealsCompleted: 1847,
  avgSavingsDollars: 2300,
  verifiedDealers: 312,
  buyersServed: 3200,
  avgAuctionBids: 4.2,
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
  const [stats, setStats] = useState<PlatformStats>(DEFAULT);

  useEffect(() => {
    fetch("/api/public/platform-stats")
      .then((r) => r.json())
      .then((d: { success: boolean; data: PlatformStats }) => {
        if (d.success) setStats(d.data);
      })
      .catch(() => {});
  }, []);

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
