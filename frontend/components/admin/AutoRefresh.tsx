"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { useAutoRefresh } from "@/lib/hooks/use-auto-refresh";

// Drop-in liveness for server-component admin pages: re-fetches the RSC
// payload on an interval (visibility-aware) so "Live" indicators are honest.
// Renders an optional last-updated caption; place next to the page header.
export default function AutoRefresh({
  intervalMs = 30_000,
  showTimestamp = true,
}: {
  intervalMs?: number;
  showTimestamp?: boolean;
}) {
  const router = useRouter();
  const refresh = useCallback(() => router.refresh(), [router]);
  const { lastRefreshed } = useAutoRefresh(refresh, { intervalMs });

  if (!showTimestamp || !lastRefreshed) return null;
  return (
    <span className="text-xs text-slate-400" data-testid="auto-refresh-timestamp">
      Updated {lastRefreshed.toLocaleTimeString()}
    </span>
  );
}
