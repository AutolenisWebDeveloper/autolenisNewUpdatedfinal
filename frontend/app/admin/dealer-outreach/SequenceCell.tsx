"use client";

// Phase 4B-4 — per-row follow-up sequence state: which of the three touches
// have gone out (with dates), a Replied/Paused badge, and a manual Pause button.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, PauseCircle } from "lucide-react";

export interface SequenceStep {
  step: number; // 1 | 2 | 3
  sentAt: string; // ISO
}

interface SequenceCellProps {
  prospectId: string;
  steps: SequenceStep[];
  replyDetectedAt: string | null;
  sequencePausedAt: string | null;
  sequencePauseReason: string | null;
}

const STEP_LABEL: Record<number, string> = {
  1: "Initial",
  2: "Follow-up 1",
  3: "Follow-up 2",
};

function fmt(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export default function SequenceCell({
  prospectId,
  steps,
  replyDetectedAt,
  sequencePausedAt,
  sequencePauseReason,
}: SequenceCellProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  // Latest step per number (steps may include retries).
  const latestByStep = new Map<number, string>();
  for (const s of steps) {
    const existing = latestByStep.get(s.step);
    if (!existing || new Date(s.sentAt) > new Date(existing)) {
      latestByStep.set(s.step, s.sentAt);
    }
  }

  async function pause() {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/dealer-outreach/pause-sequence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dealerProspectId: prospectId, reason: "manual" }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error?.message ?? `Failed (${res.status})`);
      router.refresh();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Pause failed");
    } finally {
      setBusy(false);
    }
  }

  if (latestByStep.size === 0 && !sequencePausedAt && !replyDetectedAt) {
    return <span className="text-[11px] text-slate-400">—</span>;
  }

  return (
    <div className="flex flex-col gap-1">
      {[1, 2, 3].map((n) => {
        const sentAt = latestByStep.get(n);
        if (!sentAt) return null;
        return (
          <span key={n} className="text-[11px] text-slate-600">
            <span className="font-medium text-slate-700">{STEP_LABEL[n]}</span>{" "}
            <span className="text-slate-400">{fmt(sentAt)}</span>
          </span>
        );
      })}

      <div className="flex items-center gap-1.5">
        {replyDetectedAt && (
          <span className="inline-block rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-medium text-purple-700">
            Replied
          </span>
        )}
        {sequencePausedAt && !replyDetectedAt && (
          <span
            className="inline-block rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-medium text-slate-600"
            title={sequencePauseReason ?? undefined}
          >
            Paused{sequencePauseReason ? ` · ${sequencePauseReason}` : ""}
          </span>
        )}
        {!sequencePausedAt && !replyDetectedAt && latestByStep.size > 0 && (
          <button
            onClick={pause}
            disabled={busy}
            title="Pause follow-up sequence"
            className="inline-flex items-center gap-1 text-[10px] text-slate-400 hover:text-slate-700 disabled:opacity-40"
          >
            {busy ? (
              <Loader2 size={11} className="animate-spin" />
            ) : (
              <PauseCircle size={11} />
            )}
            Pause
          </button>
        )}
      </div>
    </div>
  );
}
