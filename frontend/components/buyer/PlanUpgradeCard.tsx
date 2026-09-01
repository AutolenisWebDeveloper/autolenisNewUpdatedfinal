"use client";

import { useState } from "react";
import { Crown, CheckCircle2, Clock, AlertCircle, ArrowUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PREMIUM_FEE_REMAINING_CENTS, PREMIUM_FEE_CENTS } from "@/lib/constants";
import { api, apiErrorMessage } from "@/lib/api/client";

// UNKNOWN is distinct from NOT_PAID on purpose. The dashboard reads the deposit
// with a .catch(() => null) fallback, and a null used to collapse into
// NOT_PAID — so a transient database error told a buyer who HAD paid $99 that
// they had not. "We don't know" is the truthful answer to a failed read.
export type DepositStatus = "NOT_PAID" | "PENDING" | "PAID" | "UNKNOWN";

interface PlanUpgradeCardProps {
  plan: "STANDARD" | "PREMIUM";
  depositStatus: DepositStatus;
  planUpgradedAt?: string | null; // ISO string
}

const CONFIRMATION_MSG =
  "You are now on the Premium plan. Your $99 deposit will be credited toward your $499 service fee — $400 net will be collected after you select your deal.";

export default function PlanUpgradeCard({ plan, depositStatus, planUpgradedAt }: PlanUpgradeCardProps) {
  const [loading, setLoading] = useState(false);
  const [upgraded, setUpgraded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleUpgrade() {
    setLoading(true);
    setError(null);
    try {
      await api.post("/api/buyer/plan/upgrade");
      setUpgraded(true);
    } catch (err) {
      setError(apiErrorMessage(err, "Upgrade failed. Please try again."));
    } finally {
      setLoading(false);
    }
  }

  const isPremium = plan === "PREMIUM" || upgraded;

  // Deposit status label
  function depositLabel() {
    if (depositStatus === "PAID") {
      return isPremium
        ? { text: "Credited toward $499 fee", color: "text-green-700", bg: "bg-green-50 border-green-200" }
        : { text: "$99 paid", color: "text-green-700", bg: "bg-green-50 border-green-200" };
    }
    if (depositStatus === "PENDING") {
      return { text: "Payment pending", color: "text-amber-700", bg: "bg-amber-50 border-amber-200" };
    }
    if (depositStatus === "UNKNOWN") {
      return { text: "Status unavailable", color: "text-slate-500", bg: "bg-slate-50 border-slate-200" };
    }
    return { text: "Not yet paid", color: "text-slate-500", bg: "bg-slate-50 border-slate-200" };
  }
  const deposit = depositLabel();

  return (
    <div
      data-testid="plan-upgrade-card"
      className={`border rounded-xl p-5 ${isPremium ? "bg-gradient-to-br from-al-primary/5 to-al-primary/5 border-al-primary/30" : "bg-white border-slate-200"}`}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-2">
          <Crown size={18} className={isPremium ? "text-al-primary" : "text-slate-400"} />
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Your Plan</p>
        </div>
        <Badge
          data-testid="plan-badge"
          variant={isPremium ? "default" : "secondary"}
          className={`text-xs ${isPremium ? "bg-al-primary text-white" : ""}`}
        >
          {isPremium ? "Premium" : "Standard"}
        </Badge>
      </div>

      {/* Plan summary */}
      {isPremium ? (
        <div data-testid="premium-plan-summary">
          <p className="text-sm font-semibold text-slate-800 mb-1">
            Premium Concierge
          </p>
          <p className="text-xs text-slate-500 mb-3 leading-relaxed">
            Full concierge service — ${(PREMIUM_FEE_CENTS / 100).toLocaleString()} total fee,{" "}
            ${(PREMIUM_FEE_REMAINING_CENTS / 100).toLocaleString()} due after deal selection.
          </p>
          {planUpgradedAt && (
            <p className="text-[10px] text-slate-400">
              Upgraded {new Date(planUpgradedAt).toLocaleDateString()}
            </p>
          )}
          {upgraded && (
            <div
              data-testid="upgrade-confirmation-msg"
              className="flex items-start gap-2 mt-3 bg-al-primary/8 border border-al-primary/20 rounded-lg px-3 py-2.5 text-xs text-al-primary leading-relaxed"
            >
              <CheckCircle2 size={13} className="shrink-0 mt-0.5" />
              <span>{CONFIRMATION_MSG}</span>
            </div>
          )}
        </div>
      ) : (
        <div data-testid="standard-plan-summary">
          <p className="text-sm font-semibold text-slate-800 mb-1">Standard</p>
          <p className="text-xs text-slate-500 mb-4 leading-relaxed">
            Free to start. You can upgrade to Premium for full concierge service.
          </p>
          <Button
            type="button"
            data-testid="upgrade-to-premium-btn"
            size="sm"
            onClick={handleUpgrade}
            disabled={loading}
            className="bg-al-primary hover:bg-[#380062] text-white gap-1.5 text-xs"
          >
            <ArrowUp size={12} />
            {loading ? "Upgrading…" : "Upgrade to Premium — $499"}
          </Button>
          {error && (
            <p data-testid="upgrade-error-msg" className="text-xs text-red-500 flex items-center gap-1 mt-2">
              <AlertCircle size={11} /> {error}
            </p>
          )}
        </div>
      )}

      {/* Deposit status */}
      <div
        data-testid="deposit-status-row"
        className={`flex items-center justify-between mt-4 pt-3 border-t border-dashed ${isPremium ? "border-al-primary/15" : "border-slate-200"}`}
      >
        <div className="flex items-center gap-1.5 text-xs text-slate-500">
          {depositStatus === "PAID" ? <CheckCircle2 size={12} className="text-green-500" /> : <Clock size={12} />}
          <span>$99 Deposit</span>
        </div>
        <span
          data-testid="deposit-status-badge"
          className={`text-xs px-2 py-0.5 rounded-full border font-medium ${deposit.bg} ${deposit.color}`}
        >
          {deposit.text}
        </span>
      </div>
    </div>
  );
}
