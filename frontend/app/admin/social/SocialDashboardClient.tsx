"use client";

// /admin/social — Social Intelligence & Media Engine dashboard (client).
// Six tabs: Overview, Content Calendar, Pending Review, Publishing Queue,
// Performance, Settings — plus a shared post-detail drawer and a fixed
// automation-mode badge. Data is read from /api/admin/social/* endpoints.

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Radio, Search, Sparkles, CheckCircle2, RefreshCw, Calendar, ClipboardCheck,
  Send, BarChart2, Settings as SettingsIcon, X, Copy, AlertTriangle,
  Facebook, Instagram, Youtube, Linkedin, Music2, ThumbsUp, Eye, MousePointerClick,
  Clock, Film, Loader2, Newspaper, ExternalLink, Video, Users,
} from "lucide-react";

// ─── Shared types ────────────────────────────────────────────────────────────
export interface FranchiseRow {
  id: string;
  slug: string;
  name: string;
  platforms: string[];
  cadence: string;
  requiresReview: boolean;
  active: boolean;
  avgLeadScore: number | null;
  postsGenerated: number;
}
export interface PlatformConnection {
  platform: string;
  connected: boolean;
}
interface ProviderConnections {
  buffer: { connected: boolean; channelCount: number };
  linkedin: { connected: boolean; pageId: string };
  higgsfield: { connected: boolean };
  automationMode: string;
}
interface MarketIndexLast {
  title: string | null;
  summary: string | null;
  publishedAt: string | null;
  platformPostId: string | null;
  linkedInUrl: string | null;
  status: string | null;
}
type AutomationMode = "MANUAL_REVIEW" | "HYBRID_AUTO" | "FULL_AUTO";

interface VideoLite {
  status: string;
  videoUrl: string | null;
  thumbnailUrl: string | null;
}
interface Post {
  id: string;
  platform: string;
  contentType: string;
  hookType: string | null;
  hook: string;
  script: string;
  caption: string;
  hashtags: string[];
  ctaText: string | null;
  funnelDestination: string | null;
  trackedUrl: string | null;
  complianceNotes: string | null;
  status: string;
  scheduledAt: string | null;
  publishedAt: string | null;
  leadScore: number;
  make: string | null;
  model: string | null;
  metro: string | null;
  franchise: { slug: string; name: string } | null;
  video: VideoLite | null;
}
interface Signal {
  id: string;
  signalType: string;
  make: string | null;
  model: string | null;
  city: string | null;
  signalValue: number | null;
  assetsGenerated: boolean;
  assetCount: number;
  detectedAt: string;
}
interface Stats {
  posts: { draft: number; pending: number; approved: number; scheduled: number; published: number; failed: number };
  videos: { queued: number; generating: number; ready: number; failed: number };
  performance: { totalReach: number; totalClicks: number; totalRequests: number; totalLeadScore: number };
  topFranchise: string;
  topHook: string;
  topPlatform: string;
}
interface SocialLead {
  id: string;
  platform: string | null;
  franchise: string | null;
  utmSource: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmHook: string | null;
  landingPage: string | null;
  firstName: string;
  lastName: string | null;
  email: string;
  phone: string | null;
  zip: string | null;
  city: string | null;
  state: string | null;
  vehicleInterest: string | null;
  make: string | null;
  model: string | null;
  budget: string | null;
  timeline: string | null;
  status: string;
  nurtureSequence: string | null;
  nurtureStep: number;
  lastEmailSentAt: string | null;
  convertedAt: string | null;
  createdAt: string;
}
interface LeadsResponse {
  leads: SocialLead[];
  total: number;
  stats: {
    thisWeek: number;
    today: number;
    topPlatform: string;
    conversionRate: number;
    byPlatform: { platform: string; count: number }[];
    byLandingPage: { page: string; count: number }[];
  };
}

// ─── Constants / helpers ─────────────────────────────────────────────────────
const PLATFORMS = ["facebook", "instagram", "tiktok", "youtube", "linkedin"] as const;
const TABS = [
  { key: "overview", label: "Overview", icon: BarChart2 },
  { key: "calendar", label: "Content Calendar", icon: Calendar },
  { key: "pending", label: "Pending Review", icon: ClipboardCheck },
  { key: "queue", label: "Publishing Queue", icon: Send },
  { key: "performance", label: "Performance", icon: BarChart2 },
  { key: "market-index", label: "Market Index", icon: Newspaper },
  { key: "leads", label: "Leads", icon: Users },
  { key: "settings", label: "Settings", icon: SettingsIcon },
] as const;
type TabKey = (typeof TABS)[number]["key"];

function platformIcon(platform: string, size = 14) {
  switch (platform) {
    case "facebook": return <Facebook size={size} />;
    case "instagram": return <Instagram size={size} />;
    case "youtube": return <Youtube size={size} />;
    case "linkedin": return <Linkedin size={size} />;
    case "tiktok": return <Music2 size={size} />;
    default: return <Radio size={size} />;
  }
}

const STATUS_STYLES: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-600",
  PENDING_REVIEW: "bg-amber-100 text-amber-700",
  APPROVED: "bg-blue-100 text-blue-700",
  SCHEDULED: "bg-indigo-100 text-indigo-700",
  PUBLISHING: "bg-cyan-100 text-cyan-700",
  PUBLISHED: "bg-emerald-100 text-emerald-700",
  FAILED: "bg-red-100 text-red-700",
  SKIPPED: "bg-slate-100 text-slate-500",
  REJECTED: "bg-rose-100 text-rose-700",
};
const VIDEO_STYLES: Record<string, string> = {
  SCRIPT_READY: "bg-slate-100 text-slate-600",
  VIDEO_QUEUED: "bg-amber-100 text-amber-700",
  VIDEO_GENERATING: "bg-blue-100 text-blue-700",
  VIDEO_READY: "bg-emerald-100 text-emerald-700",
  VIDEO_FAILED: "bg-red-100 text-red-700",
  PUBLISH_READY: "bg-emerald-100 text-emerald-700",
};

const LEAD_STATUS_STYLES: Record<string, string> = {
  NEW: "bg-blue-100 text-blue-700",
  NURTURING: "bg-amber-100 text-amber-700",
  CONVERTED: "bg-emerald-100 text-emerald-700",
  DEAD: "bg-slate-100 text-slate-500",
};
function LeadStatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold ${LEAD_STATUS_STYLES[status] ?? "bg-slate-100 text-slate-600"}`}>
      {status}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-md text-[10px] font-semibold ${STATUS_STYLES[status] ?? "bg-slate-100 text-slate-600"}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}
function VideoBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold ${VIDEO_STYLES[status] ?? "bg-slate-100 text-slate-600"}`}>
      {status === "VIDEO_GENERATING" && <Loader2 size={10} className="animate-spin" />}
      {status.replace(/_/g, " ")}
    </span>
  );
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: "include", ...init });

  // Read the raw body first so an empty or non-JSON response (e.g. a crashed
  // route returning a blank 500) surfaces a real error instead of throwing
  // "Unexpected end of JSON input".
  const text = await res.text();
  if (!text) {
    console.error(`[fetchJson] empty response body from ${url} (${res.status})`);
    throw new Error(`Server returned an empty response (${res.status})`);
  }

  let json: { success?: boolean; data?: T; error?: { message?: string } };
  try {
    json = JSON.parse(text) as typeof json;
  } catch {
    console.error(`[fetchJson] invalid JSON from ${url}:`, text.slice(0, 200));
    throw new Error(`Server returned an invalid response (${res.status})`);
  }

  if (!res.ok || json.success === false) {
    throw new Error(json.error?.message ?? `Request failed (${res.status})`);
  }
  return json.data as T;
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
function fmtNum(n: number): string {
  return n.toLocaleString("en-US");
}

// ─── Root component ──────────────────────────────────────────────────────────
export default function SocialDashboardClient({
  automationMode,
  franchises,
  platformConnections,
  videoEnabled,
  publishingEnabled,
}: {
  automationMode: AutomationMode;
  franchises: FranchiseRow[];
  platformConnections: PlatformConnection[];
  videoEnabled: boolean;
  publishingEnabled: boolean;
}) {
  const [tab, setTab] = useState<TabKey>("overview");
  const [stats, setStats] = useState<Stats | null>(null);
  const [drawerPost, setDrawerPost] = useState<Post | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  }, []);

  const loadStats = useCallback(async () => {
    try {
      setStats(await fetchJson<Stats>("/api/admin/social/stats"));
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to load stats");
    }
  }, [showToast]);

  useEffect(() => { void loadStats(); }, [loadStats]);

  const modeBadge = automationMode === "FULL_AUTO"
    ? { dot: "🟢", label: "FULL_AUTO", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" }
    : automationMode === "HYBRID_AUTO"
    ? { dot: "🟡", label: "HYBRID_AUTO", cls: "bg-amber-50 text-amber-700 border-amber-200" }
    : { dot: "🔴", label: "MANUAL_REVIEW", cls: "bg-red-50 text-red-700 border-red-200" };

  return (
    <div className="min-h-screen bg-[#F4F6FA] p-4 lg:p-8" data-testid="social-dashboard">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#0B5FD1] flex items-center justify-center">
            <Radio size={18} className="text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-[#0F172A] tracking-tight">Social Engine</h1>
            <p className="text-xs text-[#64748B]">AI content, video, publishing & attribution</p>
          </div>
        </div>
        <div
          data-testid="automation-mode-badge"
          className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-bold ${modeBadge.cls}`}
        >
          <span>{modeBadge.dot}</span>
          <span>{modeBadge.label}</span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 overflow-x-auto border-b border-[#E2E8F0]">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              data-testid={`social-tab-${t.key}`}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold whitespace-nowrap border-b-2 transition-colors ${
                active ? "border-[#0B5FD1] text-[#0B5FD1]" : "border-transparent text-[#64748B] hover:text-[#0F172A]"
              }`}
            >
              <Icon size={14} />
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === "overview" && (
        <OverviewTab stats={stats} onRefresh={loadStats} showToast={showToast} />
      )}
      {tab === "calendar" && <CalendarTab onOpenPost={setDrawerPost} showToast={showToast} />}
      {tab === "pending" && <PendingTab onOpenPost={setDrawerPost} onChanged={loadStats} showToast={showToast} />}
      {tab === "queue" && <QueueTab onOpenPost={setDrawerPost} onChanged={loadStats} showToast={showToast} />}
      {tab === "performance" && <PerformanceTab stats={stats} onOpenPost={setDrawerPost} showToast={showToast} />}
      {tab === "market-index" && <MarketIndexTab showToast={showToast} />}
      {tab === "leads" && <LeadsTab showToast={showToast} />}
      {tab === "settings" && (
        <SettingsTab
          automationMode={automationMode}
          franchises={franchises}
          platformConnections={platformConnections}
          videoEnabled={videoEnabled}
          publishingEnabled={publishingEnabled}
          showToast={showToast}
        />
      )}

      {drawerPost && (
        <PostDrawer
          post={drawerPost}
          onClose={() => setDrawerPost(null)}
          onChanged={() => { void loadStats(); }}
          showToast={showToast}
        />
      )}

      {toast && (
        <div className="fixed bottom-6 right-6 z-50 bg-[#0F172A] text-white text-xs px-4 py-2.5 rounded-lg shadow-lg" data-testid="social-toast">
          {toast}
        </div>
      )}
    </div>
  );
}

// ─── Stat card ───────────────────────────────────────────────────────────────
function StatCard({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
  return (
    <div className="bg-white border border-[#E2E8F0] rounded-2xl shadow-sm p-4">
      <p className="text-[10px] uppercase tracking-wider text-[#94A3B8] font-bold">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${accent ?? "text-[#0F172A]"}`}>{value}</p>
    </div>
  );
}

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
        <StatCard label="Lead Score" value={stats ? fmtNum(stats.performance.totalLeadScore) : "—"} accent="text-[#0B5FD1]" />
      </div>

      <div className="flex flex-wrap gap-2">
        <button data-testid="action-scan-signals" onClick={scanSignals} disabled={busy === "scan"}
          className="flex items-center gap-1.5 bg-[#0B5FD1] text-white text-xs font-semibold px-4 py-2 rounded-lg disabled:opacity-50">
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
          <Sparkles size={14} className="text-[#0B5FD1]" />
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
                        className="text-[#0B5FD1] font-semibold hover:underline disabled:opacity-50">
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
      <p className="text-[10px] text-[#94A3B8]">Tip: click a post in any tab to open its detail drawer.</p>
    </div>
  );
}

// ─── Tab 2: Content Calendar ─────────────────────────────────────────────────
function CalendarTab({ onOpenPost, showToast }: { onOpenPost: (p: Post) => void; showToast: (m: string) => void }) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [platform, setPlatform] = useState<string>("all");
  const [weekOffset, setWeekOffset] = useState(0);

  const weekStart = useMemo(() => {
    const d = new Date();
    const day = (d.getDay() + 6) % 7; // Monday = 0
    d.setDate(d.getDate() - day + weekOffset * 7);
    d.setHours(0, 0, 0, 0);
    return d;
  }, [weekOffset]);

  const load = useCallback(async () => {
    try {
      const qs = platform === "all" ? "" : `?platform=${platform}`;
      const data = await fetchJson<{ posts: Post[] }>(`/api/admin/social/posts${qs}${qs ? "&" : "?"}limit=100`);
      setPosts(data.posts);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to load calendar");
    }
  }, [platform, showToast]);
  useEffect(() => { void load(); }, [load]);

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return d;
  });
  const slots = [7, 12, 19];

  const postsFor = (day: Date, hour: number) =>
    posts.filter((p) => {
      if (!p.scheduledAt) return false;
      const s = new Date(p.scheduledAt);
      return s.toDateString() === day.toDateString() && s.getHours() >= hour && s.getHours() < hour + 5;
    });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1">
          {["all", ...PLATFORMS].map((p) => (
            <button key={p} data-testid={`calendar-platform-${p}`} onClick={() => setPlatform(p)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize ${platform === p ? "bg-[#0B5FD1] text-white" : "bg-white border border-[#E2E8F0] text-[#64748B]"}`}>
              {p}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setWeekOffset((w) => w - 1)} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-white border border-[#E2E8F0]">Previous</button>
          <button onClick={() => setWeekOffset(0)} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-white border border-[#E2E8F0]">This Week</button>
          <button onClick={() => setWeekOffset((w) => w + 1)} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-white border border-[#E2E8F0]">Next</button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-2">
        {days.map((day) => (
          <div key={day.toISOString()} className="bg-white border border-[#E2E8F0] rounded-2xl shadow-sm overflow-hidden">
            <div className="px-2 py-2 border-b border-[#E2E8F0] text-center">
              <p className="text-[10px] font-bold text-[#64748B] uppercase">{day.toLocaleDateString("en-US", { weekday: "short" })}</p>
              <p className="text-sm font-bold text-[#0F172A]">{day.getDate()}</p>
            </div>
            <div className="p-1.5 space-y-2 min-h-[280px]">
              {slots.map((hour) => (
                <div key={hour}>
                  <p className="text-[9px] text-[#94A3B8] font-semibold mb-1">{hour === 7 ? "7 AM" : hour === 12 ? "12 PM" : "7 PM"}</p>
                  <div className="space-y-1">
                    {postsFor(day, hour).map((p) => (
                      <button key={p.id} onClick={() => onOpenPost(p)} data-testid={`calendar-post-${p.id}`}
                        className="w-full text-left p-1.5 rounded-lg bg-[#F8FAFC] border border-[#E2E8F0] hover:border-[#0B5FD1]">
                        <div className="flex items-center gap-1 text-[#0B5FD1]">{platformIcon(p.platform, 11)}
                          <span className="text-[9px] font-semibold text-[#475569] truncate">{p.franchise?.name ?? p.platform}</span>
                        </div>
                        <div className="mt-0.5"><StatusBadge status={p.status} /></div>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Tab 3: Pending Review ───────────────────────────────────────────────────
function PendingTab({
  onOpenPost, onChanged, showToast,
}: { onOpenPost: (p: Post) => void; onChanged: () => void; showToast: (m: string) => void }) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await fetchJson<{ posts: Post[] }>("/api/admin/social/posts?status=PENDING_REVIEW&limit=100");
      setPosts(data.posts);
    } catch (err) { showToast(err instanceof Error ? err.message : "Failed to load"); }
  }, [showToast]);
  useEffect(() => { void load(); }, [load]);

  const act = async (id: string, action: "approve" | "reject") => {
    let rejectionReason: string | undefined;
    if (action === "reject") {
      rejectionReason = window.prompt("Rejection reason?") ?? undefined;
      if (rejectionReason === undefined) return;
    }
    try {
      await fetchJson(`/api/admin/social/posts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, rejectionReason }),
      });
      showToast(action === "approve" ? "Approved" : "Rejected");
      await load(); onChanged();
    } catch (err) { showToast(err instanceof Error ? err.message : "Action failed"); }
  };

  const bulk = async (action: "approve" | "reject") => {
    if (posts.length === 0) return;
    setBusy(true);
    try {
      await fetchJson("/api/admin/social/posts/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ids: posts.map((p) => p.id), rejectionReason: action === "reject" ? "Bulk rejected" : undefined }),
      });
      showToast(`Bulk ${action} complete`);
      await load(); onChanged();
    } catch (err) { showToast(err instanceof Error ? err.message : "Bulk action failed"); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-[#0F172A]">{posts.length} posts awaiting review</h2>
        <div className="flex gap-2">
          <button data-testid="bulk-approve" onClick={() => bulk("approve")} disabled={busy || posts.length === 0}
            className="bg-[#0B5FD1] text-white text-xs font-semibold px-3 py-1.5 rounded-lg disabled:opacity-50">Approve All ({posts.length})</button>
          <button data-testid="bulk-reject" onClick={() => bulk("reject")} disabled={busy || posts.length === 0}
            className="bg-white border border-rose-200 text-rose-600 text-xs font-semibold px-3 py-1.5 rounded-lg disabled:opacity-50">Reject All ({posts.length})</button>
        </div>
      </div>

      <div className="bg-white border border-[#E2E8F0] rounded-2xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-[#F8FAFC] text-[#64748B]">
              <tr>
                <th className="text-left font-semibold px-4 py-2">Platform</th>
                <th className="text-left font-semibold px-4 py-2">Franchise</th>
                <th className="text-left font-semibold px-4 py-2">Hook</th>
                <th className="text-left font-semibold px-4 py-2">Caption</th>
                <th className="text-left font-semibold px-4 py-2">Compliance</th>
                <th className="text-left font-semibold px-4 py-2">Scheduled</th>
                <th className="text-right font-semibold px-4 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {posts.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-[#94A3B8]">Nothing pending review.</td></tr>}
              {posts.map((p) => (
                <tr key={p.id} className="border-t border-[#F1F5F9] hover:bg-[#F8FAFC]">
                  <td className="px-4 py-2"><span className="inline-flex items-center gap-1 text-[#0B5FD1] capitalize">{platformIcon(p.platform, 12)}{p.platform}</span></td>
                  <td className="px-4 py-2 text-[#475569]">{p.franchise?.name ?? "—"}</td>
                  <td className="px-4 py-2 max-w-[180px] truncate text-[#0F172A] font-medium">{p.hook}</td>
                  <td className="px-4 py-2 max-w-[220px] truncate text-[#64748B]">{p.caption}</td>
                  <td className="px-4 py-2">{p.complianceNotes ? <AlertTriangle size={14} className="text-amber-500" /> : <span className="text-[#94A3B8]">—</span>}</td>
                  <td className="px-4 py-2 text-[#64748B]">{fmtDateTime(p.scheduledAt)}</td>
                  <td className="px-4 py-2">
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => act(p.id, "approve")} className="text-emerald-600 font-semibold hover:underline">Approve</button>
                      <button onClick={() => act(p.id, "reject")} className="text-rose-600 font-semibold hover:underline">Reject</button>
                      <button onClick={() => onOpenPost(p)} className="text-[#0B5FD1] font-semibold hover:underline">Edit</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── Tab 4: Publishing Queue ─────────────────────────────────────────────────
function QueueTab({
  onOpenPost, onChanged, showToast,
}: { onOpenPost: (p: Post) => void; onChanged: () => void; showToast: (m: string) => void }) {
  const [posts, setPosts] = useState<Post[]>([]);

  const load = useCallback(async () => {
    try {
      const [a, s] = await Promise.all([
        fetchJson<{ posts: Post[] }>("/api/admin/social/posts?status=APPROVED&limit=100"),
        fetchJson<{ posts: Post[] }>("/api/admin/social/posts?status=SCHEDULED&limit=100"),
      ]);
      const merged = [...a.posts, ...s.posts].sort((x, y) => (x.scheduledAt ?? "").localeCompare(y.scheduledAt ?? ""));
      setPosts(merged);
    } catch (err) { showToast(err instanceof Error ? err.message : "Failed to load queue"); }
  }, [showToast]);
  useEffect(() => { void load(); }, [load]);

  const publishNow = async (p: Post) => {
    try {
      await fetchJson(`/api/admin/social/posts/${p.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reschedule", scheduledAt: new Date().toISOString() }),
      });
      showToast("Moved to front of queue — will publish on next run");
      await load(); onChanged();
    } catch (err) { showToast(err instanceof Error ? err.message : "Publish failed"); }
  };

  return (
    <div className="bg-white border border-[#E2E8F0] rounded-2xl shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-[#F8FAFC] text-[#64748B]">
            <tr>
              <th className="text-left font-semibold px-4 py-2">Platform</th>
              <th className="text-left font-semibold px-4 py-2">Franchise</th>
              <th className="text-left font-semibold px-4 py-2">Scheduled</th>
              <th className="text-left font-semibold px-4 py-2">Video</th>
              <th className="text-left font-semibold px-4 py-2">Status</th>
              <th className="text-right font-semibold px-4 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {posts.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-[#94A3B8]">Queue is empty.</td></tr>}
            {posts.map((p) => (
              <tr key={p.id} className="border-t border-[#F1F5F9] hover:bg-[#F8FAFC]">
                <td className="px-4 py-2"><span className="inline-flex items-center gap-1 text-[#0B5FD1] capitalize">{platformIcon(p.platform, 12)}{p.platform}</span></td>
                <td className="px-4 py-2 text-[#475569]">{p.franchise?.name ?? "—"}</td>
                <td className="px-4 py-2 text-[#64748B]"><span className="inline-flex items-center gap-1"><Clock size={11} />{fmtDateTime(p.scheduledAt)}</span></td>
                <td className="px-4 py-2">{p.video ? <VideoBadge status={p.video.status} /> : <span className="text-[#94A3B8]">no video</span>}</td>
                <td className="px-4 py-2"><StatusBadge status={p.status} /></td>
                <td className="px-4 py-2">
                  <div className="flex items-center justify-end gap-2">
                    <button data-testid={`publish-now-${p.id}`} onClick={() => publishNow(p)} className="text-[#0B5FD1] font-semibold hover:underline">Publish Now</button>
                    <button onClick={() => onOpenPost(p)} className="text-[#64748B] font-semibold hover:underline">View Post</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Tab 5: Performance ──────────────────────────────────────────────────────
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
        <StatCard label="Total Clicks" value={stats ? fmtNum(stats.performance.totalClicks) : "—"} accent="text-[#0B5FD1]" />
        <StatCard label="Lead Score" value={stats ? fmtNum(stats.performance.totalLeadScore) : "—"} accent="text-emerald-600" />
        <StatCard label="Vehicle Requests" value={stats ? fmtNum(stats.performance.totalRequests) : "—"} accent="text-indigo-600" />
      </div>

      <div className="bg-white border border-[#E2E8F0] rounded-2xl shadow-sm p-4">
        <h2 className="text-sm font-bold text-[#0F172A] mb-3">Lead Score by Platform</h2>
        <div className="space-y-2">
          {byPlatform.map((b) => (
            <div key={b.platform} className="flex items-center gap-3">
              <span className="w-20 text-xs capitalize text-[#64748B] flex items-center gap-1">{platformIcon(b.platform, 12)}{b.platform}</span>
              <div className="flex-1 h-4 bg-[#F1F5F9] rounded-full overflow-hidden">
                <div className="h-full bg-[#0B5FD1] rounded-full" style={{ width: `${b.pct}%` }} />
              </div>
              <span className="w-12 text-right text-xs font-semibold text-[#0F172A]">{fmtNum(b.score)}</span>
            </div>
          ))}
        </div>
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
                  <td className="px-4 py-2 font-bold text-[#0B5FD1]">{p.leadScore}</td>
                  <td className="px-4 py-2 text-right"><button onClick={() => onOpenPost(p)} className="text-[#0B5FD1] font-semibold hover:underline">View</button></td>
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
const LEAD_STATUS_FILTERS = ["all", "NEW", "NURTURING", "CONVERTED", "DEAD"] as const;

function LeadsTab({ showToast }: { showToast: (m: string) => void }) {
  const [data, setData] = useState<LeadsResponse | null>(null);
  const [status, setStatus] = useState<string>("all");
  const [platform, setPlatform] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<SocialLead | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "50" });
      if (status !== "all") params.set("status", status);
      if (platform !== "all") params.set("platform", platform);
      setData(await fetchJson<LeadsResponse>(`/api/admin/social/leads?${params.toString()}`));
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to load leads");
    } finally {
      setLoading(false);
    }
  }, [status, platform, showToast]);
  useEffect(() => { void load(); }, [load]);

  const stats = data?.stats;
  const leads = data?.leads ?? [];

  return (
    <div className="space-y-6">
      {/* Stats row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Leads This Week" value={stats ? fmtNum(stats.thisWeek) : "—"} accent="text-[#0B5FD1]" />
        <StatCard label="Leads Today" value={stats ? fmtNum(stats.today) : "—"} accent="text-indigo-600" />
        <StatCard label="Top Platform" value={stats ? stats.topPlatform : "—"} />
        <StatCard label="Conversion Rate" value={stats ? `${stats.conversionRate}%` : "—"} accent="text-emerald-600" />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          {LEAD_STATUS_FILTERS.map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold capitalize transition-colors ${
                status === s ? "bg-[#0B5FD1] text-white" : "bg-white border border-[#E2E8F0] text-[#64748B] hover:text-[#0F172A]"
              }`}
            >
              {s === "all" ? "All" : s.toLowerCase()}
            </button>
          ))}
        </div>
        <select
          value={platform}
          onChange={(e) => setPlatform(e.target.value)}
          className="ml-auto bg-white border border-[#E2E8F0] rounded-lg px-3 py-1.5 text-xs text-[#0F172A]"
        >
          <option value="all">All platforms</option>
          {PLATFORMS.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
        <button
          onClick={() => void load()}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white border border-[#E2E8F0] text-xs font-semibold text-[#64748B] hover:text-[#0F172A]"
        >
          <RefreshCw size={12} /> Refresh
        </button>
      </div>

      {/* Leads table */}
      <div className="bg-white border border-[#E2E8F0] rounded-2xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-[#F8FAFC] text-[#64748B]">
              <tr>
                <th className="text-left font-semibold px-4 py-2">Name</th>
                <th className="text-left font-semibold px-4 py-2">Email</th>
                <th className="text-left font-semibold px-4 py-2">Vehicle</th>
                <th className="text-left font-semibold px-4 py-2">Platform</th>
                <th className="text-left font-semibold px-4 py-2">Landing Page</th>
                <th className="text-left font-semibold px-4 py-2">Status</th>
                <th className="text-left font-semibold px-4 py-2">Step</th>
                <th className="text-left font-semibold px-4 py-2">Date</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-[#94A3B8]">Loading leads…</td></tr>
              )}
              {!loading && leads.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-[#94A3B8]">No social leads yet.</td></tr>
              )}
              {!loading && leads.map((lead) => (
                <tr
                  key={lead.id}
                  onClick={() => setSelected(lead)}
                  className="border-t border-[#F1F5F9] hover:bg-[#F8FAFC] cursor-pointer"
                >
                  <td className="px-4 py-2 font-medium text-[#0F172A]">
                    {lead.firstName} {lead.lastName ?? ""}
                  </td>
                  <td className="px-4 py-2 text-[#475569]">{lead.email}</td>
                  <td className="px-4 py-2 text-[#475569]">{lead.vehicleInterest ?? "—"}</td>
                  <td className="px-4 py-2 capitalize text-[#475569]">
                    <span className="inline-flex items-center gap-1">
                      {lead.platform ? platformIcon(lead.platform, 12) : null}
                      {lead.platform ?? "—"}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-[#475569]">{lead.landingPage ?? "—"}</td>
                  <td className="px-4 py-2"><LeadStatusBadge status={lead.status} /></td>
                  <td className="px-4 py-2 text-[#475569]">{lead.nurtureStep}/5</td>
                  <td className="px-4 py-2 text-[#475569]">{fmtDateTime(lead.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {selected && <LeadDrawer lead={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function LeadDrawer({ lead, onClose }: { lead: SocialLead; onClose: () => void }) {
  const rows: { label: string; value: string }[] = [
    { label: "Name", value: `${lead.firstName} ${lead.lastName ?? ""}`.trim() },
    { label: "Email", value: lead.email },
    { label: "Phone", value: lead.phone ?? "—" },
    { label: "Location", value: [lead.city, lead.state, lead.zip].filter(Boolean).join(", ") || "—" },
    { label: "Vehicle Interest", value: lead.vehicleInterest ?? "—" },
    { label: "Make / Model", value: [lead.make, lead.model].filter(Boolean).join(" ") || "—" },
    { label: "Budget", value: lead.budget ?? "—" },
    { label: "Timeline", value: lead.timeline ?? "—" },
    { label: "Platform", value: lead.platform ?? "—" },
    { label: "Franchise", value: lead.franchise ?? "—" },
    { label: "Landing Page", value: lead.landingPage ?? "—" },
    { label: "UTM Source", value: lead.utmSource ?? "—" },
    { label: "UTM Campaign", value: lead.utmCampaign ?? "—" },
    { label: "UTM Content", value: lead.utmContent ?? "—" },
    { label: "UTM Hook", value: lead.utmHook ?? "—" },
    { label: "Created", value: fmtDateTime(lead.createdAt) },
  ];

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40" onClick={onClose}>
      <div
        className="w-full max-w-md h-full bg-white shadow-2xl overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#E2E8F0] sticky top-0 bg-white">
          <div className="flex items-center gap-2">
            <Users size={16} className="text-[#0B5FD1]" />
            <h2 className="text-sm font-bold text-[#0F172A]">Lead Detail</h2>
            <LeadStatusBadge status={lead.status} />
          </div>
          <button onClick={onClose} className="text-[#94A3B8] hover:text-[#0F172A]"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-1">
          {rows.map((r) => (
            <div key={r.label} className="flex justify-between gap-4 py-1.5 border-b border-[#F1F5F9] text-xs">
              <span className="text-[#64748B]">{r.label}</span>
              <span className="text-[#0F172A] font-medium text-right break-all">{r.value}</span>
            </div>
          ))}
        </div>

        {/* Nurture history */}
        <div className="px-5 pb-6">
          <h3 className="text-xs font-bold text-[#0F172A] mb-2 mt-2">Nurture History</h3>
          <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl p-4 space-y-1.5 text-xs">
            <div className="flex justify-between"><span className="text-[#64748B]">Sequence</span><span className="text-[#0F172A] font-medium">{lead.nurtureSequence ?? "—"}</span></div>
            <div className="flex justify-between"><span className="text-[#64748B]">Step</span><span className="text-[#0F172A] font-medium">{lead.nurtureStep} of 5</span></div>
            <div className="flex justify-between"><span className="text-[#64748B]">Last Email Sent</span><span className="text-[#0F172A] font-medium">{fmtDateTime(lead.lastEmailSentAt)}</span></div>
            <div className="flex justify-between"><span className="text-[#64748B]">Converted</span><span className="text-[#0F172A] font-medium">{fmtDateTime(lead.convertedAt)}</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Tab 6: Settings ─────────────────────────────────────────────────────────
function SettingsTab({
  automationMode, franchises, platformConnections, videoEnabled, publishingEnabled, showToast,
}: {
  automationMode: AutomationMode;
  franchises: FranchiseRow[];
  platformConnections: PlatformConnection[];
  videoEnabled: boolean;
  publishingEnabled: boolean;
  showToast: (m: string) => void;
}) {
  const [mode, setMode] = useState<AutomationMode>(automationMode);
  const [connections, setConnections] = useState<ProviderConnections | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchJson<ProviderConnections>("/api/admin/social/connections")
      .then((c) => { if (!cancelled) setConnections(c); })
      .catch((err) => showToast(err instanceof Error ? err.message : "Failed to load connections"));
    return () => { cancelled = true; };
  }, [showToast]);

  return (
    <div className="space-y-6">
      <div className="bg-white border border-[#E2E8F0] rounded-2xl shadow-sm p-5">
        <h2 className="text-sm font-bold text-[#0F172A] mb-1">Automation Mode</h2>
        <p className="text-xs text-[#64748B] mb-4">Controls how generated content flows to publishing. Set via SOCIAL_AUTOMATION_MODE.</p>
        <div className="space-y-2">
          {(["MANUAL_REVIEW", "HYBRID_AUTO", "FULL_AUTO"] as AutomationMode[]).map((m) => (
            <label key={m} className="flex items-center gap-2 cursor-pointer">
              <input type="radio" name="mode" checked={mode === m} onChange={() => setMode(m)} data-testid={`mode-${m}`} />
              <span className="text-xs font-semibold text-[#0F172A]">{m.replace(/_/g, " ")}</span>
              {m === automationMode && <span className="text-[10px] text-emerald-600 font-bold">(current)</span>}
            </label>
          ))}
        </div>
        <button
          data-testid="save-mode"
          onClick={() => showToast("Mode is environment-controlled (SOCIAL_AUTOMATION_MODE). Update the env var to persist.")}
          className="mt-4 bg-[#0B5FD1] text-white text-xs font-semibold px-4 py-2 rounded-lg">
          Save
        </button>
      </div>

      <div className="bg-white border border-[#E2E8F0] rounded-2xl shadow-sm p-5">
        <h2 className="text-sm font-bold text-[#0F172A] mb-3">Franchises ({franchises.length})</h2>
        <div className="grid md:grid-cols-2 gap-2">
          {franchises.map((f) => (
            <div key={f.id} className="flex items-center justify-between p-3 rounded-xl border border-[#E2E8F0]">
              <div>
                <p className="text-xs font-semibold text-[#0F172A]">{f.name}</p>
                <p className="text-[10px] text-[#94A3B8]">{f.cadence} · {f.platforms.join(", ")}</p>
              </div>
              <div className="flex items-center gap-2">
                {f.requiresReview && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">REVIEW</span>}
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${f.active ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{f.active ? "ACTIVE" : "OFF"}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white border border-[#E2E8F0] rounded-2xl shadow-sm p-5">
        <h2 className="text-sm font-bold text-[#0F172A] mb-1">Provider Connections</h2>
        <p className="text-xs text-[#64748B] mb-3">
          Video: {videoEnabled ? "enabled" : "disabled"} · Publishing: {publishingEnabled ? "enabled" : "disabled"}
        </p>
        <div className="grid sm:grid-cols-3 gap-2 mb-4" data-testid="provider-connections">
          <ProviderCard
            icon={<Send size={16} />}
            name="Buffer"
            connected={connections?.buffer.connected ?? false}
            detail={connections ? `${connections.buffer.channelCount} channel${connections.buffer.channelCount === 1 ? "" : "s"}` : "…"}
          />
          <ProviderCard
            icon={<Linkedin size={16} />}
            name="LinkedIn"
            connected={connections?.linkedin.connected ?? false}
            detail={connections?.linkedin.pageId ? `Page ${connections.linkedin.pageId}` : "Direct publishing"}
          />
          <ProviderCard
            icon={<Video size={16} />}
            name="Higgsfield"
            connected={connections?.higgsfield.connected ?? false}
            detail="Video generation"
          />
        </div>

        <h3 className="text-xs font-bold text-[#0F172A] mb-2">Platform Channels</h3>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
          {platformConnections.map((c) => (
            <div key={c.platform} className="flex items-center gap-2 p-3 rounded-xl border border-[#E2E8F0]">
              <span className="text-[#0B5FD1]">{platformIcon(c.platform, 16)}</span>
              <div>
                <p className="text-xs font-semibold capitalize text-[#0F172A]">{c.platform}</p>
                <p className={`text-[10px] font-bold ${c.connected ? "text-emerald-600" : "text-[#94A3B8]"}`}>{c.connected ? "Connected" : "Not connected"}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ProviderCard({ icon, name, connected, detail }: { icon: ReactNode; name: string; connected: boolean; detail: string }) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-xl border border-[#E2E8F0]">
      <span className="text-[#0B5FD1]">{icon}</span>
      <div className="min-w-0">
        <p className="text-xs font-semibold text-[#0F172A]">{name}</p>
        <p className={`text-[10px] font-bold ${connected ? "text-emerald-600" : "text-[#94A3B8]"}`}>
          {connected ? `✅ Connected · ${detail}` : "Not connected"}
        </p>
      </div>
    </div>
  );
}

// ─── Tab 7: Market Index ─────────────────────────────────────────────────────
function MarketIndexTab({ showToast }: { showToast: (m: string) => void }) {
  const [last, setLast] = useState<MarketIndexLast | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setLast(await fetchJson<MarketIndexLast>("/api/admin/social/market-index"));
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to load market index");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { void load(); }, [load]);

  const generateNow = async () => {
    setGenerating(true);
    try {
      await fetchJson("/api/admin/social/market-index", { method: "POST" });
      showToast("Market Index generated and published");
      await load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white border border-[#E2E8F0] rounded-2xl shadow-sm p-5">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h2 className="text-sm font-bold text-[#0F172A] flex items-center gap-2"><Newspaper size={16} /> AutoLenis Market Index</h2>
            <p className="text-xs text-[#64748B]">Weekly LinkedIn market intelligence newsletter. Auto-publishes Mondays 7AM CT.</p>
          </div>
          <button
            data-testid="market-index-generate"
            disabled={generating}
            onClick={generateNow}
            className="bg-[#0B5FD1] text-white text-xs font-semibold px-4 py-2 rounded-lg disabled:opacity-50 flex items-center gap-2">
            {generating ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            {generating ? "Generating…" : "Generate Market Index Now"}
          </button>
        </div>
      </div>

      <div className="bg-white border border-[#E2E8F0] rounded-2xl shadow-sm p-5" data-testid="market-index-last">
        <h3 className="text-xs font-bold text-[#0F172A] mb-3">Last Published</h3>
        {loading ? (
          <p className="text-xs text-[#94A3B8] flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading…</p>
        ) : last?.publishedAt || last?.title ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase font-bold text-[#94A3B8]">Published</span>
              <span className="text-xs font-semibold text-[#0F172A]">{fmtDateTime(last.publishedAt)}</span>
              {last.status && <StatusBadge status={last.status} />}
            </div>
            {last.title && (
              <div>
                <p className="text-[10px] uppercase font-bold text-[#94A3B8] mb-1">Title</p>
                <p className="text-sm font-bold text-[#0F172A]">{last.title}</p>
              </div>
            )}
            {last.summary && (
              <div>
                <p className="text-[10px] uppercase font-bold text-[#94A3B8] mb-1">Summary</p>
                <p className="text-xs text-[#475569] leading-relaxed">{last.summary}</p>
              </div>
            )}
            {last.linkedInUrl && (
              <a href={last.linkedInUrl} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#0B5FD1]">
                <ExternalLink size={13} /> View on LinkedIn
              </a>
            )}
          </div>
        ) : (
          <p className="text-xs text-[#94A3B8]">No Market Index has been published yet.</p>
        )}
      </div>
    </div>
  );
}

// ─── Post detail drawer ──────────────────────────────────────────────────────
function PostDrawer({
  post, onClose, onChanged, showToast,
}: { post: Post; onClose: () => void; onChanged: () => void; showToast: (m: string) => void }) {
  const [caption, setCaption] = useState(post.caption);
  const [script, setScript] = useState(post.script);
  const [scheduledAt, setScheduledAt] = useState(post.scheduledAt ? post.scheduledAt.slice(0, 16) : "");
  const [saving, setSaving] = useState(false);

  const patch = async (body: Record<string, unknown>, msg: string) => {
    setSaving(true);
    try {
      await fetchJson(`/api/admin/social/posts/${post.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      showToast(msg);
      onChanged();
    } catch (err) { showToast(err instanceof Error ? err.message : "Action failed"); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-40 flex justify-end" data-testid="post-drawer">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-[640px] bg-white h-full overflow-y-auto shadow-2xl">
        <div className="sticky top-0 bg-white border-b border-[#E2E8F0] px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-[#0B5FD1]">{platformIcon(post.platform, 16)}</span>
            <span className="text-sm font-bold text-[#0F172A]">{post.franchise?.name ?? post.platform}</span>
            <StatusBadge status={post.status} />
          </div>
          <button onClick={onClose} data-testid="drawer-close" className="text-[#64748B] hover:text-[#0F172A]"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <p className="text-[10px] uppercase font-bold text-[#94A3B8] mb-1">Hook</p>
            <p className="text-lg font-bold text-[#0F172A]">{post.hook}</p>
          </div>

          <div>
            <p className="text-[10px] uppercase font-bold text-[#94A3B8] mb-1">Script</p>
            <textarea value={script} onChange={(e) => setScript(e.target.value)} rows={6}
              className="w-full text-xs border border-[#E2E8F0] rounded-lg p-2 font-mono" data-testid="drawer-script" />
          </div>

          <div>
            <p className="text-[10px] uppercase font-bold text-[#94A3B8] mb-1">Caption</p>
            <textarea value={caption} onChange={(e) => setCaption(e.target.value)} rows={4}
              className="w-full text-xs border border-[#E2E8F0] rounded-lg p-2" data-testid="drawer-caption" />
          </div>

          {post.hashtags.length > 0 && (
            <div>
              <p className="text-[10px] uppercase font-bold text-[#94A3B8] mb-1">Hashtags</p>
              <div className="flex flex-wrap gap-1">
                {post.hashtags.map((h) => <span key={h} className="text-[10px] bg-[#F1F5F9] text-[#475569] px-2 py-0.5 rounded-full">#{h.replace(/^#/, "")}</span>)}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-[10px] uppercase font-bold text-[#94A3B8] mb-1">CTA</p>
              <p className="text-xs text-[#475569]">{post.ctaText ?? "—"}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase font-bold text-[#94A3B8] mb-1">Funnel</p>
              <p className="text-xs text-[#475569]">{post.funnelDestination ?? "—"}</p>
            </div>
          </div>

          {post.trackedUrl && (
            <div>
              <p className="text-[10px] uppercase font-bold text-[#94A3B8] mb-1">Tracked URL</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-[10px] bg-[#F8FAFC] border border-[#E2E8F0] rounded p-2 truncate">{post.trackedUrl}</code>
                <button onClick={() => { void navigator.clipboard.writeText(post.trackedUrl ?? ""); showToast("Copied"); }}
                  className="text-[#0B5FD1]" data-testid="drawer-copy-url"><Copy size={14} /></button>
              </div>
            </div>
          )}

          {post.complianceNotes && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200">
              <AlertTriangle size={14} className="text-amber-600 mt-0.5" />
              <p className="text-xs text-amber-800">{post.complianceNotes}</p>
            </div>
          )}

          <div>
            <p className="text-[10px] uppercase font-bold text-[#94A3B8] mb-1 flex items-center gap-1"><Film size={11} /> Video</p>
            {post.video ? (
              <div className="space-y-2">
                <VideoBadge status={post.video.status} />
                {post.video.videoUrl && (
                  <video src={post.video.videoUrl} controls className="w-full rounded-lg border border-[#E2E8F0]" />
                )}
              </div>
            ) : <p className="text-xs text-[#94A3B8]">No video job</p>}
          </div>

          <div>
            <p className="text-[10px] uppercase font-bold text-[#94A3B8] mb-1">Scheduled</p>
            <input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)}
              className="text-xs border border-[#E2E8F0] rounded-lg p-2" data-testid="drawer-scheduled" />
          </div>

          {post.status === "PUBLISHED" && (
            <div className="grid grid-cols-3 gap-2">
              <div className="p-3 rounded-lg bg-[#F8FAFC] border border-[#E2E8F0] text-center">
                <Eye size={14} className="mx-auto text-[#64748B]" /><p className="text-sm font-bold mt-1">{post.leadScore}</p><p className="text-[9px] text-[#94A3B8]">Lead Score</p>
              </div>
              <div className="p-3 rounded-lg bg-[#F8FAFC] border border-[#E2E8F0] text-center">
                <MousePointerClick size={14} className="mx-auto text-[#64748B]" /><p className="text-sm font-bold mt-1">—</p><p className="text-[9px] text-[#94A3B8]">Clicks</p>
              </div>
              <div className="p-3 rounded-lg bg-[#F8FAFC] border border-[#E2E8F0] text-center">
                <ThumbsUp size={14} className="mx-auto text-[#64748B]" /><p className="text-sm font-bold mt-1">—</p><p className="text-[9px] text-[#94A3B8]">Engagement</p>
              </div>
            </div>
          )}
        </div>

        <div className="sticky bottom-0 bg-white border-t border-[#E2E8F0] px-5 py-3 flex flex-wrap gap-2">
          <button disabled={saving} data-testid="drawer-approve" onClick={() => patch({ action: "approve" }, "Approved")}
            className="bg-emerald-600 text-white text-xs font-semibold px-3 py-2 rounded-lg disabled:opacity-50">Approve</button>
          <button disabled={saving} data-testid="drawer-reject" onClick={() => { const r = window.prompt("Reason?"); if (r != null) void patch({ action: "reject", rejectionReason: r }, "Rejected"); }}
            className="bg-rose-600 text-white text-xs font-semibold px-3 py-2 rounded-lg disabled:opacity-50">Reject</button>
          <button disabled={saving} data-testid="drawer-save" onClick={() => patch({ action: "update", caption, script }, "Saved")}
            className="bg-[#0B5FD1] text-white text-xs font-semibold px-3 py-2 rounded-lg disabled:opacity-50">Save Edits</button>
          <button disabled={saving || !scheduledAt} data-testid="drawer-publish-now"
            onClick={() => patch({ action: "reschedule", scheduledAt: new Date(scheduledAt || Date.now()).toISOString() }, "Rescheduled")}
            className="bg-white border border-[#E2E8F0] text-[#0F172A] text-xs font-semibold px-3 py-2 rounded-lg disabled:opacity-50">Reschedule</button>
          <button onClick={onClose} className="ml-auto text-[#64748B] text-xs font-semibold px-3 py-2">Close</button>
        </div>
      </div>
    </div>
  );
}
