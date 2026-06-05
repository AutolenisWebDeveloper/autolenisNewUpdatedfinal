"use client";

// Phase 4B-1 — queues Gemini Search email enrichment for prospects that have
// no email yet. POSTs to /api/admin/dealer-outreach/backfill-emails, which
// enriches in the background, so we surface the queued message and refresh
// shortly after to pick up results.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Mail } from "lucide-react";

interface BackfillEmailsButtonProps {
  /** Count of prospects with no email captured yet. */
  missingCount: number;
}

interface BackfillEmailsData {
  queued: number;
  message: string;
}

export default function BackfillEmailsButton({
  missingCount,
}: BackfillEmailsButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  if (missingCount === 0) return null;

  async function run() {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/admin/dealer-outreach/backfill-emails", {
        method: "POST",
      });
      const json = (await res.json()) as
        | { success: true; data: BackfillEmailsData }
        | { error: { message: string } };
      if (!res.ok || !("success" in json)) {
        setNote("error" in json ? json.error.message : "Email backfill failed");
        return;
      }
      setNote(json.data.message);
      // Enrichment runs in the background; refresh after a short delay so newly
      // captured emails show up without a manual reload.
      setTimeout(() => startTransition(() => router.refresh()), 8000);
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Email backfill failed");
    } finally {
      setBusy(false);
    }
  }

  const disabled = busy || isPending;

  return (
    <div className="flex items-center gap-2">
      {note && <span className="text-xs text-slate-500">{note}</span>}
      <button
        type="button"
        onClick={run}
        disabled={disabled}
        className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {disabled ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />}
        Find {missingCount} email{missingCount === 1 ? "" : "s"}
      </button>
    </div>
  );
}
