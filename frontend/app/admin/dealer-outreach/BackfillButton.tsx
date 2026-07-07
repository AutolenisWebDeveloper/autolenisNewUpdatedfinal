"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Wand2 } from "lucide-react";
import { api, apiErrorMessage } from "@/lib/api/client";

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
      const data = await api.post<{
        attempted: number;
        succeeded: number;
        failed: number;
        results: BackfillResult[];
      }>("/api/admin/dealer-outreach/backfill");
      window.alert(
        `Backfill complete — attempted ${data.attempted}, succeeded ${data.succeeded}, failed ${data.failed}.`,
      );
      router.refresh();
    } catch (err) {
      window.alert(apiErrorMessage(err, "Backfill failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={runBackfill}
      disabled={busy}
      className="inline-flex items-center gap-2 rounded-md bg-al-primary px-4 py-2 text-sm font-medium text-white hover:bg-[#0a52b5] disabled:opacity-50"
    >
      <Wand2 size={16} />
      {busy ? "Backfilling…" : `Backfill Missing Scripts (${missingCount})`}
    </button>
  );
}
