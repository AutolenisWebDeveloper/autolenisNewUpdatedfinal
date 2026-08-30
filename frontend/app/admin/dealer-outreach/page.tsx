// /admin/dealer-outreach — Phase 4A Dealer Recruitment Pipeline.
// Founder-facing list of dealer prospects with AI-drafted phone scripts.
// The server shell handles auth, stats, tabs, and the rich initial query; the
// DealerPipelineClient handles search / filtering / sorting over the loaded set.
import { requireAdmin } from "@/lib/auth/admin-session";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { BarChart3, Phone } from "lucide-react";
import { DealerProspectStatus, type Prisma } from "@prisma/client";
import BackfillButton from "./BackfillButton";
import BackfillEmailsButton from "./BackfillEmailsButton";
import EmailHealthBanner from "./EmailHealthBanner";
import RunFollowupsButton from "./RunFollowupsButton";
import { type SequenceStep } from "./SequenceCell";
import DealerPipelineClient, { type ProspectRow } from "./DealerPipelineClient";

export const dynamic = "force-dynamic";

const TAB_FILTERS: Record<string, DealerProspectStatus[]> = {
  All: [],
  New: ["DISCOVERED", "SCRIPTED"],
  Active: ["CONTACTED", "REPLIED"],
  Closed: ["ONBOARDED", "DEAD"],
};

export default async function DealerOutreachPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  await requireAdmin();
  const { tab } = await searchParams;
  const activeTab = tab && TAB_FILTERS[tab] ? tab : "All";

  const tabStatuses = TAB_FILTERS[activeTab];
  const where: Prisma.DealerProspectWhereInput =
    tabStatuses.length > 0 ? { status: { in: tabStatuses } } : {};

  let prospects: Awaited<
    ReturnType<
      typeof prisma.dealerProspect.findMany<{
        include: { buyerOpp: true };
      }>
    >
  > = [];
  let loadError: string | null = null;

  try {
    prospects = await prisma.dealerProspect.findMany({
      where,
      include: { buyerOpp: true },
      orderBy: { createdAt: "desc" },
      take: 250,
    });
  } catch (err) {
    loadError = err instanceof Error ? err.message : "Failed to load prospects";
  }

  // Stats row — counts per status across all prospects.
  const grouped = await prisma.dealerProspect
    .groupBy({ by: ["status"], _count: { _all: true } })
    .catch(() => [] as { status: DealerProspectStatus; _count: { _all: number } }[]);
  const counts: Record<string, number> = {};
  for (const g of grouped) counts[g.status] = g._count._all;

  // Count of DISCOVERED prospects still missing a drafted script — these are
  // the ones the backfill button can fill in.
  const missingScriptCount = await prisma.dealerProspect
    .count({ where: { status: "DISCOVERED", outreachScript: null } })
    .catch(() => 0);

  // Count of prospects with no email captured yet — the email backfill target.
  const missingEmailCount = await prisma.dealerProspect
    .count({ where: { email: null } })
    .catch(() => 0);

  // Latest email outreach status per displayed prospect (for the Outreach
  // column) plus the per-step send history (Phase 4B-4 Sequence column).
  const latestOutreach = new Map<string, string>();
  const sequenceSteps = new Map<string, SequenceStep[]>();
  if (prospects.length > 0) {
    const logs = await prisma.dealerOutreachLog
      .findMany({
        where: {
          dealerProspectId: { in: prospects.map((p) => p.id) },
          channel: "email",
          status: { in: ["sent", "delivered", "replied"] },
        },
        orderBy: { sentAt: "desc" },
        select: {
          dealerProspectId: true,
          status: true,
          outreachSequenceStep: true,
          sentAt: true,
        },
      })
      .catch(
        () =>
          [] as {
            dealerProspectId: string;
            status: string;
            outreachSequenceStep: number | null;
            sentAt: Date;
          }[],
      );
    for (const l of logs) {
      if (!latestOutreach.has(l.dealerProspectId)) {
        latestOutreach.set(l.dealerProspectId, l.status);
      }
      const arr = sequenceSteps.get(l.dealerProspectId) ?? [];
      arr.push({
        step: l.outreachSequenceStep ?? 1,
        sentAt: l.sentAt.toISOString(),
      });
      sequenceSteps.set(l.dealerProspectId, arr);
    }
  }

  const statusOrder: DealerProspectStatus[] = [
    "DISCOVERED",
    "SCRIPTED",
    "CONTACTED",
    "REPLIED",
    "ONBOARDED",
    "DEAD",
  ];

  // Project to a serializable shape the client component can filter/sort.
  const rows: ProspectRow[] = prospects.map((p) => {
    const opp = p.buyerOpp;
    return {
      id: p.id,
      name: p.name,
      city: p.city,
      state: p.state,
      brand: p.brand,
      phone: p.phone,
      email: p.email,
      emailSource: p.emailSource,
      emailEnrichedAt: p.emailEnrichedAt ? p.emailEnrichedAt.toISOString() : null,
      website: p.website,
      contactName: p.contactName,
      contactTitle: p.contactTitle,
      status: p.status,
      contactedAt: p.contactedAt ? p.contactedAt.toISOString() : null,
      createdAt: p.createdAt.toISOString(),
      replyDetectedAt: p.replyDetectedAt ? p.replyDetectedAt.toISOString() : null,
      sequencePausedAt: p.sequencePausedAt ? p.sequencePausedAt.toISOString() : null,
      sequencePauseReason: p.sequencePauseReason,
      lastOutreachStatus: latestOutreach.get(p.id) ?? null,
      sequenceSteps: sequenceSteps.get(p.id) ?? [],
      buyerOpp: opp
        ? {
            make: opp.make,
            model: opp.model,
            bodyStyle: opp.bodyStyle,
            budgetAmount: opp.budgetAmount,
            monthlyPayment: opp.monthlyPayment,
            timeline: opp.timeline,
          }
        : null,
    };
  });

  return (
    <div
      className="min-h-screen bg-[#F4F6FA] p-6 md:p-8"
      data-testid="admin-dealer-outreach-page"
    >
      <div className="mx-auto max-w-screen-2xl">
        <div className="flex items-center justify-between gap-3 mb-6 flex-wrap">
          <div className="flex items-center gap-3">
            <Phone size={22} className="text-al-primary" />
            <h1 className="text-xl font-bold text-[#0F172A]">
              Dealer Recruitment Pipeline
            </h1>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Link
              href="/admin/dealer-outreach/coverage"
              className="inline-flex items-center gap-2 rounded-md border border-al-primary px-4 py-2 text-sm font-medium text-al-primary hover:bg-blue-50"
            >
              <BarChart3 size={16} aria-hidden="true" />
              Contact Coverage
            </Link>
            <RunFollowupsButton />
            <BackfillEmailsButton missingCount={missingEmailCount} />
            <BackfillButton missingCount={missingScriptCount} />
          </div>
        </div>

        {/* Phase 4B-2 — sending-domain readiness indicator */}
        <EmailHealthBanner />

        {/* Stats row */}
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 mb-6">
          {statusOrder.map((s) => (
            <div
              key={s}
              className="rounded-2xl border border-[#E2E8F0] bg-white p-3 shadow-sm"
            >
              <div className="text-2xl font-bold text-[#0F172A]">{counts[s] ?? 0}</div>
              <div className="text-xs font-medium text-[#64748B]">{s}</div>
            </div>
          ))}
        </div>

        {/* Filter tabs */}
        <div className="flex gap-2 mb-4 border-b border-[#E2E8F0]">
          {Object.keys(TAB_FILTERS).map((t) => (
            <Link
              key={t}
              href={`/admin/dealer-outreach?tab=${t}`}
              className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 ${
                activeTab === t
                  ? "border-al-primary text-al-primary"
                  : "border-transparent text-[#64748B] hover:text-[#0F172A]"
              }`}
            >
              {t}
            </Link>
          ))}
        </div>

        {loadError && (
          <div className="rounded-md bg-red-50 border border-red-200 text-red-700 p-4 mb-4 text-sm">
            {loadError}
          </div>
        )}

        <DealerPipelineClient prospects={rows} />
      </div>
    </div>
  );
}
