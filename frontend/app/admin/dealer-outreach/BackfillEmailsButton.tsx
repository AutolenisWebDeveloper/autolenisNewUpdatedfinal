"use client";

// Phase 4B-1 — "Backfill All Missing Emails" action. Queues Gemini Search email
// enrichment for every prospect that still has no email. Enrichment runs in the
// background (Vercel after()), so this returns a queued count immediately.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Mail } from "lucide-react";

export default function BackfillEmailsButton({
  missingCount,
}: {
  missingCount: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  if (missingCount <= 0) return null;

  async function runBackfill() {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/dealer-outreach/backfill-emails", {
        method: "POST",
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(body?.error?.message ?? `Request failed (${res.status})`);
      }
      const data = body?.data as { queued?: number; message?: string } | undefined;
      window.alert(
        data?.message ?? `Queued ${data?.queued ?? 0} dealer(s) for enrichment.`,
      );
      // Give the background job a head start, then refresh.
      setTimeout(() => router.refresh(), 1500);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Backfill failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={runBackfill}
      disabled={busy}
      className="inline-flex items-center gap-2 rounded-md border border-al-primary bg-white px-4 py-2 text-sm font-medium text-al-primary hover:bg-blue-50 disabled:opacity-50"
    >
      <Mail size={16} />
      {busy ? "Queuing…" : `Backfill Missing Emails (${missingCount})`}
    </button>
  );
}
