// /admin/dealer-outreach — Phase 4A Dealer Recruitment Pipeline.
// Founder-facing list of dealer prospects with AI-drafted phone scripts.
import { requireAdmin } from "@/lib/auth/admin-session";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { Phone, Users } from "lucide-react";
import { DealerProspectStatus, type Prisma } from "@prisma/client";
import BackfillButton from "./BackfillButton";
import BackfillEmailsButton from "./BackfillEmailsButton";
import EmailCell from "./EmailCell";
import EmailHealthBanner from "./EmailHealthBanner";
import OutreachActions from "./OutreachActions";
import RunFollowupsButton from "./RunFollowupsButton";
import SequenceCell, { type SequenceStep } from "./SequenceCell";

export const dynamic = "force-dynamic";

const TAB_FILTERS: Record<string, DealerProspectStatus[]> = {
  All: [],
  New: ["DISCOVERED", "SCRIPTED"],
  Active: ["CONTACTED", "REPLIED"],
  Closed: ["ONBOARDED", "DEAD"],
};

const STATUS_BADGE: Record<string, string> = {
  DISCOVERED: "bg-slate-100 text-slate-600",
  SCRIPTED: "bg-blue-100 text-blue-700",
  DRAFTED: "bg-indigo-100 text-indigo-700",
  CONTACTED: "bg-amber-100 text-amber-700",
  REPLIED: "bg-purple-100 text-purple-700",
  ONBOARDED: "bg-green-100 text-green-700",
  DEAD: "bg-red-100 text-red-700",
};

function humanizeTimeline(t: string | null): string {
  if (t === "this_week") return "this week";
  if (t === "1_to_3_months") return "1-3 months";
  if (t === "researching") return "researching";
  return t ?? "—";
}

function formatBudget(amount: number | null, monthly: number | null): string {
  if (amount) return `$${amount.toLocaleString()}`;
  if (monthly) return `$${monthly}/mo`;
  return "flexible";
}

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
      take: 100,
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
  // Guarded so the page still renders before the 4B-3/4B-4 migrations run.
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

  return (
    <div className="p-6 md:p-8 max-w-screen-2xl" data-testid="admin-dealer-outreach-page">
      <div className="flex items-center justify-between gap-3 mb-6 flex-wrap">
        <div className="flex items-center gap-3">
          <Phone size={22} className="text-[#0B5FD1]" />
          <h1 className="text-xl font-bold text-slate-900">Dealer Recruitment Pipeline</h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
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
          <div key={s} className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="text-2xl font-bold text-slate-900">{counts[s] ?? 0}</div>
            <div className="text-xs font-medium text-slate-500">{s}</div>
          </div>
        ))}
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 mb-4 border-b border-slate-200">
        {Object.keys(TAB_FILTERS).map((t) => (
          <Link
            key={t}
            href={`/admin/dealer-outreach?tab=${t}`}
            className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 ${
              activeTab === t
                ? "border-[#0B5FD1] text-[#0B5FD1]"
                : "border-transparent text-slate-500 hover:text-slate-700"
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

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-3 font-medium w-40">Dealer</th>
              <th className="px-3 py-3 font-medium w-32">Location</th>
              <th className="px-3 py-3 font-medium w-24 hidden xl:table-cell">Brand</th>
              <th className="px-3 py-3 font-medium w-28 hidden xl:table-cell">Phone</th>
              <th className="px-3 py-3 font-medium w-44">Email</th>
              <th className="px-3 py-3 font-medium w-36 hidden xl:table-cell">Linked Buyer</th>
              <th className="px-3 py-3 font-medium w-24">Status</th>
              <th className="px-3 py-3 font-medium w-44">Outreach</th>
              <th className="px-3 py-3 font-medium w-20 hidden xl:table-cell">Sequence</th>
              <th className="px-3 py-3 font-medium w-28 hidden xl:table-cell">Drafted</th>
              <th className="px-3 py-3 font-medium w-16"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {prospects.length === 0 && (
              <tr>
                <td colSpan={11} className="px-4 py-8 text-center text-slate-400">
                  No prospects in this view yet.
                </td>
              </tr>
            )}
            {prospects.map((p) => {
              const opp = p.buyerOpp;
              const vehicle =
                [opp?.make, opp?.model].filter(Boolean).join(" ") ||
                opp?.bodyStyle ||
                "vehicle";
              return (
                <tr key={p.id} className="hover:bg-slate-50">
                  <td className="px-3 py-3 font-medium text-slate-900 max-w-[160px] truncate">{p.name}</td>
                  <td className="px-3 py-3 text-slate-600 max-w-[128px] truncate">
                    {[p.city, p.state].filter(Boolean).join(", ") || "—"}
                  </td>
                  <td className="px-3 py-3 text-slate-600 hidden xl:table-cell">{p.brand ?? "—"}</td>
                  <td className="px-3 py-3 hidden xl:table-cell">
                    {p.phone ? (
                      <a href={`tel:${p.phone}`} className="text-[#0B5FD1] hover:underline whitespace-nowrap">
                        {p.phone}
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <EmailCell
                      prospectId={p.id}
                      email={p.email}
                      emailSource={p.emailSource}
                      emailEnrichedAt={
                        p.emailEnrichedAt
                          ? p.emailEnrichedAt.toISOString()
                          : null
                      }
                    />
                  </td>
                  <td className="px-3 py-3 text-slate-600 hidden xl:table-cell max-w-[144px] truncate">
                    {opp ? (
                      <span title={`${vehicle} · ${formatBudget(opp.budgetAmount, opp.monthlyPayment)} · ${humanizeTimeline(opp.timeline)}`}>
                        {vehicle} · {formatBudget(opp.budgetAmount, opp.monthlyPayment)}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${
                        STATUS_BADGE[p.status] ?? "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {p.status}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    <OutreachActions
                      prospectId={p.id}
                      hasEmail={!!p.email}
                      lastStatus={latestOutreach.get(p.id) ?? null}
                    />
                  </td>
                  <td className="px-3 py-3 hidden xl:table-cell">
                    <SequenceCell
                      prospectId={p.id}
                      steps={sequenceSteps.get(p.id) ?? []}
                      replyDetectedAt={
                        p.replyDetectedAt ? p.replyDetectedAt.toISOString() : null
                      }
                      sequencePausedAt={
                        p.sequencePausedAt ? p.sequencePausedAt.toISOString() : null
                      }
                      sequencePauseReason={p.sequencePauseReason ?? null}
                    />
                  </td>
                  <td className="px-3 py-3 text-slate-500 text-xs hidden xl:table-cell whitespace-nowrap">
                    {p.scriptDraftedAt
                      ? new Date(p.scriptDraftedAt).toLocaleString()
                      : "—"}
                  </td>
                  <td className="px-3 py-3">
                    <Link
                      href={`/admin/dealer-outreach/${p.id}`}
                      className="rounded-md bg-[#0B5FD1] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#0a52b5]"
                    >
                      View
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center gap-2 text-xs text-slate-400">
        <Users size={14} />
        Showing up to 100 most recent prospects.
      </div>
    </div>
  );
}
