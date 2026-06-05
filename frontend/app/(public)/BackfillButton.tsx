"use client";

// Phase 4A — drafts missing phone scripts for DISCOVERED prospects.
// POSTs to /api/admin/dealer-outreach/backfill (capped server-side) and
// refreshes the table so the freshly drafted scripts appear.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileText, Loader2 } from "lucide-react";

interface BackfillButtonProps {
  /** Count of DISCOVERED prospects still missing a drafted script. */
  missingCount: number;
}

interface BackfillData {
  attempted: number;
  succeeded: number;
  failed: number;
}

export default function BackfillButton({ missingCount }: BackfillButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  if (missingCount === 0) return null;

  async function run() {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/admin/dealer-outreach/backfill", {
        method: "POST",
      });
      const json = (await res.json()) as
        | { success: true; data: BackfillData }
        | { error: { message: string } };
      if (!res.ok || !("success" in json)) {
        const message =
          "error" in json ? json.error.message : "Backfill failed";
        setNote(message);
        return;
      }
      const { succeeded, failed, attempted } = json.data;
      setNote(`Drafted ${succeeded}/${attempted} script(s)${failed ? `, ${failed} failed` : ""}.`);
      startTransition(() => router.refresh());
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Backfill failed");
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
        {disabled ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
        Draft {missingCount} script{missingCount === 1 ? "" : "s"}
      </button>
    </div>
  );
}
