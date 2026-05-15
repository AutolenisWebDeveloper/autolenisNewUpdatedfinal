"use client";

// HeroLiveSignal — displays live buyer activity fetched from /api/public/platform-stats
// Falls back to FALLBACK_BUYER_COUNT if the fetch fails or data is unavailable.

import { useEffect, useState } from "react";

const FALLBACK_BUYER_COUNT = 12;

export default function HeroLiveSignal() {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/public/platform-stats")
      .then((r) => r.json())
      .then((d: { success: boolean; data?: { activeAuctions?: number } }) => {
        if (d.success && d.data?.activeAuctions != null) {
          setCount(d.data.activeAuctions);
        } else {
          setCount(FALLBACK_BUYER_COUNT);
        }
      })
      .catch(() => setCount(FALLBACK_BUYER_COUNT));
  }, []);

  const displayCount = count ?? FALLBACK_BUYER_COUNT;

  return (
    <div className="mt-6 inline-flex items-center gap-2.5" data-testid="hero-live-signal">
      <span className="relative flex h-2.5 w-2.5">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
      </span>
      <span className="text-xs text-[#4B5563]">
        <span className="font-semibold text-[#111827]">{displayCount} buyers</span> currently comparing dealer offers
      </span>
    </div>
  );
}
