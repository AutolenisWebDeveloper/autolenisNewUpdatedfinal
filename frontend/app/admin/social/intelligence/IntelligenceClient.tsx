"use client";

// /admin/social/intelligence — Intelligence Index dashboard (client).
// Four composite-score gauges, top buyer markets, competitor opportunities,
// and manual trigger buttons for the competitor scan + market-index publish.

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  BrainCircuit, TrendingUp, Gauge, Swords, Loader2, Sparkles,
  Linkedin, Search, ArrowUpRight,
} from "lucide-react";

export interface CompetitorInsightRow {
  id: string;
  competitor: string;
  topic: string;
  contentType: string;
  estimatedEngagement: string;
  opportunity: string;
  suggestedHook: string;
  signalCreated: boolean;
  weekOf: string;
}
export interface MarketRow {
  metroName: string;
  buyerLeverageScore: number | null;
}
interface Scores {
  buyerPowerIndex: number;
  dealerCompetitionIndex: number;
  vehiclePricingIndex: number;
  negotiationIndex: number;
  trend: "improving" | "declining" | "stable";
  weekOf: string;
}

const BLUE = "#0B5FD1";

function scoreColor(score: number): { text: string; bar: string; ring: string } {
  if (score <= 40) return { text: "text-red-600", bar: "bg-red-500", ring: "#DC2626" };
  if (score <= 70) return { text: "text-amber-600", bar: "bg-amber-500", ring: "#D97706" };
  return { text: "text-emerald-600", bar: "bg-emerald-500", ring: "#059669" };
}

function Gauge100({
  label, score, icon: Icon,
}: {
  label: string;
  score: number;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}) {
  const c = scoreColor(score);
  return (
    <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-4">
      <div className="flex items-center gap-2 mb-3">
        <Icon size={15} className="text-[#0B5FD1]" />
        <p className="text-xs font-semibold text-[#475569]">{label}</p>
      </div>
      <div className="flex items-end gap-1">
        <span className={`text-3xl font-bold ${c.text}`}>{score}</span>
        <span className="text-xs text-[#94A3B8] mb-1">/100</span>
      </div>
      <div className="mt-3 h-2 bg-[#F1F5F9] rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${c.bar}`} style={{ width: `${score}%` }} />
      </div>
    </div>
  );
}

function leverageColor(score: number): string {
  if (score >= 7) return "text-emerald-600";
  if (score >= 4) return "text-amber-600";
  return "text-red-600";
}

const ENGAGEMENT_STYLES: Record<string, string> = {
  high: "bg-emerald-100 text-emerald-700",
  medium: "bg-amber-100 text-amber-700",
  low: "bg-slate-100 text-slate-600",
};

export default function IntelligenceClient({
  insights, markets, scores,
}: {
  insights: CompetitorInsightRow[];
  markets: MarketRow[];
  scores: Scores;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  const post = async (url: string, body?: object): Promise<unknown> => {
    const res = await fetch(url, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = (await res.json().catch(() => null)) as
      | { success?: boolean; data?: unknown; error?: { message?: string } }
      | null;
    if (!res.ok || json?.success === false) {
      throw new Error(json?.error?.message ?? `Request failed (${res.status})`);
    }
    return json?.data;
  };

  const scanCompetitors = async () => {
    setBusy("scan");
    try {
      const data = (await post("/api/admin/social/competitor-scan")) as { count?: number };
      showToast(`Scan complete — ${data?.count ?? 0} opportunities`);
      router.refresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Scan failed");
    } finally {
      setBusy(null);
    }
  };

  const generateIndex = async (publish: boolean) => {
    setBusy(publish ? "publish" : "generate");
    try {
      await post("/api/admin/social/market-index", { publish });
      showToast(publish ? "Market Index published to LinkedIn" : "Market Index generated");
      router.refresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setBusy(null);
    }
  };

  const createPost = async (row: CompetitorInsightRow) => {
    setBusy(`create-${row.id}`);
    try {
      await post("/api/admin/social/generate", {
        franchiseSlug: "how_autolenis_works",
        hook: row.suggestedHook,
      });
      showToast("Post generation queued");
      router.refresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Could not create post");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="min-h-screen bg-[#F4F6FA] p-4 lg:p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#0B5FD1] flex items-center justify-center">
            <BrainCircuit size={18} className="text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-[#0F172A] tracking-tight">Intelligence Index</h1>
            <p className="text-xs text-[#64748B]">
              Week of {scores.weekOf} · trend{" "}
              <span className="font-semibold capitalize">{scores.trend}</span>
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={scanCompetitors}
            disabled={busy === "scan"}
            className="flex items-center gap-1.5 bg-white border border-[#E2E8F0] text-[#0F172A] text-xs font-semibold px-4 py-2 rounded-lg disabled:opacity-50"
          >
            {busy === "scan" ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
            Scan Competitor Content
          </button>
          <button
            onClick={() => generateIndex(false)}
            disabled={busy === "generate"}
            className="flex items-center gap-1.5 bg-[#0B5FD1] text-white text-xs font-semibold px-4 py-2 rounded-lg disabled:opacity-50"
          >
            {busy === "generate" ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            Generate Market Index
          </button>
          <button
            onClick={() => generateIndex(true)}
            disabled={busy === "publish"}
            className="flex items-center gap-1.5 bg-white border border-[#0B5FD1] text-[#0B5FD1] text-xs font-semibold px-4 py-2 rounded-lg disabled:opacity-50"
          >
            {busy === "publish" ? <Loader2 size={14} className="animate-spin" /> : <Linkedin size={14} />}
            Publish to LinkedIn
          </button>
        </div>
      </div>

      {/* Four score gauges */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Gauge100 label="Buyer Power Index" score={scores.buyerPowerIndex} icon={Gauge} />
        <Gauge100 label="Dealer Competition" score={scores.dealerCompetitionIndex} icon={Swords} />
        <Gauge100 label="Vehicle Pricing" score={scores.vehiclePricingIndex} icon={TrendingUp} />
        <Gauge100 label="Negotiation Index" score={scores.negotiationIndex} icon={BrainCircuit} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Top buyer markets */}
        <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-[#E2E8F0]">
            <h2 className="text-sm font-bold text-[#0F172A]">Top Buyer Markets</h2>
          </div>
          <table className="w-full text-xs">
            <thead className="bg-[#F8FAFC] text-[#64748B]">
              <tr>
                <th className="text-left font-semibold px-4 py-2">Metro</th>
                <th className="text-right font-semibold px-4 py-2">Leverage</th>
                <th className="text-right font-semibold px-4 py-2">Signal</th>
              </tr>
            </thead>
            <tbody>
              {markets.length === 0 && (
                <tr><td colSpan={3} className="px-4 py-8 text-center text-[#94A3B8]">No market data yet.</td></tr>
              )}
              {markets.map((m) => {
                const score = Math.round((m.buyerLeverageScore ?? 0) * 10) / 10;
                return (
                  <tr key={m.metroName} className="border-t border-[#F1F5F9]">
                    <td className="px-4 py-2 font-medium text-[#0F172A]">{m.metroName}</td>
                    <td className={`px-4 py-2 text-right font-bold ${leverageColor(score)}`}>{score}</td>
                    <td className="px-4 py-2 text-right">
                      {score >= 7 ? (
                        <span className="inline-flex items-center gap-0.5 text-emerald-600">
                          <ArrowUpRight size={12} /> strong
                        </span>
                      ) : (
                        <span className="text-[#94A3B8]">normal</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Competitor opportunities */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-[#E2E8F0] shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-[#E2E8F0] flex items-center gap-2">
            <Swords size={14} className="text-[#0B5FD1]" />
            <h2 className="text-sm font-bold text-[#0F172A]">Competitor Content Opportunities</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-[#F8FAFC] text-[#64748B]">
                <tr>
                  <th className="text-left font-semibold px-4 py-2">Competitor</th>
                  <th className="text-left font-semibold px-4 py-2">Topic</th>
                  <th className="text-left font-semibold px-4 py-2">Type</th>
                  <th className="text-left font-semibold px-4 py-2">Engagement</th>
                  <th className="text-left font-semibold px-4 py-2">Opportunity</th>
                  <th className="text-right font-semibold px-4 py-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {insights.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-[#94A3B8]">No opportunities yet. Run a scan.</td></tr>
                )}
                {insights.map((row) => (
                  <tr key={row.id} className="border-t border-[#F1F5F9] align-top">
                    <td className="px-4 py-2 font-medium text-[#0F172A]">{row.competitor}</td>
                    <td className="px-4 py-2 text-[#475569] max-w-[160px]">{row.topic}</td>
                    <td className="px-4 py-2 text-[#475569]">{row.contentType}</td>
                    <td className="px-4 py-2">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold ${ENGAGEMENT_STYLES[row.estimatedEngagement] ?? "bg-slate-100 text-slate-600"}`}>
                        {row.estimatedEngagement}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-[#64748B] max-w-[220px]">{row.opportunity}</td>
                    <td className="px-4 py-2 text-right">
                      <button
                        onClick={() => createPost(row)}
                        disabled={busy === `create-${row.id}`}
                        className="text-[#0B5FD1] font-semibold hover:underline disabled:opacity-50 whitespace-nowrap"
                      >
                        {busy === `create-${row.id}` ? "Creating…" : "Create Post"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {toast && (
        <div className="fixed bottom-6 right-6 z-50 text-white text-xs px-4 py-2.5 rounded-lg shadow-lg" style={{ background: BLUE }}>
          {toast}
        </div>
      )}
    </div>
  );
}
