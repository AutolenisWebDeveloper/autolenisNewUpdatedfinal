'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export interface AutoRefreshOptions {
  /** Poll interval in ms. Default 30s — operational queues, not real-time trading. */
  intervalMs?: number;
  /** Pause polling while the tab is hidden (default true). */
  pauseWhenHidden?: boolean;
  /** Set false to disable polling entirely (manual refresh still works). */
  enabled?: boolean;
}

export interface AutoRefreshState {
  /** Manually trigger a refresh (also resets the interval timer). */
  refresh: () => Promise<void>;
  /** True while a refresh (manual or scheduled) is in flight. */
  refreshing: boolean;
  /** Timestamp of the last successful refresh, null before the first one. */
  lastRefreshed: Date | null;
}

/**
 * Operational auto-refresh for admin surfaces (queues, health, KPIs).
 * Runs `fn` every `intervalMs`, pauses while the document is hidden, refreshes
 * immediately when the tab becomes visible again, and never overlaps calls.
 * The callback owns its error handling — a rejected `fn` stops neither the
 * interval nor future refreshes.
 */
export function useAutoRefresh(
  fn: () => void | Promise<void>,
  { intervalMs = 30_000, pauseWhenHidden = true, enabled = true }: AutoRefreshOptions = {},
): AutoRefreshState {
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const inFlight = useRef(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  const run = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setRefreshing(true);
    try {
      await fnRef.current();
      setLastRefreshed(new Date());
    } catch {
      // Caller surfaces its own errors; polling keeps going.
    } finally {
      inFlight.current = false;
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;

    const tick = () => {
      if (pauseWhenHidden && document.visibilityState === 'hidden') return;
      void run();
    };
    const id = window.setInterval(tick, intervalMs);

    const onVisible = () => {
      if (document.visibilityState === 'visible') void run();
    };
    if (pauseWhenHidden) document.addEventListener('visibilitychange', onVisible);

    return () => {
      window.clearInterval(id);
      if (pauseWhenHidden) document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled, intervalMs, pauseWhenHidden, run]);

  return { refresh: run, refreshing, lastRefreshed };
}
