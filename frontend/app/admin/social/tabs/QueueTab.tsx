"use client";
// Publishing Queue tab — extracted from SocialDashboardClient.tsx (lazy-loaded).
import { useCallback, useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { fetchJson } from "../_shared/fetchJson";
import { fmtDateTime } from "../_shared/format";
import { platformIcon, StatusBadge, VideoBadge } from "../_shared/ui";
import type { Post } from "../_shared/types";

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

  const [publishingId, setPublishingId] = useState<string | null>(null);
  const publishNow = async (p: Post) => {
    if (!window.confirm(`Publish this post to ${p.platform} now?`)) return;
    setPublishingId(p.id);
    try {
      const res = await fetchJson<{ published?: boolean; scheduled?: boolean; message?: string }>(
        `/api/admin/social/posts/${p.id}/publish`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ direct: true }),
        },
      );
      showToast(res.message ?? (res.published ? `Published to ${p.platform}` : "Done"));
      await load(); onChanged();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Publish failed");
    } finally {
      setPublishingId(null);
    }
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
                <td className="px-4 py-2"><span className="inline-flex items-center gap-1 text-al-primary capitalize">{platformIcon(p.platform, 12)}{p.platform}</span></td>
                <td className="px-4 py-2 text-[#475569]">{p.franchise?.name ?? "—"}</td>
                <td className="px-4 py-2 text-[#64748B]"><span className="inline-flex items-center gap-1"><Clock size={11} />{fmtDateTime(p.scheduledAt)}</span></td>
                <td className="px-4 py-2">{p.video ? <VideoBadge status={p.video.status} /> : <span className="text-[#94A3B8]">no video</span>}</td>
                <td className="px-4 py-2"><StatusBadge status={p.status} /></td>
                <td className="px-4 py-2">
                  <div className="flex items-center justify-end gap-2">
                    <button data-testid={`publish-now-${p.id}`} onClick={() => publishNow(p)} disabled={publishingId === p.id} className="text-al-primary font-semibold hover:underline disabled:opacity-50">{publishingId === p.id ? "Publishing…" : "Publish Now"}</button>
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

export default QueueTab;
