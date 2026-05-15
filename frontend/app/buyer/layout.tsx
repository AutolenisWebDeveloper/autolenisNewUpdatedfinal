import BuyerSidebar from "@/components/buyer/BuyerSidebar";
import JourneyNavigator from "@/components/buyer/JourneyNavigator";
import ChatWidget from "@/components/public/ChatWidget";
import SessionExpiryWatcher from "@/components/buyer/SessionExpiryWatcher";
import { requireBuyer } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";

export default async function BuyerLayout({ children }: { children: React.ReactNode }) {
  // requireBuyer redirects to /auth/signin if not authenticated
  const buyer = await requireBuyer();

  // ── Disabled / purged account guard ────────────────────────────────────────
  // If an admin has disabled login access for this buyer, render a clear
  // account-status screen instead of the full portal.  This prevents confusion
  // where a disabled buyer sees an operational UI.
  if (buyer.disabledAt || buyer.purgedAt) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F8F9FA] p-8">
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm max-w-md w-full p-8 text-center">
          <h1 className="text-xl font-semibold text-slate-900 mb-2">Account Access Suspended</h1>
          <p className="text-sm text-slate-500 leading-relaxed">
            Your account access has been suspended. Please contact{" "}
            <a href="mailto:support@autolenis.com" className="text-[#0B5FD1] hover:underline">
              support@autolenis.com
            </a>{" "}
            if you believe this is an error.
          </p>
        </div>
      </div>
    );
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
  const prequalApproved =
    !!prequal &&
    prequal.decision === "APPROVED" &&
    prequal.expiresAt > new Date();

  // If prequal is approved, onboarding is implicitly complete — a buyer
  // cannot receive an approved prequal without having gone through the
  // onboarding flow. This guards against the DB flag being stale.
  const onboardingComplete = buyer?.onboardingComplete === true || prequalApproved;

  // Fetch shortlist item count — only needed when prequal is approved
  let shortlistCount = 0;
  if (prequalApproved) {
    try {
      const shortlist = await prisma.shortlist.findUnique({
        where: { buyerId: buyer.id },
        select: { _count: { select: { items: true } } },
      });
      shortlistCount = shortlist?._count.items ?? 0;
    } catch {
      // Non-fatal: fall back to 0 so journey stage degrades gracefully
      shortlistCount = 0;
    }
  }

  // Fetch active deal for later-stage progression
  let activeDeal: { status: string } | null = null;
  if (shortlistCount > 0) {
    try {
      activeDeal = await prisma.deal.findFirst({
        where: { buyerId: buyer.id },
        orderBy: { createdAt: "desc" },
        select: { status: true },
      });
    } catch {
      // Non-fatal: treat as no active deal
      activeDeal = null;
    }
  }

  // Build completed stages and current stage
  const completedStages: string[] = ["account"];
  let currentStage: string;

  if (!onboardingComplete) {
    currentStage = "onboarding";
  } else if (!prequalApproved) {
    completedStages.push("onboarding");
    currentStage = "prequal";
  } else if (shortlistCount === 0) {
    completedStages.push("onboarding", "prequal");
    currentStage = "search";
  } else if (!activeDeal) {
    completedStages.push("onboarding", "prequal", "search");
    currentStage = "shortlist";
  } else {
    // Map deal status to journey stage
    completedStages.push("onboarding", "prequal", "search", "shortlist");
    const s = activeDeal.status;
    if (s === "PENDING" || s === "ACTIVE") {
      currentStage = "deposit";
    } else if (s === "FINANCING_PENDING") {
      completedStages.push("deposit", "auction", "select-deal");
      currentStage = "financing";
    } else if (s === "FEE_PENDING" || s === "FEE_PAID") {
      completedStages.push("deposit", "auction", "select-deal", "financing");
      currentStage = "fee";
    } else if (s === "INSURANCE_PENDING") {
      completedStages.push("deposit", "auction", "select-deal", "financing", "fee");
      currentStage = "insurance";
    } else if (s === "CONTRACT_PENDING" || s === "CONTRACT_REVIEW" || s === "CONTRACT_APPROVED") {
      completedStages.push("deposit", "auction", "select-deal", "financing", "fee", "insurance");
      currentStage = "contract";
    } else if (s === "SIGNING_PENDING" || s === "SIGNED") {
      completedStages.push("deposit", "auction", "select-deal", "financing", "fee", "insurance", "contract");
      currentStage = "sign";
    } else if (s === "PICKUP_SCHEDULED" || s === "PICKUP_COMPLETE" || s === "COMPLETED") {
      completedStages.push("deposit", "auction", "select-deal", "financing", "fee", "insurance", "contract", "sign");
      currentStage = "pickup";
    } else {
      currentStage = "deposit";
    }
  }

  // ── Admin journey unlocks ─────────────────────────────────────────────────
  // SKIP overrides count as organically complete — buyer proceeds past this stage.
  // UNLOCK overrides grant access but the buyer still needs to complete the step.
  const unlockedStages: string[] = [];
  try {
    const adminOverrides = await prisma.adminJourneyUnlock.findMany({
      where: { buyerId: buyer.id },
      select: { stageId: true, type: true },
    });
    for (const override of adminOverrides) {
      if (override.type === "SKIP") {
        if (!completedStages.includes(override.stageId)) {
          completedStages.push(override.stageId);
        }
      } else if (override.type === "UNLOCK") {
        unlockedStages.push(override.stageId);
      }
    }
  } catch {
    // Non-fatal: unlockedStages remains [] on DB error
  }

  return (
    <div className="flex flex-col lg:flex-row h-screen bg-[#F8F9FA]" data-testid="buyer-portal">
      <BuyerSidebar />
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
  );
}
