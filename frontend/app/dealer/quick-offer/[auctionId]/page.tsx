// Feature 19 — Dealer Quick Bid Interface
// Submits real offers via POST /api/dealer/offers
// Loads auction context from GET /api/dealer/auctions/[auctionId]
// Real competitiveness check via GET /api/dealer/offers/competitiveness-check

"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { api, apiErrorMessage } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertTriangle, CheckCircle2, TrendingUp, Clock, XCircle } from "lucide-react";

const COMMON_FEES = ["Documentation fee", "Dealer preparation", "Advertising fee", "Nitrogen tire fill", "VIN etching", "Paint protection film"];

interface FeeItem { name: string; amountCents: number; isJunk: boolean }

interface AuctionContext {
  id: string;
  status: string;
  endsAt: string | null;
  _count: { offers: number };
}

export default function QuickOfferPage() {
  const params = useParams();
  const auctionId = typeof params.auctionId === "string" ? params.auctionId
    : Array.isArray(params.auctionId) ? params.auctionId[0] : "";

  const [vehiclePrice, setVehiclePrice] = useState("");
  const [tax, setTax] = useState("");
  const [fees, setFees] = useState<FeeItem[]>([]);
  const [newFeeName, setNewFeeName] = useState("");
  const [newFeeAmount, setNewFeeAmount] = useState("");
  const [includesFinancing, setIncludesFinancing] = useState(false);
  const [aprRate, setAprRate] = useState("");
  const [termMonths, setTermMonths] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [competitive, setCompetitive] = useState<"STRONG" | "MODERATE" | "WEAK" | null>(null);
  const [auctionCtx, setAuctionCtx] = useState<AuctionContext | null>(null);
  const [auctionError, setAuctionError] = useState<string | null>(null);
  const [checkingCompetitiveness, setCheckingCompetitiveness] = useState(false);

  const junkFees = fees.filter(f => f.isJunk);
  const totalFeesCents = fees.reduce((sum, f) => sum + f.amountCents, 0);
  const junkFeesCents = junkFees.reduce((sum, f) => sum + f.amountCents, 0);
  const vehiclePriceCents = Math.round(parseFloat(vehiclePrice || "0") * 100);
  const taxCents = Math.round(parseFloat(tax || "0") * 100);
  const otdCents = vehiclePriceCents + taxCents + totalFeesCents;

  // Load auction context on mount
  useEffect(() => {
    if (!auctionId) return;
    api.get<{ auction: AuctionContext }>(`/api/dealer/auctions/${auctionId}`)
      .then(({ auction }) => {
        if (auction) setAuctionCtx(auction);
        else setAuctionError("Auction not found or you are not invited.");
      })
      .catch((err) => setAuctionError(apiErrorMessage(err, "Unable to load auction details.")));
  }, [auctionId]);

  // Real competitiveness check — debounced on OTD change
  const checkCompetitiveness = useCallback(async (otd: number) => {
    if (otd <= 0) return;
    setCheckingCompetitiveness(true);
    try {
      const { competitiveness } = await api.get<{ competitiveness: string }>(
        `/api/dealer/offers/competitiveness-check?otdCents=${otd}`,
      );
      // Accept only the four ranked buckets — ignore "unknown" / lowConfidence states.
      if (competitiveness === "STRONG" || competitiveness === "MODERATE" || competitiveness === "WEAK") {
        setCompetitive(competitiveness);
      } else {
        setCompetitive(null);
      }
    } catch {
      // silent — competitiveness is advisory only
    } finally {
      setCheckingCompetitiveness(false);
    }
  }, []);

  useEffect(() => {
    if (otdCents <= 0) { setCompetitive(null); return; }
    const timer = setTimeout(() => checkCompetitiveness(otdCents), 600);
    return () => clearTimeout(timer);
  }, [otdCents, checkCompetitiveness]);

  function addFee() {
    if (!newFeeName || !newFeeAmount) return;
    const isJunk = COMMON_FEES.includes(newFeeName) || ["nitro", "vin", "paint", "prep", "adv"].some(k => newFeeName.toLowerCase().includes(k));
    setFees([...fees, { name: newFeeName, amountCents: Math.round(parseFloat(newFeeAmount) * 100), isJunk }]);
    setNewFeeName(""); setNewFeeAmount("");
  }

  async function handleSubmit() {
    if (!auctionId || otdCents === 0) return;
    setLoading(true);
    setSubmitError(null);
    try {
      const body = {
        auctionId,
        otdPriceCents: otdCents,
        // vehiclePriceCents is required by the API; if the dealer entered a vehicle price use it,
        // otherwise fall back to the OTD total (fees and tax are tracked separately via feesCents/taxCents).
        vehiclePriceCents: vehiclePriceCents > 0 ? vehiclePriceCents : otdCents - taxCents - totalFeesCents > 0 ? otdCents - taxCents - totalFeesCents : otdCents,
        taxCents,
        feesCents: totalFeesCents,
        includesFinancing,
        aprRate: includesFinancing && aprRate ? parseFloat(aprRate) : undefined,
        termMonths: includesFinancing && termMonths ? parseInt(termMonths) : undefined,
        junkFeeItems: fees.map(f => ({ name: f.name, amount: f.amountCents / 100 })),
      };
      await api.post("/api/dealer/offers", body);
      setSubmitted(true);
    } catch (err) {
      setSubmitError(apiErrorMessage(err, "Failed to submit offer. Please try again."));
    } finally {
      setLoading(false);
    }
  }

  const hoursLeft = auctionCtx?.endsAt
    ? Math.max(0, Math.floor((new Date(auctionCtx.endsAt).getTime() - Date.now()) / 3600000))
    : null;

  const competitivenessConfig = {
    STRONG:   { bg: "bg-green-50 border-green-200", text: "text-green-600", label: "Strong competitiveness", desc: "Excellent pricing vs. market median" },
    MODERATE: { bg: "bg-blue-50 border-blue-200",  text: "text-blue-600",  label: "Moderate competitiveness", desc: "Competitive pricing vs. segment" },
    WEAK:     { bg: "bg-red-50 border-red-200",     text: "text-red-600",   label: "Weak competitiveness",   desc: "Price is above segment median — may not win" },
  };

  if (auctionError) {
    return (
      <div className="p-6 md:p-8 max-w-xl text-center" data-testid="auction-not-found">
        <XCircle size={40} className="text-red-400 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-slate-900 mb-2">Auction not available</h2>
        <p className="text-slate-500 text-sm">{auctionError}</p>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="p-6 md:p-8 max-w-xl text-center" data-testid="offer-submitted">
        <CheckCircle2 size={40} className="text-green-500 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-slate-900 mb-2">Offer submitted</h2>
        <p className="text-slate-500 text-sm">Your offer has been submitted to the auction. You will be notified of the outcome when the auction closes.</p>
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8 max-w-xl" data-testid="quick-offer-page">
      <h1 className="text-xl font-bold text-slate-900 mb-2">Quick-Offer Builder</h1>
      <p className="text-sm text-slate-500 mb-6">Build your out-the-door price. The buyer sees the total — not individual line items.</p>

      {/* Auction context banner */}
      {auctionCtx && (
        <div className="flex items-center gap-4 bg-slate-50 border border-slate-200 rounded-xl px-5 py-3 mb-6" data-testid="auction-context-banner">
          <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Active Auction</p>
            <p className="text-sm text-slate-700 truncate">ID: {auctionCtx.id.slice(0, 8)}…</p>
          </div>
          {hoursLeft !== null && (
            <div className="flex items-center gap-1.5 text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5 text-xs font-semibold shrink-0">
              <Clock size={12} />
              {hoursLeft}h left
            </div>
          )}
          <div className="text-xs text-slate-400 shrink-0">{auctionCtx._count.offers} offer{auctionCtx._count.offers !== 1 ? "s" : ""} so far</div>
        </div>
      )}

      {/* Vehicle price */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 mb-5">
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <Label htmlFor="qo-price">Vehicle price ($)</Label>
            <Input id="qo-price" type="number" step="0.01" data-testid="qo-vehicle-price" className="mt-1.5" placeholder="28500.00"
              value={vehiclePrice} onChange={e => setVehiclePrice(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="qo-tax">Tax ($)</Label>
            <Input id="qo-tax" type="number" step="0.01" data-testid="qo-tax" className="mt-1.5" placeholder="2000.00"
              value={tax} onChange={e => setTax(e.target.value)} />
          </div>
        </div>

        {/* Fees */}
        {fees.length > 0 && (
          <div className="space-y-2 mb-4" data-testid="fee-list">
            {fees.map((fee, i) => (
              <div key={i} data-testid={`fee-item-${i}`} className={`flex items-center justify-between px-3 py-2 rounded-lg text-sm ${fee.isJunk ? "bg-red-50 border border-red-200" : "bg-slate-50"}`}>
                <div className="flex items-center gap-2">
                  {fee.isJunk && <AlertTriangle size={13} className="text-red-500" />}
                  <span className={fee.isJunk ? "text-red-700" : "text-slate-700"}>{fee.name}</span>
                  {fee.isJunk && <span className="text-xs text-red-500 font-semibold">(may be flagged)</span>}
                </div>
                <span className="font-medium">${(fee.amountCents / 100).toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          <Input placeholder="Fee name" value={newFeeName} onChange={e => setNewFeeName(e.target.value)} data-testid="fee-name-input" className="flex-1 text-sm" list="common-fees" />
          <datalist id="common-fees">{COMMON_FEES.map(f => <option key={f} value={f} />)}</datalist>
          <Input placeholder="Amount" type="number" value={newFeeAmount} onChange={e => setNewFeeAmount(e.target.value)} data-testid="fee-amount-input" className="w-28 text-sm" />
          <Button variant="secondary" size="sm" onClick={addFee} data-testid="add-fee-btn">Add</Button>
        </div>
      </div>

      {/* Financing (optional) */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 mb-5">
        <label className="flex items-center gap-2 cursor-pointer mb-3">
          <input type="checkbox" checked={includesFinancing} onChange={e => setIncludesFinancing(e.target.checked)}
            data-testid="includes-financing-checkbox" className="rounded border-slate-300" />
          <span className="text-sm font-medium text-slate-700">Include financing offer</span>
        </label>
        {includesFinancing && (
          <div className="grid grid-cols-2 gap-4" data-testid="financing-inputs">
            <div>
              <Label htmlFor="qo-apr">APR (%)</Label>
              <Input id="qo-apr" type="number" step="0.01" min="0" data-testid="qo-apr" className="mt-1.5" placeholder="5.99"
                value={aprRate} onChange={e => setAprRate(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="qo-term">Term (months)</Label>
              <Input id="qo-term" type="number" min="12" max="84" data-testid="qo-term" className="mt-1.5" placeholder="60"
                value={termMonths} onChange={e => setTermMonths(e.target.value)} />
            </div>
          </div>
        )}
      </div>

      {/* OTD total */}
      {otdCents > 0 && (
        <div className="bg-[#0B5FD1] text-white rounded-xl p-5 mb-5" data-testid="otd-total">
          <p className="text-xs text-white/60 uppercase tracking-wider mb-1">Out-the-Door Total</p>
          <p className="text-3xl font-bold">${(otdCents / 100).toLocaleString()}</p>
          {junkFeesCents > 0 && (
            <p className="text-sm text-red-300 mt-2 flex items-center gap-1.5">
              <AlertTriangle size={14} />${(junkFeesCents / 100).toLocaleString()} in flagged fees — removing these improves win rate
            </p>
          )}
        </div>
      )}

      {/* Real competitiveness gauge */}
      {competitive && !checkingCompetitiveness && (
        <div data-testid="competitiveness-gauge"
          className={`flex items-center gap-3 p-4 rounded-xl mb-5 border ${competitivenessConfig[competitive].bg}`}>
          <TrendingUp size={18} className={competitivenessConfig[competitive].text} />
          <div>
            <p className={`text-sm font-semibold ${competitivenessConfig[competitive].text}`}>{competitivenessConfig[competitive].label}</p>
            <p className="text-xs text-slate-500">{competitivenessConfig[competitive].desc}</p>
          </div>
        </div>
      )}

      {submitError && (
        <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl p-4 mb-5" data-testid="submit-error">
          <AlertTriangle size={16} className="text-red-500 shrink-0 mt-0.5" />
          <p className="text-sm text-red-700">{submitError}</p>
        </div>
      )}

      <Button className="w-full" size="lg" onClick={handleSubmit}
        disabled={otdCents === 0 || loading || !auctionId || auctionCtx?.status !== "ACTIVE"}
        data-testid="submit-offer-btn">
        {loading ? "Submitting…" : "Submit Offer"}
      </Button>
      {auctionCtx && auctionCtx.status !== "ACTIVE" && (
        <p className="text-xs text-slate-400 text-center mt-2" data-testid="auction-closed-notice">This auction is no longer accepting offers.</p>
      )}
    </div>
  );
}
