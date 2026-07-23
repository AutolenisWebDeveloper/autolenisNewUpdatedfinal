"use client";
// Market Index tab — extracted from SocialDashboardClient.tsx (lazy-loaded).
import { useCallback, useEffect, useState } from "react";
import { Sparkles, Loader2, Newspaper, ExternalLink } from "lucide-react";
import { fetchJson } from "../_shared/fetchJson";
import { fmtDateTime } from "../_shared/format";
import { StatusBadge } from "../_shared/ui";
import type { MarketIndexLast } from "../_shared/types";

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
            className="bg-al-primary text-white text-xs font-semibold px-4 py-2 rounded-lg disabled:opacity-50 flex items-center gap-2">
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
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-al-primary">
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


export default MarketIndexTab;
