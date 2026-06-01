"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Wand2 } from "lucide-react";

interface BackfillResult {
  prospectId: string;
  name: string;
  succeeded: boolean;
}

export default function BackfillButton({ missingCount }: { missingCount: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  if (missingCount <= 0) return null;

  async function runBackfill() {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/dealer-outreach/backfill", {
        method: "POST",
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(body?.error?.message ?? `Request failed (${res.status})`);
      }
      const data = body?.data as
        | { attempted: number; succeeded: number; failed: number; results: BackfillResult[] }
        | undefined;
      if (data) {
        window.alert(
          `Backfill complete — attempted ${data.attempted}, succeeded ${data.succeeded}, failed ${data.failed}.`,
        );
      } else {
        window.alert("Backfill complete.");
      }
      router.refresh();
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
      className="inline-flex items-center gap-2 rounded-md bg-[#0B5FD1] px-4 py-2 text-sm font-medium text-white hover:bg-[#0a52b5] disabled:opacity-50"
    >
      <Wand2 size={16} />
      {busy ? "Backfilling…" : `Backfill Missing Scripts (${missingCount})`}
    </button>
  );
}
