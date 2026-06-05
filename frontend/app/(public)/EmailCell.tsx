"use client";

// Phase 4B-1 — table cell showing a dealer prospect's enriched email plus a
// re-enrich control. Renders the email as a mailto link with its source and a
// button to (re)run Gemini Search enrichment via the per-prospect route, which
// returns the fresh email synchronously so we can update the cell in place.
import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";

interface EmailCellProps {
  prospectId: string;
  email: string | null;
  emailSource: string | null;
  /** ISO timestamp string, or null if never enriched. */
  emailEnrichedAt: string | null;
}

interface ReenrichData {
  email: string | null;
  emailSource: string | null;
  emailEnrichedAt: string | null;
}

function sourceLabel(source: string | null): string | null {
  if (!source) return null;
  if (source.startsWith("gemini_search_high")) return "high confidence";
  if (source.startsWith("gemini_search_medium")) return "medium confidence";
  if (source.startsWith("gemini_search_inferred")) return "inferred";
  if (source === "fallback_info_email") return "fallback";
  if (source === "manual") return "manual";
  return source;
}

export default function EmailCell({
  prospectId,
  email: initialEmail,
  emailSource: initialSource,
}: EmailCellProps) {
  const [email, setEmail] = useState<string | null>(initialEmail);
  const [source, setSource] = useState<string | null>(initialSource);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reenrich() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/dealer-outreach/${prospectId}/reenrich-email`,
        { method: "POST" },
      );
      const json = (await res.json()) as
        | { success: true; data: ReenrichData }
        | { error: { message: string } };
      if (!res.ok || !("success" in json)) {
        setError("error" in json ? json.error.message : "Enrichment failed");
        return;
      }
      setEmail(json.data.email);
      setSource(json.data.emailSource);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Enrichment failed");
    } finally {
      setBusy(false);
    }
  }

  const label = sourceLabel(source);

  return (
    <div className="flex flex-col gap-0.5">
      {email ? (
        <a href={`mailto:${email}`} className="text-[#0B5FD1] hover:underline">
          {email}
        </a>
      ) : (
        <span className="text-slate-400">—</span>
      )}
      <div className="flex items-center gap-2">
        {label && <span className="text-xs text-slate-400">{label}</span>}
        <button
          type="button"
          onClick={reenrich}
          disabled={busy}
          className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-[#0B5FD1] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
          {email ? "Re-find" : "Find"}
        </button>
      </div>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
