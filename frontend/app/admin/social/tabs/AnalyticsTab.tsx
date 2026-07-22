"use client";
// Analytics & Optimization tab — extracted from SocialDashboardClient.tsx as part
// of the social-dashboard decomposition (lazy-loaded by the shell). Behavior
// unchanged from the original inline component.
import { useCallback, useEffect, useState } from "react";
import { fetchJson } from "../_shared/fetchJson";
import { StatusBadge } from "../_shared/ui";
import type { Post } from "../_shared/types";

// ─── Tab: Analytics & Optimization ───────────────────────────────────────────
type AnalysisResult = {
  overallScore: number;
  strengths: string[];
  weaknesses: string[];
  recommendations: {
    priority: string;
    action: string;
    expectedImpact: string;
    howTo: string;
  }[];
  hookAnalysis: {
    score: number;
    feedback: string;
    improvedHook: string;
  };
  bestTimeToPost: string;
  viralPotential: string;
  viralPotentialReason: string;
  optimizedVersion: {
    hook: string;
    caption: string;
    hashtags: string[];
    callToAction: string;
  };
};

type OptimizedVersions = Record<string, {
  hook: string;
  caption: string;
  hashtags: string[];
  viralFormat: string;
  scheduledTime: string;
  estimatedReach: string;
}>;

const ANALYTICS_PLATFORMS = ["tiktok", "instagram", "facebook", "youtube", "linkedin"];

// Status views for the optimization tab. "live" merges everything currently on
// (or going onto) a platform so the admin can view all current posts at once;
// the rest scope to a single status.
const ANALYTICS_STATUS_FILTERS: { key: string; label: string; statuses: string[] }[] = [
  { key: "live", label: "All Current", statuses: ["PUBLISHED", "SCHEDULED", "PUBLISHING"] },
  { key: "published", label: "Published", statuses: ["PUBLISHED"] },
  { key: "scheduled", label: "Scheduled", statuses: ["SCHEDULED"] },
  { key: "failed", label: "Failed", statuses: ["FAILED"] },
];

function AnalyticsTab({ showToast }: { showToast: (m: string) => void }) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [optimized, setOptimized] = useState<OptimizedVersions | null>(null);
  const [platformFilter, setPlatformFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("live");
  const [publishingAll, setPublishingAll] = useState(false);
  const [publishStrategy, setPublishStrategy] =
    useState<"immediate" | "staggered">("staggered");

  const loadPosts = useCallback(async () => {
    setLoading(true);
    try {
      const view =
        ANALYTICS_STATUS_FILTERS.find((s) => s.key === statusFilter) ??
        ANALYTICS_STATUS_FILTERS[0];
      const platformQs =
        platformFilter === "all" ? "" : `&platform=${platformFilter}`;
      // The posts API filters by a single status, so fetch each status in the
      // selected view and merge. Most views are a single status.
      const results = await Promise.all(
        view.statuses.map((status) =>
          fetchJson<{ posts: Post[] }>(
            `/api/admin/social/posts?status=${status}&limit=50${platformQs}`,
          ).catch(() => ({ posts: [] as Post[] })),
        ),
      );
      const merged = results.flatMap((r) => r.posts);
      // Published first (richest for optimization), then by lead score.
      merged.sort((a, b) => {
        if (a.status !== b.status) {
          if (a.status === "PUBLISHED") return -1;
          if (b.status === "PUBLISHED") return 1;
        }
        return b.leadScore - a.leadScore;
      });
      setPosts(merged);
    } catch {
      showToast("Failed to load posts");
    } finally {
      setLoading(false);
    }
  }, [platformFilter, statusFilter, showToast]);

  useEffect(() => { void loadPosts(); }, [loadPosts]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await fetchJson<{ synced: number; message: string }>(
        "/api/admin/social/analytics/sync",
        { method: "POST", body: JSON.stringify({}) },
      );
      showToast(res.message);
      void loadPosts();
    } catch {
      showToast("Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  const handleAnalyze = async (post: Post) => {
    setSelectedPost(post);
    setAnalysis(null);
    setOptimized(null);
    setAnalyzing(true);
    try {
      const res = await fetchJson<{ analysis: AnalysisResult }>(
        "/api/admin/social/analytics/analyze",
        { method: "POST", body: JSON.stringify({ postId: post.id }) },
      );
      setAnalysis(res.analysis);
    } catch {
      showToast("Analysis failed");
    } finally {
      setAnalyzing(false);
    }
  };

  const handleViralOptimize = async () => {
    if (!selectedPost) return;
    setOptimizing(true);
    try {
      const res = await fetchJson<{ optimizedVersions: OptimizedVersions }>(
        "/api/admin/social/analytics/viral-optimize",
        { method: "POST", body: JSON.stringify({ postId: selectedPost.id }) },
      );
      setOptimized(res.optimizedVersions);
      showToast("Viral optimization complete");
    } catch {
      showToast("Optimization failed");
    } finally {
      setOptimizing(false);
    }
  };

  const handleRepost = async (
    post: Post,
    platform: string,
    overrides?: { hook?: string; caption?: string; hashtags?: string[] },
  ) => {
    try {
      await fetchJson(
        `/api/admin/social/posts/${post.id}/repost`,
        {
          method: "POST",
          body: JSON.stringify({
            platform,
            isOptimized: !!overrides,
            ...overrides,
          }),
        },
      );
      showToast(`Post queued for ${platform}`);
    } catch {
      showToast("Repost failed");
    }
  };

  const handlePublishAll = async () => {
    if (!selectedPost) return;
    if (!confirm(
      `Publish optimized versions of this post to all 5 platforms?\n\n` +
      `Strategy: ${publishStrategy}\n` +
      `Viral optimizer: ON\n\n` +
      `This creates 5 new posts with AI-optimized content for each platform.`
    )) return;

    setPublishingAll(true);
    try {
      const res = await fetchJson<{
        created: { platform: string; scheduledAt: string }[];
        failed: { platform: string; error: string }[];
        total: number;
        succeeded: number;
      }>("/api/admin/social/publish-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourcePostId: selectedPost.id,
          platforms: ["tiktok", "instagram", "facebook", "youtube", "linkedin"],
          useViralOptimizer: true,
          schedulingStrategy: publishStrategy,
        }),
      });

      const succeeded = res.succeeded ?? res.created?.length ?? 0;
      const failedCount = res.failed?.length ?? 0;
      if (succeeded > 0) {
        showToast(
          `✅ Published to ${succeeded} platform${succeeded === 1 ? "" : "s"}!` +
            (failedCount > 0 ? ` (${failedCount} failed)` : ""),
        );
      } else {
        showToast("Publishing failed — check logs");
      }
    } catch {
      showToast("Publish all failed");
    } finally {
      setPublishingAll(false);
    }
  };

  const scoreColor = (score: number) =>
    score >= 80 ? "text-emerald-600"
    : score >= 60 ? "text-amber-600"
    : "text-red-500";

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-[#0F172A]">
          Social Analytics &amp; Optimization
        </h2>
        <button
          onClick={handleSync}
          disabled={syncing}
          className="text-xs bg-al-primary text-white px-3 py-1.5 rounded-lg hover:bg-[#0a54bc] disabled:opacity-50"
        >
          {syncing ? "Syncing..." : "↻ Sync Analytics"}
        </button>
      </div>

      {/* Status filter — view current posts across platforms by lifecycle. */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {ANALYTICS_STATUS_FILTERS.map((s) => (
          <button
            key={s.key}
            onClick={() => setStatusFilter(s.key)}
            className={`text-xs px-3 py-1 rounded-full border whitespace-nowrap ${
              statusFilter === s.key
                ? "bg-[#0F172A] text-white border-[#0F172A]"
                : "bg-white text-slate-600 border-[#E2E8F0]"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Platform filter */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {["all", ...ANALYTICS_PLATFORMS].map((p) => (
          <button
            key={p}
            onClick={() => setPlatformFilter(p)}
            className={`text-xs px-3 py-1 rounded-full border whitespace-nowrap ${
              platformFilter === p
                ? "bg-al-primary text-white border-al-primary"
                : "bg-white text-slate-600 border-[#E2E8F0]"
            }`}
          >
            {p === "all" ? "All Platforms" : p.charAt(0).toUpperCase() + p.slice(1)}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Posts list */}
        <div className="space-y-2">
          <p className="text-xs text-slate-500">
            {posts.length} {posts.length === 1 ? "post" : "posts"} — click to analyze &amp; optimize
          </p>
          {loading ? (
            <p className="text-xs text-slate-400">Loading...</p>
          ) : posts.length === 0 ? (
            <div className="bg-white rounded-xl border border-[#E2E8F0] p-6 text-center">
              <p className="text-sm text-slate-500">No posts in this view</p>
              <p className="text-xs text-slate-400 mt-1">
                Try a different status or platform filter, or publish a post first
              </p>
            </div>
          ) : (
            <div className="space-y-2 max-h-[600px] overflow-y-auto pr-1">
              {posts.map((post) => (
                <div
                  key={post.id}
                  onClick={() => handleAnalyze(post)}
                  className={`bg-white rounded-xl border p-3 cursor-pointer hover:border-al-primary transition-colors ${
                    selectedPost?.id === post.id
                      ? "border-al-primary ring-1 ring-al-primary/20"
                      : "border-[#E2E8F0]"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-medium capitalize text-al-primary bg-al-primary-subtle px-1.5 py-0.5 rounded">
                          {post.platform}
                        </span>
                        <StatusBadge status={post.status} />
                        <span className="text-xs text-slate-400 truncate">
                          {post.franchise?.name ?? "—"}
                        </span>
                      </div>
                      <p className="text-xs font-medium text-[#0F172A] line-clamp-2">
                        {post.hook}
                      </p>
                      <p className="text-xs text-slate-400 mt-1">
                        {post.publishedAt
                          ? new Date(post.publishedAt).toLocaleDateString()
                          : "Not published"}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-bold text-al-primary">
                        {post.leadScore}
                      </p>
                      <p className="text-xs text-slate-400">score</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Analysis panel */}
        <div>
          {!selectedPost ? (
            <div className="bg-white rounded-2xl border border-[#E2E8F0] p-6 text-center">
              <p className="text-sm text-slate-500">
                Select a post to analyze
              </p>
              <p className="text-xs text-slate-400 mt-1">
                AI will analyze performance and generate recommendations
              </p>
            </div>
          ) : analyzing ? (
            <div className="bg-white rounded-2xl border border-[#E2E8F0] p-6 text-center">
              <p className="text-sm text-slate-500">🤖 Analyzing post...</p>
              <p className="text-xs text-slate-400 mt-1">
                This takes a few seconds
              </p>
            </div>
          ) : analysis ? (
            <div className="space-y-3">
              {/* Overall score */}
              <div className="bg-white rounded-2xl border border-[#E2E8F0] p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-bold text-[#0F172A]">AI Analysis</h3>
                  <div className="flex items-center gap-2">
                    <span className={`text-2xl font-bold ${scoreColor(analysis.overallScore)}`}>
                      {analysis.overallScore}
                    </span>
                    <span className="text-xs text-slate-400">/100</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 mb-3">
                  <div className="bg-[#F8FAFC] rounded-lg p-2">
                    <p className="text-xs text-slate-500">Viral Potential</p>
                    <p className={`text-sm font-medium capitalize ${
                      analysis.viralPotential === "high" ? "text-emerald-600"
                      : analysis.viralPotential === "medium" ? "text-amber-600"
                      : "text-red-500"
                    }`}>
                      {analysis.viralPotential}
                    </p>
                  </div>
                  <div className="bg-[#F8FAFC] rounded-lg p-2">
                    <p className="text-xs text-slate-500">Hook Score</p>
                    <p className={`text-sm font-medium ${scoreColor(analysis.hookAnalysis.score)}`}>
                      {analysis.hookAnalysis.score}/100
                    </p>
                  </div>
                </div>

                <p className="text-xs text-slate-500 mb-1">
                  {analysis.viralPotentialReason}
                </p>
                <p className="text-xs text-slate-500">
                  Best time: {analysis.bestTimeToPost}
                </p>
              </div>

              {/* Strengths */}
              <div className="bg-white rounded-xl border border-[#E2E8F0] p-3">
                <h4 className="text-xs font-semibold text-emerald-600 mb-2">
                  ✓ Strengths
                </h4>
                <ul className="space-y-1">
                  {analysis.strengths.map((s, i) => (
                    <li key={i} className="text-xs text-slate-600">• {s}</li>
                  ))}
                </ul>
              </div>

              {/* Recommendations */}
              <div className="bg-white rounded-xl border border-[#E2E8F0] p-3">
                <h4 className="text-xs font-semibold text-al-primary mb-2">
                  ⚡ Recommendations
                </h4>
                <div className="space-y-2">
                  {analysis.recommendations.slice(0, 3).map((r, i) => (
                    <div key={i} className="border-l-2 border-al-primary/30 pl-2">
                      <div className="flex items-center gap-1 mb-0.5">
                        <span className={`text-xs font-medium ${
                          r.priority === "high" ? "text-red-500"
                          : r.priority === "medium" ? "text-amber-600"
                          : "text-slate-500"
                        }`}>
                          {r.priority.toUpperCase()}
                        </span>
                      </div>
                      <p className="text-xs font-medium text-[#0F172A]">
                        {r.action}
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {r.expectedImpact}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Improved hook */}
              <div className="bg-al-primary-subtle rounded-xl border border-al-primary/20 p-3">
                <h4 className="text-xs font-semibold text-al-primary mb-1">
                  💡 Better Hook
                </h4>
                <p className="text-xs text-[#0F172A] font-medium">
                  &ldquo;{analysis.hookAnalysis.improvedHook}&rdquo;
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  {analysis.hookAnalysis.feedback}
                </p>
              </div>

              {/* Action buttons */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={handleViralOptimize}
                  disabled={optimizing}
                  className="bg-[#643293] text-white text-xs font-medium py-2 rounded-xl hover:bg-[#5a2883] disabled:opacity-50"
                >
                  {optimizing ? "Optimizing..." : "🚀 Viral Optimize"}
                </button>
                <button
                  onClick={() => handleRepost(selectedPost, selectedPost.platform)}
                  className="border border-al-primary text-al-primary text-xs font-medium py-2 rounded-xl hover:bg-al-primary/5"
                >
                  ↻ Repost Original
                </button>
              </div>

              {/* Cross-platform publishing */}
              <div className="bg-white rounded-xl border border-[#E2E8F0] p-3">
                {/* Strategy toggle */}
                <div className="flex gap-2 mb-2">
                  {(["staggered", "immediate"] as const).map((s) => (
                    <button
                      key={s}
                      onClick={() => setPublishStrategy(s)}
                      className={`text-xs px-2 py-1 rounded-lg border ${
                        publishStrategy === s
                          ? "bg-al-primary text-white border-al-primary"
                          : "text-slate-600 border-[#E2E8F0]"
                      }`}
                    >
                      {s === "staggered" ? "📅 Staggered" : "⚡ Immediate"}
                    </button>
                  ))}
                </div>

                {/* Publish all button */}
                <button
                  onClick={handlePublishAll}
                  disabled={publishingAll}
                  className="w-full bg-emerald-600 text-white text-xs font-semibold
                    py-2 rounded-xl hover:bg-emerald-700 disabled:opacity-50"
                >
                  {publishingAll
                    ? "Publishing to all platforms..."
                    : "🌐 Publish Everywhere (5 Platforms)"}
                </button>
              </div>

              {/* Optimized versions */}
              {optimized && (
                <div className="bg-white rounded-2xl border border-[#E2E8F0] p-4">
                  <h3 className="text-sm font-bold text-[#0F172A] mb-3">
                    🚀 Viral Optimized Versions
                  </h3>
                  <div className="space-y-3">
                    {Object.entries(optimized).map(([platform, version]) => (
                      <div key={platform} className="border border-[#E2E8F0] rounded-xl p-3">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-medium capitalize text-al-primary bg-al-primary-subtle px-2 py-0.5 rounded-full">
                            {platform}
                          </span>
                          <span className="text-xs text-slate-400">
                            {version.viralFormat}
                          </span>
                        </div>
                        <p className="text-xs font-medium text-[#0F172A] mb-1">
                          &ldquo;{version.hook}&rdquo;
                        </p>
                        <p className="text-xs text-slate-500 line-clamp-2 mb-2">
                          {version.caption}
                        </p>
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-slate-400">
                            Est. reach: {version.estimatedReach}
                          </span>
                          <button
                            onClick={() => handleRepost(selectedPost, platform, {
                              hook: version.hook,
                              caption: version.caption,
                              hashtags: version.hashtags,
                            })}
                            className="text-xs bg-al-primary text-white px-2 py-1 rounded-lg hover:bg-[#0a54bc]"
                          >
                            Publish to {platform}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>

      {/* Audience Insights — always visible, populated by Sync Analytics */}
      <AudienceInsights />
    </div>
  );
}

// ─── Audience Insights ───────────────────────────────────────────────────────
interface AudienceBreakdown {
  countries: { country: string; pct: number }[];
  ageRanges: { range: string; pct: number }[];
  genders: { gender: string; pct: number }[];
  updatedAt?: string;
}
interface AudienceResponse {
  platforms: Record<string, AudienceBreakdown | null>;
  lastUpdated: string | null;
}

function AudienceBar({ label, pct }: { label: string; pct: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-24 text-xs text-slate-600 truncate">{label}</span>
      <div className="flex-1 h-3 bg-slate-100 rounded-full">
        <div
          className="h-full bg-al-primary rounded-full"
          style={{ width: `${Math.min(Math.max(pct, 0), 100)}%` }}
        />
      </div>
      <span className="text-xs text-slate-500 w-8 text-right">{pct}%</span>
    </div>
  );
}

function AudienceInsights() {
  const [data, setData] = useState<AudienceResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [platform, setPlatform] = useState<string>(ANALYTICS_PLATFORMS[0]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchJson<AudienceResponse>("/api/admin/social/analytics/audience")
      .then((res) => {
        if (active) setData(res);
      })
      .catch(() => {
        if (active) setData(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const current = data?.platforms?.[platform] ?? null;
  const hasData =
    !!current &&
    (current.countries.length > 0 ||
      current.ageRanges.length > 0 ||
      current.genders.length > 0);

  return (
    <div className="bg-white rounded-2xl border border-[#E2E8F0] p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-[#0F172A]">Audience Insights</h3>
        {data?.lastUpdated && (
          <span className="text-xs text-slate-400">
            Updated {new Date(data.lastUpdated).toLocaleDateString()}
          </span>
        )}
      </div>

      {/* Platform selector */}
      <div className="flex gap-2 overflow-x-auto pb-2 mb-3">
        {ANALYTICS_PLATFORMS.map((p) => (
          <button
            key={p}
            onClick={() => setPlatform(p)}
            className={`text-xs px-3 py-1 rounded-full border whitespace-nowrap ${
              platform === p
                ? "bg-al-primary text-white border-al-primary"
                : "bg-white text-slate-600 border-[#E2E8F0]"
            }`}
          >
            {p.charAt(0).toUpperCase() + p.slice(1)}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-xs text-slate-400">Loading...</p>
      ) : !hasData ? (
        <p className="text-xs text-slate-400">
          Run Analytics Sync to load audience data
        </p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Top countries */}
          <div>
            <h4 className="text-xs font-semibold text-slate-600 mb-2">Top Countries</h4>
            <div className="space-y-1.5">
              {current!.countries.length === 0 ? (
                <p className="text-xs text-slate-400">No data</p>
              ) : (
                current!.countries
                  .slice(0, 6)
                  .map((c) => <AudienceBar key={c.country} label={c.country} pct={c.pct} />)
              )}
            </div>
          </div>

          {/* Age ranges */}
          <div>
            <h4 className="text-xs font-semibold text-slate-600 mb-2">Age Ranges</h4>
            <div className="space-y-1.5">
              {current!.ageRanges.length === 0 ? (
                <p className="text-xs text-slate-400">No data</p>
              ) : (
                current!.ageRanges
                  .slice(0, 6)
                  .map((a) => <AudienceBar key={a.range} label={a.range} pct={a.pct} />)
              )}
            </div>
          </div>

          {/* Gender split */}
          <div>
            <h4 className="text-xs font-semibold text-slate-600 mb-2">Gender Split</h4>
            <div className="space-y-1.5">
              {current!.genders.length === 0 ? (
                <p className="text-xs text-slate-400">No data</p>
              ) : (
                current!.genders.map((g) => (
                  <AudienceBar key={g.gender} label={g.gender} pct={g.pct} />
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default AnalyticsTab;
