// /admin/dealer-outreach/[prospectId] — prospect detail + founder call workspace.
import { requireAdmin } from "@/lib/auth/admin-session";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import ProspectDetailClient, {
  type ProspectDetail,
  type MarketInsight,
} from "./ProspectDetailClient";
import { getCachedMarketEnrichment } from "@/lib/services/acquisition/compound-search.service";

export const dynamic = "force-dynamic";

export default async function DealerProspectDetailPage({
  params,
}: {
  params: Promise<{ prospectId: string }>;
}) {
  await requireAdmin();
  const { prospectId } = await params;

  const prospect = await prisma.dealerProspect.findUnique({
    where: { id: prospectId },
    include: {
      buyerOpp: true,
      // Full communication history, newest first.
      outreachLog: { orderBy: { sentAt: "desc" } },
    },
  });

  if (!prospect) notFound();

  const opp = prospect.buyerOpp;

  // Change 1 — pull web-grounded market context for the linked buyer request.
  // Prefer the cached enrichment blob (richer); fall back to the legacy columns
  // persisted on the BuyerOpportunity so older records still show something.
  let marketInsight: MarketInsight | null = null;
  if (opp) {
    const cached = await getCachedMarketEnrichment({
      zip: opp.zip,
      make: opp.make,
      model: opp.model,
    }).catch(() => null);

    const hasLegacyColumns =
      opp.marketNotes != null ||
      opp.marketTypicalMarkup != null ||
      opp.marketGoodDealTarget != null ||
      opp.marketMsrpEstimate != null;

    if (cached || hasLegacyColumns) {
      const lowFromColumn =
        opp.marketMsrpEstimate != null
          ? { low: opp.marketMsrpEstimate, high: null }
          : null;
      marketInsight = {
        regionalPricingInsight: cached?.regionalPricingInsight ?? null,
        msrpRange: cached?.msrpRange ?? lowFromColumn,
        currentIncentives: cached?.currentIncentives ?? null,
        demandLevel: cached?.demandLevel ?? null,
        supplyNote: cached?.supplyNote ?? null,
        localDealers: (cached?.localDealers ?? []).map((d) => ({
          name: d.name,
          city: d.city,
          distanceMiles: d.distanceMiles,
          hasInventory: d.hasInventory,
          inventoryNote: d.inventoryNote,
        })),
        searchGrounded: cached?.searchGrounded ?? false,
        dataAsOf: cached?.dataAsOf ?? null,
        typicalMarkup: cached?.typicalMarkup ?? opp.marketTypicalMarkup ?? null,
        goodDealTarget:
          cached?.goodDealTarget ?? opp.marketGoodDealTarget ?? null,
        notes: cached?.notes ?? opp.marketNotes ?? null,
      };
    }
  }

  const detail: ProspectDetail = {
    id: prospect.id,
    name: prospect.name,
    address: prospect.address,
    city: prospect.city,
    state: prospect.state,
    zip: prospect.zip,
    phone: prospect.phone,
    website: prospect.website,
    brand: prospect.brand,
    sourceUrl: prospect.sourceUrl,
    searchScore: prospect.searchScore,
    distanceMiles: prospect.distanceMiles,
    status: prospect.status,
    outreachScript: prospect.outreachScript,
    founderNotes: prospect.founderNotes,
    contactName: prospect.contactName,
    contactTitle: prospect.contactTitle,
    email: prospect.email,
    emailSource: prospect.emailSource,
    emailEnrichedAt: prospect.emailEnrichedAt?.toISOString() ?? null,
    scriptDraftedAt: prospect.scriptDraftedAt?.toISOString() ?? null,
    createdAt: prospect.createdAt.toISOString(),
    updatedAt: prospect.updatedAt.toISOString(),
    scriptedAt: prospect.scriptedAt?.toISOString() ?? null,
    contactedAt: prospect.contactedAt?.toISOString() ?? null,
    repliedAt: prospect.repliedAt?.toISOString() ?? null,
    onboardedAt: prospect.onboardedAt?.toISOString() ?? null,
    deadAt: prospect.deadAt?.toISOString() ?? null,
    deadReason: prospect.deadReason,
    replyDetectedAt: prospect.replyDetectedAt?.toISOString() ?? null,
    outreachLog: prospect.outreachLog.map((l) => ({
      id: l.id,
      outreachType: l.outreachType,
      channel: l.channel,
      subject: l.subject,
      body: l.body,
      status: l.status,
      resendId: l.resendId,
      sentAt: l.sentAt.toISOString(),
      outreachSequenceStep: l.outreachSequenceStep,
    })),
    buyerOpp: opp
      ? {
          id: opp.id,
          firstName: opp.firstName,
          make: opp.make,
          model: opp.model,
          trim: opp.trim,
          yearMin: opp.yearMin,
          yearMax: opp.yearMax,
          bodyStyle: opp.bodyStyle,
          budgetAmount: opp.budgetAmount,
          monthlyPayment: opp.monthlyPayment,
          timeline: opp.timeline,
          zip: opp.zip,
          phone: opp.phone,
          source: opp.source,
          createdAt: opp.createdAt.toISOString(),
        }
      : null,
    marketInsight,
  };

  return (
    <div
      className="min-h-screen bg-[#F4F6FA] p-6 md:p-8"
      data-testid="admin-dealer-prospect-detail"
    >
      <div className="mx-auto max-w-6xl">
        <Link
          href="/admin/dealer-outreach"
          className="inline-flex items-center gap-1 text-sm text-[#64748B] hover:text-[#0F172A] mb-4"
        >
          <ArrowLeft size={16} /> Back to pipeline
        </Link>
        <ProspectDetailClient prospect={detail} />
      </div>
    </div>
  );
}
