"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

const INPUT_CLASS =
  "w-full border border-slate-200 rounded-lg px-4 py-3 text-slate-900 placeholder-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-[#0B5FD1]/30";

export default function NewOfferPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [auctionId, setAuctionId] = useState("");
  const [otdPrice, setOtdPrice] = useState("");
  const [vehiclePrice, setVehiclePrice] = useState("");
  const [tax, setTax] = useState("");
  const [fees, setFees] = useState("");
  const [includesFinancing, setIncludesFinancing] = useState(false);
  const [aprRate, setAprRate] = useState("");
  const [termMonths, setTermMonths] = useState("");
  const [downPayment, setDownPayment] = useState("");
  const [comments, setComments] = useState("");

  const otdNum = parseFloat(otdPrice) || 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/dealer/offers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          auctionId,
          otdPriceCents: otdNum ? Math.round(otdNum * 100) : undefined,
          vehiclePriceCents: vehiclePrice ? Math.round(parseFloat(vehiclePrice) * 100) : undefined,
          taxCents: tax ? Math.round(parseFloat(tax) * 100) : undefined,
          feesCents: fees ? Math.round(parseFloat(fees) * 100) : undefined,
          includesFinancing,
          aprRate: aprRate ? parseFloat(aprRate) : undefined,
          termMonths: termMonths ? parseInt(termMonths, 10) : undefined,
          downPaymentCents: downPayment
            ? Math.round(parseFloat(downPayment) * 100)
            : undefined,
          comments: comments || undefined,
        }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setError(data.error ?? "Something went wrong");
        return;
      }
      router.push("/dealer/offers");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-6 md:p-8 max-w-3xl" data-testid="new-offer-page">
      <div className="flex items-center gap-3 mb-6">
        <Link
          href="/dealer/offers"
          className="text-sm text-slate-400 hover:text-[#0B5FD1] transition-colors"
        >
          ← Offers
        </Link>
        <h1 className="text-xl font-bold text-slate-900">New Offer</h1>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 mb-5 text-sm">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5" data-testid="new-offer-form">
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1.5">
            Auction ID <span className="text-red-500">*</span>
          </label>
          <input
            value={auctionId}
            onChange={(e) => setAuctionId(e.target.value)}
            placeholder="Select the auction you received an invitation for"
            required
            className={INPUT_CLASS}
            data-testid="auction-id-input"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1.5">
            OTD Price ($) <span className="text-red-500">*</span>
          </label>
          <input
            type="number"
            value={otdPrice}
            onChange={(e) => setOtdPrice(e.target.value)}
            placeholder="25000"
            required
            min={0}
            step="0.01"
            className={INPUT_CLASS}
            data-testid="otd-price-input"
          />
        </div>

        {/* Competitiveness Gauge */}
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4" data-testid="competitiveness-gauge">
          <p className="text-xs font-semibold text-slate-500 mb-2">Competitiveness Estimate</p>
          <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
            <div
              className="h-2 bg-[#0B5FD1] rounded-full transition-all"
              style={{ width: otdNum > 0 ? "60%" : "0%" }}
            />
          </div>
          <p className="text-xs text-slate-400 mt-2">
            {otdNum > 0
              ? "Competitiveness based on market data"
              : "Enter your OTD price to see competitiveness estimate"}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">
              Vehicle Price ($)
            </label>
            <input
              type="number"
              value={vehiclePrice}
              onChange={(e) => setVehiclePrice(e.target.value)}
              placeholder="23000"
              min={0}
              step="0.01"
              className={INPUT_CLASS}
              data-testid="vehicle-price-input"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">Tax ($)</label>
            <input
              type="number"
              value={tax}
              onChange={(e) => setTax(e.target.value)}
              placeholder="1500"
              min={0}
              step="0.01"
              className={INPUT_CLASS}
              data-testid="tax-input"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1.5">Fees ($)</label>
          <input
            type="number"
            value={fees}
            onChange={(e) => setFees(e.target.value)}
            placeholder="500"
            min={0}
            step="0.01"
            className={INPUT_CLASS}
            data-testid="fees-input"
          />
        </div>

        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={includesFinancing}
            onChange={(e) => setIncludesFinancing(e.target.checked)}
            className="w-4 h-4 rounded accent-[#0B5FD1]"
            data-testid="includes-financing-checkbox"
          />
          <span className="text-sm font-semibold text-slate-700">Includes Financing?</span>
        </label>

        {includesFinancing && (
          <div className="space-y-4 pl-4 border-l-2 border-[#0B5FD1]/20" data-testid="financing-fields">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">APR Rate (%)</label>
                <input
                  type="number"
                  value={aprRate}
                  onChange={(e) => setAprRate(e.target.value)}
                  placeholder="4.9"
                  min={0}
                  step="0.01"
                  className={INPUT_CLASS}
                  data-testid="apr-rate-input"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">Term (months)</label>
                <input
                  type="number"
                  value={termMonths}
                  onChange={(e) => setTermMonths(e.target.value)}
                  placeholder="60"
                  min={1}
                  className={INPUT_CLASS}
                  data-testid="term-months-input"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">Down Payment ($)</label>
              <input
                type="number"
                value={downPayment}
                onChange={(e) => setDownPayment(e.target.value)}
                placeholder="2000"
                min={0}
                step="0.01"
                className={INPUT_CLASS}
                data-testid="down-payment-input"
              />
            </div>
          </div>
        )}

        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1.5">Comments</label>
          <textarea
            value={comments}
            onChange={(e) => setComments(e.target.value)}
            placeholder="Any notes or comments for this offer..."
            rows={3}
            className={INPUT_CLASS}
            data-testid="comments-input"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-[#0B5FD1] hover:bg-[#1A6FE0] disabled:opacity-50 text-white font-semibold py-3 rounded-lg transition-colors text-sm"
          data-testid="submit-offer-btn"
        >
          {loading ? "Submitting..." : "Submit Offer"}
        </button>
      </form>
    </div>
  );
}
