"use client";

// Phase 4B-1 — dealer email cell for the recruitment pipeline table.
// Renders the captured email + confidence badge + enriched-at relative time,
// with a "Re-Enrich" action (Gemini Search) and an inline "Edit" manual
// override.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Pencil, Check, X } from "lucide-react";

interface EmailCellProps {
  prospectId: string;
  email: string | null;
  // Persisted emailSource value (free-form string from the DB). Known values are
  // mapped to badges below; anything else renders without a badge.
  emailSource: string | null;
  emailEnrichedAt: string | null; // ISO string
}

const SOURCE_BADGE: Record<string, { label: string; cls: string }> = {
  gemini_search_high_confidence: { label: "high", cls: "bg-green-100 text-green-700" },
  gemini_search_medium_confidence: { label: "medium", cls: "bg-blue-100 text-blue-700" },
  gemini_search_inferred: { label: "low", cls: "bg-amber-100 text-amber-700" },
  fallback_info_email: { label: "fallback", cls: "bg-slate-100 text-slate-600" },
  manual: { label: "manual", cls: "bg-purple-100 text-purple-700" },
};

function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const diffMs = Date.now() - then;
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

export default function EmailCell(props: EmailCellProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(props.email ?? "");

  const badge = props.emailSource ? SOURCE_BADGE[props.emailSource] : null;

  async function reEnrich() {
    setBusy(true);
    try {
      const res = await fetch(
        `/api/admin/dealer-outreach/${props.prospectId}/reenrich-email`,
        { method: "POST" },
      );
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(body?.error?.message ?? `Request failed (${res.status})`);
      }
      const found = body?.data?.email as string | null | undefined;
      if (!found) {
        window.alert("No email found for this dealer.");
      }
      router.refresh();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Re-enrich failed");
    } finally {
      setBusy(false);
    }
  }

  async function saveOverride() {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/dealer-outreach/${props.prospectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: draft.trim() }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(body?.error?.message ?? `Request failed (${res.status})`);
      }
      setEditing(false);
      router.refresh();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <input
          type="email"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="name@dealer.com"
          className="w-40 rounded border border-slate-300 px-2 py-1 text-xs"
          autoFocus
        />
        <button
          onClick={saveOverride}
          disabled={busy}
          title="Save"
          className="rounded p-1 text-green-600 hover:bg-green-50 disabled:opacity-50"
        >
          <Check size={14} />
        </button>
        <button
          onClick={() => {
            setEditing(false);
            setDraft(props.email ?? "");
          }}
          disabled={busy}
          title="Cancel"
          className="rounded p-1 text-slate-400 hover:bg-slate-100 disabled:opacity-50"
        >
          <X size={14} />
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        {props.email ? (
          <a
            href={`mailto:${props.email}`}
            className="text-al-primary hover:underline max-w-[200px] truncate"
            title={props.email}
          >
            {props.email}
          </a>
        ) : (
          <span className="text-slate-400">—</span>
        )}
        {badge && (
          <span
            className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${badge.cls}`}
          >
            {badge.label}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 text-[11px] text-slate-400">
        <span>{relativeTime(props.emailEnrichedAt)}</span>
        <button
          onClick={reEnrich}
          disabled={busy}
          title="Re-enrich via Gemini Search"
          className="inline-flex items-center gap-1 text-slate-500 hover:text-al-primary disabled:opacity-50"
        >
          <RefreshCw size={12} className={busy ? "animate-spin" : ""} />
          {busy ? "Working…" : "Re-Enrich"}
        </button>
        <button
          onClick={() => setEditing(true)}
          disabled={busy}
          title="Manually override email"
          className="inline-flex items-center gap-1 text-slate-500 hover:text-al-primary disabled:opacity-50"
        >
          <Pencil size={12} />
          Edit
        </button>
      </div>
    </div>
  );
}
