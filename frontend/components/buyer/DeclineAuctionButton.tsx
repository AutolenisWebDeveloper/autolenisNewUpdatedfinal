"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { XCircle, Loader2, ChevronDown, ChevronUp } from "lucide-react";

const DECLINE_REASONS = [
  "Offers were too high",
  "Changed my mind about this vehicle",
  "Found a vehicle elsewhere",
  "Financing fell through",
  "Other",
];

export default function DeclineAuctionButton({ auctionId }: { auctionId: string }) {
  const router    = useRouter();
  const [open,    setOpen]    = useState(false);
  const [reason,  setReason]  = useState(DECLINE_REASONS[0] ?? "");
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  async function handleDecline() {
    setLoading(true);
    setError(null);
    try {
      const res  = await fetch(`/api/buyer/auctions/${auctionId}/decline`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ reason }),
      });
      const data = await res.json() as { success?: boolean; error?: { message: string } };
      if (!data.success) {
        setError(data.error?.message ?? "Failed to close auction. Please try again.");
      } else {
        router.push("/buyer/auctions");
        router.refresh();
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="border border-[#FCA5A5] rounded-xl overflow-hidden" data-testid="decline-auction-section">
      <button
        onClick={() => setOpen(p => !p)}
        className="w-full flex items-center justify-between px-5 py-3.5 bg-[#FFF1F2] hover:bg-[#FFE4E6] transition-colors text-left"
        data-testid="decline-auction-toggle"
      >
        <span className="text-sm font-semibold text-red-700">Pass on this auction</span>
        {open ? <ChevronUp size={16} className="text-red-500" /> : <ChevronDown size={16} className="text-red-400" />}
      </button>

      {open && (
        <div className="px-5 py-4 bg-white space-y-4">
          <p className="text-xs text-[#4B5563] leading-relaxed">
            Not happy with the offers? You can pass on this auction and receive a full refund of your $99 deposit.
          </p>
          <div>
            <label className="block text-xs font-medium text-[#374151] mb-1.5">Reason (optional)</label>
            <select
              value={reason}
              onChange={e => setReason(e.target.value)}
              className="w-full border border-[#D1D5DB] rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
              data-testid="decline-reason-select"
            >
              {DECLINE_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex items-center gap-3">
            <button
              onClick={handleDecline}
              disabled={loading}
              className="flex-1 flex items-center justify-center gap-2 py-3 bg-red-600 hover:bg-red-700 text-white font-semibold text-sm rounded-xl disabled:opacity-60 transition-colors"
              data-testid="confirm-decline-btn"
            >
              {loading
                ? <><Loader2 size={14} className="animate-spin" /> Processing…</>
                : <><XCircle size={14} /> Pass &amp; Request Refund</>}
            </button>
            <button
              onClick={() => setOpen(false)}
              disabled={loading}
              className="px-4 py-3 text-sm text-[#6B7280] hover:text-[#374151] transition-colors"
            >
              Cancel
            </button>
          </div>
          <p className="text-xs text-[#9CA3AF]">
            Refund of $99 will be processed within 3–5 business days.
          </p>
        </div>
      )}
    </div>
  );
}
