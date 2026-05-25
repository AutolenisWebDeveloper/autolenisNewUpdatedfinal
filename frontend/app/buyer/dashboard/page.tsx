import type { Metadata } from "next";
import { requireBuyer } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import PlanUpgradeCard, { type DepositStatus } from "@/components/buyer/PlanUpgradeCard";
import ProactiveNudgesPanel, { type BuyerNudge } from "@/components/buyer/ProactiveNudgesPanel";
import { DEPOSIT_AMOUNT_CENTS } from "@/lib/constants";
import { MapPin } from "lucide-react";

export const metadata: Metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

export default async function BuyerDashboard() {
  const buyer = await requireBuyer();
  const prequal = buyer?.preQualification ?? null;
  const firstName = buyer?.firstName ?? "there";
  const prequalApproved =
    !!prequal && prequal.decision === "APPROVED" && prequal.expiresAt > new Date();

  // ── Deposit status ────────────────────────────────────────────────────────
  let depositStatus: DepositStatus = "NOT_PAID";
  try {
    const latestDeposit = await prisma.deposit.findFirst({
      where: { buyerId: buyer.id },
      orderBy: { createdAt: "desc" },
      select: { status: true },
    });
    depositStatus =
      latestDeposit?.status === "PAID" ? "PAID" :
      latestDeposit?.status === "PENDING" ? "PENDING" : "NOT_PAID";
  } catch {
    depositStatus = "NOT_PAID";
  }

  // ── Feature 11 KPI data — shortlist count ────────────────────────────────
  let shortlistCount = 0;
  if (prequalApproved) {
    try {
      const shortlist = await prisma.shortlist.findUnique({
        where: { buyerId: buyer.id },
        select: { _count: { select: { items: true } } },
      });
      shortlistCount = shortlist?._count.items ?? 0;
    } catch { /* non-fatal */ }
  }

  // ── Feature 11 KPI data — active auction ─────────────────────────────────
  let activeAuction: { id: string; status: string; endsAt: Date | null; _count: { offers: number } } | null = null;
  try {
    activeAuction = await prisma.auction.findFirst({
      where: { buyerId: buyer.id, status: { in: ["ACTIVE", "PENDING"] } },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true, endsAt: true, _count: { select: { offers: { where: { status: "SUBMITTED" } } } } },
    });
  } catch { /* non-fatal */ }

  // ── Feature 11 KPI data — active deal ────────────────────────────────────
  let activeDeal: { id: string; status: string } | null = null;
  try {
    activeDeal = await prisma.deal.findFirst({
      where: { buyerId: buyer.id, status: { notIn: ["COMPLETED", "CANCELLED", "REFUNDED"] } },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true },
    });
  } catch { /* non-fatal */ }

  // ── Latest auction (for KPI / next-step display) ──────────────────────────
  let latestAuction: { id: string; status: string; endsAt: Date | null; _count: { offers: number } } | null = null;
  try {
    latestAuction = await prisma.auction.findFirst({
      where: { buyerId: buyer.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true, endsAt: true, _count: { select: { offers: true } } },
    });
  } catch { /* non-fatal */ }

  // ── Latest deal (for KPI / next-step display) ────────────────────────────
  let latestDeal: { id: string; status: string } | null = null;
  try {
    latestDeal = await prisma.deal.findFirst({
      where: { buyerId: buyer.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true },
    });
  } catch { /* non-fatal */ }

  // ── Unread notification count ─────────────────────────────────────────────
  let unreadCount = 0;
  try {
    unreadCount = await prisma.notification.count({
      where: { buyerId: buyer.id, readAt: null },
    });
  } catch { /* non-fatal */ }

  // ── Active dealer count (for no-dealer-in-area banner) ───────────────────
  let activeDealerCount = 0;
  try {
    activeDealerCount = await prisma.dealer.count({ where: { status: "ACTIVE" } });
  } catch { /* non-fatal */ }

  // If prequal is approved, onboarding is implicitly complete
  const onboardingComplete = buyer.onboardingComplete === true || prequalApproved;

  // Determine current step label for header (journey: 1=account, 2=onboarding,
  // 3=prequal, 4=search, 5=shortlist, 6=deposit, 7=auction, 8=deal-active)
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
    stepNum = 8;
    stepLabel = "Deal Active";
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

  return (
    <div className="p-6 md:p-8 max-w-5xl" data-testid="buyer-dashboard">

      {/* Feature 16 — Proactive Nudges (only shows real state-driven nudges) */}
      {nudges.length > 0 && (
        <ProactiveNudgesPanel nudges={nudges} />
      )}

      {/* No dealers in area banner — shown when prequal approved but no active dealers */}
      {prequalApproved && activeDealerCount === 0 && !activeAuction && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 mb-4" data-testid="no-dealer-banner">
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
              <a
                href="/buyer/requests/new"
                className="inline-flex items-center gap-2 bg-[#0B5FD1] text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-[#0944a8] transition-colors"
              >
                Submit a Vehicle Request →
              </a>
            </div>
          </div>
        </div>
      )}

      {/* ── Greeting Header ─────────────────────────────────────────────── */}
      <div className="mb-8 flex items-start justify-between flex-wrap gap-4">
        <div>
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <span
              className="text-xs font-semibold text-[#0B5FD1] bg-[#EFF6FF] border border-[#DBEAFE] px-3 py-1 rounded-full"
              data-testid="dashboard-step-label"
            >
              Step {stepNum} of 14 — {stepLabel}
            </span>
            {unreadCount > 0 && (
              <a
                href="/buyer/notifications"
                className="text-xs font-semibold text-white bg-[#EF4444] px-2.5 py-1 rounded-full hover:bg-red-600 transition-colors"
                data-testid="dashboard-unread-badge"
              >
                {unreadCount} new {unreadCount === 1 ? "notification" : "notifications"}
              </a>
            )}
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-[#111827] tracking-tight">
            Good {getTimeOfDay()}, {firstName}
          </h1>
          <p className="text-[#6B7280] text-sm mt-1">
            {nextStepLabel
              ? `Your next step: ${nextStepLabel}`
              : "You're on track — here's your full picture."}
          </p>
        </div>
      </div>

      {/* ── KPI Row ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">

        {/* Card 1: Buying Power / Prequal CTA */}
        {prequalApproved && prequal ? (
          <div
            className="bg-white border border-[#E5E7EB] rounded-2xl p-6 shadow-sm"
            data-testid="kpi-buying-power"
          >
            <p className="text-xs font-semibold text-[#6B7280] uppercase tracking-wider mb-3">
              Buying Power
            </p>
            <p className="text-3xl font-bold text-[#111827] tracking-tight">
              ${((prequal.maxOtdAmountCents ?? 0) / 100).toLocaleString()}
            </p>
            <p className="text-xs text-[#6B7280] mt-1">
              Pre-approved max OTD budget
            </p>
            <div className="mt-4 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[#10B981]" />
              <span className="text-xs font-medium text-[#10B981]">Active approval</span>
              {prequal.expiresAt && (
                <span className="text-xs text-[#9CA3AF] ml-auto">
                  Expires {new Date(prequal.expiresAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </span>
              )}
            </div>
          </div>
        ) : (
          <div
            className="bg-[#EFF6FF] border border-[#DBEAFE] rounded-2xl p-6"
            data-testid="kpi-prequal-cta"
          >
            <p className="text-xs font-semibold text-[#0B5FD1] uppercase tracking-wider mb-3">
              Buying Power
            </p>
            <p className="text-xl font-bold text-[#111827] mb-1">Get pre-qualified</p>
            <p className="text-sm text-[#4B5563] mb-4">
              Soft pull only · 3 minutes · No credit impact
            </p>
            <a
              href="/buyer/prequal"
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#0B5FD1] hover:text-[#0A4DB8] transition-colors"
              data-testid="kpi-start-prequal"
            >
              Check my buying power →
            </a>
          </div>
        )}

        {/* Card 2: Journey Progress */}
        <div
          className="bg-white border border-[#E5E7EB] rounded-2xl p-6 shadow-sm"
          data-testid="kpi-journey-stage"
        >
          <p className="text-xs font-semibold text-[#6B7280] uppercase tracking-wider mb-3">
            Journey Progress
          </p>
          <div className="mb-3">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-sm font-bold text-[#111827]">{stepLabel}</span>
              <span className="text-xs text-[#6B7280]">{stepNum}/14</span>
            </div>
            <div className="w-full h-1.5 bg-[#E5E7EB] rounded-full overflow-hidden">
              <div
                className="h-full bg-[#0B5FD1] rounded-full transition-all duration-500"
                style={{ width: `${Math.round((stepNum / 14) * 100)}%` }}
              />
            </div>
          </div>
          {nextStepLabel && (
            <p className="text-xs text-[#6B7280]">
              Next: <span className="font-medium text-[#374151]">{nextStepLabel}</span>
            </p>
          )}
        </div>

        {/* Card 3: Active Auction / Deal / Shortlist — stage-dependent */}
        {latestAuction && latestAuction.status === "ACTIVE" ? (
          <div
            className="bg-white border border-[#E5E7EB] rounded-2xl p-6 shadow-sm"
            data-testid="kpi-active-auction"
          >
            <p className="text-xs font-semibold text-[#6B7280] uppercase tracking-wider mb-3">
              Active Auction
            </p>
            <p className="text-3xl font-bold text-[#111827]">
              {latestAuction._count.offers}
            </p>
            <p className="text-xs text-[#6B7280] mt-1">
              {latestAuction._count.offers === 1 ? "offer received" : "offers received"}
            </p>
            <div className="mt-4 flex items-center gap-1.5">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#10B981] opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-[#10B981]" />
              </span>
              <span className="text-xs font-medium text-[#10B981]">Live now</span>
              {latestAuction.endsAt && (
                <span className="text-xs text-[#9CA3AF] ml-auto">
                  Ends {new Date(latestAuction.endsAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </span>
              )}
            </div>
          </div>
        ) : latestDeal ? (
          <div
            className="bg-white border border-[#E5E7EB] rounded-2xl p-6 shadow-sm"
            data-testid="kpi-deal-status"
          >
            <p className="text-xs font-semibold text-[#6B7280] uppercase tracking-wider mb-3">
              Deal Status
            </p>
            <p className="text-lg font-bold text-[#111827]">
              {latestDeal.status.replace(/_/g, " ")}
            </p>
            <a
              href="/buyer/deal"
              className="inline-flex items-center gap-1 mt-3 text-xs font-semibold text-[#0B5FD1] hover:text-[#0A4DB8]"
            >
              View deal details →
            </a>
          </div>
        ) : prequalApproved ? (
          <div
            className="bg-white border border-[#E5E7EB] rounded-2xl p-6 shadow-sm"
            data-testid="kpi-shortlist"
          >
            <p className="text-xs font-semibold text-[#6B7280] uppercase tracking-wider mb-3">
              My Shortlist
            </p>
            <p className="text-3xl font-bold text-[#111827]">{shortlistCount}</p>
            <p className="text-xs text-[#6B7280] mt-1">
              {shortlistCount === 1 ? "vehicle saved" : "vehicles saved"}
              {shortlistCount < 5 && ` · up to 5 total`}
            </p>
            <a
              href="/buyer/search"
              className="inline-flex items-center gap-1 mt-3 text-xs font-semibold text-[#0B5FD1] hover:text-[#0A4DB8]"
            >
              Browse inventory →
            </a>
          </div>
        ) : (
          <div className="bg-[#F8F9FB] border border-[#E5E7EB] rounded-2xl p-6 flex items-center justify-center">
            <p className="text-sm text-[#9CA3AF] text-center">
              Complete pre-qualification to unlock your full dashboard
            </p>
          </div>
        )}
      </div>

      {/* ── Two-Column: Next Step + Quick Actions ────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 mb-6">

        {/* Left: Primary Action Card (3 of 5 columns) */}
        <div className="lg:col-span-3 bg-white border border-[#E5E7EB] rounded-2xl p-6 shadow-sm" data-testid="dashboard-next-step">
          <p className="text-xs font-semibold text-[#6B7280] uppercase tracking-wider mb-4">
            Recommended Next Step
          </p>

          {/* A: Not onboarded */}
          {!onboardingComplete && (
            <div>
              <h2 className="text-lg font-bold text-[#111827] mb-2">Complete your buyer profile</h2>
              <p className="text-sm text-[#4B5563] leading-relaxed mb-5">
                Takes about 3 minutes. We&apos;ll personalize your search and buying experience.
              </p>
              <a href="/buyer/onboarding"
                className="inline-flex items-center gap-2 px-6 py-3 bg-[#0B5FD1] text-white font-semibold text-sm rounded-xl hover:bg-[#0A4DB8] transition-colors"
                data-testid="next-step-onboarding">
                Complete onboarding →
              </a>
            </div>
          )}

          {/* B: Onboarded, no prequal */}
          {onboardingComplete && !prequalApproved && (
            <div>
              <h2 className="text-lg font-bold text-[#111827] mb-2">Check your buying power</h2>
              <p className="text-sm text-[#4B5563] leading-relaxed mb-4">
                A soft pull only — zero impact on your credit score. You&apos;ll see your exact pre-approved budget in 3 minutes.
              </p>
              <div className="flex items-center gap-3 text-xs text-[#6B7280] mb-5">
                <span className="flex items-center gap-1">✓ Soft pull only</span>
                <span className="flex items-center gap-1">✓ 3 minutes</span>
                <span className="flex items-center gap-1">✓ No commitment</span>
              </div>
              <a href="/buyer/prequal"
                className="inline-flex items-center gap-2 px-6 py-3 bg-[#0B5FD1] text-white font-semibold text-sm rounded-xl hover:bg-[#0A4DB8] transition-colors"
                data-testid="next-step-prequal">
                Get pre-qualified →
              </a>
            </div>
          )}

          {/* C: Pre-qual done, build shortlist */}
          {prequalApproved && shortlistCount === 0 && !latestAuction && (
            <div>
              <h2 className="text-lg font-bold text-[#111827] mb-2">Search and shortlist vehicles</h2>
              <p className="text-sm text-[#4B5563] leading-relaxed mb-4">
                Browse vehicles within your ${((prequal?.maxOtdAmountCents ?? 0) / 100).toLocaleString()} approved budget. Save up to 5 to your shortlist.
              </p>
              <a href="/buyer/search"
                className="inline-flex items-center gap-2 px-6 py-3 bg-[#0B5FD1] text-white font-semibold text-sm rounded-xl hover:bg-[#0A4DB8] transition-colors"
                data-testid="next-step-search">
                Search vehicles →
              </a>
            </div>
          )}

          {/* D: Shortlist has vehicles, no deposit */}
          {prequalApproved && shortlistCount > 0 && !latestAuction && depositStatus !== "PAID" && (
            <div>
              <h2 className="text-lg font-bold text-[#111827] mb-2">Activate your auction</h2>
              <p className="text-sm text-[#4B5563] leading-relaxed mb-4">
                You have {shortlistCount} vehicle{shortlistCount !== 1 ? "s" : ""} shortlisted. Pay the ${DEPOSIT_AMOUNT_CENTS / 100} Limited-Time Auction Access Fee to launch your private 48-hour dealer competition.
              </p>
              <div className="flex items-center gap-3 text-xs text-[#6B7280] mb-5">
                <span>✓ Refundable if no valuable offer</span>
                <span>✓ Up to 8 dealers compete</span>
                <span>✓ 48-hour window</span>
              </div>
              <a href="/buyer/deposit"
                className="inline-flex items-center gap-2 px-6 py-3 bg-[#0B5FD1] text-white font-semibold text-sm rounded-xl hover:bg-[#0A4DB8] transition-colors"
                data-testid="next-step-deposit">
                Pay ${DEPOSIT_AMOUNT_CENTS / 100} Auction Access Fee →
              </a>
            </div>
          )}

          {/* E: Active auction */}
          {latestAuction && latestAuction.status === "ACTIVE" && (
            <div>
              <h2 className="text-lg font-bold text-[#111827] mb-2">Your auction is live</h2>
              <p className="text-sm text-[#4B5563] leading-relaxed mb-4">
                {latestAuction._count.offers === 0
                  ? "Dealers are reviewing your request. Check back soon for offers."
                  : `You have ${latestAuction._count.offers} offer${latestAuction._count.offers !== 1 ? "s" : ""} waiting. Review and compare them now.`}
              </p>
              <a href="/buyer/auctions"
                className="inline-flex items-center gap-2 px-6 py-3 bg-[#0B5FD1] text-white font-semibold text-sm rounded-xl hover:bg-[#0A4DB8] transition-colors"
                data-testid="next-step-auction">
                {latestAuction._count.offers > 0 ? "Review offers →" : "View auction →"}
              </a>
            </div>
          )}

          {/* F: Deal in progress */}
          {latestDeal && (
            <div>
              <h2 className="text-lg font-bold text-[#111827] mb-2">Continue your deal</h2>
              <p className="text-sm text-[#4B5563] leading-relaxed mb-4">
                Your deal is in progress. Current stage: <strong>{latestDeal.status.replace(/_/g, " ")}</strong>
              </p>
              <a href="/buyer/deal"
                className="inline-flex items-center gap-2 px-6 py-3 bg-[#0B5FD1] text-white font-semibold text-sm rounded-xl hover:bg-[#0A4DB8] transition-colors"
                data-testid="next-step-deal">
                Continue deal →
              </a>
            </div>
          )}
        </div>

        {/* Right: Quick Actions (2 of 5 columns) */}
        <div className="lg:col-span-2 bg-white border border-[#E5E7EB] rounded-2xl p-6 shadow-sm" data-testid="dashboard-quick-actions">
          <p className="text-xs font-semibold text-[#6B7280] uppercase tracking-wider mb-4">
            Quick Actions
          </p>
          <div className="space-y-1">
            {[
              { label: "Check buying power", href: "/buyer/prequal", icon: "💳", show: true },
              { label: "Browse inventory", href: "/buyer/search", icon: "🔍", show: prequalApproved },
              { label: "My shortlist", href: "/buyer/shortlist", icon: "❤️", show: prequalApproved },
              { label: "Request a vehicle", href: "/buyer/requests/new", icon: "📋", show: true },
              { label: "View notifications", href: "/buyer/notifications", icon: "🔔", show: true },
              { label: "My messages", href: "/buyer/messages", icon: "💬", show: true },
            ].filter(a => a.show).slice(0, 5).map(action => (
              <a
                key={action.href}
                href={action.href}
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-[#374151] hover:bg-[#F8F9FB] hover:text-[#0B5FD1] transition-colors group"
                data-testid={`qa-${action.label.toLowerCase().replace(/\s+/g, "-")}`}
              >
                <span className="text-base">{action.icon}</span>
                <span className="flex-1 font-medium">{action.label}</span>
                <span className="text-[#D1D5DB] group-hover:text-[#0B5FD1] transition-colors">→</span>
              </a>
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
          className="bg-[#111827] rounded-2xl p-6 text-white flex flex-col justify-between"
          data-testid="dashboard-how-it-works"
        >
          <div>
            <p className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-3">
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
                  <span className="text-xs font-bold text-white/30 w-6 shrink-0">{step.num}</span>
                  <div>
                    <span className="text-sm font-semibold text-white">{step.label}</span>
                    <span className="text-xs text-white/50 ml-2">{step.sub}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <a
            href="/how-it-works"
            className="inline-flex items-center gap-1.5 mt-6 text-xs font-semibold text-white/60 hover:text-white transition-colors"
            data-testid="dashboard-how-it-works-link"
          >
            Full process guide →
          </a>
        </div>
      </div>
    </div>
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
