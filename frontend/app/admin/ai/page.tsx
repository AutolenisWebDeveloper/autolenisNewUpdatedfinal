// Admin AI console — System 16 ENH — Groq ONLY
// Shows AI status, kill switch, admin morning briefing

"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Brain, Loader2, MessageCircle, RefreshCw } from "lucide-react";
import { isAiEnabled } from "@/lib/ai/kill-switch";

export default function AdminAiPage() {
  const [briefing, setBriefing] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const aiOn = isAiEnabled();

  async function generateBriefing() {
    setLoading(true);
    setError(null);
    const res = await fetch("/api/admin/ai/briefing", { method: "POST" });
    const d = await res.json() as { success: boolean; data?: { briefing: string }; error?: { message: string } };
    setLoading(false);
    if (res.ok && d.data) setBriefing(d.data.briefing);
    else setError(d.error?.message ?? "Briefing generation failed");
  }

  return (
    <div className="p-6 md:p-8 max-w-3xl" data-testid="admin-ai-page">
      <div className="flex items-center gap-3 mb-6">
        <Brain size={22} className="text-[#0B5FD1]" />
        <h1 className="text-xl font-bold text-slate-900">Zura — AI Concierge</h1>
        <p className="text-sm text-[#6B7280]">Groq-powered · openai/gpt-oss-120b</p>
        <Badge variant={aiOn ? "green" : "destructive"}>{aiOn ? "Active" : "Kill Switch ON"}</Badge>
      </div>
      {aiOn && (
        <div className="mb-6">
          <button
            onClick={() => document.querySelector<HTMLButtonElement>("[data-testid='chat-toggle-btn']")?.click()}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#0B5FD1] text-white font-semibold text-sm rounded-xl hover:bg-[#0A4DB8] transition-colors"
            data-testid="open-zura-btn"
          >
            <MessageCircle size={14} /> Chat with Zura
          </button>
        </div>
      )}

      {/* AI Configuration */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3 text-sm mb-6" data-testid="ai-config">
        {[
          { label: "Primary model", value: "openai/gpt-oss-120b" },
          { label: "Fallback model", value: "openai/gpt-oss-20b" },
          { label: "Provider", value: "Groq API (only approved provider)" },
          { label: "Kill switch", value: aiOn ? "OFF (AI enabled)" : "ON (AI disabled)" },
          { label: "Available agents", value: "7 (General, PreQual, Search, Auction, Deal, Dealer, Admin Briefing)" },
        ].map(f => (
          <div key={f.label} className="flex items-center justify-between py-1 border-b border-slate-100 last:border-0">
            <span className="text-slate-500">{f.label}</span>
            <span className={`font-medium text-xs font-mono ${f.label === "Kill switch" ? (aiOn ? "text-green-600" : "text-red-600 font-bold") : "text-slate-700"}`}>
              {f.value}
            </span>
          </div>
        ))}
      </div>

      {/* Admin Morning Briefing */}
      <div className="bg-white border border-slate-200 rounded-xl p-5" data-testid="admin-briefing-section">
        <div className="flex items-center justify-between mb-3">
          <p className="font-semibold text-slate-800 text-sm">Morning Operations Briefing</p>
          <Button size="sm" variant="secondary" onClick={generateBriefing} disabled={loading || !aiOn} data-testid="generate-briefing-btn">
            {loading ? <Loader2 size={12} className="animate-spin mr-1" /> : <RefreshCw size={12} className="mr-1" />}
            {loading ? "Generating…" : "Generate Briefing"}
          </Button>
        </div>

        {!aiOn && (
          <p className="text-sm text-slate-400">AI briefing unavailable — kill switch is active.</p>
        )}

        {error && (
          <p className="text-sm text-red-500 bg-red-50 rounded-lg p-3" data-testid="briefing-error">{error}</p>
        )}

        {briefing && (
          <div className="bg-slate-50 rounded-lg p-4 text-sm text-slate-700 leading-relaxed whitespace-pre-wrap" data-testid="briefing-output">
            {briefing}
          </div>
        )}

        {!briefing && !loading && !error && aiOn && (
          <p className="text-sm text-slate-400">Click &quot;Generate Briefing&quot; to get an AI-powered daily operations summary.</p>
        )}
      </div>

      <p className="text-xs text-slate-400 mt-4">Anthropic, OpenAI, Gemini, and Cohere are explicitly prohibited. All AI features use Groq API exclusively.</p>
    </div>
  );
}
