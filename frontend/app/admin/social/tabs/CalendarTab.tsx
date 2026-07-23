"use client";
// Content Calendar tab — extracted from SocialDashboardClient.tsx (lazy-loaded).
import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchJson } from "../_shared/fetchJson";
import { PLATFORMS, platformIcon, StatusBadge } from "../_shared/ui";
import type { Post } from "../_shared/types";

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
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize ${platform === p ? "bg-al-primary text-white" : "bg-white border border-[#E2E8F0] text-[#64748B]"}`}>
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
                        className="w-full text-left p-1.5 rounded-lg bg-[#F8FAFC] border border-[#E2E8F0] hover:border-al-primary">
                        <div className="flex items-center gap-1 text-al-primary">{platformIcon(p.platform, 11)}
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

export default CalendarTab;
