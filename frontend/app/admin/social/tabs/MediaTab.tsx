"use client";
// Media tab — extracted from SocialDashboardClient.tsx (lazy-loaded).
import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Film, Loader2 } from "lucide-react";
import { fetchJson } from "../_shared/fetchJson";
import { fmtDateTime } from "../_shared/format";
import { PLATFORMS, VideoBadge } from "../_shared/ui";

interface MediaItem {
  id: string;
  status: string;
  thumbnailUrl: string | null;
  videoUrl: string | null;
  provider: string;
  generatedAt: string | null;
  createdAt: string;
  post: {
    id: string;
    platform: string;
    hook: string;
    status: string;
    scheduledAt: string | null;
    franchise: { name: string; slug: string } | null;
  } | null;
}

const MEDIA_TYPE_FILTERS = [
  { label: "All", value: "all" },
  { label: "Images", value: "image" },
  { label: "Videos", value: "video" },
];
const MEDIA_STATUS_FILTERS = [
  { label: "All", value: "all" },
  { label: "Ready", value: "VIDEO_READY" },
  { label: "Generating", value: "VIDEO_GENERATING" },
  { label: "Failed", value: "VIDEO_FAILED" },
];
const PLATFORM_BADGE: Record<string, string> = {
  facebook: "bg-blue-100 text-blue-700",
  instagram: "bg-pink-100 text-pink-700",
  tiktok: "bg-slate-900 text-white",
  youtube: "bg-red-100 text-red-700",
  linkedin: "bg-sky-100 text-sky-700",
};

function MediaTab({ showToast }: { showToast: (m: string) => void }) {
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [platform, setPlatform] = useState("all");
  const [type, setType] = useState("all");
  const [status, setStatus] = useState("all");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (platform !== "all") params.set("platform", platform);
      if (type !== "all") params.set("type", type);
      if (status !== "all") params.set("status", status);
      const data = await fetchJson<{ media: MediaItem[] }>(`/api/admin/social/media?${params.toString()}`);
      setMedia(data.media);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to load media");
    } finally {
      setLoading(false);
    }
  }, [platform, type, status, showToast]);
  useEffect(() => { void load(); }, [load]);

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1">
          {["all", ...PLATFORMS].map((p) => (
            <button key={p} data-testid={`media-platform-${p}`} onClick={() => setPlatform(p)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize ${platform === p ? "bg-al-primary text-white" : "bg-white border border-[#E2E8F0] text-[#64748B]"}`}>
              {p}
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          {MEDIA_TYPE_FILTERS.map((f) => (
            <button key={f.value} onClick={() => setType(f.value)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${type === f.value ? "bg-al-primary text-white" : "bg-white border border-[#E2E8F0] text-[#64748B]"}`}>
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          {MEDIA_STATUS_FILTERS.map((f) => (
            <button key={f.value} onClick={() => setStatus(f.value)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${status === f.value ? "bg-al-primary text-white" : "bg-white border border-[#E2E8F0] text-[#64748B]"}`}>
              {f.label}
            </button>
          ))}
        </div>
        <button onClick={() => void load()} className="ml-auto flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white border border-[#E2E8F0] text-xs font-semibold text-[#64748B] hover:text-[#0F172A]">
          <RefreshCw size={12} /> Refresh
        </button>
      </div>

      {/* Grid */}
      {loading ? (
        <div className="py-16 text-center text-[#94A3B8] text-sm flex items-center justify-center gap-2"><Loader2 size={16} className="animate-spin" /> Loading media…</div>
      ) : media.length === 0 ? (
        <div className="py-16 text-center text-[#94A3B8] text-sm">No media assets yet.</div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4" data-testid="media-grid">
          {media.map((m) => {
            const url = m.videoUrl ?? m.thumbnailUrl ?? "";
            const isVideo = Boolean(m.videoUrl);
            return (
              <div key={m.id} className="bg-white border border-[#E2E8F0] rounded-2xl shadow-sm overflow-hidden">
                <div className="relative aspect-video bg-slate-100">
                  {m.thumbnailUrl ? (
                    <img src={m.thumbnailUrl} alt={m.post?.hook ?? "media"} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-slate-300"><Film size={28} /></div>
                  )}
                  {isVideo && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="w-10 h-10 rounded-full bg-black/50 text-white flex items-center justify-center text-sm">▶</span>
                    </div>
                  )}
                  {m.post && (
                    <span className={`absolute top-2 left-2 text-[10px] font-bold px-2 py-0.5 rounded-full capitalize ${PLATFORM_BADGE[m.post.platform] ?? "bg-slate-100 text-slate-600"}`}>
                      {m.post.platform}
                    </span>
                  )}
                </div>
                <div className="p-3 space-y-2">
                  <p className="text-xs font-medium text-[#0F172A] truncate">{m.post?.hook ?? "—"}</p>
                  <div className="flex items-center justify-between text-[10px] text-[#94A3B8]">
                    <span>{m.post?.franchise?.name ?? "—"}</span>
                    <span>{fmtDateTime(m.generatedAt ?? m.createdAt)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <VideoBadge status={m.status} />
                    <button onClick={() => { if (url) window.open(url, "_blank"); }} disabled={!url}
                      className="flex items-center gap-1 text-xs font-semibold text-al-primary hover:underline disabled:opacity-40">
                      ⬇ Download
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Bulk upload modal ───────────────────────────────────────────────────────

export default MediaTab;
