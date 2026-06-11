// VehicleDetailPanel — sticky action panel for vehicle detail page
// Budget fit indicator, shortlist CTA, auction eligibility
// maxOtdAmountCents is READ-ONLY — never modified by this component

"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, CheckCircle2, AlertTriangle, TrendingUp, Heart } from "lucide-react";
import Link from "next/link";

interface VehicleDetailPanelProps {
  vehicleId: string;
  priceCents: number;
  lane: string;
  budgetFit: "within" | "borderline" | "over" | null;
  maxOtdAmountCents?: number;
  isAuthenticated: boolean;
}

export default function VehicleDetailPanel({
  vehicleId, priceCents, lane, budgetFit, maxOtdAmountCents, isAuthenticated,
}: VehicleDetailPanelProps) {
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleShortlist() {
    if (!isAuthenticated) return;
    setAdding(true);
    setError(null);
    const res = await fetch("/api/buyer/shortlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inventoryItemId: vehicleId }),
    });
    setAdding(false);
    if (res.ok) {
      setAdded(true);
    } else {
      const d = await res.json() as { error?: { message?: string } };
      setError(d.error?.message ?? "Unable to add to shortlist");
    }
  }

  const BudgetFitBanner = () => {
    if (!maxOtdAmountCents || budgetFit === null) return null;
    const config = {
      within:     { icon: CheckCircle2, text: "Within your approved budget", cls: "bg-green-50 border-green-200 text-green-800" },
      borderline: { icon: AlertTriangle, text: "Close to your budget ceiling", cls: "bg-amber-50 border-amber-200 text-amber-800" },
      over:       { icon: AlertTriangle, text: "Above your approved budget",   cls: "bg-red-50 border-red-200 text-red-700" },
    }[budgetFit];
    const Icon = config.icon;
    return (
      <div className={`flex items-center gap-2 border rounded-lg px-4 py-3 text-sm font-medium ${config.cls}`} data-testid="budget-fit-indicator">
        <Icon size={16} className="shrink-0" />
        {config.text}
        {/* maxOtdAmountCents displayed read-only — never editable */}
        {maxOtdAmountCents && (
          <span className="ml-auto text-xs opacity-70">Budget: ${(maxOtdAmountCents / 100).toLocaleString()}</span>
        )}
      </div>
    );
  };

  return (
    <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden" data-testid="vehicle-action-panel">
      {/* Price */}
      <div className="bg-[#0B5FD1] p-6 text-white">
        <p className="text-xs text-white/60 uppercase tracking-wider mb-1">Listed Price</p>
        <p className="text-4xl font-bold tracking-tight" data-testid="vehicle-price">
          ${(priceCents / 100).toLocaleString()}
        </p>
        {lane === "LANE_3" && (
          <p className="text-xs text-white/50 mt-1">Open-market estimate — verify at auction</p>
        )}
      </div>

      <div className="p-5 space-y-4">
        {/* Budget fit indicator */}
        <BudgetFitBanner />

        {/* Auction eligibility chip */}
        {lane === "LANE_1" ? (
          <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2.5" data-testid="auction-eligible-chip">
            <TrendingUp size={14} className="shrink-0" />
            Eligible for private 48-hour auction
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5" data-testid="auction-ineligible-chip">
            <TrendingUp size={14} className="shrink-0" />
            Auction eligibility pending dealer onboarding
          </div>
        )}

        {/* CTA */}
        {isAuthenticated ? (
          <>
            {added ? (
              <div className="flex items-center gap-2 text-green-700 text-sm font-semibold" data-testid="shortlist-added-confirm">
                <CheckCircle2 size={16} /> Added to shortlist
              </div>
            ) : (
              <Button
                className="w-full"
                size="lg"
                onClick={handleShortlist}
                disabled={adding || budgetFit === "over"}
                data-testid="add-to-shortlist-btn"
              >
                <Heart size={16} fill={added ? "currentColor" : "none"} />
                {adding ? "Adding…" : "Add to Shortlist"}
              </Button>
            )}
            {budgetFit === "over" && (
              <p className="text-xs text-red-500 text-center" data-testid="over-budget-note">
                This vehicle exceeds your approved budget. Update your prequal or choose a different vehicle.
              </p>
            )}
            {error && <p className="text-xs text-red-500" data-testid="shortlist-error">{error}</p>}
            <Button variant="secondary" className="w-full" href="/buyer/shortlist" data-testid="view-shortlist-from-detail">
              View My Shortlist <ArrowRight size={14} />
            </Button>
          </>
        ) : (
          <>
            <Button className="w-full" size="lg" href="/auth/signup" data-testid="signup-to-shortlist-btn">
              Create Account to Shortlist <ArrowRight size={16} />
            </Button>
            <p className="text-xs text-slate-400 text-center">
              Already have an account?{" "}
              <Link href="/auth/signin" className="text-[#0B5FD1] hover:underline">Sign in</Link>
            </p>
          </>
        )}

        {/* Trust note */}
        <div className="pt-3 border-t border-slate-100 text-xs text-slate-400 space-y-1" data-testid="vehicle-trust-note">
          <p>• $99 refundable Auction Access Fee to start your auction</p>
          <p>• Dealer identity revealed only after you select a deal</p>
          <p>• Contract Shield reviews every document before signing</p>
        </div>
      </div>
    </div>
  );
}
