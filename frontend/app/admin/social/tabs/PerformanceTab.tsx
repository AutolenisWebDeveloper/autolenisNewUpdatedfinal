"use client";
// Performance tab — extracted from SocialDashboardClient.tsx (lazy-loaded).
import { useCallback, useEffect, useMemo, useState } from "react";
import { DollarSign } from "lucide-react";
import { PLATFORM_BENCHMARKS } from "@/lib/social/config";
import { fetchJson } from "../_shared/fetchJson";
import { fmtNum } from "../_shared/format";
import { StatCard } from "../_shared/StatCard";
import { PLATFORMS, platformIcon } from "../_shared/ui";
import type { Post, Stats } from "../_shared/types";

function PerformanceTab({
  stats, onOpenPost, showToast,
}: { stats: Stats | null; onOpenPost: (p: Post) => void; showToast: (m: string) => void }) {
  const [topPosts, setTopPosts] = useState<Post[]>([]);

  const load = useCallback(async () => {
    try {
      const data = await fetchJson<{ posts: Post[] }>("/api/admin/social/posts?status=PUBLISHED&limit=50");
      setTopPosts([...data.posts].sort((a, b) => b.leadScore - a.leadScore).slice(0, 15));
    } catch (err) { showToast(err instanceof Error ? err.message : "Failed to load performance"); }
  }, [showToast]);
  useEffect(() => { void load(); }, [load]);

  const byPlatform = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of topPosts) map.set(p.platform, (map.get(p.platform) ?? 0) + p.leadScore);
    const max = Math.max(1, ...Array.from(map.values()));
    return PLATFORMS.map((pl) => ({ platform: pl, score: map.get(pl) ?? 0, pct: ((map.get(pl) ?? 0) / max) * 100 }));
  }, [topPosts]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Total Reach" value={stats ? fmtNum(stats.performance.totalReach) : "—"} />
        <StatCard label="Total Clicks" value={stats ? fmtNum(stats.performance.totalClicks) : "—"} accent="text-al-primary" />
        <StatCard label="Lead Score" value={stats ? fmtNum(stats.performance.totalLeadScore) : "—"} accent="text-emerald-600" />
        <StatCard label="Vehicle Requests" value={stats ? fmtNum(stats.performance.totalRequests) : "—"} accent="text-indigo-600" />
      </div>

      {stats?.revenue && (
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-white rounded-xl border border-[#E2E8F0] p-3">
            <p className="text-xs text-slate-500 flex items-center gap-1"><DollarSign size={12} /> Revenue Attributed</p>
            <p className="text-lg font-medium text-emerald-600">
              ${((stats.revenue.totalCents ?? 0) / 100).toLocaleString()}
            </p>
          </div>
          <div className="bg-white rounded-xl border border-[#E2E8F0] p-3">
            <p className="text-xs text-slate-500">Deals Won via Social</p>
            <p className="text-lg font-medium text-al-primary">{stats.revenue.dealsWon ?? 0}</p>
          </div>
          {stats.revenue.topPost && (
            <div className="col-span-2 bg-white rounded-xl border border-[#E2E8F0] p-3">
              <p className="text-xs text-slate-500 mb-1">Top Revenue Post</p>
              <p className="text-xs text-[#0F172A]">&ldquo;{stats.revenue.topPost.hook}&rdquo;</p>
              <p className="text-xs text-emerald-600 mt-1">
                ${((stats.revenue.topPost.revenueCents ?? 0) / 100).toLocaleString()}
              </p>
            </div>
          )}
        </div>
      )}

      <div className="bg-white border border-[#E2E8F0] rounded-2xl shadow-sm p-4">
        <h2 className="text-sm font-bold text-[#0F172A] mb-3">Lead Score by Platform</h2>
        <div className="space-y-2">
          {byPlatform.map((b) => (
            <div key={b.platform} className="flex items-center gap-3">
              <span className="w-20 text-xs capitalize text-[#64748B] flex items-center gap-1">{platformIcon(b.platform, 12)}{b.platform}</span>
              <div className="flex-1 h-4 bg-[#F1F5F9] rounded-full overflow-hidden">
                <div className="h-full bg-al-primary rounded-full" style={{ width: `${b.pct}%` }} />
              </div>
              <span className="w-12 text-right text-xs font-semibold text-[#0F172A]">{fmtNum(b.score)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-[#E2E8F0] p-4">
        <h3 className="font-medium text-sm text-[#0F172A] mb-3">
          Platform Performance vs Industry Benchmarks
        </h3>
        <div className="space-y-2">
          {Object.entries(PLATFORM_BENCHMARKS).map(([platform, bench]) => (
            <div key={platform} className="flex items-center justify-between text-xs">
              <span className="capitalize text-slate-600 w-20">{platform}</span>
              <div className="flex items-center gap-4">
                <span className="text-slate-400">Avg CTR: {(bench.avgCTR * 100).toFixed(1)}%</span>
                <span className="text-slate-400">Avg Completion: {(bench.avgCompletionRate * 100).toFixed(0)}%</span>
                <span className="text-slate-400">Viral at: {bench.baselineViewsPerHour * bench.viralMultiplier}/hr</span>
              </div>
            </div>
          ))}
        </div>
        <p className="text-xs text-slate-400 mt-2">Industry averages for automotive content</p>
      </div>

      <div className="bg-white border border-[#E2E8F0] rounded-2xl shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-[#E2E8F0]"><h2 className="text-sm font-bold text-[#0F172A]">Top Performing Posts</h2></div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-[#F8FAFC] text-[#64748B]">
              <tr>
                <th className="text-left font-semibold px-4 py-2">Hook</th>
                <th className="text-left font-semibold px-4 py-2">Platform</th>
                <th className="text-left font-semibold px-4 py-2">Franchise</th>
                <th className="text-left font-semibold px-4 py-2">Lead Score</th>
                <th className="text-right font-semibold px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {topPosts.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-[#94A3B8]">No published posts yet.</td></tr>}
              {topPosts.map((p) => (
                <tr key={p.id} className="border-t border-[#F1F5F9] hover:bg-[#F8FAFC]">
                  <td className="px-4 py-2 max-w-[260px] truncate text-[#0F172A] font-medium">{p.hook}</td>
                  <td className="px-4 py-2 capitalize text-[#475569]"><span className="inline-flex items-center gap-1">{platformIcon(p.platform, 12)}{p.platform}</span></td>
                  <td className="px-4 py-2 text-[#475569]">{p.franchise?.name ?? "—"}</td>
                  <td className="px-4 py-2 font-bold text-al-primary">{p.leadScore}</td>
                  <td className="px-4 py-2 text-right"><button onClick={() => onOpenPost(p)} className="text-al-primary font-semibold hover:underline">View</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}


// ─── Tab: Leads ──────────────────────────────────────────────────────────────

export default PerformanceTab;
