"use client";
// Post detail drawer — extracted from SocialDashboardClient.tsx (lazy-loaded).
import { useEffect, useState } from "react";
import { X, Copy, AlertTriangle, ThumbsUp, Eye, MousePointerClick, Film } from "lucide-react";
import { fetchJson } from "../_shared/fetchJson";
import { platformIcon, StatusBadge, VideoBadge } from "../_shared/ui";
import type { Post } from "../_shared/types";

function PostDrawer({
  post, onClose, onChanged, showToast,
}: { post: Post; onClose: () => void; onChanged: () => void; showToast: (m: string) => void }) {
  const [caption, setCaption] = useState(post.caption);
  const [script, setScript] = useState(post.script);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState(false);
  const [newScheduledAt, setNewScheduledAt] = useState(
    post.scheduledAt ? new Date(post.scheduledAt).toISOString().slice(0, 16) : "",
  );
  // Latest performance snapshot for the Clicks/Engagement cells. The list passes
  // a post without its performance relation, so fetch the full record (which
  // includes performance) when the drawer opens a PUBLISHED post.
  const [latestPerf, setLatestPerf] = useState<{
    linkClicks: number | null;
    likes: number | null;
    comments: number | null;
    shares: number | null;
  } | null>(null);
  useEffect(() => {
    if (post.status !== "PUBLISHED") return;
    let active = true;
    void fetchJson<{
      post: {
        performance?: Array<{
          linkClicks: number | null;
          likes: number | null;
          comments: number | null;
          shares: number | null;
        }>;
      };
    }>(`/api/admin/social/posts/${post.id}`)
      .then((r) => {
        if (active) setLatestPerf(r.post.performance?.[0] ?? null);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [post.id, post.status]);

  const engagementTotal = latestPerf
    ? (latestPerf.likes ?? 0) + (latestPerf.comments ?? 0) + (latestPerf.shares ?? 0)
    : null;

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

  const handleReschedule = async () => {
    if (!newScheduledAt) return;
    try {
      await fetchJson(`/api/admin/social/posts/${post.id}/reschedule`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduledAt: new Date(newScheduledAt).toISOString() }),
      });
      setEditingSchedule(false);
      showToast("Post rescheduled");
      onChanged();
    } catch (err) { showToast(err instanceof Error ? err.message : "Reschedule failed"); }
  };

  const [uploadingImage, setUploadingImage] = useState(false);
  const handleUploadImage = async (file: File) => {
    setUploadingImage(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      await fetchJson(`/api/admin/social/posts/${post.id}/upload-image`, {
        method: "POST",
        body: fd,
      });
      showToast("Image uploaded and attached");
      onChanged();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Image upload failed");
    } finally {
      setUploadingImage(false);
    }
  };

  const [publishing, setPublishing] = useState(false);
  const handlePublishNow = async () => {
    if (!window.confirm(`Publish this post to ${post.platform} immediately?`)) return;
    setPublishing(true);
    try {
      const res = await fetchJson<{ published?: boolean; message?: string }>(
        `/api/admin/social/posts/${post.id}/publish`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ direct: true }),
        },
      );
      showToast(res.message ?? (res.published ? `Published to ${post.platform}` : "Done"));
      onChanged();
      onClose();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Publish failed");
    } finally {
      setPublishing(false);
    }
  };

  const handleGenerateVideo = async () => {
    setGenerating(true);
    try {
      await fetchJson("/api/admin/social/generate-video-single", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postId: post.id }),
      });
      showToast("Video generation started — check back in 1–2 minutes");
    } catch (err) { showToast(err instanceof Error ? err.message : "Video generation failed"); }
    finally { setGenerating(false); }
  };

  const handleGenerateImage = async () => {
    setGenerating(true);
    try {
      await fetchJson("/api/admin/social/generate-images", { method: "POST" });
      showToast("Image generation started");
    } catch (err) { showToast(err instanceof Error ? err.message : "Image generation failed"); }
    finally { setGenerating(false); }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div role="dialog" aria-modal="true" aria-label="Post details" className="fixed inset-0 z-40 flex justify-end" data-testid="post-drawer">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-[640px] bg-white h-full overflow-y-auto shadow-2xl">
        <div className="sticky top-0 bg-white border-b border-[#E2E8F0] px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-al-primary">{platformIcon(post.platform, 16)}</span>
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

          {/* Visual Assets — viewer with download + generation controls */}
          <div className="border-t border-[#E2E8F0] pt-4 space-y-3">
            <h3 className="text-sm font-medium text-slate-700">Visual Assets</h3>

            {post.video?.videoUrl ? (
              <div className="space-y-2">
                <video
                  src={post.video.videoUrl}
                  controls
                  className="w-full rounded-xl border border-slate-200"
                  style={{ maxHeight: 300 }}
                />
                <div className="flex gap-2">
                  <a
                    href={post.video.videoUrl}
                    download={`autolenis-${post.id}.mp4`}
                    className="flex-1 flex items-center justify-center gap-2 bg-al-primary text-white text-xs font-medium py-2 rounded-lg hover:bg-[#0a54bc] transition-colors"
                  >
                    ⬇ Download Video
                  </a>
                  {post.video.thumbnailUrl && (
                    <a
                      href={post.video.thumbnailUrl}
                      download={`autolenis-${post.id}.jpg`}
                      className="flex items-center justify-center gap-2 border border-slate-200 text-slate-600 text-xs font-medium py-2 px-3 rounded-lg hover:bg-slate-50"
                    >
                      ⬇ Image
                    </a>
                  )}
                </div>
              </div>
            ) : post.video?.thumbnailUrl ? (
              <div className="space-y-2">
                <img
                  src={post.video.thumbnailUrl}
                  alt="Generated image"
                  className="w-full rounded-xl border border-slate-200 object-cover"
                  style={{ maxHeight: 300 }}
                />
                <div className="flex gap-2">
                  <a
                    href={post.video.thumbnailUrl}
                    download={`autolenis-${post.id}.jpg`}
                    className="flex-1 flex items-center justify-center gap-2 bg-al-primary text-white text-xs font-medium py-2 rounded-lg hover:bg-[#0a54bc] transition-colors"
                  >
                    ⬇ Download Image
                  </a>
                  <button
                    onClick={handleGenerateVideo}
                    disabled={generating}
                    className="flex items-center justify-center gap-2 border border-al-primary text-al-primary text-xs font-medium py-2 px-3 rounded-lg hover:bg-al-primary/5 disabled:opacity-50"
                  >
                    🎬 Generate Video
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center h-32 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                <div className="text-center">
                  <p className="text-sm text-slate-500">
                    {post.video?.status === "VIDEO_GENERATING"
                      ? "🎬 Video generating..."
                      : "📸 Image generating..."}
                  </p>
                  <button
                    onClick={handleGenerateImage}
                    disabled={generating}
                    className="mt-2 text-xs text-al-primary underline disabled:opacity-50"
                  >
                    Generate Now
                  </button>
                </div>
              </div>
            )}
          </div>

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
                  className="text-al-primary" data-testid="drawer-copy-url"><Copy size={14} /></button>
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
            <p className="text-[10px] uppercase font-bold text-[#94A3B8] mb-1 flex items-center gap-1"><Film size={11} /> Video Job</p>
            {post.video ? <VideoBadge status={post.video.status} /> : <p className="text-xs text-[#94A3B8]">No video job</p>}
          </div>

          <div>
            <p className="text-[10px] uppercase font-bold text-[#94A3B8] mb-1">Scheduled</p>
            {editingSchedule ? (
              <div className="flex gap-2 items-center">
                <input
                  type="datetime-local"
                  value={newScheduledAt}
                  onChange={(e) => setNewScheduledAt(e.target.value)}
                  className="text-sm border border-slate-200 rounded-lg px-3 py-1.5"
                  data-testid="drawer-scheduled"
                />
                <button
                  onClick={handleReschedule}
                  className="text-xs bg-al-primary text-white px-3 py-1.5 rounded-lg hover:bg-[#0a54bc]"
                >
                  Save
                </button>
                <button
                  onClick={() => setEditingSchedule(false)}
                  className="text-xs text-slate-500 px-2"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <p className="text-sm text-slate-800">
                  {post.scheduledAt ? new Date(post.scheduledAt).toLocaleString() : "Not scheduled"}
                </p>
                <button
                  onClick={() => setEditingSchedule(true)}
                  className="text-xs text-al-primary underline"
                  data-testid="drawer-edit-schedule"
                >
                  Edit
                </button>
              </div>
            )}
          </div>

          {post.status === "PUBLISHED" && (
            <div className="grid grid-cols-3 gap-2">
              <div className="p-3 rounded-lg bg-[#F8FAFC] border border-[#E2E8F0] text-center">
                <Eye size={14} className="mx-auto text-[#64748B]" /><p className="text-sm font-bold mt-1">{post.leadScore}</p><p className="text-[9px] text-[#94A3B8]">Lead Score</p>
              </div>
              <div className="p-3 rounded-lg bg-[#F8FAFC] border border-[#E2E8F0] text-center">
                <MousePointerClick size={14} className="mx-auto text-[#64748B]" /><p className="text-sm font-bold mt-1">{latestPerf?.linkClicks ?? "—"}</p><p className="text-[9px] text-[#94A3B8]">Clicks</p>
              </div>
              <div className="p-3 rounded-lg bg-[#F8FAFC] border border-[#E2E8F0] text-center">
                <ThumbsUp size={14} className="mx-auto text-[#64748B]" /><p className="text-sm font-bold mt-1">{engagementTotal ?? "—"}</p><p className="text-[9px] text-[#94A3B8]">Engagement</p>
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
            className="bg-al-primary text-white text-xs font-semibold px-3 py-2 rounded-lg disabled:opacity-50">Save Edits</button>
          <label className={`bg-white border border-al-primary text-al-primary text-xs font-semibold px-3 py-2 rounded-lg cursor-pointer hover:bg-al-primary-subtle ${uploadingImage ? "opacity-50 pointer-events-none" : ""}`}>
            {uploadingImage ? "Uploading…" : "Upload Image"}
            <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleUploadImage(f); e.target.value = ""; }} />
          </label>
          <button disabled={saving || publishing} data-testid="drawer-publish-now" onClick={handlePublishNow}
            className="bg-emerald-600 text-white text-xs font-semibold px-3 py-2 rounded-lg hover:bg-emerald-700 disabled:opacity-50">{publishing ? "Publishing…" : "Publish Now"}</button>
          <button onClick={onClose} className="ml-auto text-[#64748B] text-xs font-semibold px-3 py-2">Close</button>
        </div>
      </div>
    </div>
  );
}

export default PostDrawer;
