import { prisma } from "@/lib/prisma";

export type StageStatus =
  | "COMPLETE"    // Organically complete in DB
  | "SKIPPED"     // Admin bypassed with required reason — counts as complete for journey progression
  | "UNLOCKED"    // Admin gave access — buyer can visit but hasn't completed
  | "ACTIVE"      // Current natural stage
  | "LOCKED";     // Not yet accessible

export interface JourneyStageView {
  id: string;
  label: string;
  description: string;
  route: string | null;
  status: StageStatus;
  adminUnlocked: boolean;
  adminUnlockedAt: string | null;
  adminUnlockedBy: string | null;
  adminUnlockNote: string | null;
  canAdminUnlock: boolean;
  canSkip: boolean;
  canReopen: boolean;
  notes: Array<{
    id: string;
    content: string;
    adminEmail: string;
    createdAt: string;
  }>;
}

export interface AdminBuyerJourney {
  buyerId: string;
  buyerName: string;
  buyerEmail: string;
  currentStageId: string;
  completedCount: number;
  totalCount: number;
  percentComplete: number;
  stages: JourneyStageView[];
}

const ALL_STAGE_IDS = [
  "account", "onboarding", "prequal", "search", "shortlist",
  "deposit", "auction", "select-deal", "financing", "fee",
  "insurance", "contract", "sign", "pickup",
] as const;

type StageId = typeof ALL_STAGE_IDS[number];

// Skippable stages — non-critical, can bypass
const SKIPPABLE_STAGES = new Set<string>(["prequal", "search", "shortlist", "financing", "insurance"]);

// Reopenable stages — can reverse DB state
const REOPENABLE_STAGES = new Set<string>([
  "onboarding", "prequal", "financing", "fee", "insurance", "contract", "sign", "pickup",
]);

const STAGE_META: Record<StageId, { label: string; description: string; route: string | null }> = {
  "account":     { label: "Account",      route: "/buyer/dashboard",       description: "Buyer registered. User account created in the system." },
  "onboarding":  { label: "Onboarding",   route: "/buyer/onboarding",      description: "Buyer accepted Terms of Service. buyer.onboardingComplete = true." },
  "prequal":     { label: "Pre-Qual",     route: "/buyer/prequal",         description: "Pre-qualification submitted. PreQualification record exists." },
  "search":      { label: "Search",       route: "/buyer/search",          description: "Buyer can browse inventory. Auto-unlocked after prequal." },
  "shortlist":   { label: "Shortlist",    route: "/buyer/shortlist",       description: "Buyer shortlisted at least one vehicle. Shortlist.items.length > 0." },
  "deposit":     { label: "Deposit",      route: "/buyer/deposit",         description: "Buyer paid the $99 Auction Access Deposit. Deposit.status = PAID." },
  "auction":     { label: "Auction",      route: "/buyer/auctions",        description: "Dealer auction concluded. Active deal exists." },
  "select-deal": { label: "Select Deal",  route: "/buyer/deal",            description: "Buyer selected a dealer offer. Deal record created." },
  "financing":   { label: "Financing",    route: "/buyer/deal/financing",  description: "Buyer chose financing path. deal.financingPath is set." },
  "fee":         { label: "Service Fee",  route: "/buyer/fee",             description: "Buyer paid AutoLenis Service Fee. deal.feePaidAt is set." },
  "insurance":   { label: "Insurance",    route: "/buyer/insurance",       description: "Insurance step engaged. deal.insuranceStatus != NOT_STARTED." },
  "contract":    { label: "Contract",     route: "/buyer/contracts",       description: "Contract Shield passed. deal.contractShieldStatus = PASS." },
  "sign":        { label: "Sign",         route: "/buyer/esign",           description: "DocuSign complete. deal.status = PICKUP_SCHEDULED or COMPLETED." },
  "pickup":      { label: "Pickup",       route: "/buyer/pickup",          description: "Vehicle delivered. deal.status = COMPLETED." },
};

export async function getAdminBuyerJourney(buyerId: string): Promise<AdminBuyerJourney | null> {
  const buyer = await prisma.buyer.findUnique({
    where: { id: buyerId },
    include: {
      user: { select: { email: true } },
      preQualification: { select: { id: true } },
      shortlists: { include: { items: { select: { id: true }, take: 1 } } },
      deposits: {
        where: { status: "PAID" },
        select: { id: true },
        take: 1,
      },
      deals: {
        orderBy: { createdAt: "desc" },
        take: 5,
        select: {
          id: true,
          status: true,
          financingPath: true,
          feePaidAt: true,
          insuranceStatus: true,
          contractShieldStatus: true,
        },
      },
      adminJourneyUnlocks: { select: { stageId: true, type: true, createdAt: true, adminEmail: true, note: true } },
      adminJourneyNotes: {
        orderBy: { createdAt: "desc" },
        select: { id: true, stageId: true, content: true, adminEmail: true, createdAt: true },
      },
    },
  });

  if (!buyer) return null;

  const unlockMap = new Map(buyer.adminJourneyUnlocks.map(u => [u.stageId, u]));

  const INACTIVE = ["CANCELLED", "COMPLETED", "REFUNDED"];
  const activeDeal = buyer.deals.find(d => !INACTIVE.includes(d.status));
  const completedDeal = buyer.deals.find(d => d.status === "COMPLETED");
  const anyDeal = activeDeal ?? completedDeal ?? null;

  // Mirrors journey-status/route.ts completion logic exactly
  const organic = new Set<string>(["account"]);
  if (buyer.onboardingComplete) organic.add("onboarding");
  if (buyer.preQualification) { organic.add("prequal"); organic.add("search"); }
  if ((buyer.shortlists?.items?.length ?? 0) > 0) organic.add("shortlist");
  if (buyer.deposits.length > 0) organic.add("deposit");
  if (anyDeal) {
    organic.add("auction");
    organic.add("select-deal");
    if (anyDeal.financingPath) organic.add("financing");
    if (anyDeal.feePaidAt) organic.add("fee");
    if (anyDeal.insuranceStatus !== "NOT_STARTED") organic.add("insurance");
    if (anyDeal.contractShieldStatus === "PASS") organic.add("contract");
    if (["PICKUP_SCHEDULED", "PICKUP_COMPLETE", "COMPLETED"].includes(anyDeal.status)) organic.add("sign");
    if (anyDeal.status === "COMPLETED") organic.add("pickup");
  }

  const stages: JourneyStageView[] = ALL_STAGE_IDS.map((id, idx) => {
    const meta = STAGE_META[id];
    const isComplete = organic.has(id);
    const unlock = unlockMap.get(id) ?? null;
    const prevId = idx > 0 ? ALL_STAGE_IDS[idx - 1] : null;
    const prevDone = !prevId || organic.has(prevId) || unlockMap.has(prevId);

    let status: StageStatus;
    if (isComplete) status = "COMPLETE";
    else if (unlock?.type === "SKIP") status = "SKIPPED";
    else if (unlock?.type === "UNLOCK") status = "UNLOCKED";
    else if (prevDone) status = "ACTIVE";
    else status = "LOCKED";

    return {
      id, label: meta.label, description: meta.description, route: meta.route,
      status, canAdminUnlock: !isComplete,
      canSkip: SKIPPABLE_STAGES.has(id) && !isComplete && status !== "SKIPPED",
      canReopen: REOPENABLE_STAGES.has(id) && (isComplete || status === "SKIPPED"),
      adminUnlocked: !!unlock,  // true for both SKIP and UNLOCK overrides
      adminUnlockedAt: unlock?.createdAt.toISOString() ?? null,
      adminUnlockedBy: unlock?.adminEmail ?? null,
      adminUnlockNote: unlock?.note ?? null,
      notes: buyer.adminJourneyNotes
        .filter(n => n.stageId === id)
        .map(n => ({
          id: n.id,
          content: n.content,
          adminEmail: n.adminEmail,
          createdAt: n.createdAt.toISOString(),
        })),
    };
  });

  const completedCount = stages.filter(s => s.status === "COMPLETE" || s.status === "SKIPPED").length;
  const current = stages.find(s => s.status === "ACTIVE" || s.status === "UNLOCKED");

  return {
    buyerId,
    buyerName: `${buyer.firstName ?? ""} ${buyer.lastName ?? ""}`.trim() || "—",
    buyerEmail: buyer.user?.email ?? "—",
    currentStageId: current?.id ?? (completedCount === stages.length ? "pickup" : "account"),
    completedCount,
    totalCount: stages.length,
    percentComplete: Math.round((completedCount / stages.length) * 100),
    stages,
  };
}
