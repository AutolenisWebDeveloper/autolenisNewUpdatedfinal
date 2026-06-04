"use client";

// HeroLiveSignal — displays live buyer activity fetched from /api/public/platform-stats.
// The signal is only rendered when the API reports a real, positive active-auction
// count. We intentionally do NOT show a hardcoded fallback number: claiming "N buyers
// currently comparing offers" without real activity is an unsubstantiated activity
// signal (FTC). For a brand-new platform with no live auctions, the signal stays hidden.

import { useEffect, useState } from "react";

export default function HeroLiveSignal() {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/public/platform-stats")
      .then((r) => r.json())
      .then((d: { success: boolean; data?: { activeAuctions?: number } }) => {
        if (d.success && typeof d.data?.activeAuctions === "number") {
          setCount(d.data.activeAuctions);
        }
      })
      .catch(() => {});
  }, []);

  // Hide the signal entirely until there is real, positive live activity.
  if (count == null || count <= 0) return null;

  return (
    <div className="mt-6 inline-flex items-center gap-2.5" data-testid="hero-live-signal">
      <span className="relative flex h-2.5 w-2.5">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
      </span>
      <span className="text-xs text-[#4B5563]">
        <span className="font-semibold text-[#111827]">{count} {count === 1 ? "buyer" : "buyers"}</span> currently comparing dealer offers
      </span>
    </div>
  );
}
