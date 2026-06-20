"use client";

import { useState } from "react";
import { Sparkles, Loader2, RefreshCw, AlertCircle } from "lucide-react";

interface SummaryResponse {
  success: true;
  data: { summary: string; model: string; generatedAt: string };
}
interface ErrorResponse {
  error: { message: string };
}

// Escape HTML, then promote **bold** spans — safe rendering of the model's
// lightweight markdown without dangerously injecting arbitrary HTML.
function renderMarkdown(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped
    .replace(/\*\*(.+?)\*\*/g, '<strong class="text-[#0F172A] font-bold">$1</strong>')
    .replace(/\n{2,}/g, "<br/><br/>")
    .replace(/\n/g, "<br/>");
}

export default function ExecutiveSummaryCard() {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [summary, setSummary] = useState<string>("");
  const [meta, setMeta] = useState<{ model: string; at: string } | null>(null);
  const [error, setError] = useState<string>("");

  async function generate() {
    setState("loading");
    setError("");
    try {
      const res = await fetch("/api/admin/amips/executive-summary", {
        method: "POST",
        headers: { Accept: "application/json" },
      });

      // Parse defensively: the response can be an HTML error page (e.g. a
      // gateway timeout) which would otherwise blow up JSON.parse with an
      // opaque "Unexpected token '<'".
      const raw = await res.text();
      let json: SummaryResponse | ErrorResponse | null = null;
      try {
        json = JSON.parse(raw) as SummaryResponse | ErrorResponse;
      } catch {
        json = null;
      }

      if (!json) {
        setError(
          res.status === 504 || res.status === 502
            ? "The AI service took too long to respond. Please try again."
            : `The server returned an unexpected response (HTTP ${res.status}). Please try again.`,
        );
        setState("error");
        return;
      }
      if (!res.ok || !("success" in json)) {
        setError("error" in json ? json.error.message : `Request failed (HTTP ${res.status}).`);
        setState("error");
        return;
      }
      setSummary(json.data.summary);
      setMeta({
        model: json.data.model,
        at: new Date(json.data.generatedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
      });
      setState("done");
    } catch (err) {
      setError((err as Error).message);
      setState("error");
    }
  }

  return (
    <div className="bg-gradient-to-br from-[#0B5FD1] to-[#0A3D8F] rounded-2xl p-5 shadow-sm text-white">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-white/15 flex items-center justify-center">
            <Sparkles size={15} />
          </div>
          <div>
            <p className="text-sm font-bold leading-tight">AI Executive Briefing</p>
            <p className="text-[10px] text-white/70">
              {meta ? `${meta.model} · ${meta.at}` : "Natural-language reading of the live intelligence"}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={generate}
          disabled={state === "loading"}
          className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-[#0B5FD1] hover:bg-white/90 transition-colors disabled:opacity-60"
        >
          {state === "loading" ? (
            <><Loader2 size={12} className="animate-spin" /> Analyzing…</>
          ) : state === "done" ? (
            <><RefreshCw size={12} /> Regenerate</>
          ) : (
            <><Sparkles size={12} /> Generate Briefing</>
          )}
        </button>
      </div>

      {state === "idle" && (
        <p className="mt-4 text-sm text-white/80 leading-relaxed">
          Generate an on-demand executive summary — the model interprets the current
          health, opportunities, and risks into a 3-part briefing. It reasons only over
          the computed numbers, never inventing figures.
        </p>
      )}

      {state === "error" && (
        <div className="mt-4 flex items-start gap-2 rounded-lg bg-white/10 p-3 text-sm text-white/90">
          <AlertCircle size={15} className="shrink-0 mt-0.5" />
          <span>{error || "Could not generate the briefing."}</span>
        </div>
      )}

      {state === "done" && (
        <div
          className="mt-4 rounded-xl bg-white/95 p-4 text-sm text-[#374151] leading-relaxed [&_strong]:text-[#0F172A]"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(summary) }}
        />
      )}
    </div>
  );
}
