"use client";

// /admin/social — Social Intelligence & Media Engine dashboard (client).
// Six tabs: Overview, Content Calendar, Pending Review, Publishing Queue,
// Performance, Settings — plus a shared post-detail drawer and a fixed
// automation-mode badge. Data is read from /api/admin/social/* endpoints.

import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import {
  Radio, Sparkles, Calendar, ClipboardCheck, Send, BarChart2, Film,
  Newspaper, Users, TrendingUp, FlaskConical, UploadCloud,
  Settings as SettingsIcon,
} from "lucide-react";

// Shared types + the fetch helper live in ./_shared (extracted during the
// social-dashboard decomposition). Types are re-exported so ./page.tsx keeps
// importing them from this module. All tab/drawer UI now lives in ./tabs and
// ./drawers and is lazy-loaded below.
import type { FranchiseRow, PlatformConnection, AutomationMode, Post, Stats } from "./_shared/types";
export type { FranchiseRow, PlatformConnection };
import { fetchJson } from "./_shared/fetchJson";

// Every tab and drawer is code-split and lazy-loaded so its JS only ships when
// opened (extracted to ./tabs/* and ./drawers/* — behavior identical to the
// former inline components). The shell is now just chrome + routing.
const OverviewTab = lazy(() => import("./tabs/OverviewTab"));
const CalendarTab = lazy(() => import("./tabs/CalendarTab"));
const PendingTab = lazy(() => import("./tabs/PendingTab"));
const QueueTab = lazy(() => import("./tabs/QueueTab"));
const MediaTab = lazy(() => import("./tabs/MediaTab"));
const PerformanceTab = lazy(() => import("./tabs/PerformanceTab"));
const AnalyticsTab = lazy(() => import("./tabs/AnalyticsTab"));
const ABTestsTab = lazy(() => import("./tabs/ABTestsTab"));
const MarketIndexTab = lazy(() => import("./tabs/MarketIndexTab"));
const LeadsTab = lazy(() => import("./tabs/LeadsTab"));
const CreatorsTab = lazy(() => import("./tabs/CreatorsTab"));
const SettingsTab = lazy(() => import("./tabs/SettingsTab"));
const ComposeDrawer = lazy(() => import("./drawers/ComposeDrawer"));
const BulkUploadModal = lazy(() => import("./drawers/BulkUploadModal"));
const PostDrawer = lazy(() => import("./drawers/PostDrawer"));

// ─── Tabs (shell-coupled: icon + order) ──────────────────────────────────────
const TABS = [
  { key: "overview", label: "Overview", icon: BarChart2 },
  { key: "calendar", label: "Content Calendar", icon: Calendar },
  { key: "pending", label: "Pending Review", icon: ClipboardCheck },
  { key: "queue", label: "Publishing Queue", icon: Send },
  { key: "media", label: "Media", icon: Film },
  { key: "performance", label: "Performance", icon: BarChart2 },
  { key: "analytics", label: "Analytics", icon: TrendingUp },
  { key: "ab-tests", label: "A/B Tests", icon: FlaskConical },
  { key: "market-index", label: "Market Index", icon: Newspaper },
  { key: "leads", label: "Leads", icon: Users },
  { key: "creators", label: "Creators", icon: Users },
  { key: "settings", label: "Settings", icon: SettingsIcon },
] as const;
type TabKey = (typeof TABS)[number]["key"];

// ─── Root component ──────────────────────────────────────────────────────────
export default function SocialDashboardClient({
  automationMode,
  franchises,
  platformConnections,
  videoEnabled,
}: {
  automationMode: AutomationMode;
  franchises: FranchiseRow[];
  platformConnections: PlatformConnection[];
  videoEnabled: boolean;
}) {
  const [tab, setTab] = useState<TabKey>("overview");
  const [stats, setStats] = useState<Stats | null>(null);
  const [drawerPost, setDrawerPost] = useState<Post | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
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
          <div className="w-10 h-10 rounded-xl bg-al-primary flex items-center justify-center">
            <Radio size={18} className="text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-[#0F172A] tracking-tight">Social Engine</h1>
            <p className="text-xs text-[#64748B]">AI content, video, publishing & attribution</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            data-testid="bulk-open"
            onClick={() => setBulkOpen(true)}
            className="flex items-center gap-1.5 bg-white border border-al-primary text-al-primary text-xs font-semibold px-4 py-2 rounded-lg hover:bg-al-primary-subtle transition-colors"
          >
            <UploadCloud size={14} /> Bulk Upload
          </button>
          <button
            data-testid="compose-open"
            onClick={() => setComposeOpen(true)}
            className="flex items-center gap-1.5 bg-al-primary text-white text-xs font-semibold px-4 py-2 rounded-lg hover:bg-[#0a54bc] transition-colors"
          >
            <Sparkles size={14} /> Compose
          </button>
          <div
            data-testid="automation-mode-badge"
            className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-bold ${modeBadge.cls}`}
          >
            <span>{modeBadge.dot}</span>
            <span>{modeBadge.label}</span>
          </div>
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
                active ? "border-al-primary text-al-primary" : "border-transparent text-[#64748B] hover:text-[#0F172A]"
              }`}
            >
              <Icon size={14} />
              {t.label}
            </button>
          );
        })}
      </div>

      <Suspense fallback={<div className="py-16 text-center text-sm text-[#64748B]">Loading…</div>}>
        {tab === "overview" && (
          <OverviewTab stats={stats} onRefresh={loadStats} showToast={showToast} />
        )}
        {tab === "calendar" && <CalendarTab onOpenPost={setDrawerPost} showToast={showToast} />}
        {tab === "pending" && <PendingTab onOpenPost={setDrawerPost} onChanged={loadStats} showToast={showToast} />}
        {tab === "queue" && <QueueTab onOpenPost={setDrawerPost} onChanged={loadStats} showToast={showToast} />}
        {tab === "media" && <MediaTab showToast={showToast} />}
        {tab === "performance" && <PerformanceTab stats={stats} onOpenPost={setDrawerPost} showToast={showToast} />}
        {tab === "analytics" && <AnalyticsTab showToast={showToast} />}
        {tab === "ab-tests" && <ABTestsTab showToast={showToast} />}
        {tab === "market-index" && <MarketIndexTab showToast={showToast} />}
        {tab === "leads" && <LeadsTab showToast={showToast} />}
        {tab === "creators" && <CreatorsTab showToast={showToast} />}
        {tab === "settings" && (
          <SettingsTab
            automationMode={automationMode}
            franchises={franchises}
            platformConnections={platformConnections}
            videoEnabled={videoEnabled}
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

        {composeOpen && (
          <ComposeDrawer
            franchises={franchises}
            onClose={() => setComposeOpen(false)}
            onCreated={() => { void loadStats(); }}
            showToast={showToast}
          />
        )}

        {bulkOpen && (
          <BulkUploadModal
            franchises={franchises}
            onClose={() => setBulkOpen(false)}
            onCreated={() => { void loadStats(); }}
            showToast={showToast}
          />
        )}
      </Suspense>

      {toast && (
        <div className="fixed bottom-6 right-6 z-50 bg-[#0F172A] text-white text-xs px-4 py-2.5 rounded-lg shadow-lg" data-testid="social-toast">
          {toast}
        </div>
      )}
    </div>
  );
}
