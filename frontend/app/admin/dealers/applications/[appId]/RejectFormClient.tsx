"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  appId: string;
}

export default function RejectFormClient({ appId }: Props) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/admin/dealers/applications/${appId}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() || undefined }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setErr(j.error || `Reject failed (${res.status})`);
        setBusy(false);
        return;
      }
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Network error");
      setBusy(false);
    }
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5" data-testid="reject-application-card">
      <h3 className="text-sm font-semibold text-slate-900 mb-1">Reject Application</h3>
      <p className="text-xs text-slate-500 mb-3">
        The applicant will be emailed an automated rejection notice. This action cannot be undone.
      </p>
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason (optional, internal + emailed to applicant)"
        rows={3}
        className="w-full text-sm border border-slate-200 rounded-lg p-2 mb-3 focus:outline-none focus:ring-2 focus:ring-red-200"
        data-testid="reject-reason-input"
      />
      {err && <p className="text-xs text-red-600 mb-3" data-testid="reject-error">{err}</p>}
      <button
        onClick={submit}
        disabled={busy}
        className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition-colors"
        data-testid="reject-application-btn"
      >
        {busy ? "Rejecting…" : "Reject Application"}
      </button>
    </div>
  );
}
