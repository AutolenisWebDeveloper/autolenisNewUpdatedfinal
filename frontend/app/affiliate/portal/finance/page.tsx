import { requireAffiliate } from "@/lib/auth/affiliate-session";
import { prisma } from "@/lib/prisma";
import { getCommissionSummary } from "@/lib/services/affiliate/commission.service";
import { getPayoutHistory } from "@/lib/services/affiliate/affiliate-payout.service";
import { Badge } from "@/components/ui/badge";
import { Landmark, DollarSign, Clock, CheckCircle2 } from "lucide-react";
import AffiliatePayoutMethodForm from "@/components/affiliate/AffiliatePayoutMethodForm";
import AffiliateTaxInfoForm from "@/components/affiliate/AffiliateTaxInfoForm";

function statusVariant(status: string): "green" | "destructive" | "amber" | "secondary" {
  if (status === "PAID" || status === "COMPLETED") return "green";
  if (status === "FAILED") return "destructive";
  if (status === "PENDING" || status === "PROCESSING") return "amber";
  return "secondary";
}

export const dynamic = "force-dynamic";

export default async function AffiliateFinancePage() {
  const affiliate = await requireAffiliate();

  const now = new Date();

  const [summary, payouts, payoutMethod, taxProfile, payoutSchedule] = await Promise.all([
    getCommissionSummary(affiliate.id).catch(() => ({
      totalCents: 0, paidCents: 0, approvedCents: 0,
      pendingCents: 0, pendingReviewCents: 0,
    })),
    getPayoutHistory(affiliate.id).catch(() => []),
    prisma.affiliatePayoutMethod.findUnique({
      where: { affiliateId: affiliate.id },
    }).catch(() => null),
    prisma.affiliateTaxProfile.findUnique({
      where: { affiliateId: affiliate.id },
      select: {
        tinLast4: true, tinType: true, legalName: true,
        taxClassification: true, certified: true, certifiedAt: true,
      },
    }).catch(() => null),
    prisma.affiliatePayoutSchedule.findUnique({
      where: { affiliateId: affiliate.id },
      select: { payoutDay: true, isActive: true },
    }).catch(() => null),
  ]);

  let nextPayoutFormatted: string;
  if (payoutSchedule?.isActive) {
    const day = payoutSchedule.payoutDay;
    const targetMonth = now.getDate() >= day ? now.getMonth() + 1 : now.getMonth();
    const nextPayout = new Date(now.getFullYear(), targetMonth, day);
    nextPayoutFormatted = nextPayout.toLocaleDateString("en-US", {
      month: "long", day: "numeric", year: "numeric",
    });
  } else {
    nextPayoutFormatted = "On request";
  }

  const hasBanking    = !!payoutMethod?.method;
  const hasTax        = taxProfile?.certified === true;
  const isApproved    = affiliate.status === "ACTIVE";

  const missing: string[] = [];
  if (!hasBanking) missing.push("banking");
  if (!hasTax)     missing.push("tax");
  if (!isApproved) missing.push("onboarding");

  return (
    <div className="p-6 md:p-8 max-w-2xl" data-testid="affiliate-finance-page">
      <div className="flex items-center gap-3 mb-6">
        <Landmark size={22} className="text-al-primary" />
        <h1 className="text-xl font-bold text-slate-900">Finance Hub</h1>
      </div>

      {/* Section 1: Earnings Overview */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 mb-6">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-4">Earnings Overview</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: "Total Earned", value: `$${(summary.totalCents / 100).toLocaleString()}`, icon: DollarSign, color: "text-green-600" },
            { label: "Total Paid", value: `$${(summary.paidCents / 100).toLocaleString()}`, icon: CheckCircle2, color: "text-blue-600" },
            { label: "Approved (payable)", value: `$${(summary.approvedCents / 100).toLocaleString()}`, icon: Clock, color: "text-amber-600" },
            { label: "Next Payout", value: nextPayoutFormatted, icon: Landmark, color: "text-al-primary" },
          ].map(stat => (
            <div key={stat.label} className="text-center">
              <stat.icon size={18} className={`${stat.color} mx-auto mb-1`} />
              <p className="text-sm font-bold text-slate-900">{stat.value}</p>
              <p className="text-xs text-slate-400">{stat.label}</p>
            </div>
          ))}
        </div>
        <p className="text-xs text-slate-400 mt-4">
          Minimum payout: $25 · Totals reflect settled commissions; reversed commissions are excluded.
        </p>
      </div>

      {/* Section 2: Payout Method */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 mb-6">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-4">Payout Method</p>
        <AffiliatePayoutMethodForm
          initialMethod={payoutMethod?.method ?? undefined}
          initialBankName={payoutMethod?.bankName}
          initialAccountType={payoutMethod?.accountType}
          initialRoutingLast4={payoutMethod?.routingNumberLast4}
          initialAccountLast4={payoutMethod?.accountNumberLast4}
          initialZelleEmail={payoutMethod?.zelleEmail}
          initialPaypalEmail={payoutMethod?.paypalEmail}
        />
      </div>

      {/* Section 3: Tax Information */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 mb-6">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-4">Tax Information (W-9)</p>
        <AffiliateTaxInfoForm
          initialLegalName={taxProfile?.legalName ?? ""}
          initialTaxClassification={taxProfile?.taxClassification ?? ""}
          initialTinType={taxProfile?.tinType ?? "SSN"}
          initialTinLast4={taxProfile?.tinLast4 ?? ""}
          certified={taxProfile?.certified ?? false}
        />
      </div>

      {/* Section 4: Payouts — the settlement rail is not live yet, so no
          request CTA is shown. The accrued balance stays visible. */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 mb-6" data-testid="payouts-section">
        <div className="flex items-center justify-between mb-4">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Payouts</p>
          <Badge variant="secondary">Payouts opening soon</Badge>
        </div>
        <p className="text-sm text-slate-600">
          You have <strong className="text-slate-900">${(summary.approvedCents / 100).toFixed(2)}</strong> approved and accruing.
          {summary.pendingReviewCents > 0 && (
            <span className="text-slate-400"> An additional ${(summary.pendingReviewCents / 100).toFixed(2)} is awaiting admin approval.</span>
          )}
        </p>
        <p className="text-xs text-slate-400 mt-2">
          Payout requests aren&apos;t available yet — your approved balance carries over and will be payable
          as soon as payouts open{missing.length > 0 ? `. To be payout-ready, complete: ${missing.join(", ")}.` : "."}
        </p>
      </div>

      {/* Section 5: Payout History */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-4">Payout History</p>
        {payouts.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-4">No payouts yet.</p>
        ) : (
          <div className="space-y-3">
            {payouts.map(p => (
              <div key={p.id} className="flex items-center justify-between border border-slate-100 rounded-lg px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-slate-800">${(p.amountCents / 100).toFixed(2)}</p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {new Date(p.periodStart).toLocaleDateString()} – {new Date(p.periodEnd).toLocaleDateString()}
                    {p.method && ` · ${p.method}`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={statusVariant(p.status)}>{p.status}</Badge>
                  {p.processedAt && (
                    <span className="text-xs text-slate-400">{new Date(p.processedAt).toLocaleDateString()}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
