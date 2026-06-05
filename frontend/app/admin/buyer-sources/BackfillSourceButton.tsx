"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Wand2 } from "lucide-react";

export default function BackfillSourceButton({ nullCount }: { nullCount: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  if (nullCount <= 0) return null;

  async function runBackfill() {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/buyers/backfill-source", { method: "POST" });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(body?.error?.message ?? `Request failed (${res.status})`);
      }
      const data = body?.data as
        | { updated: number; remaining: number; ruleBreakdown: Record<string, number> }
        | undefined;
      if (data) {
        const rules = Object.entries(data.ruleBreakdown)
          .map(([k, v]) => `${k}: ${v}`)
          .join(", ");
        window.alert(
          `Backfill complete — updated ${data.updated}, remaining ${data.remaining}.` +
            (rules ? `\nInference: ${rules}` : ""),
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
      {busy ? "Backfilling…" : `Backfill Unknown Sources (${nullCount})`}
    </button>
  );
}
