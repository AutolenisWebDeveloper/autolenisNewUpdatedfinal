import type { Metadata } from "next";
import Link from "next/link";
import { requireBuyer } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import PlanUpgradeCard, { type DepositStatus } from "@/components/buyer/PlanUpgradeCard";
import ProactiveNudgesPanel, { type BuyerNudge } from "@/components/buyer/ProactiveNudgesPanel";
import { DEPOSIT_AMOUNT_CENTS } from "@/lib/constants";
import { isPrequalValid } from "@/lib/services/prequal/prequal.service";
import PageContainer from "@/components/ui/patterns/PageContainer";
import PageHeader from "@/components/ui/patterns/PageHeader";
import { CARD, EYEBROW, FIGURE } from "@/components/ui/patterns/tokens";
import {
  MapPin, Wallet, Search, Heart, ClipboardList, Bell, MessageSquare,
  Gavel, CheckCircle2, ArrowRight, FileText, Sparkles,
} from "lucide-react";

export const metadata: Metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

// Journey ladder — 14 steps end-to-end. Steps 9–13 are derived from the deal
// state machine so the progress indicator stays truthful *through* the deal
// instead of sitting at 8 and jumping straight to 14 on completion.
const DEAL_STATUS_STEPS: Record<string, { stepNum: number; stepLabel: string; nextStepLabel: string | null }> = {
  PENDING:            { stepNum: 8,  stepLabel: "Deal Active",         nextStepLabel: "Financing" },
  ACTIVE:             { stepNum: 8,  stepLabel: "Deal Active",         nextStepLabel: "Financing" },
  FINANCING_PENDING:  { stepNum: 9,  stepLabel: "Financing",           nextStepLabel: "Service Fee" },
  FEE_PENDING:        { stepNum: 10, stepLabel: "Service Fee",         nextStepLabel: "Insurance" },
  FEE_PAID:           { stepNum: 10, stepLabel: "Service Fee",         nextStepLabel: "Insurance" },
  INSURANCE_PENDING:  { stepNum: 11, stepLabel: "Insurance",           nextStepLabel: "Contract & Signing" },
  CONTRACT_PENDING:   { stepNum: 12, stepLabel: "Contract & Signing",  nextStepLabel: "Pickup" },
  CONTRACT_REVIEW:    { stepNum: 12, stepLabel: "Contract & Signing",  nextStepLabel: "Pickup" },
  CONTRACT_APPROVED:  { stepNum: 12, stepLabel: "Contract & Signing",  nextStepLabel: "Pickup" },
  SIGNING_PENDING:    { stepNum: 12, stepLabel: "Contract & Signing",  nextStepLabel: "Pickup" },
  SIGNED:             { stepNum: 12, stepLabel: "Contract & Signing",  nextStepLabel: "Pickup" },
  PICKUP_SCHEDULED:   { stepNum: 13, stepLabel: "Vehicle Pickup",      nextStepLabel: "Purchase Complete" },
  PICKUP_COMPLETE:    { stepNum: 13, stepLabel: "Vehicle Pickup",      nextStepLabel: "Purchase Complete" },
};
const TOTAL_STEPS = 14;

export default async function BuyerDashboard() {
  const buyer = await requireBuyer();
  const prequal = buyer?.preQualification ?? null;
  const firstName = buyer?.firstName ?? "there";
  // Use the shared validity helper so the dashboard's prequal gating can never
  // drift from the rest of the platform (layout, journey-status API, etc.).
  const prequalApproved = isPrequalValid(prequal);

  // ── Dashboard data — fetched concurrently ─────────────────────────────────
  // These queries are mutually independent, so we run them in parallel instead
  // of serially (8 round-trips → 1 round-trip of wall-clock latency). Each
  // query degrades to a safe fallback so a single failure never blanks the
  // dashboard — preserving the previous per-query non-fatal behaviour.
  const [
    latestDeposit,
    shortlist,
    activeAuction,
    activeDeal,
    latestAuction,
    latestDeal,
    unreadCount,
    activeDealerCount,
  ] = await Promise.all([
    prisma.deposit
      .findFirst({ where: { buyerId: buyer.id }, orderBy: { createdAt: "desc" }, select: { status: true } })
      .catch(() => null),
    prequalApproved
      ? prisma.shortlist
          .findUnique({ where: { buyerId: buyer.id }, select: { _count: { select: { items: true } } } })
          .catch(() => null)
      : Promise.resolve(null),
    prisma.auction
      .findFirst({
        where: { buyerId: buyer.id, status: { in: ["ACTIVE", "PENDING"] } },
        orderBy: { createdAt: "desc" },
        select: { id: true, status: true, endsAt: true, _count: { select: { offers: { where: { status: "SUBMITTED" } } } } },
      })
      .catch(() => null),
    prisma.deal
      .findFirst({
        where: { buyerId: buyer.id, status: { notIn: ["COMPLETED", "CANCELLED", "REFUNDED"] } },
        orderBy: { createdAt: "desc" },
        select: { id: true, status: true },
      })
      .catch(() => null),
    prisma.auction
      .findFirst({
        where: { buyerId: buyer.id },
        orderBy: { createdAt: "desc" },
        select: { id: true, status: true, endsAt: true, _count: { select: { offers: true } } },
      })
      .catch(() => null),
    prisma.deal
      .findFirst({ where: { buyerId: buyer.id }, orderBy: { createdAt: "desc" }, select: { id: true, status: true } })
      .catch(() => null),
    prisma.notification.count({ where: { buyerId: buyer.id, readAt: null } }).catch(() => 0),
    prisma.dealer.count({ where: { status: "ACTIVE" } }).catch(() => 0),
  ]);

  const depositStatus: DepositStatus =
    latestDeposit?.status === "PAID" ? "PAID" :
    latestDeposit?.status === "PENDING" ? "PENDING" : "NOT_PAID";

  const shortlistCount = shortlist?._count.items ?? 0;

  // If prequal is approved, onboarding is implicitly complete
  const onboardingComplete = buyer.onboardingComplete === true || prequalApproved;

  // Determine current step for the header (journey: 1=account, 2=onboarding,
  // 3=prequal, 4=search, 5=shortlist, 6=deposit, 7=auction, 8–13=deal stages,
  // 14=purchase complete).
  let stepNum = 1;
  let stepLabel = "Account Created";
  let nextStepLabel: string | null = "Onboarding";
  if (!onboardingComplete) {
    stepNum = 2;
    stepLabel = "Onboarding";
    nextStepLabel = "Pre-Qualification";
  } else if (!prequalApproved) {
    stepNum = 3;
    stepLabel = "Pre-Qualification";
    nextStepLabel = "Search";
  } else if (shortlistCount === 0) {
    stepNum = 4;
    stepLabel = "Search";
    nextStepLabel = "Shortlist";
  } else if (!activeDeal && !activeAuction && depositStatus === "NOT_PAID") {
    stepNum = 5;
    stepLabel = "Shortlist";
    nextStepLabel = "Access Fee";
  } else if (!activeDeal && !activeAuction) {
    stepNum = 6;
    stepLabel = "Access Fee";
    nextStepLabel = "Auction";
  } else if (activeAuction) {
    stepNum = 7;
    stepLabel = "Auction Live";
    nextStepLabel = "Select Deal";
  } else if (activeDeal) {
    // Within a deal, the step is derived from the deal state machine so
    // progress advances through financing → fee → insurance → contract → pickup.
    const dealStep = DEAL_STATUS_STEPS[activeDeal.status] ?? DEAL_STATUS_STEPS.PENDING;
    stepNum = dealStep.stepNum;
    stepLabel = dealStep.stepLabel;
    nextStepLabel = dealStep.nextStepLabel;
  }

  // A completed purchase is the terminal journey state. It overrides the
  // cascade above, which keys off activeDeal/activeAuction (both null once the
  // deal is COMPLETED) and would otherwise mislabel the step.
  const purchaseComplete = latestDeal?.status === "COMPLETED";
  if (purchaseComplete) {
    stepNum = TOTAL_STEPS;
    stepLabel = "Purchase Complete";
    nextStepLabel = null;
  }

  const buyerPlan: "STANDARD" | "PREMIUM" =
    buyer.plan === "PREMIUM" ? "PREMIUM" : "STANDARD";

  // ── Feature 16 — Proactive Nudges (Phase 3) ──────────────────────────────
  // Nudges derived from real buyer state ONLY. No fabricated data.
  const nudges: BuyerNudge[] = [];

  // Nudge 1 — Prequal expiry warning (if approved and expires ≤ 30 days)
  if (prequalApproved && prequal?.expiresAt) {
    const daysLeft = Math.ceil((prequal.expiresAt.getTime() - Date.now()) / 86400000);
    if (daysLeft <= 30 && daysLeft > 0) {
      nudges.push({
        id: "prequal-expiry",
        stage: "PREQUAL_IDLE",
        icon: "prequal",
        title: `Pre-qualification expires in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`,
        body: "Renewing is fast and won't affect your credit score. Keep your buying power active.",
        actionLabel: "Renew pre-qualification",
        actionHref: "/buyer/prequal",
        urgency: daysLeft <= 7 ? "high" : "medium",
      });
    }
  }

  // Nudge 2 — Empty shortlist after prequal approved
  if (prequalApproved && shortlistCount === 0 && !activeAuction && !activeDeal) {
    nudges.push({
      id: "shortlist-empty",
      stage: "DEPOSIT_IDLE",
      icon: "shortlist",
      title: "Build your shortlist to launch an auction",
      body: "Add at least one vehicle to your shortlist. Dealers compete — you pick the best deal.",
      actionLabel: "Browse vehicles",
      actionHref: "/buyer/search",
      urgency: "medium",
    });
  }

  // Nudge 3 — Active auction countdown (only if real endsAt exists)
  if (activeAuction?.status === "ACTIVE" && activeAuction.endsAt) {
    const hoursLeft = Math.ceil((activeAuction.endsAt.getTime() - Date.now()) / 3600000);
    if (hoursLeft > 0 && hoursLeft <= 48) {
      nudges.push({
        id: `auction-countdown-${activeAuction.id}`,
        stage: "FINANCING_IDLE",
        icon: "auction",
        title: `Auction closes in ${formatHoursRemaining(hoursLeft)}`,
        body: `${activeAuction._count.offers} offer${activeAuction._count.offers !== 1 ? "s" : ""} received so far. Review them when the auction closes.`,
        actionLabel: "View auction",
        actionHref: `/buyer/auctions/${activeAuction.id}`,
        urgency: hoursLeft <= 6 ? "high" : "medium",
      });
    }
  }

  const progressPct = Math.round((stepNum / TOTAL_STEPS) * 100);

  const quickActions = [
    { label: "Check buying power", href: "/buyer/prequal", icon: Wallet, show: true },
    { label: "Browse inventory", href: "/buyer/search", icon: Search, show: prequalApproved },
    { label: "My shortlist", href: "/buyer/shortlist", icon: Heart, show: prequalApproved },
    { label: "Request a vehicle", href: "/buyer/requests/new", icon: ClipboardList, show: true },
    { label: "View notifications", href: "/buyer/notifications", icon: Bell, show: true },
    { label: "My messages", href: "/buyer/messages", icon: MessageSquare, show: true },
  ].filter(a => a.show);

  return (
    <PageContainer testId="buyer-dashboard">

      {/* Feature 16 — Proactive Nudges (only shows real state-driven nudges) */}
      {nudges.length > 0 && (
        <ProactiveNudgesPanel nudges={nudges} />
      )}

      {/* No dealers in area banner — shown when prequal approved but no active dealers */}
      {prequalApproved && activeDealerCount === 0 && !activeAuction && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 mb-6" data-testid="no-dealer-banner">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center shrink-0">
              <MapPin size={18} className="text-amber-600" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-amber-900 mb-1">No dealers in your area yet</h3>
              <p className="text-sm text-amber-700 mb-3">
                We&apos;re actively onboarding dealers in your area. In the meantime, you can submit a vehicle
                request and our team will source options for you manually — no Auction Access Fee required.
              </p>
              <Link
                href="/buyer/requests/new"
                className="inline-flex items-center gap-2 bg-[#0B5FD1] text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-[#0A4DB8] transition-colors"
              >
                Submit a Vehicle Request <ArrowRight size={14} />
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* ── Greeting Header ─────────────────────────────────────────────── */}
      <PageHeader
        eyebrow={
          <>
            <span
              className="text-xs font-semibold text-[#0B5FD1] bg-[#EFF6FF] border border-[#DBEAFE] px-3 py-1 rounded-full"
              data-testid="dashboard-step-label"
            >
              Step {stepNum} of {TOTAL_STEPS} — {stepLabel}
            </span>
            {unreadCount > 0 && (
              <Link
                href="/buyer/notifications"
                className="text-xs font-semibold text-white bg-red-500 px-2.5 py-1 rounded-full hover:bg-red-600 transition-colors"
                data-testid="dashboard-unread-badge"
              >
                {unreadCount} new {unreadCount === 1 ? "notification" : "notifications"}
              </Link>
            )}
          </>
        }
        title={<>Good {getTimeOfDay()}, {firstName}</>}
        subtitle={
          nextStepLabel
            ? `Your next step: ${nextStepLabel}`
            : "You're on track — here's your full picture."
        }
      />

      {/* ── KPI Row ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">

        {/* Card 1: Buying Power / Prequal CTA */}
        {prequalApproved && prequal ? (
          <div className={`${CARD} p-5`} data-testid="kpi-buying-power">
            <div className="flex items-start justify-between mb-4">
              <div className="w-9 h-9 rounded-xl bg-[#EFF6FF] flex items-center justify-center">
                <Wallet size={16} className="text-[#0B5FD1]" />
              </div>
            </div>
            <p className={`text-[1.65rem] leading-none ${FIGURE}`}>
              ${((prequal.maxOtdAmountCents ?? 0) / 100).toLocaleString()}
            </p>
            <p className="text-xs font-medium text-slate-500 mt-2">Buying Power</p>
            <p className="text-[11px] text-slate-400 mt-0.5">Pre-approved max OTD budget</p>
            <div className="mt-4 flex items-center gap-1.5 pt-3 border-t border-slate-100">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              <span className="text-xs font-medium text-emerald-600">Active approval</span>
              {prequal.expiresAt && (
                <span className="text-xs text-slate-400 ml-auto">
                  Expires {new Date(prequal.expiresAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </span>
              )}
            </div>
          </div>
        ) : (
          <div
            className="bg-[#EFF6FF] border border-[#DBEAFE] rounded-2xl p-5"
            data-testid="kpi-prequal-cta"
          >
            <div className="w-9 h-9 rounded-xl bg-white/70 flex items-center justify-center mb-4">
              <Wallet size={16} className="text-[#0B5FD1]" />
            </div>
            <p className="text-lg font-bold text-slate-900 mb-1">Get pre-qualified</p>
            <p className="text-sm text-slate-600 mb-4">
              Soft pull only · 3 minutes · No credit impact
            </p>
            <Link
              href="/buyer/prequal"
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#0B5FD1] hover:text-[#0A4DB8] transition-colors"
              data-testid="kpi-start-prequal"
            >
              Check my buying power <ArrowRight size={14} />
            </Link>
          </div>
        )}

        {/* Card 2: Journey Progress */}
        <div className={`${CARD} p-5`} data-testid="kpi-journey-stage">
          <div className="flex items-start justify-between mb-4">
            <div className="w-9 h-9 rounded-xl bg-indigo-50 flex items-center justify-center">
              <Sparkles size={16} className="text-indigo-600" />
            </div>
            <span className={`text-xs ${FIGURE} font-semibold text-slate-400`}>{stepNum}/{TOTAL_STEPS}</span>
          </div>
          <div className="mb-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-bold text-slate-900">{stepLabel}</span>
              <span className="text-xs text-slate-400 font-mono tabular-nums">{progressPct}%</span>
            </div>
            <div
              className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden"
              role="progressbar"
              aria-valuenow={stepNum}
              aria-valuemin={1}
              aria-valuemax={TOTAL_STEPS}
              aria-label={`Journey progress: step ${stepNum} of ${TOTAL_STEPS}`}
            >
              <div
                className="h-full bg-gradient-to-r from-[#0B5FD1] to-[#4DA3FF] rounded-full transition-all duration-500"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
          <p className="text-xs font-medium text-slate-500">Journey Progress</p>
          {nextStepLabel && (
            <p className="text-[11px] text-slate-400 mt-0.5">
              Next: <span className="font-medium text-slate-600">{nextStepLabel}</span>
            </p>
          )}
        </div>

        {/* Card 3: Active Auction / Deal / Shortlist — stage-dependent */}
        {latestAuction && latestAuction.status === "ACTIVE" ? (
          <div className={`${CARD} p-5`} data-testid="kpi-active-auction">
            <div className="flex items-start justify-between mb-4">
              <div className="w-9 h-9 rounded-xl bg-emerald-50 flex items-center justify-center">
                <Gavel size={16} className="text-emerald-600" />
              </div>
            </div>
            <div className="flex items-baseline gap-2">
              <p className={`text-[1.65rem] leading-none ${FIGURE}`}>{latestAuction._count.offers}</p>
              <span className="relative flex h-2 w-2 self-center">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
              </span>
            </div>
            <p className="text-xs font-medium text-slate-500 mt-2">
              Active Auction · {latestAuction._count.offers === 1 ? "offer received" : "offers received"}
            </p>
            <div className="mt-4 flex items-center gap-1.5 pt-3 border-t border-slate-100">
              <span className="text-xs font-medium text-emerald-600">Live now</span>
              {latestAuction.endsAt && (
                <span className="text-xs text-slate-400 ml-auto">
                  Ends {new Date(latestAuction.endsAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </span>
              )}
            </div>
          </div>
        ) : activeDeal ? (
          <div className={`${CARD} p-5`} data-testid="kpi-deal-status">
            <div className="flex items-start justify-between mb-4">
              <div className="w-9 h-9 rounded-xl bg-[#EFF6FF] flex items-center justify-center">
                <FileText size={16} className="text-[#0B5FD1]" />
              </div>
            </div>
            <p className="text-lg font-bold text-slate-900">
              {activeDeal.status.replace(/_/g, " ")}
            </p>
            <p className="text-xs font-medium text-slate-500 mt-2">Deal Status</p>
            <Link
              href="/buyer/deal"
              className="inline-flex items-center gap-1 mt-3 text-xs font-semibold text-[#0B5FD1] hover:text-[#0A4DB8]"
            >
              View deal details <ArrowRight size={12} />
            </Link>
          </div>
        ) : purchaseComplete ? (
          <div className={`${CARD} p-5`} data-testid="kpi-deal-complete">
            <div className="flex items-start justify-between mb-4">
              <div className="w-9 h-9 rounded-xl bg-emerald-50 flex items-center justify-center">
                <CheckCircle2 size={16} className="text-emerald-600" />
              </div>
            </div>
            <p className="text-lg font-bold text-emerald-600">All done 🎉</p>
            <p className="text-xs font-medium text-slate-500 mt-2">Purchase Complete</p>
            <Link
              href="/buyer/deal"
              className="inline-flex items-center gap-1 mt-3 text-xs font-semibold text-[#0B5FD1] hover:text-[#0A4DB8]"
            >
              View deal summary <ArrowRight size={12} />
            </Link>
          </div>
        ) : prequalApproved ? (
          <div className={`${CARD} p-5`} data-testid="kpi-shortlist">
            <div className="flex items-start justify-between mb-4">
              <div className="w-9 h-9 rounded-xl bg-rose-50 flex items-center justify-center">
                <Heart size={16} className="text-rose-500" />
              </div>
            </div>
            <p className={`text-[1.65rem] leading-none ${FIGURE}`}>{shortlistCount}</p>
            <p className="text-xs font-medium text-slate-500 mt-2">
              My Shortlist · {shortlistCount === 1 ? "vehicle saved" : "vehicles saved"}
              {shortlistCount < 5 && ` · up to 5 total`}
            </p>
            <Link
              href="/buyer/search"
              className="inline-flex items-center gap-1 mt-3 text-xs font-semibold text-[#0B5FD1] hover:text-[#0A4DB8]"
            >
              Browse inventory <ArrowRight size={12} />
            </Link>
          </div>
        ) : (
          <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-5 flex items-center justify-center">
            <p className="text-sm text-slate-400 text-center">
              Complete pre-qualification to unlock your full dashboard
            </p>
          </div>
        )}
      </div>

      {/* ── Two-Column: Next Step + Quick Actions ────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 mb-6">

        {/* Left: Primary Action Card (3 of 5 columns) */}
        <div className={`lg:col-span-3 ${CARD} p-6`} data-testid="dashboard-next-step">
          <p className={`${EYEBROW} mb-4`}>Recommended Next Step</p>

          {/* A: Not onboarded */}
          {!onboardingComplete && (
            <div>
              <h2 className="text-lg font-bold text-slate-900 mb-2">Complete your buyer profile</h2>
              <p className="text-sm text-slate-600 leading-relaxed mb-5">
                Takes about 3 minutes. We&apos;ll personalize your search and buying experience.
              </p>
              <Link href="/buyer/onboarding"
                className="inline-flex items-center gap-2 px-6 py-3 bg-[#0B5FD1] text-white font-semibold text-sm rounded-xl hover:bg-[#0A4DB8] transition-colors"
                data-testid="next-step-onboarding">
                Complete onboarding <ArrowRight size={15} />
              </Link>
            </div>
          )}

          {/* B: Onboarded, no prequal */}
          {onboardingComplete && !prequalApproved && (
            <div>
              <h2 className="text-lg font-bold text-slate-900 mb-2">Check your buying power</h2>
              <p className="text-sm text-slate-600 leading-relaxed mb-4">
                A soft pull only — zero impact on your credit score. You&apos;ll see your exact pre-approved budget in 3 minutes.
              </p>
              <div className="flex items-center gap-3 text-xs text-slate-500 mb-5">
                <span className="flex items-center gap-1"><CheckCircle2 size={13} className="text-emerald-500" /> Soft pull only</span>
                <span className="flex items-center gap-1"><CheckCircle2 size={13} className="text-emerald-500" /> 3 minutes</span>
                <span className="flex items-center gap-1"><CheckCircle2 size={13} className="text-emerald-500" /> No commitment</span>
              </div>
              <Link href="/buyer/prequal"
                className="inline-flex items-center gap-2 px-6 py-3 bg-[#0B5FD1] text-white font-semibold text-sm rounded-xl hover:bg-[#0A4DB8] transition-colors"
                data-testid="next-step-prequal">
                Get pre-qualified <ArrowRight size={15} />
              </Link>
            </div>
          )}

          {/* C: Pre-qual done, build shortlist */}
          {prequalApproved && shortlistCount === 0 && !latestAuction && (
            <div>
              <h2 className="text-lg font-bold text-slate-900 mb-2">Search and shortlist vehicles</h2>
              <p className="text-sm text-slate-600 leading-relaxed mb-4">
                Browse vehicles within your ${((prequal?.maxOtdAmountCents ?? 0) / 100).toLocaleString()} approved budget. Save up to 5 to your shortlist.
              </p>
              <Link href="/buyer/search"
                className="inline-flex items-center gap-2 px-6 py-3 bg-[#0B5FD1] text-white font-semibold text-sm rounded-xl hover:bg-[#0A4DB8] transition-colors"
                data-testid="next-step-search">
                Search vehicles <ArrowRight size={15} />
              </Link>
            </div>
          )}

          {/* D: Shortlist has vehicles, no deposit */}
          {prequalApproved && shortlistCount > 0 && !latestAuction && depositStatus !== "PAID" && (
            <div>
              <h2 className="text-lg font-bold text-slate-900 mb-2">Activate your auction</h2>
              <p className="text-sm text-slate-600 leading-relaxed mb-4">
                You have {shortlistCount} vehicle{shortlistCount !== 1 ? "s" : ""} shortlisted. Pay the ${DEPOSIT_AMOUNT_CENTS / 100} Limited-Time Auction Access Fee to launch your private 48-hour dealer competition.
              </p>
              <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 mb-5">
                <span className="flex items-center gap-1"><CheckCircle2 size={13} className="text-emerald-500" /> Refundable if no valuable offer</span>
                <span className="flex items-center gap-1"><CheckCircle2 size={13} className="text-emerald-500" /> Up to 8 dealers compete</span>
                <span className="flex items-center gap-1"><CheckCircle2 size={13} className="text-emerald-500" /> 48-hour window</span>
              </div>
              <Link href="/buyer/deposit"
                className="inline-flex items-center gap-2 px-6 py-3 bg-[#0B5FD1] text-white font-semibold text-sm rounded-xl hover:bg-[#0A4DB8] transition-colors"
                data-testid="next-step-deposit">
                Pay ${DEPOSIT_AMOUNT_CENTS / 100} Auction Access Fee <ArrowRight size={15} />
              </Link>
            </div>
          )}

          {/* E: Active auction */}
          {latestAuction && latestAuction.status === "ACTIVE" && (
            <div>
              <h2 className="text-lg font-bold text-slate-900 mb-2">Your auction is live</h2>
              <p className="text-sm text-slate-600 leading-relaxed mb-4">
                {latestAuction._count.offers === 0
                  ? "Dealers are reviewing your request. Check back soon for offers."
                  : `You have ${latestAuction._count.offers} offer${latestAuction._count.offers !== 1 ? "s" : ""} waiting. Review and compare them now.`}
              </p>
              <Link href="/buyer/auctions"
                className="inline-flex items-center gap-2 px-6 py-3 bg-[#0B5FD1] text-white font-semibold text-sm rounded-xl hover:bg-[#0A4DB8] transition-colors"
                data-testid="next-step-auction">
                {latestAuction._count.offers > 0 ? "Review offers" : "View auction"} <ArrowRight size={15} />
              </Link>
            </div>
          )}

          {/* F: Deal in progress — active (non-terminal) deals only */}
          {activeDeal && (
            <div>
              <h2 className="text-lg font-bold text-slate-900 mb-2">Continue your deal</h2>
              <p className="text-sm text-slate-600 leading-relaxed mb-4">
                Your deal is in progress. Current stage: <strong>{activeDeal.status.replace(/_/g, " ")}</strong>
              </p>
              <Link href="/buyer/deal"
                className="inline-flex items-center gap-2 px-6 py-3 bg-[#0B5FD1] text-white font-semibold text-sm rounded-xl hover:bg-[#0A4DB8] transition-colors"
                data-testid="next-step-deal">
                Continue deal <ArrowRight size={15} />
              </Link>
            </div>
          )}

          {/* G: Purchase complete — terminal celebratory state */}
          {!activeDeal && purchaseComplete && (
            <div>
              <h2 className="text-lg font-bold text-slate-900 mb-2">Your purchase is complete 🎉</h2>
              <p className="text-sm text-slate-600 leading-relaxed mb-4">
                Congratulations on your new vehicle. You can review your final paperwork and receipt anytime.
              </p>
              <Link href="/buyer/deal"
                className="inline-flex items-center gap-2 px-6 py-3 bg-[#0B5FD1] text-white font-semibold text-sm rounded-xl hover:bg-[#0A4DB8] transition-colors"
                data-testid="next-step-complete">
                View deal summary <ArrowRight size={15} />
              </Link>
            </div>
          )}
        </div>

        {/* Right: Quick Actions (2 of 5 columns) */}
        <div className={`lg:col-span-2 ${CARD} p-6`} data-testid="dashboard-quick-actions">
          <p className={`${EYEBROW} mb-4`}>Quick Actions</p>
          <div className="space-y-1">
            {quickActions.map(action => (
              <Link
                key={action.href}
                href={action.href}
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-slate-700 hover:bg-slate-50 hover:text-[#0B5FD1] transition-colors group"
                data-testid={`qa-${action.label.toLowerCase().replace(/\s+/g, "-")}`}
              >
                <span className="w-7 h-7 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-center group-hover:bg-[#EFF6FF] group-hover:border-[#DBEAFE] transition-colors">
                  <action.icon size={14} className="text-slate-500 group-hover:text-[#0B5FD1] transition-colors" />
                </span>
                <span className="flex-1 font-medium">{action.label}</span>
                <ArrowRight size={13} className="text-slate-300 group-hover:text-[#0B5FD1] group-hover:translate-x-0.5 transition-all" />
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* ── Plan + Process ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* PlanUpgradeCard — keep existing component */}
        <div data-testid="dashboard-plan-section">
          <PlanUpgradeCard
            plan={buyerPlan}
            depositStatus={depositStatus}
            planUpgradedAt={buyer.planUpgradedAt?.toISOString() ?? null}
          />
        </div>

        {/* How It Works — dark premium card */}
        <div
          className="bg-slate-900 rounded-2xl p-6 text-white flex flex-col justify-between"
          data-testid="dashboard-how-it-works"
        >
          <div>
            <p className="text-[11px] font-semibold text-white/50 uppercase tracking-[0.14em] mb-4">
              The AutoLenis Process
            </p>
            <div className="space-y-3">
              {[
                { num: "01", label: "Pre-Qualification", sub: "Soft pull, 3 minutes" },
                { num: "02", label: "Shortlist Vehicles", sub: "Up to 5 vehicles" },
                { num: "03", label: "Launch Auction", sub: "8 dealers compete in 48hrs" },
                { num: "04", label: "Select Best Deal", sub: "Compare total cost" },
                { num: "05", label: "Sign & Pick Up", sub: "Remote or in-person" },
              ].map(step => (
                <div key={step.num} className="flex items-center gap-3">
                  <span className="text-xs font-bold font-mono text-white/30 w-6 shrink-0">{step.num}</span>
                  <div>
                    <span className="text-sm font-semibold text-white">{step.label}</span>
                    <span className="text-xs text-white/50 ml-2">{step.sub}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <Link
            href="/how-it-works"
            className="inline-flex items-center gap-1.5 mt-6 text-xs font-semibold text-white/60 hover:text-white transition-colors"
            data-testid="dashboard-how-it-works-link"
          >
            Full process guide <ArrowRight size={13} />
          </Link>
        </div>
      </div>
    </PageContainer>
  );
}

function getTimeOfDay() {
  const h = new Date().getHours();
  if (h < 12) return "morning";
  if (h < 17) return "afternoon";
  return "evening";
}

function formatHoursRemaining(hoursLeft: number): string {
  if (hoursLeft < 1) return "less than 1 hour";
  return `${hoursLeft} hour${hoursLeft === 1 ? "" : "s"}`;
}
