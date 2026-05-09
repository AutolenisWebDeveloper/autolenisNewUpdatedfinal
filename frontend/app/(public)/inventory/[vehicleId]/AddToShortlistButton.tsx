"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Check, Heart } from "lucide-react";

interface Props { vehicleId: string; testId?: string }

export default function AddToShortlistButton({ vehicleId, testId = "vehicle-cta-primary" }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function add() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/buyer/shortlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inventoryItemId: vehicleId }),
      });
      const data = await res.json() as { success?: boolean; error?: { code?: string; message?: string } };
      if (!res.ok || !data.success) {
        const code = data.error?.code ?? "ERROR";
        const msg = data.error?.message ?? "Failed to add to shortlist";
        if (code === "ALREADY_IN_SHORTLIST") {
          setDone(true);
        } else if (code === "SHORTLIST_FULL") {
          setErr("Shortlist is full (5 max). Remove one to add this vehicle.");
        } else if (code === "UNAUTHORIZED") {
          router.push(`/auth/signin?redirect=/inventory/${vehicleId}`);
        } else {
          setErr(msg);
        }
        return;
      }
      setDone(true);
      router.refresh();
    } catch {
      setErr("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div data-testid="shortlist-success" className="block w-full text-center px-5 py-3 bg-[#F2FAF2] border border-[#C9E8C9] text-[#1A6B18] font-semibold text-sm rounded-md">
        <Check size={14} className="inline mr-1.5" /> Added to your shortlist
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={add}
        disabled={busy}
        data-testid={testId}
        className="block w-full text-center px-5 py-3 bg-[#50D14E] hover:bg-[#3DBF3B] disabled:bg-slate-300 text-white font-semibold text-sm rounded-md transition-colors shadow-md shadow-[#50D14E]/15"
      >
        {busy ? <Loader2 size={14} className="animate-spin inline" /> : <Heart size={14} className="inline mr-1.5" />}
        Add to Shortlist
      </button>
      {err && <p data-testid="shortlist-error" className="text-xs text-red-700 mt-2 text-center">{err}</p>}
    </>
  );
}
