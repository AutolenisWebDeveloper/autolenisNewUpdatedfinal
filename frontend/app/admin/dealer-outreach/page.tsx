// /admin/dealer-outreach — Phase 4A Dealer Recruitment Pipeline.
// Founder-facing list of dealer prospects with AI-drafted phone scripts.
import { requireAdmin } from "@/lib/auth/admin-session";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { Phone, Users } from "lucide-react";
import { DealerProspectStatus, type Prisma } from "@prisma/client";

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

  const statusOrder: DealerProspectStatus[] = [
    "DISCOVERED",
    "SCRIPTED",
    "CONTACTED",
    "REPLIED",
    "ONBOARDED",
    "DEAD",
  ];

  return (
    <div className="p-6 md:p-8 max-w-6xl" data-testid="admin-dealer-outreach-page">
      <div className="flex items-center gap-3 mb-6">
        <Phone size={22} className="text-[#0B5FD1]" />
        <h1 className="text-xl font-bold text-slate-900">Dealer Recruitment Pipeline</h1>
      </div>

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
              <th className="px-4 py-3 font-medium">Dealer</th>
              <th className="px-4 py-3 font-medium">Location</th>
              <th className="px-4 py-3 font-medium">Brand</th>
              <th className="px-4 py-3 font-medium">Phone</th>
              <th className="px-4 py-3 font-medium">Linked Buyer</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Drafted</th>
              <th className="px-4 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {prospects.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-slate-400">
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
                  <td className="px-4 py-3 font-medium text-slate-900">{p.name}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {[p.city, p.state].filter(Boolean).join(", ") || "—"}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{p.brand ?? "—"}</td>
                  <td className="px-4 py-3">
                    {p.phone ? (
                      <a href={`tel:${p.phone}`} className="text-[#0B5FD1] hover:underline">
                        {p.phone}
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {opp ? (
                      <span>
                        {vehicle} · {formatBudget(opp.budgetAmount, opp.monthlyPayment)} ·{" "}
                        {humanizeTimeline(opp.timeline)}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                        STATUS_BADGE[p.status] ?? "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {p.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-500 text-xs">
                    {p.scriptDraftedAt
                      ? new Date(p.scriptDraftedAt).toLocaleString()
                      : "—"}
                  </td>
                  <td className="px-4 py-3">
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
