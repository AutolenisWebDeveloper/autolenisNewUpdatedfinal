"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, ChevronDown, ChevronUp } from "lucide-react";
import { api, apiErrorMessage } from "@/lib/api/client";
import type { InsuranceQuoteRequest } from "./page";

interface Props {
  requests: InsuranceQuoteRequest[];
}

function coverageLabel(type: string): string {
  if (type === "full")      return "Full coverage (comp + collision)";
  if (type === "liability") return "Liability only";
  if (type === "gap")       return "Full coverage + GAP";
  return type;
}

function RequestRow({ req }: { req: InsuranceQuoteRequest }) {
  const router  = useRouter();
  const [open,   setOpen]   = useState(false);
  const [amount, setAmount] = useState("");
  const [note,   setNote]   = useState("");
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const [done,    setDone]    = useState(false);

  async function handleRespond(e: React.FormEvent) {
    e.preventDefault();
    const cents = Math.round(parseFloat(amount) * 100);
    if (!amount || isNaN(cents) || cents <= 0) {
      setError("Enter a valid monthly premium amount.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await api.post<unknown>("/api/admin/insurance-requests/respond", { dealId: req.dealId, buyerId: req.buyerId, premiumCents: cents, note: note.trim() || null });
      setDone(true);
      router.refresh();
    } catch (err) {
      setError(apiErrorMessage(err, "Action failed. Please try again."));
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <div className="bg-[#F0FDF4] border border-[#BBF7D0] rounded-xl px-5 py-3.5" data-testid={`request-responded-${req.id}`}>
        <p className="text-sm font-semibold text-[#065F46]">✓ Quote sent to buyer for deal {req.dealId.slice(-8)}</p>
      </div>
    );
  }

  return (
    <div className="bg-white border border-[#E5E7EB] rounded-xl px-5 py-4" data-testid={`pending-request-${req.id}`}>
      {/* Header row */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="font-semibold text-slate-900 text-sm truncate">{req.buyerName}</p>
          <p className="text-xs text-slate-500 mt-0.5 truncate">{req.vehicle}</p>
          <div className="flex flex-wrap gap-3 mt-1.5 text-xs text-[#6B7280]">
            <span className="bg-al-primary-subtle text-al-primary font-medium px-2 py-0.5 rounded-md">
              {coverageLabel(req.coverageType)}
            </span>
            {req.otdPriceCents && (
              <span>OTD: ${(req.otdPriceCents / 100).toLocaleString()}</span>
            )}
            {req.currentInsurer && <span>Current: {req.currentInsurer}</span>}
            {req.driverDob && <span>DOB: {req.driverDob}</span>}
            <span>{new Date(req.requestedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}</span>
          </div>
          {req.additionalInfo && (
            <p className="text-xs text-slate-500 mt-1.5 italic">"{req.additionalInfo}"</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Link
            href={`/admin/deals/${req.dealId}`}
            className="text-xs text-al-primary hover:underline"
            data-testid={`view-deal-pending-${req.id}`}
          >
            View Deal
          </Link>
          <button
            type="button"
            onClick={() => setOpen(prev => !prev)}
            className="flex items-center gap-1 text-xs font-semibold text-white bg-al-primary hover:bg-al-primary-hover px-3 py-1.5 rounded-lg transition-colors"
            data-testid={`respond-btn-${req.id}`}
          >
            {open ? "Cancel" : "Respond"}
            {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
        </div>
      </div>

      {/* Inline respond form */}
      {open && (
        <form
          onSubmit={handleRespond}
          className="mt-4 pt-4 border-t border-[#E5E7EB] space-y-3"
          data-testid={`respond-form-${req.id}`}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[#374151] mb-1">
                Monthly premium ($/mo) <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9CA3AF] text-sm">$</span>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  placeholder="120.00"
                  required
                  data-testid={`respond-amount-${req.id}`}
                  className="w-full border border-[#D1D5DB] rounded-xl pl-7 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-al-primary focus:border-transparent"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-[#374151] mb-1">
                Note to buyer (optional)
              </label>
              <input
                type="text"
                value={note}
                onChange={e => setNote(e.target.value)}
                placeholder="e.g. Quote valid for 30 days"
                maxLength={300}
                data-testid={`respond-note-${req.id}`}
                className="w-full border border-[#D1D5DB] rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-al-primary focus:border-transparent"
              />
            </div>
          </div>
          {error && (
            <p className="text-xs text-red-600" data-testid={`respond-error-${req.id}`}>{error}</p>
          )}
          <button
            type="submit"
            disabled={loading}
            data-testid={`respond-submit-${req.id}`}
            className="flex items-center gap-2 px-5 py-2.5 bg-al-primary text-white font-semibold text-sm rounded-xl hover:bg-al-primary-hover disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? (
              <><Loader2 size={13} className="animate-spin" /> Sending…</>
            ) : "Send Quote to Buyer"}
          </button>
        </form>
      )}
    </div>
  );
}

export default function InsuranceRequestsClient({ requests }: Props) {
  if (requests.length === 0) return null;
  return (
    <div className="space-y-3" data-testid="insurance-requests-list">
      {requests.map(r => (
        <RequestRow key={r.id} req={r} />
      ))}
    </div>
  );
}
