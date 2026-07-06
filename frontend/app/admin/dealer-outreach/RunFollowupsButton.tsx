"use client";

// Phase 4B-4 — fire the follow-up sequence on demand (same logic as the daily
// cron) without waiting for the schedule. Useful for testing and manual nudges.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Send, Loader2 } from "lucide-react";

export default function RunFollowupsButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/dealer-outreach/run-followups", {
        method: "POST",
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(body?.error?.message ?? `Request failed (${res.status})`);
      }
      const data = body?.data as
        | { due: number; sent: number; failed: number }
        | undefined;
      window.alert(
        data
          ? `Follow-up run complete — due ${data.due}, sent ${data.sent}, failed ${data.failed}.`
          : "Follow-up run complete.",
      );
      router.refresh();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Follow-up run failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={run}
      disabled={busy}
      title="Run the follow-up sequence now"
      className="inline-flex items-center gap-2 rounded-md border border-al-primary px-4 py-2 text-sm font-medium text-al-primary hover:bg-blue-50 disabled:opacity-50"
    >
      {busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
      {busy ? "Running…" : "Run Follow-Up Cron Now"}
    </button>
  );
}
