"use client";
// Buffer Posts tab — extracted from SocialDashboardClient.tsx (lazy-loaded).
import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Copy, AlertTriangle, ThumbsUp, Eye, MousePointerClick, Clock, Loader2, Trash2 } from "lucide-react";
import { fetchJson } from "../_shared/fetchJson";
import { fmtDateTime } from "../_shared/format";
import { PLATFORMS, platformIcon } from "../_shared/ui";

interface BufferMetricsLite {
  likes: number | null;
  comments: number | null;
  shares: number | null;
  clicks: number | null;
  reach: number | null;
  impressions?: number | null;
  views?: number | null;
}
interface BufferPostRow {
  id: string;
  status: string;
  via: string;
  text: string;
  channelService: string;
  channelName: string;
  createdAt: string | null;
  dueAt: string | null;
  sentAt: string | null;
  errorMessage: string | null;
  thumbnailUrl: string | null;
  hasVideo: boolean;
  metrics: BufferMetricsLite | null;
  allowedActions: string[];
  local: { id: string; status: string; leadScore: number } | null;
  tracked: boolean;
}
interface BufferPostsResponse {
  posts: BufferPostRow[];
  endCursor: string | null;
  hasNextPage: boolean;
  trackedCount: number;
}

const BUFFER_STATUS_FILTERS: { key: string; label: string; status: string }[] = [
  { key: "all", label: "All", status: "" },
  { key: "scheduled", label: "Scheduled / Queued", status: "scheduled" },
  { key: "sent", label: "Published", status: "sent" },
  { key: "draft", label: "Drafts", status: "draft" },
  { key: "needs_approval", label: "Needs Approval", status: "needs_approval" },
  { key: "error", label: "Failed", status: "error" },
];

const BUFFER_STATUS_STYLES: Record<string, string> = {
  draft: "bg-slate-100 text-slate-600",
  needs_approval: "bg-amber-100 text-amber-700",
  scheduled: "bg-indigo-100 text-indigo-700",
  sending: "bg-cyan-100 text-cyan-700",
  sent: "bg-emerald-100 text-emerald-700",
  error: "bg-red-100 text-red-700",
};

function BufferTab({ showToast }: { showToast: (m: string) => void }) {
  const [posts, setPosts] = useState<BufferPostRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusKey, setStatusKey] = useState("all");
  const [platform, setPlatform] = useState("all");
  const [withMetrics, setWithMetrics] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [trackedCount, setTrackedCount] = useState(0);
  const [notConfigured, setNotConfigured] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setNotConfigured(null);
    try {
      const status = BUFFER_STATUS_FILTERS.find((s) => s.key === statusKey)?.status ?? "";
      const qs = new URLSearchParams();
      if (status) qs.set("status", status);
      if (platform !== "all") qs.set("platform", platform);
      if (withMetrics) qs.set("metrics", "true");
      qs.set("limit", "50");
      const data = await fetchJson<BufferPostsResponse>(`/api/admin/social/buffer/posts?${qs.toString()}`);
      setPosts(data.posts);
      setTrackedCount(data.trackedCount);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load Buffer posts";
      if (/not configured|organization/i.test(msg)) setNotConfigured(msg);
      else showToast(msg);
      setPosts([]);
    } finally {
      setLoading(false);
    }
  }, [statusKey, platform, withMetrics, showToast]);

  useEffect(() => { void load(); }, [load]);

  const act = async (
    p: BufferPostRow,
    action: "reschedule" | "edit" | "duplicate" | "delete",
  ) => {
    setBusyId(p.id);
    try {
      if (action === "delete") {
        if (!window.confirm("Delete this post from Buffer? This cannot be undone.")) return;
        await fetchJson(`/api/admin/social/buffer/posts/${p.id}`, { method: "DELETE" });
        showToast("Deleted from Buffer");
      } else if (action === "reschedule") {
        const when = window.prompt(
          "Reschedule to (ISO date-time, e.g. 2026-07-01T15:00:00Z):",
          p.dueAt ?? new Date().toISOString(),
        );
        if (!when) return;
        await fetchJson(`/api/admin/social/buffer/posts/${p.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scheduledAt: when }),
        });
        showToast("Rescheduled");
      } else if (action === "edit") {
        const text = window.prompt("Edit caption:", p.text);
        if (text === null) return;
        await fetchJson(`/api/admin/social/buffer/posts/${p.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
        showToast("Caption updated");
      } else if (action === "duplicate") {
        await fetchJson(`/api/admin/social/buffer/posts/${p.id}/duplicate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        showToast("Duplicated to queue");
      }
      await load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusyId(null);
    }
  };

  if (notConfigured) {
    return (
      <div className="bg-white border border-amber-200 rounded-2xl p-6 text-center">
        <AlertTriangle size={20} className="text-amber-500 mx-auto mb-2" />
        <p className="text-sm font-semibold text-[#0F172A]">Buffer is not fully configured</p>
        <p className="text-xs text-[#64748B] mt-1">{notConfigured}</p>
        <p className="text-[11px] text-[#94A3B8] mt-2">
          Set <code>BUFFER_API_KEY</code> (and optionally <code>BUFFER_ORGANIZATION_ID</code>) in the environment.
          Channel ids auto-resolve from your connected Buffer channels.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1">
          {BUFFER_STATUS_FILTERS.map((s) => (
            <button key={s.key} data-testid={`buffer-status-${s.key}`} onClick={() => setStatusKey(s.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${statusKey === s.key ? "bg-al-primary text-white" : "bg-white border border-[#E2E8F0] text-[#64748B]"}`}>
              {s.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <select value={platform} onChange={(e) => setPlatform(e.target.value)}
            className="text-xs border border-[#E2E8F0] rounded-lg px-2 py-1.5 bg-white text-[#0F172A]">
            <option value="all">All platforms</option>
            {PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <label className="flex items-center gap-1.5 text-xs text-[#64748B] cursor-pointer">
            <input type="checkbox" checked={withMetrics} onChange={(e) => setWithMetrics(e.target.checked)} data-testid="buffer-metrics-toggle" />
            Metrics
          </label>
          <button data-testid="buffer-refresh" onClick={() => void load()}
            className="flex items-center gap-1.5 bg-white border border-[#E2E8F0] text-[#0F172A] text-xs font-semibold px-3 py-1.5 rounded-lg">
            <RefreshCw size={13} /> Refresh
          </button>
        </div>
      </div>

      <p className="text-[11px] text-[#94A3B8]">
        {posts.length} post{posts.length === 1 ? "" : "s"} from Buffer · {trackedCount} linked to local records
      </p>

      <div className="bg-white border border-[#E2E8F0] rounded-2xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-[#F8FAFC] text-[#64748B]">
              <tr>
                <th className="text-left font-semibold px-4 py-2">Channel</th>
                <th className="text-left font-semibold px-4 py-2">Content</th>
                <th className="text-left font-semibold px-4 py-2">Status</th>
                <th className="text-left font-semibold px-4 py-2">When</th>
                {withMetrics && <th className="text-left font-semibold px-4 py-2">Metrics</th>}
                <th className="text-right font-semibold px-4 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={withMetrics ? 6 : 5} className="px-4 py-8 text-center text-[#94A3B8]">
                  <Loader2 size={16} className="animate-spin inline" /> Loading from Buffer…
                </td></tr>
              )}
              {!loading && posts.length === 0 && (
                <tr><td colSpan={withMetrics ? 6 : 5} className="px-4 py-8 text-center text-[#94A3B8]">No Buffer posts for this filter.</td></tr>
              )}
              {!loading && posts.map((p) => (
                <tr key={p.id} className="border-t border-[#F1F5F9] hover:bg-[#F8FAFC] align-top">
                  <td className="px-4 py-2">
                    <span className="inline-flex items-center gap-1 text-al-primary capitalize">
                      {platformIcon(p.channelService, 12)}{p.channelService || "—"}
                    </span>
                    <p className="text-[10px] text-[#94A3B8]">{p.channelName}</p>
                  </td>
                  <td className="px-4 py-2 max-w-[320px]">
                    <div className="flex items-center gap-2">
                      {p.thumbnailUrl ? (
                        <img src={p.thumbnailUrl} alt="" className="w-9 h-9 rounded-md object-cover border border-[#E2E8F0] shrink-0" />
                      ) : (
                        <div className="w-9 h-9 rounded-md bg-slate-100 flex items-center justify-center text-[10px] text-slate-400 shrink-0">{p.hasVideo ? "🎬" : "📝"}</div>
                      )}
                      <span className="truncate text-[#475569]">{p.text || <span className="text-[#94A3B8]">(no text)</span>}</span>
                    </div>
                    {p.errorMessage && <p className="text-[10px] text-red-600 mt-1">⚠ {p.errorMessage}</p>}
                    {p.tracked && <span className="inline-block mt-1 text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">TRACKED</span>}
                  </td>
                  <td className="px-4 py-2">
                    <span className={`inline-flex px-2 py-0.5 rounded-md text-[10px] font-semibold ${BUFFER_STATUS_STYLES[p.status] ?? "bg-slate-100 text-slate-600"}`}>
                      {p.status.replace(/_/g, " ")}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-[#64748B] whitespace-nowrap">
                    {p.status === "sent"
                      ? <span title="Sent">{fmtDateTime(p.sentAt)}</span>
                      : <span className="inline-flex items-center gap-1" title="Scheduled"><Clock size={11} />{fmtDateTime(p.dueAt)}</span>}
                  </td>
                  {withMetrics && (
                    <td className="px-4 py-2 text-[#475569]">
                      {p.metrics ? (
                        <div className="flex flex-wrap gap-2 text-[10px]">
                          <span className="inline-flex items-center gap-0.5"><ThumbsUp size={10} />{p.metrics.likes ?? "—"}</span>
                          <span className="inline-flex items-center gap-0.5"><Eye size={10} />{p.metrics.impressions ?? p.metrics.views ?? p.metrics.reach ?? "—"}</span>
                          <span className="inline-flex items-center gap-0.5"><MousePointerClick size={10} />{p.metrics.clicks ?? "—"}</span>
                        </div>
                      ) : <span className="text-[#94A3B8]">—</span>}
                    </td>
                  )}
                  <td className="px-4 py-2">
                    <div className="flex items-center justify-end gap-2 whitespace-nowrap">
                      {p.status !== "sent" && (
                        <>
                          <button disabled={busyId === p.id} onClick={() => act(p, "reschedule")} className="text-al-primary font-semibold hover:underline disabled:opacity-50">Reschedule</button>
                          <button disabled={busyId === p.id} onClick={() => act(p, "edit")} className="text-[#64748B] font-semibold hover:underline disabled:opacity-50">Edit</button>
                        </>
                      )}
                      <button disabled={busyId === p.id} onClick={() => act(p, "duplicate")} className="text-[#64748B] font-semibold hover:underline disabled:opacity-50 inline-flex items-center gap-0.5"><Copy size={11} />Duplicate</button>
                      <button disabled={busyId === p.id} onClick={() => act(p, "delete")} className="text-rose-600 font-semibold hover:underline disabled:opacity-50 inline-flex items-center gap-0.5"><Trash2 size={11} />Delete</button>
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

// ─── Tab 5: Performance ──────────────────────────────────────────────────────

export default BufferTab;
