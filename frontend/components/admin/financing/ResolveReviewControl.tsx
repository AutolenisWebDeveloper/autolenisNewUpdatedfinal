"use client";

// Client control to resolve one financing review task. Posts to the role-guarded,
// audited resolve API. The decision set is the safe, machine-validated set; a
// resolution note is required. No PII should be entered in the note.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/admin/crm/ui";

const DECISIONS = ["APPROVED", "DECLINED", "CONDITIONAL", "WITHDRAWN"] as const;

export function ResolveReviewControl({ taskId, taskType }: { taskId: string; taskType: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [resolution, setResolution] = useState("");
  const [decision, setDecision] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/financing-reviews/${taskId}/resolve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ resolution, decision: decision || undefined }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error?.message ?? "Could not resolve the task");
      }
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        Resolve
      </Button>
    );
  }

  const noteId = `resolve-note-${taskId}`;
  const decId = `resolve-decision-${taskId}`;
  return (
    <div className="flex flex-col items-stretch gap-2 text-left">
      <label htmlFor={decId} className="text-[11px] font-medium text-[var(--crm-text-tertiary)]">
        Decision {taskType === "STIP_REVIEW" ? "(after clearing stips)" : ""}
      </label>
      <select
        id={decId}
        value={decision}
        onChange={(e) => setDecision(e.target.value)}
        className="rounded-[var(--crm-radius-sm)] border border-[var(--crm-border)] bg-[var(--crm-bg-primary)] px-2 py-1 text-[13px] text-[var(--crm-text-primary)]"
      >
        <option value="">No status change (note only)</option>
        {DECISIONS.map((d) => (
          <option key={d} value={d}>
            {d}
          </option>
        ))}
      </select>
      <label htmlFor={noteId} className="text-[11px] font-medium text-[var(--crm-text-tertiary)]">
        Resolution note (required — do not include personal data)
      </label>
      <textarea
        id={noteId}
        value={resolution}
        onChange={(e) => setResolution(e.target.value)}
        rows={2}
        className="rounded-[var(--crm-radius-sm)] border border-[var(--crm-border)] bg-[var(--crm-bg-primary)] px-2 py-1 text-[13px] text-[var(--crm-text-primary)]"
      />
      {error && <p className="text-[12px] text-[var(--crm-danger)]" role="alert">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
          Cancel
        </Button>
        <Button size="sm" onClick={submit} disabled={busy || resolution.trim().length === 0}>
          {busy ? "Saving…" : "Confirm"}
        </Button>
      </div>
    </div>
  );
}
