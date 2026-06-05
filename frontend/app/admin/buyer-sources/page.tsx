// /admin/buyer-sources — Phase 5.5 Admin Source Visibility.
// Lists BuyerOpportunity records with their traffic source, a channel filter,
// a source-distribution stats bar, and a historical backfill action.
import { requireAdmin } from "@/lib/auth/admin-session";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { BarChart2, Users } from "lucide-react";
import { type Prisma } from "@prisma/client";
import {
  parseSource,
  sourceBadgeClasses,
  channelsForFilter,
  SOURCE_FILTERS,
  type SourceFilterKey,
} from "@/lib/admin/buyer-source";
import BackfillSourceButton from "./BackfillSourceButton";

export const dynamic = "force-dynamic";

function vehicleLabel(o: { make: string | null; model: string | null; bodyStyle: string | null }) {
  return [o.make, o.model].filter(Boolean).join(" ") || o.bodyStyle || "—";
}

// Builds the Prisma where clause for a given filter key. Web/voice match on the
// channel prefix; unknown matches null sources.
function whereForFilter(key: SourceFilterKey): Prisma.BuyerOpportunityWhereInput {
  const channels = channelsForFilter(key);
  if (!channels) return {};
  if (channels.includes("unknown")) return { source: null };
  return {
    OR: channels.map((c) => ({ source: { startsWith: c } })),
  };
}

export default async function BuyerSourcesPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  await requireAdmin();
  const { filter } = await searchParams;
  const activeFilter: SourceFilterKey = SOURCE_FILTERS.some((f) => f.key === filter)
    ? (filter as SourceFilterKey)
    : "all";

  const where = whereForFilter(activeFilter);

  let opportunities: Awaited<ReturnType<typeof prisma.buyerOpportunity.findMany>> = [];
  let loadError: string | null = null;
  try {
    opportunities = await prisma.buyerOpportunity.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  } catch (err) {
    loadError = err instanceof Error ? err.message : "Failed to load buyer opportunities";
  }

  // Source distribution stats — grouped across ALL records (ignores filter).
  const grouped = await prisma.buyerOpportunity
    .groupBy({ by: ["source"], _count: { _all: true } })
    .catch(() => [] as { source: string | null; _count: { _all: number } }[]);

  const stats = { web: 0, voice: 0, lp: 0, widget: 0, api: 0, unknown: 0, total: 0 };
  let nullCount = 0;
  for (const g of grouped) {
    const n = g._count._all;
    stats.total += n;
    if (!g.source) nullCount += n;
    const { channel } = parseSource(g.source);
    if (channel === "buyer_dashboard" || channel === "request_vehicle_wizard") stats.web += n;
    else if (channel === "voice_dispatch" || channel === "phone_intake") stats.voice += n;
    else if (channel === "lp_campaign") stats.lp += n;
    else if (channel === "zura_widget") stats.widget += n;
    else if (channel === "public_api") stats.api += n;
    else stats.unknown += n;
  }

  return (
    <div className="p-6 md:p-8 max-w-6xl" data-testid="admin-buyer-sources-page">
      <div className="flex items-center justify-between gap-3 mb-6 flex-wrap">
        <div className="flex items-center gap-3">
          <BarChart2 size={22} className="text-[#0B5FD1]" />
          <h1 className="text-xl font-bold text-slate-900">Buyer Sources</h1>
        </div>
        <BackfillSourceButton nullCount={nullCount} />
      </div>

      {/* Source distribution stats bar */}
      <div className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm">
        <span className="font-semibold text-slate-900">{stats.total} total</span>
        <span className="text-slate-400">·</span>
        <span className="text-slate-600">Web: <strong>{stats.web}</strong></span>
        <span className="text-slate-600">Voice: <strong>{stats.voice}</strong></span>
        <span className="text-slate-600">LP: <strong>{stats.lp}</strong></span>
        <span className="text-slate-600">Widget: <strong>{stats.widget}</strong></span>
        <span className="text-slate-600">API: <strong>{stats.api}</strong></span>
        <span className="text-slate-600">Unknown: <strong>{stats.unknown}</strong></span>
      </div>

      {/* Filter tabs */}
      <div className="flex flex-wrap gap-2 mb-4 border-b border-slate-200">
        {SOURCE_FILTERS.map((f) => (
          <Link
            key={f.key}
            href={`/admin/buyer-sources?filter=${f.key}`}
            className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 ${
              activeFilter === f.key
                ? "border-[#0B5FD1] text-[#0B5FD1]"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            {f.label}
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
              <th className="px-4 py-3 font-medium">Buyer</th>
              <th className="px-4 py-3 font-medium">Vehicle</th>
              <th className="px-4 py-3 font-medium">ZIP</th>
              <th className="px-4 py-3 font-medium">Source</th>
              <th className="px-4 py-3 font-medium">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {opportunities.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                  No buyer opportunities in this view yet.
                </td>
              </tr>
            )}
            {opportunities.map((o) => {
              const parsed = parseSource(o.source);
              return (
                <tr key={o.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {[o.firstName].filter(Boolean).join(" ") || o.phone || o.email || "—"}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{vehicleLabel(o)}</td>
                  <td className="px-4 py-3 text-slate-600">{o.zip ?? "—"}</td>
                  <td className="px-4 py-3">
                    <span
                      title={parsed.raw ?? "no source recorded"}
                      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${sourceBadgeClasses(
                        parsed.channel,
                      )}`}
                    >
                      {parsed.label}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-500 text-xs">
                    {new Date(o.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center gap-2 text-xs text-slate-400">
        <Users size={14} />
        Showing up to 100 most recent buyer opportunities.
      </div>
    </div>
  );
}
