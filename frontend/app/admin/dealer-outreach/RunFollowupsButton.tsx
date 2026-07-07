"use client";

// Phase 4B-4 — fire the follow-up sequence on demand (same logic as the daily
// cron) without waiting for the schedule. Useful for testing and manual nudges.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Send, Loader2 } from "lucide-react";
import { api, apiErrorMessage } from "@/lib/api/client";

export default function RunFollowupsButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      const data = await api.post<{ due: number; sent: number; failed: number }>(
        "/api/admin/dealer-outreach/run-followups",
      );
      window.alert(
        `Follow-up run complete — due ${data.due}, sent ${data.sent}, failed ${data.failed}.`,
      );
      router.refresh();
    } catch (err) {
      window.alert(apiErrorMessage(err, "Follow-up run failed"));
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
