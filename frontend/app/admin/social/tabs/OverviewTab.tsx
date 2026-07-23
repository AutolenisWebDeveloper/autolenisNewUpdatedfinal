"use client";
// Overview tab — extracted from SocialDashboardClient.tsx (decomposition, lazy-loaded).
import { useCallback, useEffect, useState } from "react";
import { Search, Sparkles, CheckCircle2, RefreshCw, Loader2, Flame } from "lucide-react";
import { fetchJson } from "../_shared/fetchJson";
import { fmtNum } from "../_shared/format";
import { StatCard } from "../_shared/StatCard";
import type { Post, Signal, Stats, TrendingData } from "../_shared/types";

// ─── Tab 1: Overview ─────────────────────────────────────────────────────────
function OverviewTab({
  stats, onRefresh, showToast,
}: {
  stats: Stats | null;
  onRefresh: () => Promise<void> | void;
  showToast: (m: string) => void;
}) {
  const [signals, setSignals] = useState<Signal[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [genResults, setGenResults] = useState<Record<string, { ok: boolean; count?: number; error?: string }>>({});
  const [genAllProgress, setGenAllProgress] = useState<{ done: number; total: number } | null>(null);
  const [trendingData, setTrendingData] = useState<TrendingData | null>(null);
  const [trendingStale, setTrendingStale] = useState(false);

  useEffect(() => {
    fetch("/api/admin/social/trending", { credentials: "include" })
      .then((r) => r.json())
      .then((d: { data?: { trending?: TrendingData | null; stale?: boolean } }) => {
        setTrendingData(d.data?.trending ?? null);
        setTrendingStale(d.data?.stale ?? false);
      })
      .catch(() => {});
  }, []);

  const loadSignals = useCallback(async () => {
    try {
      const data = await fetchJson<{ signals: Signal[] }>("/api/admin/social/signals");
      setSignals(data.signals);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to load signals");
    }
  }, [showToast]);

  useEffect(() => { void loadSignals(); }, [loadSignals]);

  const scanSignals = async () => {
    setBusy("scan");
    try {
      const data = await fetchJson<{ created: number }>("/api/admin/social/signals", { method: "POST" });
      showToast(`Scan complete — ${data.created} new signals`);
      await loadSignals();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Scan failed");
    } finally { setBusy(null); }
  };

  const generateForSignal = async (signal: Signal) => {
    setBusy(`gen-${signal.id}`);
    setGenResults((prev) => { const n = { ...prev }; delete n[signal.id]; return n; });
    try {
      const data = await fetchJson<{ postsCreated: number; postIds: string[]; created?: string[] }>("/api/admin/social/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signalId: signal.id, franchiseSlug: "how_autolenis_works" }),
      });
      const count = data.postsCreated ?? data.created?.length ?? 0;
      setGenResults((prev) => ({ ...prev, [signal.id]: { ok: true, count } }));
      showToast(`Generated ${count} post(s)`);
      await loadSignals();
      await onRefresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Generation failed";
      setGenResults((prev) => ({ ...prev, [signal.id]: { ok: false, error: msg } }));
      showToast(msg);
    } finally { setBusy(null); }
  };

  const generateAllSignals = async () => {
    const unprocessed = signals.filter((s) => !s.assetsGenerated);
    if (unprocessed.length === 0) { showToast("No unprocessed signals"); return; }
    setBusy("gen-all");
    setGenAllProgress({ done: 0, total: unprocessed.length });
    let done = 0;
    for (const signal of unprocessed) {
      try {
        const data = await fetchJson<{ postsCreated: number; postIds: string[]; created?: string[] }>("/api/admin/social/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ signalId: signal.id, franchiseSlug: "how_autolenis_works" }),
        });
        const count = data.postsCreated ?? data.created?.length ?? 0;
        setGenResults((prev) => ({ ...prev, [signal.id]: { ok: true, count } }));
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed";
        setGenResults((prev) => ({ ...prev, [signal.id]: { ok: false, error: msg } }));
      }
      done += 1;
      setGenAllProgress({ done, total: unprocessed.length });
    }
    setBusy(null);
    setGenAllProgress(null);
    showToast(`Generated posts for ${done}/${unprocessed.length} signals`);
    await loadSignals();
    await onRefresh();
  };

  const approveAllPending = async () => {
    setBusy("approve-all");
    try {
      const { posts } = await fetchJson<{ posts: Post[] }>("/api/admin/social/posts?status=PENDING_REVIEW&limit=100");
      if (posts.length === 0) { showToast("No pending posts"); return; }
      const data = await fetchJson<{ processed: number }>("/api/admin/social/posts/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve", ids: posts.map((p) => p.id) }),
      });
      showToast(`Approved ${data.processed} post(s)`);
      await onRefresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Bulk approve failed");
    } finally { setBusy(null); }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        <StatCard label="Total Posts" value={stats ? Object.values(stats.posts).reduce((a, b) => a + b, 0) : "—"} />
        <StatCard label="Pending Review" value={stats?.posts.pending ?? "—"} accent="text-amber-600" />
        <StatCard label="Scheduled" value={stats?.posts.scheduled ?? "—"} accent="text-indigo-600" />
        <StatCard label="Published" value={stats?.posts.published ?? "—"} accent="text-emerald-600" />
        <StatCard label="Videos Queued" value={stats ? stats.videos.queued + stats.videos.generating : "—"} accent="text-blue-600" />
        <StatCard label="Lead Score" value={stats ? fmtNum(stats.performance.totalLeadScore) : "—"} accent="text-al-primary" />
      </div>

      <div className="flex flex-wrap gap-2">
        <button data-testid="action-scan-signals" onClick={scanSignals} disabled={busy === "scan"}
          className="flex items-center gap-1.5 bg-al-primary text-white text-xs font-semibold px-4 py-2 rounded-lg disabled:opacity-50">
          {busy === "scan" ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />} Scan for Signals
        </button>
        <button data-testid="action-approve-all" onClick={approveAllPending} disabled={busy === "approve-all"}
          className="flex items-center gap-1.5 bg-white border border-[#E2E8F0] text-[#0F172A] text-xs font-semibold px-4 py-2 rounded-lg disabled:opacity-50">
          {busy === "approve-all" ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} Approve All Pending
        </button>
        <button data-testid="action-gen-all-signals" onClick={generateAllSignals} disabled={busy === "gen-all"}
          className="flex items-center gap-1.5 bg-white border border-[#E2E8F0] text-[#0F172A] text-xs font-semibold px-4 py-2 rounded-lg disabled:opacity-50">
          {busy === "gen-all" ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
          {genAllProgress ? `Generating… (${genAllProgress.done}/${genAllProgress.total})` : "Generate All Signals"}
        </button>
        <button data-testid="action-refresh" onClick={() => void onRefresh()}
          className="flex items-center gap-1.5 bg-white border border-[#E2E8F0] text-[#0F172A] text-xs font-semibold px-4 py-2 rounded-lg">
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      <div className="bg-white border border-[#E2E8F0] rounded-2xl shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-[#E2E8F0] flex items-center gap-2">
          <Sparkles size={14} className="text-al-primary" />
          <h2 className="text-sm font-bold text-[#0F172A]">Recent Signals</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-[#F8FAFC] text-[#64748B]">
              <tr>
                <th className="text-left font-semibold px-4 py-2">Signal Type</th>
                <th className="text-left font-semibold px-4 py-2">Make</th>
                <th className="text-left font-semibold px-4 py-2">City</th>
                <th className="text-left font-semibold px-4 py-2">Value</th>
                <th className="text-left font-semibold px-4 py-2">Assets</th>
                <th className="text-right font-semibold px-4 py-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {signals.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-[#94A3B8]">No signals yet. Run a scan.</td></tr>
              )}
              {signals.slice(0, 25).map((s) => (
                <tr key={s.id} className="border-t border-[#F1F5F9]">
                  <td className="px-4 py-2 font-medium text-[#0F172A]">{s.signalType}</td>
                  <td className="px-4 py-2 text-[#475569]">{s.make ?? "—"}</td>
                  <td className="px-4 py-2 text-[#475569]">{s.city ?? "—"}</td>
                  <td className="px-4 py-2 text-[#475569]">{s.signalValue ?? "—"}</td>
                  <td className="px-4 py-2">
                    {s.assetsGenerated
                      ? <span className="text-emerald-600 font-semibold">{s.assetCount} ✓</span>
                      : <span className="text-[#94A3B8]">none</span>}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {genResults[s.id]?.ok && (
                        <span className="text-[10px] font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-md">
                          {genResults[s.id].count} created
                        </span>
                      )}
                      {genResults[s.id] && !genResults[s.id].ok && (
                        <span title={genResults[s.id].error} className="text-[10px] font-semibold text-red-600 bg-red-50 px-2 py-0.5 rounded-md cursor-help">
                          Failed
                        </span>
                      )}
                      <button data-testid={`generate-signal-${s.id}`} onClick={() => generateForSignal(s)} disabled={busy === `gen-${s.id}`}
                        className="text-al-primary font-semibold hover:underline disabled:opacity-50">
                        {busy === `gen-${s.id}` ? "Generating…" : "Generate"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {trendingData && (
        <div className="bg-white rounded-2xl border border-[#E2E8F0] p-4 mt-4">
          <div className="flex items-center gap-2 mb-3">
            <Flame size={16} className="text-orange-500" />
            <h3 className="font-medium text-[#0F172A] text-sm">Trending Today</h3>
            {trendingStale && (
              <span className="text-xs text-amber-500 ml-auto">Stale — updates at 5AM UTC</span>
            )}
          </div>

          {trendingData.tiktokHashtags && (
            <div className="mb-2">
              <p className="text-xs text-slate-500 mb-1">TikTok hashtags</p>
              <div className="flex flex-wrap gap-1">
                {trendingData.tiktokHashtags.slice(0, 8).map((tag) => (
                  <span key={tag} className="text-xs bg-al-primary-subtle text-al-primary px-2 py-0.5 rounded-full">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}

          {trendingData.redditTopics && (
            <div className="mb-2">
              <p className="text-xs text-slate-500 mb-1">Reddit buyers are asking</p>
              {trendingData.redditTopics.map((topic, i) => (
                <p key={i} className="text-xs text-[#475569] italic mb-0.5">&ldquo;{topic}&rdquo;</p>
              ))}
            </div>
          )}

          {trendingData.googleTrends && (
            <div>
              <p className="text-xs text-slate-500 mb-1">Google Trends</p>
              {trendingData.googleTrends.map((trend, i) => (
                <span key={i} className="text-xs text-emerald-600 mr-2">↑ {trend}</span>
              ))}
            </div>
          )}
        </div>
      )}

      <p className="text-[10px] text-[#94A3B8]">Tip: click a post in any tab to open its detail drawer.</p>
    </div>
  );
}

// ─── Tab 2: Content Calendar ─────────────────────────────────────────────────

export default OverviewTab;
