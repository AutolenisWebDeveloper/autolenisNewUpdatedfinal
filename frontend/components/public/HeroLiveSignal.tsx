"use client";

// HeroLiveSignal — shows a genuinely live platform signal fetched from
// /api/public/platform-stats. It renders ONLY a real value from the database.
//
// Phase 4 F1: the previous version substituted a hardcoded "12 buyers" whenever
// the fetch failed or data was missing, and mislabeled `activeAuctions` as
// "buyers". Both are fabrications/misstatements shown to real visitors. Now:
//   - the value is the real `activeAuctions` count, labeled truthfully;
//   - if the fetch fails, is loading, or the count is not a positive number,
//     the component renders NOTHING (honest neutral state) — never a fake number.

import { useEffect, useState } from "react";

export default function HeroLiveSignal() {
  const [activeAuctions, setActiveAuctions] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/public/platform-stats")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { success?: boolean; data?: { activeAuctions?: number } } | null) => {
        if (cancelled) return;
        const n =
          d?.success && typeof d.data?.activeAuctions === "number"
            ? d.data.activeAuctions
            : null;
        setActiveAuctions(n);
      })
      .catch(() => {
        if (!cancelled) setActiveAuctions(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Only surface the signal when there is a real, positive live count.
  if (activeAuctions === null || activeAuctions <= 0) return null;

  return (
    <div className="mt-6 inline-flex items-center gap-2.5" data-testid="hero-live-signal">
      <span className="relative flex h-2.5 w-2.5">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
      </span>
      <span className="text-xs text-[#4B5563]">
        <span className="font-semibold text-[#111827]">
          {activeAuctions} live {activeAuctions === 1 ? "auction" : "auctions"}
        </span>{" "}
        running right now
      </span>
    </div>
  );
}
