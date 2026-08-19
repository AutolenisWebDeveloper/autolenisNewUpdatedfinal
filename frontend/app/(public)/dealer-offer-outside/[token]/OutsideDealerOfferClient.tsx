"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, Clock, XCircle } from "lucide-react";

interface Props {
  token: string;
  dealershipName: string;
  contactName: string;
  auctionId: string;
  auctionStatus: string;
  auctionActive: boolean;
  endsAt: string | null;
  alreadySubmitted: boolean;
  existingOtdCents: number | null;
}

export default function OutsideDealerOfferClient({
  token,
  dealershipName,
  contactName,
  auctionId,
  auctionStatus,
  auctionActive,
  endsAt,
  alreadySubmitted,
  existingOtdCents,
}: Props) {
  const [vehiclePrice, setVehiclePrice] = useState("");
  const [tax, setTax]   = useState("");
  const [fees, setFees] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(alreadySubmitted);
  const [error, setError] = useState<string | null>(null);

  const vehicleCents = Math.round(parseFloat(vehiclePrice || "0") * 100);
  const taxCents     = Math.round(parseFloat(tax || "0")        * 100);
  const feesCents    = Math.round(parseFloat(fees || "0")       * 100);
  const otdCents     = vehicleCents + taxCents + feesCents;

  const hoursLeft = endsAt
    ? Math.max(0, Math.floor((new Date(endsAt).getTime() - Date.now()) / 3600000))
    : null;

  async function handleSubmit() {
    if (otdCents <= 0 || loading) return; // re-entry guard (Enter can also submit now)
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/public/outside-dealer-offer/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vehiclePriceCents: vehicleCents,
          taxCents,
          feesCents,
          otdPriceCents: otdCents,
          notes: notes.trim() || undefined,
        }),
      });
      const data = await res.json() as { success?: boolean; error?: { message: string } };
      if (!res.ok || !data.success) {
        setError(data.error?.message ?? "Failed to submit offer. Please try again.");
      } else {
        setSubmitted(true);
      }
    } catch {
      setError("Network error. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  if (!auctionActive && !submitted) {
    return (
      <div className="p-6 md:p-8 max-w-xl mx-auto text-center" data-testid="outside-auction-closed">
        <XCircle size={40} className="text-red-400 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-slate-900 mb-2">Auction not active</h2>
        <p className="text-slate-500 text-sm">
          This auction is currently {auctionStatus.toLowerCase()} and no longer accepting offers.
        </p>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="p-6 md:p-8 max-w-xl mx-auto text-center" data-testid="outside-offer-submitted">
        <CheckCircle2 size={40} className="text-green-500 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-slate-900 mb-2">Offer received</h2>
        <p className="text-slate-500 text-sm">
          Thank you, {contactName}. Your offer
          {existingOtdCents
            ? ` of $${(existingOtdCents / 100).toLocaleString()}`
            : otdCents > 0
              ? ` of $${(otdCents / 100).toLocaleString()}`
              : ""}{" "}
          has been recorded. The buyer&apos;s AutoLenis advisor will reach out if your bid is selected.
        </p>
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8 max-w-xl mx-auto" data-testid="outside-offer-form">
      <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#0B5FD1] mb-2">
        Dealer Auction Invite
      </p>
      <h1 className="text-2xl font-bold text-slate-900 mb-1">Submit your offer</h1>
      <p className="text-sm text-slate-500 mb-6">
        Hello {contactName} — {dealershipName} has been invited to bid on a private AutoLenis auction.
        Enter your out-the-door price below.
      </p>

      <div className="flex items-center gap-3 bg-slate-50 border border-slate-200 rounded-xl px-5 py-3 mb-6">
        <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse shrink-0" aria-hidden="true" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Auction</p>
          <p className="text-sm text-slate-700 truncate">ID: {auctionId.slice(0, 8)}…</p>
        </div>
        {hoursLeft !== null && (
          <div className="flex items-center gap-1.5 text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5 text-xs font-semibold shrink-0">
            <Clock size={12} aria-hidden="true" /> <span>{hoursLeft}h left</span>
          </div>
        )}
      </div>

      <form
        onSubmit={e => { e.preventDefault(); handleSubmit(); }}
        noValidate
      >
        <div className="bg-white border border-slate-200 rounded-xl p-5 mb-5 space-y-4">
          <div>
            <label htmlFor="outside-vehicle-price" className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
              Vehicle price ($)
            </label>
            <input
              id="outside-vehicle-price"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={vehiclePrice}
              onChange={e => setVehiclePrice(e.target.value)}
              placeholder="28500.00"
              data-testid="outside-vehicle-price"
              className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#0B5FD1]/20"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="outside-tax" className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
                Tax ($)
              </label>
              <input
                id="outside-tax"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={tax}
                onChange={e => setTax(e.target.value)}
                placeholder="2000.00"
                data-testid="outside-tax"
                className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#0B5FD1]/20"
              />
            </div>
            <div>
              <label htmlFor="outside-fees" className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
                Fees ($)
              </label>
              <input
                id="outside-fees"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={fees}
                onChange={e => setFees(e.target.value)}
                placeholder="500.00"
                data-testid="outside-fees"
                className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#0B5FD1]/20"
              />
            </div>
          </div>
          <div>
            <label htmlFor="outside-notes" className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
              Notes (optional)
            </label>
            <textarea
              id="outside-notes"
              rows={2}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Anything the buyer should know about this offer"
              data-testid="outside-notes"
              className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#0B5FD1]/20"
            />
          </div>
        </div>

        {otdCents > 0 && (
          <div className="bg-[#0B5FD1] text-white rounded-xl p-5 mb-5" data-testid="outside-otd-total">
            <p className="text-xs text-white/60 uppercase tracking-wider mb-1">Out-the-Door Total</p>
            <p className="text-3xl font-bold" aria-live="polite">${(otdCents / 100).toLocaleString()}</p>
          </div>
        )}

        {error && (
          <div
            className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl p-4 mb-5"
            data-testid="outside-submit-error"
            role="alert"
          >
            <AlertTriangle size={16} className="text-red-500 shrink-0 mt-0.5" aria-hidden="true" />
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        <button
          type="submit"
          disabled={otdCents <= 0 || loading}
          aria-busy={loading}
          data-testid="outside-submit-btn"
          className="w-full bg-[#0B5FD1] text-white font-semibold text-sm px-4 py-3 rounded-xl hover:bg-[#0944a8] disabled:bg-slate-300 disabled:cursor-not-allowed"
        >
          {loading ? "Submitting…" : "Submit offer"}
        </button>
        {otdCents <= 0 && (
          <p className="text-xs text-slate-400 text-center mt-2">Enter a vehicle price to submit your offer.</p>
        )}
      </form>
    </div>
  );
}
