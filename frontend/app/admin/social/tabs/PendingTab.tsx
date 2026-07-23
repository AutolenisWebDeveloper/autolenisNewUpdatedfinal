"use client";
// Pending Review tab — extracted from SocialDashboardClient.tsx (lazy-loaded).
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { fetchJson } from "../_shared/fetchJson";
import { fmtDateTime } from "../_shared/format";
import { platformIcon } from "../_shared/ui";
import type { Post } from "../_shared/types";

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
            className="bg-al-primary text-white text-xs font-semibold px-3 py-1.5 rounded-lg disabled:opacity-50">Approve All ({posts.length})</button>
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
                  <td className="px-4 py-2"><span className="inline-flex items-center gap-1 text-al-primary capitalize">{platformIcon(p.platform, 12)}{p.platform}</span></td>
                  <td className="px-4 py-2 text-[#475569]">{p.franchise?.name ?? "—"}</td>
                  <td className="px-4 py-2 max-w-[220px]">
                    <div className="flex items-center gap-2">
                      {p.video?.thumbnailUrl ? (
                        <img src={p.video.thumbnailUrl} alt="" className="w-9 h-9 rounded-md object-cover border border-[#E2E8F0] shrink-0" />
                      ) : (
                        <div className="w-9 h-9 rounded-md bg-slate-100 flex items-center justify-center text-[10px] text-slate-400 shrink-0">📸</div>
                      )}
                      <span className="truncate text-[#0F172A] font-medium">{p.hook}</span>
                    </div>
                  </td>
                  <td className="px-4 py-2 max-w-[220px] truncate text-[#64748B]">{p.caption}</td>
                  <td className="px-4 py-2">{p.complianceNotes ? <AlertTriangle size={14} className="text-amber-500" /> : <span className="text-[#94A3B8]">—</span>}</td>
                  <td className="px-4 py-2 text-[#64748B]">{fmtDateTime(p.scheduledAt)}</td>
                  <td className="px-4 py-2">
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => act(p.id, "approve")} className="text-emerald-600 font-semibold hover:underline">Approve</button>
                      <button onClick={() => act(p.id, "reject")} className="text-rose-600 font-semibold hover:underline">Reject</button>
                      <button onClick={() => onOpenPost(p)} className="text-al-primary font-semibold hover:underline">Edit</button>
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

export default PendingTab;
