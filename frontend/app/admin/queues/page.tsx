// Feature 11 — Admin Queue Command Center (8 tabs) with functional resolve
"use client";

import { useState, useCallback, useEffect } from "react";
import { AlertOctagon, CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ErrorState } from "@/components/ui/kit";
import { useAutoRefresh } from "@/lib/hooks/use-auto-refresh";

const QUEUE_TABS = [
  { id: "ofac",           label: "OFAC Escalations",       priority: "P0" as const },
  { id: "contract-fail",  label: "Contract Failures",       priority: "P1" as const },
  { id: "insurance",      label: "Insurance Exceptions",    priority: "P1" as const },
  { id: "esign",          label: "E-Sign Exceptions",       priority: "P1" as const },
  { id: "pickup",         label: "Pickup Exceptions",       priority: "P2" as const },
  { id: "prequal",        label: "Prequal Manual Review",   priority: "P1" as const },
  { id: "support",        label: "Support Tickets",         priority: "P2" as const },
  { id: "system",         label: "System Alerts",           priority: "P0" as const },
];

// Map UI tab id → API queueType param
const QUEUE_TYPE_MAP: Record<string, string> = {
  "ofac":          "OFAC_ALERT",
  "contract-fail": "CONTRACT_FAIL",
  "insurance":     "INSURANCE_EXCEPTION",
  "esign":         "ESIGN_EXCEPTION",
  "pickup":        "PICKUP_EXCEPTION",
  "prequal":       "PREQUAL_MANUAL",
  "support":       "SUPPORT_TICKET",
  "system":        "SYSTEM_ALERT",
};

interface QueueItem { id: string; [key: string]: unknown }

export default function AdminQueuesPage() {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [resolving, setResolving] = useState<Record<string, boolean>>({});
  const [resolved, setResolved] = useState<Record<string, boolean>>({});
  const [items, setItems] = useState<Record<string, QueueItem[]>>({});
  const [loadError, setLoadError] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Fetch counts for all queues
  const loadCounts = useCallback(async () => {
    const results = await Promise.all(
      QUEUE_TABS.map(async tab => {
        const res = await fetch(`/api/admin/queues/${QUEUE_TYPE_MAP[tab.id]}`);
        if (!res.ok) throw new Error(`queue ${tab.id} returned ${res.status}`);
        const json = await res.json() as { success?: boolean; data?: { items: QueueItem[] } };
        return { id: tab.id, count: json.data?.items?.length ?? 0, items: json.data?.items ?? [] };
      })
    );
    const newCounts: Record<string, number> = {};
    const newItems: Record<string, QueueItem[]> = {};
    results.forEach(r => { newCounts[r.id] = r.count; newItems[r.id] = r.items; });
    setCounts(newCounts);
    setItems(newItems);
  }, []);

  const guardedLoad = useCallback(async () => {
    try {
      await loadCounts();
      setLoadError(false);
    } catch {
      setLoadError(true);
    } finally {
      setLoaded(true);
    }
  }, [loadCounts]);

  useEffect(() => { void guardedLoad(); }, [guardedLoad]);

  // Operational queue — keep counts current without manual reloads.
  const { refresh, refreshing, lastRefreshed } = useAutoRefresh(guardedLoad, { intervalMs: 30_000 });

  async function resolve(tabId: string, itemId: string) {
    const key = `${tabId}-${itemId}`;
    setResolving(p => ({ ...p, [key]: true }));
    try {
      const res = await fetch(`/api/admin/queues/${QUEUE_TYPE_MAP[tabId]}/${itemId}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resolution: "Resolved via admin console" }),
      });
      const json = await res.json().catch(() => null) as { success?: boolean; error?: { message?: string } } | null;
      if (!res.ok || !json?.success) {
        throw new Error(json?.error?.message ?? `Resolve failed (${res.status})`);
      }
      setResolved(p => ({ ...p, [key]: true }));
      setCounts(p => ({ ...p, [tabId]: Math.max(0, (p[tabId] ?? 0) - 1) }));
      setItems(p => ({ ...p, [tabId]: (p[tabId] ?? []).filter(i => i.id !== itemId) }));
      toast.success("Queue item resolved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to resolve queue item");
    }
    setResolving(p => ({ ...p, [key]: false }));
  }

  return (
    <div className="p-6 md:p-8 max-w-5xl" data-testid="admin-queues-page">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <AlertOctagon size={22} className="text-al-primary" />
          <h1 className="text-xl font-bold text-slate-900">Exception Queue Command Center</h1>
        </div>
        <div className="flex items-center gap-3">
          {lastRefreshed && (
            <span className="text-xs text-slate-400" data-testid="queues-last-refreshed">
              Updated {lastRefreshed.toLocaleTimeString()}
            </span>
          )}
          <Button size="sm" variant="outline" onClick={() => void refresh()} disabled={refreshing}
            data-testid="queues-refresh-btn" className="gap-1.5">
            <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} aria-hidden />
            Refresh
          </Button>
        </div>
      </div>

      {loadError && (
        <div className="mb-6 bg-white border border-red-200 rounded-xl">
          <ErrorState
            title="Failed to load queues"
            description="One or more queues could not be loaded. Counts below may be stale."
            onRetry={() => void refresh()}
            data-testid="queues-load-error"
          />
        </div>
      )}

      {!loaded ? (
        <div className="flex items-center justify-center py-24" data-testid="queues-loading">
          <Loader2 size={20} className="animate-spin text-slate-400" />
        </div>
      ) : (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {QUEUE_TABS.map(queue => {
          const count = counts[queue.id] ?? 0;
          const tabItems = items[queue.id] ?? [];
          const hasItems = count > 0 || tabItems.length > 0;

          return (
            <div key={queue.id} data-testid={`queue-tab-${queue.id}`}
              className={`bg-white border-2 rounded-xl p-5 transition-all ${hasItems ? "border-red-200" : "border-slate-200"}`}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Badge
                    variant={queue.priority === "P0" ? "destructive" : queue.priority === "P1" ? "amber" : "secondary"}
                    className="text-xs">
                    {queue.priority}
                  </Badge>
                  <span className="font-semibold text-slate-900 text-sm">{queue.label}</span>
                </div>
                {hasItems && (
                  <span className="bg-red-500 text-white text-xs font-bold w-6 h-6 rounded-full flex items-center justify-center"
                    data-testid={`queue-count-${queue.id}`}>
                    {count}
                  </span>
                )}
              </div>

              {!hasItems ? (
                <p className="text-sm text-slate-400" data-testid={`queue-empty-${queue.id}`}>No items in queue</p>
              ) : (
                <div className="space-y-2">
                  {tabItems.slice(0, 3).map(item => {
                    const key = `${queue.id}-${item.id}`;
                    const isResolved = resolved[key];
                    const isResolving = resolving[key];
                    return (
                      <div key={item.id} data-testid={`queue-item-${queue.id}-${item.id}`}
                        className="flex items-center justify-between bg-slate-50 rounded-lg px-3 py-2 text-xs">
                        <span className="text-slate-600 font-mono truncate max-w-[140px]">{item.id.slice(-8)}</span>
                        {isResolved ? (
                          <span className="flex items-center gap-1 text-green-600 text-xs font-medium" data-testid={`queue-resolved-${key}`}>
                            <CheckCircle2 size={12} /> Resolved
                          </span>
                        ) : (
                          <Button size="sm" variant="secondary" disabled={isResolving}
                            data-testid={`queue-resolve-${queue.id}-${item.id}`}
                            onClick={() => resolve(queue.id, item.id)}
                            className="h-6 text-xs px-2">
                            {isResolving ? <Loader2 size={10} className="animate-spin" /> : "Resolve"}
                          </Button>
                        )}
                      </div>
                    );
                  })}
                  {count > 3 && (
                    <p className="text-xs text-slate-400 text-center">{count - 3} more items</p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      )}
    </div>
  );
}
