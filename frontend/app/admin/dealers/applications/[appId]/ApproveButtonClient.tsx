"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  appId: string;
}

export default function ApproveButtonClient({ appId }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [tempPassword, setTempPassword] = useState<string | null>(null);

  async function submit() {
    if (busy) return;
    if (!confirm("Approve this application? A dealer account will be created and an email sent to the applicant.")) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/admin/dealers/applications/${appId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(j.error || `Approve failed (${res.status})`);
        setBusy(false);
        return;
      }
      if (j.tempPassword) setTempPassword(j.tempPassword);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Network error");
      setBusy(false);
    }
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5" data-testid="approve-application-card">
      <h3 className="text-sm font-semibold text-slate-900 mb-1">Approve Application</h3>
      <p className="text-xs text-slate-500 mb-3">
        Creates a Supabase user + Dealer record and emails the applicant a temporary password.
      </p>
      {err && <p className="text-xs text-red-600 mb-3" data-testid="approve-error">{err}</p>}
      {tempPassword && (
        <div className="text-xs bg-amber-50 border border-amber-200 rounded p-2 mb-3 font-mono" data-testid="approve-temp-password">
          Temp password (sandbox only): <strong>{tempPassword}</strong>
        </div>
      )}
      <button
        onClick={submit}
        disabled={busy}
        className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition-colors"
        data-testid="approve-application-btn"
      >
        {busy ? "Approving…" : "Approve & Create Dealer Account"}
      </button>
    </div>
  );
}
