// Feature 2 — Offer Comparison Engine
// Side-by-side ranked offers: Best Cash, Best Monthly, Best Overall Value
// Dealer identity NEVER revealed until buyer selects a deal

"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, ArrowRight, Star, AlertTriangle, Clock, HelpCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { api, apiErrorMessage } from "@/lib/api/client";

interface OtdBreakdown {
  vehiclePriceCents: number;
  taxCents: number;
  feesCents: number;
}

interface RankedOffer {
  offerId: string;
  rankType: "BEST_CASH" | "BEST_MONTHLY" | "BEST_OVERALL";
  rankLabel: string;
  otdPriceCents: number;
  /** Integer MINOR UNITS, like every other money field here. Render through `money()`. */
  monthlyPaymentCents?: number;
  /** The term the DEALERSHIP quoted, which is the only term anyone actually offered. */
  monthlyTermMonths?: number | null;
  totalCostCents?: number;
  junkFeesCents: number;
  dealerTier: string;
  rankingExplanation: string;
  savingsVsRetailCents?: number;
  aprFlag?: string | null;   // System 4 ENH — buyer-facing APR validation flag
  aprRate?: number | null;
  rank?: number;                       // Group 7 (7C) — numeric rank (#1/#2/#3) by OTD
  otdBreakdown?: OtdBreakdown;          // Group 7 (7C) — vehicle + tax + fees
  responseTimeHours?: number | null;   // Group 7 (7C) — dealer response speed
}

const money = (cents: number) => `$${(cents / 100).toLocaleString()}`;

interface OfferComparisonPanelProps {
  auctionId: string;
}

const RANK_COLORS: Record<string, string> = {
  BEST_CASH: "bg-green-50 border-green-200",
  BEST_MONTHLY: "bg-blue-50 border-blue-200",
  BEST_OVERALL: "bg-al-primary/5 border-al-primary/20",
};

export default function OfferComparisonPanel({ auctionId }: OfferComparisonPanelProps) {
  const router = useRouter();
  const [offers, setOffers] = useState<RankedOffer[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.get<{ offers?: RankedOffer[] }>(`/api/buyer/auctions/${auctionId}/best-price`)
      .then(data => {
        if (cancelled) return;
        setOffers(data?.offers ?? []);
      })
      .catch(() => {
        if (!cancelled) setError("We couldn't load your offers. Please check your connection and refresh.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [auctionId]);

  async function selectOffer(offerId: string) {
    setError(null);
    try {
      // Surface the API's explanation (e.g. AUCTION_LIVE: the 48h auction is
      // still running) instead of a generic failure.
      await api.post(`/api/buyer/auctions/${auctionId}/select-offer`, { offerId });
      router.push("/buyer/deal");
      return;
    } catch (err) {
      setConfirming(null);
      setError(apiErrorMessage(err, "Failed to select offer. Please try again."));
    }
  }

  if (loading) {
    return <div className="grid md:grid-cols-3 gap-6">{[1,2,3].map(i => <div key={i} className="h-64 bg-slate-100 rounded-xl animate-pulse" />)}</div>;
  }

  // A FAILED fetch is not an empty result. This check has to come before the
  // empty state: the error branch was rendered further down, so a failed load
  // fell into "no offers yet" — telling a buyer whose dealers may well have bid
  // that nobody had, and making the error banner unreachable.
  if (error && offers.length === 0) {
    return (
      <div
        className="text-center py-16 px-6 bg-red-50 rounded-2xl border border-red-200"
        data-testid="offer-comparison-error"
        role="alert"
      >
        <p className="font-semibold text-red-800 mb-1">We couldn&apos;t load your offers</p>
        <p className="text-sm text-red-700 mb-5 max-w-sm mx-auto leading-relaxed">
          This is a problem on our side, not a sign that no offers arrived. Please
          refresh — if it keeps happening, contact support and we&apos;ll check for you.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          data-testid="offer-comparison-retry-btn"
          className="inline-flex items-center gap-2 px-6 py-3 bg-al-primary text-white font-semibold text-sm rounded-xl hover:bg-al-primary-hover transition-colors"
        >
          Try again
        </button>
      </div>
    );
  }

  // Feature 13 — Best Price Engine empty state
  if (offers.length === 0) {
    return (
      <div className="text-center py-16 px-6 bg-slate-50 rounded-2xl border border-slate-200" data-testid="offer-comparison-empty">
        <div className="w-14 h-14 rounded-full bg-al-primary/10 border border-al-primary/20 flex items-center justify-center mx-auto mb-4">
          <Star size={24} className="text-al-primary" />
        </div>
        <h3 className="text-lg font-semibold text-slate-900 mb-2">No offers to compare yet</h3>
        <p className="text-sm text-slate-500 max-w-xs mx-auto">
          Dealer offers appear here once your auction closes. The Best Price Engine will automatically rank them by cash price, monthly payment, and overall value.
        </p>
      </div>
    );
  }

  return (
    <div data-testid="offer-comparison-panel">
      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" data-testid="offer-select-error" role="alert">
          {error}
        </div>
      )}
      {/* LOAN TERM — THE CONTROL IS GONE. Owner ruling, 2026-09-14, signing off the removal:
           "A monthly payment computed at a term no dealership quoted is a number nobody has
           offered, and §12 is explicit that AutoLenis does not underwrite."

           It had been relabelled, then disabled, and neither was honest enough: four buttons that
           refetched identical data and repainted nothing. `months` was validated by the route and
           consumed by nothing — the engine computes each payment from the DEALERSHIP's own
           `term_months` — so no buyer ever saw it change a figure.

           The sentence below is what survives the deletion, and it survives deliberately: it was
           the only statement on this screen that each monthly figure is the dealership's own quote
           at their own APR, which is exactly what §12 requires the buyer to be able to see. The
           route's `months` parameter and its 6–96 validation stay where they are — the guard on a
           public input outlives the control that used to supply it, and the persisted
           `best_price_calculation_logs.term_months` audit of how each report was computed is
           untouched. */}
      <p className="mb-4 text-xs text-slate-500" data-testid="monthly-quote-note">
        Each monthly figure is the payment that dealership quoted, at their own APR and term.
      </p>

      {/* Offer cards — dealer identity NEVER revealed here */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {offers.map((offer) => {
          const isBest = offer.rank === 1;
          return (
          <div
            key={offer.offerId}
            data-testid={offer.rank ? `offer-card-${offer.rank}` : `offer-card-${offer.rankType}`}
            data-rank-type={offer.rankType}
            className={`border-2 rounded-2xl p-6 ${RANK_COLORS[offer.rankType]} relative ${
              isBest ? "ring-2 ring-al-primary ring-offset-2 shadow-md" : ""
            }`}>
            {/* Group 7 (7C) — numeric rank badge; #1 is visually dominant */}
            {offer.rank && (
              <div className="absolute -top-3 left-5">
                <Badge
                  data-testid={`offer-rank-badge-${offer.rank}`}
                  className={`border-0 px-3 ${isBest ? "bg-al-primary text-white" : "bg-slate-700 text-white"}`}
                >
                  {isBest ? <Star size={11} className="mr-1" /> : null}
                  #{offer.rank}{isBest ? " Best Offer" : ""}
                </Badge>
              </div>
            )}
            {offer.rankType === "BEST_OVERALL" && (
              <div className="absolute -top-3 right-5">
                <Badge className="bg-[#643293] text-white border-0 px-3">
                  Recommended
                </Badge>
              </div>
            )}

            <p className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3 mt-2">{offer.rankLabel}</p>
            <p className="text-3xl font-bold text-slate-900 mb-1">
              {money(offer.otdPriceCents)}
            </p>
            <p className="text-xs text-slate-400 mb-3">Out-the-door price</p>

            {/* Group 7 (7C) — OTD breakdown: vehicle + fees + taxes */}
            {offer.otdBreakdown && (
              <div className="text-xs text-slate-500 space-y-1 mb-3 border-t border-slate-200/70 pt-3" data-testid={`otd-breakdown-${offer.rankType}`}>
                <div className="flex justify-between"><span>Vehicle</span><span className="font-medium text-slate-700">{money(offer.otdBreakdown.vehiclePriceCents)}</span></div>
                <div className="flex justify-between"><span>Taxes</span><span className="font-medium text-slate-700">{money(offer.otdBreakdown.taxCents)}</span></div>
                <div className="flex justify-between"><span>Fees</span><span className="font-medium text-slate-700">{money(offer.otdBreakdown.feesCents)}</span></div>
              </div>
            )}

            {/* Group 7 (7C) — dealer response-time badge */}
            {typeof offer.responseTimeHours === "number" && (
              <span
                className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 bg-slate-100 rounded-full px-2.5 py-1 mb-3"
                data-testid={`offer-response-time-${offer.rankType}`}
              >
                <Clock size={11} />
                Responded in {offer.responseTimeHours} hr{offer.responseTimeHours !== 1 ? "s" : ""}
              </span>
            )}

            {/* TWO DEFECTS FIXED HERE, BOTH FOUND BY REVIEW, AND THE HISTORY IS KEPT ON PURPOSE.
                 The payment is INTEGER MINOR UNITS — `calculateMonthly` takes `otdPriceCents` and
                 returns cents — and this printed it raw, so a $30,000 offer at 6.9% over 72 months
                 rendered as "~$50990/mo". It now goes through `money()` like every other amount.
                 The term used to say `{termMonths}`, the value of a toggle, while the payment was
                 computed from the DEALERSHIP's own quoted term — toggling to 36mo relabelled a
                 72-month payment. The card states the term the payment is actually for, and under
                 the 2026-09-14 owner ruling the toggle that made the two disagree is gone.

                 "term not recorded" IS REACHABLE, so it is stated rather than left blank. On the
                 live ranking path the engine only computes a payment when the dealership quoted a
                 term, and then always carries it — but `getBestPriceReport` spreads a PERSISTED log
                 row straight through, and rows written before the `monthlyTermMonths` field existed
                 carry a payment with no term. An empty suffix would print a bare "~$450/mo": a
                 monthly figure whose term is silently absent, which is the one thing the ruling
                 forbids. */}
            {offer.monthlyPaymentCents != null && (
              <p className="text-sm text-slate-600 mb-2">
                ~{money(offer.monthlyPaymentCents)}/mo
                {offer.monthlyTermMonths
                  ? ` for ${offer.monthlyTermMonths} months, as quoted`
                  : " — term not recorded"}
              </p>
            )}

            {offer.junkFeesCents > 0 && (
              <p className="text-xs text-red-600 bg-red-50 px-2 py-1 rounded mb-3" data-testid={`junk-fee-warning-${offer.rankType}`}>
                ⚠ ${(offer.junkFeesCents / 100).toLocaleString()} in flagged fees
              </p>
            )}

            {/* System 4 ENH — APR flag buyer-facing warning */}
            {offer.aprFlag === "SUSPICIOUS_APR" && (
              <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-2 mb-3" data-testid={`apr-flag-warning-${offer.rankType}`}>
                <AlertTriangle size={13} className="text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-semibold text-amber-800">Interest rate flagged</p>
                  <p className="text-xs text-amber-700 leading-snug">
                    This offer includes a financing rate that is higher than typical market rates{offer.aprRate ? ` (${offer.aprRate}%)` : ""}. Review carefully before accepting. You may use your own bank financing instead.
                  </p>
                </div>
              </div>
            )}

            {offer.savingsVsRetailCents && offer.savingsVsRetailCents > 0 && (
              <p className="text-xs text-green-700 bg-green-50 px-2 py-1 rounded mb-3">
                ${(offer.savingsVsRetailCents / 100).toLocaleString()} below market
              </p>
            )}

            <Badge variant="secondary" className="text-xs mb-3">{offer.dealerTier} Dealer</Badge>
            <p className="text-xs text-slate-500 italic mb-2">{offer.rankingExplanation}</p>

            {/* Group 7 (7C) — "Why this rank?" explainer (hover/focus tooltip) */}
            <div className="relative group inline-block mb-4" data-testid={`offer-rank-tooltip-${offer.rankType}`}>
              <button
                type="button"
                className="inline-flex items-center gap-1 text-xs font-medium text-al-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-al-primary rounded"
                aria-label="Why this rank?"
              >
                <HelpCircle size={12} /> Why this rank?
              </button>
              <span className="absolute left-0 top-full mt-1 w-56 bg-slate-800 text-white text-xs leading-snug rounded-lg px-3 py-2 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity pointer-events-none z-10 shadow-lg">
                {/* §8c parity row C9: the old copy named "dealer tier and reliability" as a
                    tie-break. The engine has never read either — the real order is out-the-door,
                    then required-feature match, then distance, then who submitted first, and
                    equal offers share a rank rather than being separated by an invented rule. */}
                Offers are ranked by total out-the-door price first. Ties go to the closer match on
                your required features, then the shorter distance, then whoever submitted first —
                and offers that are genuinely equal share the same rank.
              </span>
            </div>

            {confirming === offer.offerId ? (
              <div className="space-y-2">
                <p className="text-xs text-slate-600 font-semibold">Confirm this deal?</p>
                <Button className="w-full" size="sm" onClick={() => selectOffer(offer.offerId)} data-testid={`confirm-offer-${offer.rankType}`}>
                  <CheckCircle2 size={14} /> Confirm Deal
                </Button>
                <button className="w-full text-xs text-slate-400 hover:text-slate-600" onClick={() => setConfirming(null)}>Cancel</button>
              </div>
            ) : (
              <Button variant={offer.rankType === "BEST_OVERALL" ? "default" : "secondary"} className="w-full" size="sm"
                onClick={() => setConfirming(offer.offerId)} data-testid={`choose-deal-${offer.rankType}`}>
                Choose This Deal <ArrowRight size={13} />
              </Button>
            )}
          </div>
          );
        })}
      </div>
    </div>
  );
}
