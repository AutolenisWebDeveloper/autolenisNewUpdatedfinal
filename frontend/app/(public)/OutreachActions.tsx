"use client";

// Phase 4B-3 — per-row outreach control. Sends a single initial outreach email
// to a dealer prospect via /api/admin/dealer-outreach/send and shows the last
// known email outreach status. Disabled when the prospect has no email.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Send } from "lucide-react";

interface OutreachActionsProps {
  prospectId: string;
  hasEmail: boolean;
  /** Latest email outreach status for this prospect, or null if none sent. */
  lastStatus: string | null;
}

export default function OutreachActions({
  prospectId,
  hasEmail,
  lastStatus,
}: OutreachActionsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/dealer-outreach/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dealerProspectId: prospectId,
          outreachType: "initial",
        }),
      });
      const json = (await res.json()) as
        | { success: true; data: unknown }
        | { error: { message: string } };
      if (!res.ok || !("success" in json)) {
        setError("error" in json ? json.error.message : "Send failed");
        return;
      }
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Send failed");
    } finally {
      setBusy(false);
    }
  }

  const disabled = busy || isPending || !hasEmail;

  return (
    <div className="flex flex-col gap-0.5">
      {lastStatus && (
        <span className="text-xs text-slate-500">Last: {lastStatus}</span>
      )}
      <button
        type="button"
        onClick={send}
        disabled={disabled}
        title={hasEmail ? undefined : "No email captured for this dealer yet"}
        className="inline-flex items-center gap-1 text-xs font-medium text-[#0B5FD1] hover:underline disabled:cursor-not-allowed disabled:text-slate-300 disabled:no-underline"
      >
        {busy ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
        {lastStatus ? "Resend" : "Send"}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
