// Admin AI console — status, the runtime kill switch, and the morning briefing.
//
// Three false claims are corrected here (Phase 2 §8.4), and one dead control is
// repaired:
//   • the "Chat with Zura" button queried `[data-testid='chat-toggle-btn']`,
//     which matches NO element. The widget's launcher is `open-chat-btn`.
//   • the page asserted "Groq API (only approved provider)" and that Anthropic,
//     OpenAI, Gemini and Cohere were "explicitly prohibited" — while Gemini,
//     Claude Haiku and Whisper all ran in production. The provider list is now
//     rendered from the closed `ModelId` union and cannot drift again.
//   • it advertised "7 agents", a routing internal that was also wrong once
//     `routeToAgent` was retired. It is gone.
//
// It also stops calling `isAiEnabled()`. That call NEVER worked: this is a
// `"use client"` module, `AI_KILL_SWITCH` is not a `NEXT_PUBLIC_*` var and
// `next.config.mjs` declares no `env` block, so `process.env.AI_KILL_SWITCH` was
// `undefined` in the browser and the badge always read "Active" — telling an
// operator AI was up while it was disabled. The badge now reads real server state.

"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Brain, Loader2, MessageCircle, RefreshCw, ShieldAlert, ShieldCheck } from "lucide-react";
import { api, apiErrorMessage } from "@/lib/api/client";
import { toast } from "sonner";

interface KillSwitchState {
  killed: boolean;
  envKilled: boolean;
  aiEnabled: boolean;
  providers: Array<{ provider: string; models: string[] }>;
}

export default function AdminAiPage() {
  const [briefing, setBriefing] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [state, setState] = useState<KillSwitchState | null>(null);
  const [stateError, setStateError] = useState<string | null>(null);
  const [toggling, setToggling] = useState(false);

  const loadState = useCallback(async () => {
    try {
      setState(await api.get<KillSwitchState>("/api/admin/ai/kill-switch"));
      setStateError(null);
    } catch (err) {
      setStateError(apiErrorMessage(err, "Could not read AI status"));
    }
  }, []);

  useEffect(() => {
    void loadState();
  }, [loadState]);

  // Until the server answers, AI status is UNKNOWN — not "Active". Defaulting to
  // "Active" is exactly the lie the old client-side check told.
  const aiOn = state?.aiEnabled ?? false;
  const statusKnown = state !== null;

  async function toggleKillSwitch() {
    if (!state) return;
    setToggling(true);
    try {
      const next = await api.post<KillSwitchState>("/api/admin/ai/kill-switch", {
        killed: !state.killed,
      });
      setState((prev) => ({ ...next, providers: next.providers ?? prev?.providers ?? [] }));
      toast.success(next.killed ? "AI kill switch ENGAGED" : "AI kill switch released");
    } catch (err) {
      toast.error(apiErrorMessage(err, "Could not change the kill switch"));
    } finally {
      setToggling(false);
    }
  }

  async function generateBriefing() {
    setLoading(true);
    setError(null);
    try {
      const d = await api.post<{ briefing: string }>("/api/admin/ai/briefing");
      setBriefing(d.briefing);
    } catch (err) {
      setError(apiErrorMessage(err, "Briefing generation failed"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-6 md:p-8 max-w-3xl" data-testid="admin-ai-page">
      <div className="flex items-center gap-3 mb-6">
        <Brain size={22} className="text-al-primary" />
        <h1 className="text-xl font-bold text-slate-900">Zura — AI Concierge</h1>
        <Badge variant={!statusKnown ? "secondary" : aiOn ? "green" : "destructive"} data-testid="ai-status-badge">
          {!statusKnown ? "Checking…" : aiOn ? "Active" : "Kill Switch ON"}
        </Badge>
      </div>

      {stateError && (
        <p className="text-sm text-red-500 bg-red-50 rounded-lg p-3 mb-6" data-testid="ai-status-error">
          {stateError}
        </p>
      )}

      {aiOn && (
        <div className="mb-6">
          <button
            onClick={() => {
              const toggle = document.querySelector<HTMLButtonElement>("[data-testid='open-chat-btn']");
              if (toggle) toggle.click();
              else toast.info("The chat widget isn't available on this screen — it opens from the bubble in the corner of any admin page.");
            }}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-al-primary text-white font-semibold text-sm rounded-xl hover:bg-al-primary-hover transition-colors"
            data-testid="open-zura-btn"
          >
            <MessageCircle size={14} aria-hidden /> Chat with Zura
          </button>
        </div>
      )}

      {/* Runtime kill switch */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 mb-6" data-testid="ai-kill-switch">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-semibold text-slate-800 text-sm flex items-center gap-2">
              {aiOn ? <ShieldCheck size={15} className="text-green-600" /> : <ShieldAlert size={15} className="text-red-600" />}
              AI kill switch
            </p>
            <p className="text-xs text-slate-500 mt-1 max-w-md">
              Engaging this stops every AI operation platform-wide — chat, voice, content
              generation, enrichment and scoring — with no redeploy. Every flip is recorded.
            </p>
            {state?.envKilled && (
              <p className="text-xs text-red-600 mt-2 font-medium" data-testid="env-kill-notice">
                The deploy-level <code>AI_KILL_SWITCH</code> env var is also set. AI stays
                disabled until that is cleared, whatever this control says.
              </p>
            )}
          </div>
          <Button
            size="sm"
            variant={state?.killed ? "secondary" : "destructive"}
            onClick={toggleKillSwitch}
            disabled={!statusKnown || toggling}
            data-testid="toggle-kill-switch-btn"
          >
            {toggling ? <Loader2 size={12} className="animate-spin mr-1" /> : null}
            {state?.killed ? "Release kill switch" : "Engage kill switch"}
          </Button>
        </div>
      </div>

      {/* AI configuration — rendered from the closed model union, not from prose */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3 text-sm mb-6" data-testid="ai-config">
        <div className="flex items-center justify-between py-1 border-b border-slate-100">
          <span className="text-slate-500">Kill switch</span>
          <span className={`font-medium text-xs font-mono ${aiOn ? "text-green-600" : "text-red-600 font-bold"}`}>
            {!statusKnown ? "unknown" : aiOn ? "OFF (AI enabled)" : "ON (AI disabled)"}
          </span>
        </div>
        {(state?.providers ?? []).map((p) => (
          <div key={p.provider} className="flex items-start justify-between py-1 border-b border-slate-100 last:border-0 gap-4">
            <span className="text-slate-500 capitalize">{p.provider}</span>
            <span className="font-medium text-xs font-mono text-slate-700 text-right" data-testid={`provider-${p.provider}`}>
              {p.models.join(", ")}
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

        {statusKnown && !aiOn && (
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

      <p className="text-xs text-slate-400 mt-4">
        Every model call in AutoLenis passes through one provider adapter, which asserts the
        kill switch once. The list above is the complete set of models the code can reach.
      </p>
    </div>
  );
}
