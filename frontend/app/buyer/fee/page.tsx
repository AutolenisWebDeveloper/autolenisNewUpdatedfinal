import type { Metadata } from "next";

export const metadata: Metadata = { title: "Service Fee", robots: { index: false, follow: false } };

import { requireBuyer } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import {
  CheckCircle2,
  Clock,
  ArrowRight,
  Shield,
  Sparkles,
  AlertCircle,
  Banknote,
  RotateCcw,
  Lock,
  CreditCard,
  Info,
  Receipt,
} from "lucide-react";
import {
  DEPOSIT_AMOUNT_CENTS,
  PREMIUM_FEE_CENTS,
  PREMIUM_FEE_REMAINING_CENTS,
} from "@/lib/constants";

export const dynamic = "force-dynamic";

// Deal statuses that must come before FEE_PENDING — fee step is not yet reached.
const PRE_FEE_STATUSES = new Set([
  "PENDING",
  "ACTIVE",
  "FINANCING_PENDING",
]);

// Deal statuses where the fee is done (paid, or past fee stage entirely).
const POST_FEE_STATUSES = new Set([
  "INSURANCE_PENDING",
  "CONTRACT_PENDING",
  "CONTRACT_REVIEW",
  "CONTRACT_APPROVED",
  "SIGNING_PENDING",
  "SIGNED",
  "PICKUP_SCHEDULED",
  "PICKUP_COMPLETE",
  "COMPLETED",
]);

function formatCents(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export default async function FeePage() {
  const buyer = await requireBuyer();
  const isPremium = buyer.plan === "PREMIUM";

  // Fetch the most recent deal for this buyer.
  const deal = await prisma.deal.findFirst({
    where: { buyerId: buyer.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      status: true,
      feePaidAt: true,
      feeAmountCents: true,
      feeRefundedAt: true,
      feeRefundedAmountCents: true,
      stripeFeePIId: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  // Fetch the most recent paid deposit for this buyer.
  const deposit = await prisma.deposit.findFirst({
    where: { buyerId: buyer.id, status: "PAID" },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      amountCents: true,
      status: true,
      createdAt: true,
    },
  });

  // Also try to load a ServiceFeePayment for the current deal.
  // findUnique returns null when no record exists (no error to catch).
  const serviceFeePayment = deal
    ? await prisma.serviceFeePayment.findUnique({ where: { dealId: deal.id } })
    : null;

  const depositPaid = !!deposit;
  const depositAmountCents = deposit?.amountCents ?? DEPOSIT_AMOUNT_CENTS;

  // ── Fee amount logic ──────────────────────────────────────────────────────
  const totalFeeCents = isPremium ? PREMIUM_FEE_CENTS : 0;
  const depositCreditCents = isPremium ? depositAmountCents : 0;
  const netFeeCents = isPremium
    ? Math.max(0, PREMIUM_FEE_REMAINING_CENTS)
    : 0;

  // ── Determine fee status ──────────────────────────────────────────────────
  // Priority: refunded > paid > pending > not-started > pre-fee blocker
  const feeRefunded = !!deal?.feeRefundedAt;
  const feePaid =
    !!deal?.feePaidAt ||
    deal?.status === "FEE_PAID" ||
    POST_FEE_STATUSES.has(deal?.status ?? "");
  const feeAmountPaidCents =
    deal?.feeAmountCents ?? serviceFeePayment?.amountCents ?? 0;
  const feePaidAt = deal?.feePaidAt ?? serviceFeePayment?.paidAt ?? null;

  const isPreFeeStage = deal ? PRE_FEE_STATUSES.has(deal.status) : false;
  const isFeePending = deal?.status === "FEE_PENDING" || (!feePaid && !isPreFeeStage && !!deal);

  // ── No deal at all ────────────────────────────────────────────────────────
  if (!deal) {
    return (
      <FeePage_NoDeal isPremium={isPremium} depositPaid={depositPaid} />
    );
  }

  // ── Pre-fee stage — deal exists but hasn't reached fee step ──────────────
  if (isPreFeeStage) {
    return (
      <FeePage_NotYet
        isPremium={isPremium}
        dealStatus={deal.status}
        depositPaid={depositPaid}
        totalFeeCents={totalFeeCents}
        depositCreditCents={depositCreditCents}
        netFeeCents={netFeeCents}
      />
    );
  }

  // ── Fee refunded ──────────────────────────────────────────────────────────
  if (feeRefunded) {
    return (
      <FeePage_Refunded
        isPremium={isPremium}
        feeAmountCents={deal.feeRefundedAmountCents ?? feeAmountPaidCents}
        refundedAt={deal.feeRefundedAt!}
      />
    );
  }

  // ── Fee paid (or past fee stage) ──────────────────────────────────────────
  if (feePaid) {
    return (
      <FeePage_Paid
        isPremium={isPremium}
        feeAmountCents={feeAmountPaidCents}
        feePaidAt={feePaidAt}
        totalFeeCents={totalFeeCents}
        depositCreditCents={depositCreditCents}
        netFeeCents={netFeeCents}
        depositPaid={depositPaid}
      />
    );
  }

  // ── Fee pending / due ─────────────────────────────────────────────────────
  return (
    <FeePage_Due
      isPremium={isPremium}
      totalFeeCents={totalFeeCents}
      depositCreditCents={depositCreditCents}
      netFeeCents={netFeeCents}
      depositPaid={depositPaid}
      isFeePending={isFeePending}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-page: No deal exists
// ─────────────────────────────────────────────────────────────────────────────

function FeePage_NoDeal({
  isPremium,
  depositPaid,
}: {
  isPremium: boolean;
  depositPaid: boolean;
}) {
  return (
    <PageShell>
      <HeroCard
        icon={<Banknote size={28} className="text-slate-400" />}
        iconBg="bg-slate-100"
        title="Service Fee"
        subtitle="AutoLenis service fee status"
      />

      <InfoCard testId="fee-no-deal">
        <div className="flex items-start gap-3">
          <Info size={18} className="text-slate-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-slate-800 mb-1">
              No active deal yet
            </p>
            <p className="text-sm text-slate-600 leading-relaxed">
              The service fee step becomes active once you have a deal in
              progress. Start by selecting an offer from your auction.
            </p>
          </div>
        </div>
      </InfoCard>

      <PlanInfoCard isPremium={isPremium} depositPaid={depositPaid} />

      <div className="flex flex-col gap-3 pt-2">
        <CtaLink href="/buyer/auctions" testId="fee-goto-auctions-btn">
          Go to My Auctions <ArrowRight size={16} />
        </CtaLink>
        <SecondaryLink href="/buyer/deal" testId="fee-goto-deal-btn">
          View My Deal
        </SecondaryLink>
      </div>
    </PageShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-page: Deal exists but fee step not yet reached
// ─────────────────────────────────────────────────────────────────────────────

function FeePage_NotYet({
  isPremium,
  dealStatus,
  depositPaid,
  totalFeeCents,
  depositCreditCents,
  netFeeCents,
}: {
  isPremium: boolean;
  dealStatus: string;
  depositPaid: boolean;
  totalFeeCents: number;
  depositCreditCents: number;
  netFeeCents: number;
}) {
  const statusLabel = dealStatus.replace(/_/g, " ");

  return (
    <PageShell>
      <HeroCard
        icon={<Lock size={28} className="text-slate-400" />}
        iconBg="bg-slate-100"
        title="Service Fee"
        subtitle="Awaiting earlier steps to complete"
      />

      <InfoCard testId="fee-not-yet">
        <div className="flex items-start gap-3">
          <Clock size={18} className="text-amber-500 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-slate-800 mb-1">
              Fee step not yet reached
            </p>
            <p className="text-sm text-slate-600 leading-relaxed">
              Your deal is currently at the{" "}
              <span className="font-semibold text-slate-800">{statusLabel}</span>{" "}
              stage. The fee step will become available after financing is
              confirmed.
            </p>
          </div>
        </div>
      </InfoCard>

      {/* Preview fee breakdown */}
      <FeeBreakdown
        isPremium={isPremium}
        totalFeeCents={totalFeeCents}
        depositCreditCents={depositCreditCents}
        netFeeCents={netFeeCents}
        depositPaid={depositPaid}
        preview
      />

      <div className="flex flex-col gap-3 pt-2">
        <CtaLink href="/buyer/deal/financing" testId="fee-goto-financing-btn">
          Continue to Financing <ArrowRight size={16} />
        </CtaLink>
        <SecondaryLink href="/buyer/deal" testId="fee-goto-deal-btn">
          View My Deal
        </SecondaryLink>
      </div>
    </PageShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-page: Fee due (FEE_PENDING)
// ─────────────────────────────────────────────────────────────────────────────

function FeePage_Due({
  isPremium,
  totalFeeCents,
  depositCreditCents,
  netFeeCents,
  depositPaid,
  isFeePending,
}: {
  isPremium: boolean;
  totalFeeCents: number;
  depositCreditCents: number;
  netFeeCents: number;
  depositPaid: boolean;
  isFeePending: boolean;
}) {
  if (!isPremium) {
    // Standard plan — no fee due, just show status and continue CTA.
    return (
      <PageShell>
        <HeroCard
          icon={<Shield size={28} className="text-emerald-600" />}
          iconBg="bg-emerald-100"
          title="No Service Fee"
          subtitle="Standard plan — no fee required"
          badge={{ text: "Standard Plan", color: "green" }}
        />

        <InfoCard testId="fee-standard-no-fee">
          <div className="flex items-start gap-3">
            <CheckCircle2
              size={18}
              className="text-emerald-600 mt-0.5 shrink-0"
            />
            <div>
              <p className="text-sm font-semibold text-slate-800 mb-1">
                No AutoLenis service fee applies
              </p>
              <p className="text-sm text-slate-600 leading-relaxed">
                Standard plan buyers pay no service fee. Your{" "}
                <strong>{formatCents(DEPOSIT_AMOUNT_CENTS)} Limited-Time Auction Access Fee</strong> is refundable
                if no valuable offer is received.
              </p>
            </div>
          </div>
        </InfoCard>

        <FeeBreakdown
          isPremium={false}
          totalFeeCents={0}
          depositCreditCents={0}
          netFeeCents={0}
          depositPaid={depositPaid}
        />

        <CtaLink href="/buyer/insurance" testId="fee-continue-btn">
          Continue to Insurance <ArrowRight size={16} />
        </CtaLink>
      </PageShell>
    );
  }

  // Premium plan — fee is due.
  return (
    <PageShell>
      <HeroCard
        icon={<Sparkles size={28} className="text-[#0B5FD1]" />}
        iconBg="bg-[#0B5FD1]/10"
        title="AutoLenis Service Fee"
        subtitle="Payment required to continue"
        badge={{ text: "Premium Plan", color: "purple" }}
        status={{ text: isFeePending ? "Payment Pending" : "Due", color: "amber" }}
      />

      <FeeBreakdown
        isPremium
        totalFeeCents={totalFeeCents}
        depositCreditCents={depositCreditCents}
        netFeeCents={netFeeCents}
        depositPaid={depositPaid}
      />

      {!depositPaid && (
        <InfoCard testId="fee-no-deposit-warning">
          <div className="flex items-start gap-3">
            <AlertCircle
              size={18}
              className="text-amber-500 mt-0.5 shrink-0"
            />
            <p className="text-sm text-slate-600 leading-relaxed">
              Your {formatCents(DEPOSIT_AMOUNT_CENTS)} Auction Access Fee has not been confirmed yet. Once confirmed, it
              will be credited toward your service fee.
            </p>
          </div>
        </InfoCard>
      )}

      <div className="flex flex-col gap-3 pt-2">
        <CtaLink href="/buyer/deal/payment" testId="fee-pay-btn">
          Pay Remaining Fee ({formatCents(netFeeCents)}){" "}
          <ArrowRight size={16} />
        </CtaLink>
        <SecondaryLink href="/buyer/deal" testId="fee-goto-deal-btn">
          View My Deal
        </SecondaryLink>
      </div>
    </PageShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-page: Fee paid
// ─────────────────────────────────────────────────────────────────────────────

function FeePage_Paid({
  isPremium,
  feeAmountCents,
  feePaidAt,
  totalFeeCents,
  depositCreditCents,
  netFeeCents,
  depositPaid,
}: {
  isPremium: boolean;
  feeAmountCents: number;
  feePaidAt: Date | null;
  totalFeeCents: number;
  depositCreditCents: number;
  netFeeCents: number;
  depositPaid: boolean;
}) {
  return (
    <PageShell>
      <HeroCard
        icon={<CheckCircle2 size={28} className="text-emerald-600" />}
        iconBg="bg-emerald-100"
        title={isPremium ? "Service Fee Paid" : "No Fee — Standard Plan"}
        subtitle={
          isPremium
            ? "Your AutoLenis service fee has been received"
            : "No service fee required — Auction Access Fee refundable if no valuable offer"
        }
        status={{ text: "Complete", color: "green" }}
      />

      {/* Paid confirmation panel */}
      {isPremium && (
        <div
          className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5"
          data-testid="fee-paid-confirmation"
        >
          <div className="flex items-center gap-3 mb-4">
            <Receipt size={18} className="text-emerald-700" />
            <span className="text-sm font-semibold text-emerald-800">
              Payment Confirmed
            </span>
          </div>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between text-slate-700">
              <span>Amount paid</span>
              <span className="font-semibold">
                {feeAmountCents > 0
                  ? formatCents(feeAmountCents)
                  : formatCents(netFeeCents)}
              </span>
            </div>
            {feePaidAt && (
              <div className="flex justify-between text-slate-500">
                <span>Paid on</span>
                <span>{formatDate(feePaidAt)}</span>
              </div>
            )}
          </div>
        </div>
      )}

      <FeeBreakdown
        isPremium={isPremium}
        totalFeeCents={totalFeeCents}
        depositCreditCents={depositCreditCents}
        netFeeCents={netFeeCents}
        depositPaid={depositPaid}
        paid
      />

      <div className="flex flex-col gap-3 pt-2">
        <CtaLink href="/buyer/insurance" testId="fee-continue-insurance-btn">
          Continue to Insurance <ArrowRight size={16} />
        </CtaLink>
        <SecondaryLink href="/buyer/contracts" testId="fee-goto-contracts-btn">
          View Contract Documents
        </SecondaryLink>
      </div>
    </PageShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-page: Fee refunded
// ─────────────────────────────────────────────────────────────────────────────

function FeePage_Refunded({
  isPremium,
  feeAmountCents,
  refundedAt,
}: {
  isPremium: boolean;
  feeAmountCents: number;
  refundedAt: Date;
}) {
  return (
    <PageShell>
      <HeroCard
        icon={<RotateCcw size={28} className="text-blue-500" />}
        iconBg="bg-blue-50"
        title="Fee Refunded"
        subtitle="Your service fee has been refunded"
        status={{ text: "Refunded", color: "blue" }}
      />

      <InfoCard testId="fee-refunded">
        <div className="flex items-start gap-3">
          <RotateCcw size={18} className="text-blue-500 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-slate-800 mb-1">
              {isPremium ? formatCents(feeAmountCents) : "$0"} refunded
            </p>
            <p className="text-sm text-slate-600">
              Refunded on {formatDate(refundedAt)}. Please allow 5–10 business
              days for the refund to appear on your statement.
            </p>
          </div>
        </div>
      </InfoCard>

      <SecondaryLink href="/buyer/deal" testId="fee-goto-deal-btn">
        View My Deal
      </SecondaryLink>
    </PageShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared UI sub-components
// ─────────────────────────────────────────────────────────────────────────────

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-purple-50/30"
      data-testid="buyer-fee-page"
    >
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8 space-y-5 pb-12">
        <div>
          <h1 className="text-xl font-bold text-slate-900">
            Service Fee
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            AutoLenis service fee status for your deal
          </p>
        </div>
        {children}
      </div>
    </div>
  );
}

function HeroCard({
  icon,
  iconBg,
  title,
  subtitle,
  badge,
  status,
}: {
  icon: React.ReactNode;
  iconBg: string;
  title: string;
  subtitle: string;
  badge?: { text: string; color: "green" | "purple" | "amber" | "blue" };
  status?: { text: string; color: "green" | "amber" | "blue" | "slate" };
}) {
  const badgeColors = {
    green: "bg-emerald-100 text-emerald-700 border-emerald-200",
    purple: "bg-[#0B5FD1]/10 text-[#0B5FD1] border-[#0B5FD1]/20",
    amber: "bg-amber-100 text-amber-700 border-amber-200",
    blue: "bg-blue-100 text-blue-700 border-blue-200",
  };
  const statusColors = {
    green: "bg-emerald-100 text-emerald-700",
    amber: "bg-amber-100 text-amber-700",
    blue: "bg-blue-100 text-blue-700",
    slate: "bg-slate-100 text-slate-600",
  };

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm flex items-start gap-4">
      <div
        className={`w-12 h-12 ${iconBg} rounded-xl flex items-center justify-center shrink-0`}
      >
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2 mb-1">
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          {badge && (
            <span
              className={`text-xs font-medium px-2.5 py-0.5 rounded-full border ${badgeColors[badge.color]}`}
            >
              {badge.text}
            </span>
          )}
          {status && (
            <span
              className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${statusColors[status.color]}`}
            >
              {status.text}
            </span>
          )}
        </div>
        <p className="text-sm text-slate-500">{subtitle}</p>
      </div>
    </div>
  );
}

function InfoCard({
  children,
  testId,
}: {
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <div
      className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm"
      data-testid={testId}
    >
      {children}
    </div>
  );
}

function FeeBreakdown({
  isPremium,
  totalFeeCents,
  depositCreditCents,
  netFeeCents,
  depositPaid,
  preview = false,
  paid = false,
}: {
  isPremium: boolean;
  totalFeeCents: number;
  depositCreditCents: number;
  netFeeCents: number;
  depositPaid: boolean;
  preview?: boolean;
  paid?: boolean;
}) {
  return (
    <div
      className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm"
      data-testid="fee-breakdown"
    >
      <div className="flex items-center gap-2 mb-4">
        <CreditCard size={16} className="text-slate-400" />
        <span className="text-sm font-semibold text-slate-700">
          Fee Breakdown
          {preview && (
            <span className="ml-2 text-xs font-normal text-slate-400">
              (preview)
            </span>
          )}
        </span>
      </div>

      <div className="space-y-3 text-sm">
        {isPremium ? (
          <>
            <FeeRow
              label="AutoLenis Service Fee (total)"
              value={formatCents(totalFeeCents)}
            />
            <FeeRow
              label={`${formatCents(DEPOSIT_AMOUNT_CENTS)} Auction Access Fee credited`}
              value={`−${formatCents(depositCreditCents)}`}
              highlight
              note={
                depositPaid
                  ? "Auction Access Fee confirmed"
                  : "Auction Access Fee not yet confirmed"
              }
              noteColor={depositPaid ? "green" : "amber"}
            />
            <div className="border-t border-slate-100 pt-3">
              <FeeRow
                label={paid ? "Total paid to AutoLenis" : "Remaining balance due"}
                value={formatCents(netFeeCents)}
                bold
                highlight={paid}
              />
            </div>
          </>
        ) : (
          <>
            <FeeRow
              label="AutoLenis Service Fee"
              value="$0"
              note="Standard plan — no fee"
              noteColor="green"
            />
            <FeeRow
              label={`${formatCents(DEPOSIT_AMOUNT_CENTS)} Auction Access Fee`}
              value="Refundable"
              note="Refundable if no valuable offer is received"
              noteColor="green"
            />
            <div className="border-t border-slate-100 pt-3">
              <FeeRow
                label="Due to AutoLenis today"
                value="$0"
                bold
              />
            </div>
          </>
        )}
      </div>

      {isPremium && (
        <p className="text-xs text-slate-400 mt-4 leading-relaxed bg-slate-50 rounded-lg px-3 py-2">
          AutoLenis Service Fee: <strong>{formatCents(PREMIUM_FEE_CENTS)} total</strong> — {formatCents(DEPOSIT_AMOUNT_CENTS)} Auction Access Fee
          credited ={" "}
          <strong>{formatCents(netFeeCents)} due to AutoLenis</strong>.
          The Auction Access Fee is refundable if no valuable offer is
          received.
        </p>
      )}
    </div>
  );
}

function FeeRow({
  label,
  value,
  highlight = false,
  bold = false,
  note,
  noteColor = "slate",
}: {
  label: string;
  value: string;
  highlight?: boolean;
  bold?: boolean;
  note?: string;
  noteColor?: "green" | "amber" | "slate";
}) {
  const noteColors = {
    green: "text-emerald-600",
    amber: "text-amber-600",
    slate: "text-slate-400",
  };

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex justify-between items-baseline">
        <span
          className={`${bold ? "font-semibold text-slate-900" : "text-slate-600"}`}
        >
          {label}
        </span>
        <span
          className={`${bold ? "font-bold text-base" : "font-medium"} ${highlight ? "text-emerald-700" : "text-slate-900"} ml-4 shrink-0`}
        >
          {value}
        </span>
      </div>
      {note && (
        <span className={`text-xs ${noteColors[noteColor]} pl-0`}>{note}</span>
      )}
    </div>
  );
}

function PlanInfoCard({
  isPremium,
  depositPaid,
}: {
  isPremium: boolean;
  depositPaid: boolean;
}) {
  return (
    <div
      className={`rounded-2xl p-5 border flex items-start gap-3 ${
        isPremium
          ? "bg-[#F8F9FB] border-[#E5E7EB]"
          : "bg-emerald-50 border-emerald-200"
      }`}
      data-testid="fee-plan-info"
    >
      {isPremium ? (
        <Sparkles size={18} className="text-[#0B5FD1] mt-0.5 shrink-0" />
      ) : (
        <Shield size={18} className="text-emerald-600 mt-0.5 shrink-0" />
      )}
      <div>
        <p className="text-sm font-semibold text-slate-900 mb-0.5">
          You are on the {isPremium ? "Premium" : "Standard"} plan
        </p>
        <p className="text-sm text-slate-600 leading-relaxed">
          {isPremium
            ? `Premium plan includes the full AutoLenis white-glove concierge service. A ${formatCents(PREMIUM_FEE_CENTS)} fee applies, with your ${formatCents(DEPOSIT_AMOUNT_CENTS)} Auction Access Fee already credited — leaving ${formatCents(PREMIUM_FEE_REMAINING_CENTS)} due.`
            : `Standard plan buyers pay no service fee. Your ${formatCents(DEPOSIT_AMOUNT_CENTS)} Limited-Time Auction Access Fee is refundable if no valuable offer is received.`}
        </p>
        {isPremium && !depositPaid && (
          <p className="text-xs text-amber-600 mt-1.5">
            Note: Your {formatCents(DEPOSIT_AMOUNT_CENTS)} Auction Access Fee has not yet been confirmed. Once confirmed,
            it will reduce your balance to {formatCents(PREMIUM_FEE_REMAINING_CENTS)}.
          </p>
        )}
      </div>
    </div>
  );
}

function CtaLink({
  href,
  children,
  testId,
}: {
  href: string;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <Link
      href={href}
      data-testid={testId}
      className="flex items-center justify-center gap-2 w-full bg-[#0B5FD1] hover:bg-[#0A4DB8] text-white font-semibold py-3.5 px-6 rounded-xl transition-colors text-sm shadow-md shadow-[#0B5FD1]/20"
    >
      {children}
    </Link>
  );
}

function SecondaryLink({
  href,
  children,
  testId,
}: {
  href: string;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <Link
      href={href}
      data-testid={testId}
      className="flex items-center justify-center gap-2 w-full border border-slate-200 hover:bg-slate-50 text-slate-700 font-semibold py-3.5 px-6 rounded-xl transition-colors text-sm"
    >
      {children}
    </Link>
  );
}
