import { requireAffiliateWithOnboarding } from "@/lib/auth/affiliate-session";
import { prisma } from "@/lib/prisma";
import { getCommissionSummary } from "@/lib/services/affiliate/commission.service";
import { getPayoutHistory } from "@/lib/services/affiliate/affiliate-payout.service";
import { AFFILIATE_PAYOUT_MINIMUM_CENTS } from "@/lib/constants";
import { Badge } from "@/components/ui/badge";
import { Landmark, DollarSign, Clock, CheckCircle2, AlertCircle } from "lucide-react";
import AffiliatePayoutMethodForm from "@/components/affiliate/AffiliatePayoutMethodForm";
import AffiliateTaxInfoForm from "@/components/affiliate/AffiliateTaxInfoForm";
import PayoutRequestSection from "@/components/affiliate/PayoutRequestSection";

function statusVariant(status: string): "green" | "destructive" | "amber" | "secondary" {
  if (status === "PAID" || status === "COMPLETED") return "green";
  if (status === "FAILED") return "destructive";
  if (status === "PENDING" || status === "PROCESSING") return "amber";
  return "secondary";
}

// U1 — a failed read renders an explicit error state, NEVER fabricated zeros:
// a money page showing "$0" or an empty banking form on a DB hiccup misleads
// and invites re-entry of payout/tax data. Partial-failure aware: each section
// errors independently (documents-page pattern).
function SectionError({ what }: { what: string }) {
  return (
    <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-4 py-3" role="alert">
      <AlertCircle size={15} className="text-red-500 shrink-0" aria-hidden="true" />
      <p className="text-sm text-red-700">
        We couldn&apos;t load your {what} right now. Refresh to try again — nothing was changed.
      </p>
    </div>
  );
}

export const dynamic = "force-dynamic";

export default async function AffiliateFinancePage() {
  // P1-2 — gate runs in the PAGE, not only the layout: App Router does not
  // re-render the layout on soft navigation, so a sidebar click would bypass
  // a layout-only gate.
  const { affiliate } = await requireAffiliateWithOnboarding();

  const [summaryR, payoutsR, payoutMethodR, taxProfileR, onboardingR, openRequestR] = await Promise.allSettled([
    getCommissionSummary(affiliate.id),
    getPayoutHistory(affiliate.id, { take: 50 }),
    prisma.affiliatePayoutMethod.findUnique({
      where: { affiliateId: affiliate.id },
    }),
    prisma.affiliateTaxProfile.findUnique({
      where: { affiliateId: affiliate.id },
      select: {
        tinLast4: true, tinType: true, legalName: true,
        taxClassification: true, certified: true, certifiedAt: true,
      },
    }),
    prisma.affiliateOnboardingReview.findUnique({
      where: { affiliateId: affiliate.id },
      select: { status: true },
    }),
    prisma.affiliatePayout.findFirst({
      where: { affiliateId: affiliate.id, status: "PENDING" },
      select: { amountCents: true, requestedAt: true },
    }),
  ]);

  const summary      = summaryR.status === "fulfilled" ? summaryR.value : null;
  const payouts      = payoutsR.status === "fulfilled" ? payoutsR.value : null;
  const payoutMethod = payoutMethodR.status === "fulfilled" ? payoutMethodR.value : null;
  const taxProfile   = taxProfileR.status === "fulfilled" ? taxProfileR.value : null;
  const onboarding   = onboardingR.status === "fulfilled" ? onboardingR.value : null;
  const openRequest  = openRequestR.status === "fulfilled" ? openRequestR.value : null;

  const hasBanking         = !!payoutMethod?.method;
  const onboardingApproved = onboarding?.status === "APPROVED";
  const taxCertified       = !!taxProfile?.certified;

  // Prerequisites the payout service actually enforces, in user words.
  const missing: string[] = [];
  if (!onboardingApproved) missing.push("complete onboarding (and get approved)");
  if (!hasBanking) missing.push("add a payout method below");
  if (!taxCertified) missing.push("certify your tax information (W-9) below");

  return (
    <div className="p-6 md:p-8 max-w-2xl" data-testid="affiliate-finance-page">
      <div className="flex items-center gap-3 mb-6">
        <Landmark size={22} className="text-al-primary" />
        <h1 className="text-xl font-bold text-slate-900">Finance Hub</h1>
      </div>

      {/* Section 1: Earnings Overview */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 mb-6">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-4">Earnings Overview</p>
        {summary === null ? (
          <SectionError what="earnings" />
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                { label: "Total Earned", value: `$${(summary.totalCents / 100).toLocaleString()}`, icon: DollarSign, color: "text-green-600" },
                { label: "Total Paid", value: `$${(summary.paidCents / 100).toLocaleString()}`, icon: CheckCircle2, color: "text-blue-600" },
                { label: "Approved (payable)", value: `$${(summary.approvedCents / 100).toLocaleString()}`, icon: Clock, color: "text-amber-600" },
                { label: "In Review", value: `$${(summary.pendingReviewCents / 100).toLocaleString()}`, icon: Landmark, color: "text-al-primary" },
              ].map(stat => (
                <div key={stat.label} className="text-center">
                  <stat.icon size={18} className={`${stat.color} mx-auto mb-1`} aria-hidden="true" />
                  <p className="text-sm font-bold text-slate-900">{stat.value}</p>
                  <p className="text-xs text-slate-500">{stat.label}</p>
                </div>
              ))}
            </div>
            <p className="text-xs text-slate-500 mt-4">
              Minimum payout: ${(AFFILIATE_PAYOUT_MINIMUM_CENTS / 100).toFixed(0)} · Totals net out reversed commissions.
            </p>
          </>
        )}
      </div>

      {/* Section 2: Payouts — the self-serve request rail (decision 3). */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 mb-6" data-testid="payouts-section">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-4">Payouts</p>
        {summary === null || openRequestR.status === "rejected" ? (
          <SectionError what="payout status" />
        ) : (
          <PayoutRequestSection
            availableCents={summary.approvedCents}
            minimumCents={AFFILIATE_PAYOUT_MINIMUM_CENTS}
            missing={missing}
            pendingRequest={
              openRequest
                ? { amountCents: openRequest.amountCents, requestedAt: openRequest.requestedAt.toISOString() }
                : null
            }
          />
        )}
      </div>

      {/* Section 3: Payout Method */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 mb-6">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-4">Payout Method</p>
        {payoutMethodR.status === "rejected" ? (
          <SectionError what="payout method" />
        ) : (
          <AffiliatePayoutMethodForm
            initialMethod={payoutMethod?.method ?? undefined}
            initialBankName={payoutMethod?.bankName}
            initialAccountType={payoutMethod?.accountType}
            initialRoutingLast4={payoutMethod?.routingNumberLast4}
            initialAccountLast4={payoutMethod?.accountNumberLast4}
            initialZelleEmail={payoutMethod?.zelleEmail}
            initialPaypalEmail={payoutMethod?.paypalEmail}
          />
        )}
      </div>

      {/* Section 4: Tax Information */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 mb-6">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-4">Tax Information (W-9)</p>
        {taxProfileR.status === "rejected" ? (
          <SectionError what="tax information" />
        ) : (
          <AffiliateTaxInfoForm
            initialLegalName={taxProfile?.legalName ?? ""}
            initialTaxClassification={taxProfile?.taxClassification ?? ""}
            initialTinType={taxProfile?.tinType ?? "SSN"}
            initialTinLast4={taxProfile?.tinLast4 ?? ""}
            certified={taxProfile?.certified ?? false}
          />
        )}
      </div>

      {/* Section 5: Payout History */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-4">Payout History</p>
        {payouts === null ? (
          <SectionError what="payout history" />
        ) : payouts.length === 0 ? (
          <p className="text-sm text-slate-500 text-center py-4">No payouts yet.</p>
        ) : (
          <div className="space-y-3">
            {payouts.map(p => (
              <div key={p.id} className="flex items-center justify-between border border-slate-100 rounded-lg px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-slate-800">${(p.amountCents / 100).toFixed(2)}</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {new Date(p.periodStart).toLocaleDateString()} – {new Date(p.periodEnd).toLocaleDateString()}
                    {p.method && ` · ${p.method}`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={statusVariant(p.status)}>{p.status}</Badge>
                  {p.processedAt && (
                    <span className="text-xs text-slate-500">{new Date(p.processedAt).toLocaleDateString()}</span>
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
