"use client";

// Client control to resolve one financing follow-up. Posts to the role-guarded, audited resolve
// API. A resolution note is required. No PII should be entered in the note.
//
// PHASE 7 (§13-D25) REMOVED THE DECISION SELECT, and that is a removal with a reason rather than a
// simplification. The control used to offer APPROVED / DECLINED / CONDITIONAL / WITHDRAWN, which
// drove a `CreditApplication` through its own state machine. §12 is explicit that AutoLenis "does
// not accept a lender application, does not pull lender credit, does not underwrite" — so there is
// no application for an admin to decide, and an admin who picked "APPROVED" here would be
// recording a credit decision AutoLenis is not permitted to make. The note and the resolution are
// what remain, which is what §26 gives every exception.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/admin/crm/ui";

export function ResolveReviewControl({ taskId, taskType }: { taskId: string; taskType: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [resolution, setResolution] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/financing-reviews/${taskId}/resolve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ resolution }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error?.message ?? "Could not resolve the follow-up");
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
  return (
    <div className="flex flex-col items-stretch gap-2 text-left">
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
