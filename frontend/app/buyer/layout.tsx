import type { Metadata } from "next";
// Private portal — noindex at the metadata layer as defense-in-depth with
// robots.txt (which disallows crawling these paths). robots.txt prevents
// crawling; this prevents indexing of any externally-linked URL.
export const metadata: Metadata = { robots: { index: false, follow: false } };
import BuyerSidebar from "@/components/buyer/BuyerSidebar";
import ExitPreviewButton from "@/components/buyer/ExitPreviewButton";
import JourneyNavigator from "@/components/buyer/JourneyNavigator";
import ChatWidget from "@/components/public/ChatWidget";
import SessionExpiryWatcher from "@/components/buyer/SessionExpiryWatcher";
import { requireBuyer } from "@/lib/auth/session";
import { isBuyerAccessDisabled } from "@/lib/auth/buyer-status";
import { prisma } from "@/lib/prisma";
import { isPrequalValid } from "@/lib/services/prequal/prequal.service";
import { computeJourney } from "@/lib/services/buyer/journey";
import { needsTermsAcceptance } from "@/lib/auth/terms";
import { jwtVerify } from "jose";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

function getPreviewSecret() {
  const raw =
    process.env.JWT_SECRET ??
    process.env.NEXTAUTH_SECRET ??
    process.env.APP_SECRET ?? "";
  return new TextEncoder().encode(raw);
}

export default async function BuyerLayout({ children }: { children: React.ReactNode }) {
  // ── Suspension notice: bypass the portal shell ─────────────────────────────
  // /buyer/suspended must render for a SUSPENDED buyer — that is its entire
  // purpose. But it lives under app/buyer/, so this layout wraps it, and
  // requireBuyer() below redirects a suspended buyer to /buyer/suspended: the
  // page redirects to itself forever and the notice can never appear. The page
  // author anticipated exactly this ("do NOT call requireBuyer() which would
  // redirect suspended buyers") and guarded the page — but a child cannot opt
  // out of its parent layout, so the guard was defeated from above.
  //
  // The page does its own authentication (getAuthenticatedBuyer, redirecting
  // unauthenticated visitors to sign-in and non-suspended buyers to the
  // dashboard) and renders a standalone full-screen notice, so returning it
  // bare is both safe and what its design intends. proxy.ts already exempts
  // this path from the edge suspension redirect for the same reason.
  const layoutPathname = (await headers()).get("x-pathname") ?? "";
  if (layoutPathname === "/buyer/suspended") {
    return <>{children}</>;
  }

  // ── Admin preview mode ─────────────────────────────────────────────────────
  // Check for a valid admin preview token cookie before normal buyer auth.
  // If present and valid: load buyer data by token's buyerId, render with banner.
  let isAdminPreview = false;
  let previewAdminEmail: string | null = null;
  let previewBuyerName: string | null = null;
  let previewBuyerId: string | null = null;

  try {
    const cookieStore = await cookies();
    const previewToken = cookieStore.get("admin_preview_token")?.value;

    if (previewToken) {
      const { payload } = await jwtVerify(previewToken, getPreviewSecret());
      const p = payload as {
        buyerId: string;
        adminId: string;
        adminEmail: string;
        stageRoute: string;
        buyerName: string;
      };
      if (p.buyerId) {
        isAdminPreview = true;
        previewBuyerId = p.buyerId;
        previewAdminEmail = p.adminEmail;
        previewBuyerName = p.buyerName;
      }
    }
  } catch {
    // Invalid or expired token — fall through to normal buyer auth
    isAdminPreview = false;
    previewBuyerId = null;
  }

  // ── Buyer auth ─────────────────────────────────────────────────────────────
  // In preview mode, skip normal session auth and load buyer by token's buyerId.
  // requireBuyer redirects to /auth/signin if not authenticated
  let buyer: Awaited<ReturnType<typeof requireBuyer>>;

  if (isAdminPreview && previewBuyerId) {
    const previewBuyer = await prisma.buyer.findUnique({
      where: { id: previewBuyerId },
      include: { user: true, preQualification: true },
    });
    if (!previewBuyer) {
      // Buyer not found — fall through to normal auth (will redirect to sign-in)
      buyer = await requireBuyer();
    } else {
      buyer = previewBuyer as Awaited<ReturnType<typeof requireBuyer>>;
    }
  } else {
    buyer = await requireBuyer();
  }

  // ── Disabled / purged account guard ────────────────────────────────────────
  // If an admin has disabled login access for this buyer, render a clear
  // account-status screen instead of the full portal.  This prevents confusion
  // where a disabled buyer sees an operational UI.
  if (!isAdminPreview && isBuyerAccessDisabled(buyer)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F8F9FA] p-8">
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm max-w-md w-full p-8 text-center">
          <h1 className="text-xl font-semibold text-slate-900 mb-2">Account Access Suspended</h1>
          <p className="text-sm text-slate-500 leading-relaxed">
            Your account access has been suspended. Please contact{" "}
            <a href="mailto:support@autolenis.com" className="text-al-primary hover:underline">
              support@autolenis.com
            </a>{" "}
            if you believe this is an error.
          </p>
        </div>
      </div>
    );
  }

  // ── Terms-acceptance gate (defense-in-depth) ───────────────────────────────
  // The Next.js 16 edge middleware (proxy.ts) also gates terms from
  // user_metadata at the edge; this is a server-side backstop that reads the
  // Prisma source of truth, so it still holds if the edge value is missing or
  // stale. The buyer layout only renders for /buyer/*, so no path check is
  // needed; /auth/accept-terms is outside this route group, so there is no
  // redirect loop. Mirrors requiresTermsAcceptance(): redirect when terms were
  // never accepted, or were accepted under an older version.
  if (!isAdminPreview && needsTermsAcceptance(buyer.termsAcceptedAt, buyer.termsVersion)) {
    redirect("/auth/accept-terms");
  }

  // Journey progression:
  //   Step 1 — ACCOUNT:    always complete after signup
  //   Step 2 — ONBOARDING: complete when buyer.onboardingComplete === true
  //   Step 3 — PRE-QUAL:   complete when prequal.decision === 'APPROVED' AND expiresAt > now
  //   Step 4 — SEARCH:     unlocked after prequal approved
  //   Step 5 — SHORTLIST:  unlocked after prequal approved
  //   Step 6 — DEPOSIT:    unlocked after shortlist has at least 1 vehicle
  //   Subsequent steps unlock progressively per deal state machine

  const prequal = buyer?.preQualification;
  const prequalApproved = isPrequalValid(prequal ?? null);

  // If prequal is approved, onboarding is implicitly complete — a buyer
  // cannot receive an approved prequal without having gone through the
  // onboarding flow. This guards against the DB flag being stale.
  const onboardingComplete = buyer?.onboardingComplete === true || prequalApproved;

  // ── Onboarding gate ───────────────────────────────────────────────────────
  // A buyer who hasn't completed onboarding can only see /buyer/dashboard
  // (which renders the onboarding CTA) and /buyer/onboarding itself.
  // Any other buyer route is bounced back so the wizard cannot be skipped.
  // Admin preview mode bypasses this so support can see what the buyer sees.
  if (!isAdminPreview && !onboardingComplete) {
    const reqHeaders = await headers();
    const pathname = reqHeaders.get("x-pathname") ?? "";
    const allowedWithoutOnboarding =
      pathname === "/buyer/dashboard" ||
      pathname === "/buyer/onboarding" ||
      pathname === "/buyer/suspended" ||
      pathname === "/buyer/profile" ||
      pathname.startsWith("/buyer/settings");
    if (pathname.startsWith("/buyer/") && !allowedWithoutOnboarding) {
      redirect("/buyer/onboarding");
    }
  }

  // Gather ALL journey facts unconditionally, exactly as
  // /api/buyer/journey-status does, so the two genuinely compute the same stage
  // from the same facts (M-3).
  //
  // These reads used to sit behind two nested short-circuits — the shortlist
  // count only when prequal was approved, and the deal/deposit/auction records
  // only when that count was > 0 — which broke the very invariant the comment
  // claimed. A buyer mid-deal whose prequal had EXPIRED, or whose shortlist
  // items were removed, produced deal = null here while the API still saw the
  // deal, so the layout silently regressed their stage. Now that the sidebar
  // gates on this stage, that regression would LOCK the entire Auction & Deal
  // nav for a buyer who is in the middle of a deal.
  let shortlistCount = 0;
  let activeDeal:
    | { status: string; financingPath: string | null; feePaidAt: Date | null; insuranceStatus: string; contractShieldStatus: string | null }
    | null = null;
  let depositPaid = false;
  let activeAuction = false;
  // When the facts cannot be read at all, the stage computed from zeros is not
  // "early journey" — it is UNKNOWN. Nav then fails OPEN (journey = null →
  // every item rendered as a link) rather than confidently locking a buyer out
  // of their own deal; each page still enforces its own access server-side.
  let journeyFactsKnown = true;
  try {
    const [shortlist, deal, deposit, auction] = await Promise.all([
      prisma.shortlist.findUnique({
        where: { buyerId: buyer.id },
        select: { _count: { select: { items: true } } },
      }),
      prisma.deal.findFirst({
        where: { buyerId: buyer.id },
        orderBy: { createdAt: "desc" },
        select: { status: true, financingPath: true, feePaidAt: true, insuranceStatus: true, contractShieldStatus: true },
      }),
      prisma.deposit.findFirst({ where: { buyerId: buyer.id, status: "PAID" }, select: { id: true } }),
      prisma.auction.findFirst({ where: { buyerId: buyer.id, status: "ACTIVE" }, select: { id: true } }),
    ]);
    shortlistCount = shortlist?._count.items ?? 0;
    activeDeal = deal;
    depositPaid = !!deposit;
    activeAuction = !!auction;
  } catch {
    journeyFactsKnown = false;
  }

  // ── Journey stage (shared machine) ────────────────────────────────────────
  // Admin SKIP/UNLOCK overrides are merged inside computeJourney.
  let adminOverrides: Array<{ stageId: string; type: "SKIP" | "UNLOCK" }> = [];
  try {
    adminOverrides = await prisma.adminJourneyUnlock.findMany({
      where: { buyerId: buyer.id },
      select: { stageId: true, type: true },
    });
  } catch {
    // Non-fatal: no overrides on DB error
  }

  const journey = computeJourney({
    onboardingComplete,
    prequalValid: prequalApproved,
    shortlistCount,
    depositPaid,
    activeAuction,
    deal: activeDeal
      ? {
          status: activeDeal.status,
          hasFinancingPath: !!activeDeal.financingPath,
          feePaid: !!activeDeal.feePaidAt,
          insuranceStatus: activeDeal.insuranceStatus,
          contractShieldPassed: activeDeal.contractShieldStatus === "PASS",
        }
      : null,
    overrides: adminOverrides,
  });
  const { currentStage, completedStages, unlockedStages } = journey;

  return (
    <div className="min-h-screen">
      {/* Admin preview banner — only shown in preview mode */}
      {isAdminPreview && (
        <div className="sticky top-0 z-50 bg-amber-500 text-white text-xs font-bold px-4 py-2 flex items-center justify-between gap-3">
          <span>
            👁 ADMIN PREVIEW MODE — Viewing as {previewBuyerName ?? "buyer"} ·
            This is what the buyer sees
          </span>
          <div className="flex items-center gap-3">
            <span className="opacity-75 hidden sm:inline">Previewed by {previewAdminEmail} · Token expires in 5 min</span>
            <ExitPreviewButton />
          </div>
        </div>
      )}
      <div className="flex flex-col lg:flex-row h-screen bg-[#F8F9FA]" data-testid="buyer-portal">
        {/* Journey-aware nav (lib/services/buyer/nav-gating): the sidebar renders
            items the buyer cannot reach yet as explained LOCKED entries instead
            of live links that silently redirect. */}
        <BuyerSidebar
          journey={journeyFactsKnown ? { currentStage, completedStages, unlockedStages } : null}
        />
        <div className="flex-1 flex flex-col overflow-hidden pt-14 lg:pt-0">
          {/* Feature 3: Journey Navigator — suppressed on /buyer/requests/* by component itself */}
          <JourneyNavigator
            currentStage={currentStage}
            completedStages={completedStages}
            unlockedStages={unlockedStages}
          />
          <main className="flex-1 overflow-y-auto">
            {children}
          </main>
          {/* System 16 ENH — AI Concierge (Groq ONLY, kill switch checked) */}
          <ChatWidget
            buyerId={buyer.id}
            agentType="general"
            initialGreeting={`Hi ${buyer.firstName}! I'm Zura, your AutoLenis concierge. How can I help you today?`}
          />
          <SessionExpiryWatcher />
        </div>
      </div>
    </div>
  );
}
