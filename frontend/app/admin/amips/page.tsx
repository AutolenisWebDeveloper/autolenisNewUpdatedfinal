import { requireAdmin } from "@/lib/auth/admin-session";
import { prisma } from "@/lib/prisma";
import { haversineMiles } from "@/lib/utils/zip-coords";
import { getMetroDefs, METRO_MEMBERSHIP_RADIUS_MILES } from "@/lib/amips/metros";
import AmipsSyncControls from "@/components/admin/amips/AmipsSyncControls";
import {
  computeIndexationGates,
  type IndexationDecision,
} from "@/lib/amips/indexation-gate";

export const dynamic = "force-dynamic";

// Indexation-gate decision → badge styling.
function indexationCls(decision: IndexationDecision): string {
  switch (decision) {
    case "scale":
      return "bg-emerald-100 text-emerald-700";
    case "hold":
      return "bg-amber-100 text-amber-700";
    case "pause":
      return "bg-red-100 text-red-700";
  }
}

function fmtDate(d: Date | null | undefined): string {
  return d ? new Date(d).toISOString().slice(0, 10) : "—";
}

// Readiness: ready (green) needs a scored market + 3+ dealers; partial (amber)
// has a market record or any dealer; red is insufficient data.
function readiness(
  dealers: number,
  leverage: number | null | undefined,
): { label: string; cls: string } {
  if (dealers >= 3 && (leverage ?? 0) > 0) {
    return { label: "Ready", cls: "bg-emerald-100 text-emerald-700" };
  }
  if (dealers > 0 || (leverage ?? 0) > 0) {
    return { label: "Partial", cls: "bg-amber-100 text-amber-700" };
  }
  return { label: "Insufficient", cls: "bg-red-100 text-red-700" };
}

export default async function AdminAmipsPage() {
  await requireAdmin();

  const metroDefs = getMetroDefs();

  const [
    vehicleCount,
    vehicleLast,
    dealerCount,
    dealerRows,
    markets,
    queueByStatus,
    pagesByLifecycle,
    queueByMetro,
    marketScoreCount,
    indexationGates,
  ] = await Promise.all([
    prisma.vehicleIntelligence.count(),
    prisma.vehicleIntelligence.findFirst({
      orderBy: { lastUpdated: "desc" },
      select: { lastUpdated: true },
    }),
    prisma.dealerIntelligence.count(),
    prisma.dealerIntelligence.findMany({
      where: { latitude: { not: null }, longitude: { not: null } },
      select: { latitude: true, longitude: true },
    }),
    prisma.marketIntelligence.findMany({
      select: { metroName: true, buyerLeverageScore: true, lastUpdated: true },
    }),
    prisma.contentQueue.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.amipsPage.groupBy({ by: ["lifecycleStatus"], _count: { _all: true } }),
    prisma.contentQueue.groupBy({
      by: ["metro"],
      _count: { _all: true },
      where: { metro: { not: null } },
    }),
    prisma.amipsMarketScore.count(),
    computeIndexationGates(),
  ]);

  const dealerCoords = dealerRows.map((d) => ({
    lat: d.latitude as number,
    lng: d.longitude as number,
  }));

  // Per-metro dealer counts (membership radius from each metro center).
  const dealersInMetro = new Map<string, number>();
  for (const def of metroDefs) {
    let n = 0;
    for (const c of dealerCoords) {
      if (haversineMiles(def.center, c) <= METRO_MEMBERSHIP_RADIUS_MILES) n++;
    }
    dealersInMetro.set(def.metro, n);
  }
  const metrosCovered = [...dealersInMetro.values()].filter((n) => n > 0).length;

  const marketByMetro = new Map(markets.map((m) => [m.metroName, m]));
  const marketLast = markets.reduce<Date | null>(
    (acc, m) => (!acc || m.lastUpdated > acc ? m.lastUpdated : acc),
    null,
  );
  const queueByMetroMap = new Map(
    queueByMetro.map((q) => [q.metro as string, q._count._all]),
  );
  const statusCount = (s: string) =>
    queueByStatus.find((q) => q.status === s)?._count._all ?? 0;
  const lifecycleCount = (s: string) =>
    pagesByLifecycle.find((p) => p.lifecycleStatus === s)?._count._all ?? 0;

  const health = [
    {
      label: "Vehicle Intelligence",
      value: `${vehicleCount} records`,
      sub: `Updated ${fmtDate(vehicleLast?.lastUpdated)}`,
    },
    {
      label: "Dealer Intelligence",
      value: `${dealerCount} records`,
      sub: `${metrosCovered}/25 metros covered`,
    },
    {
      label: "Market Intelligence",
      value: `${markets.length} metros scored`,
      sub: `Updated ${fmtDate(marketLast)}`,
    },
    {
      label: "Market Scores",
      value: `${marketScoreCount} cached`,
      sub: "make/model × metro",
    },
    {
      label: "Content Queue",
      value: `${statusCount("pending")} pending`,
      sub: `${statusCount("in_progress")} in progress · ${statusCount("complete")} complete`,
    },
    {
      label: "AMIPS Pages",
      value: `${lifecycleCount("ACTIVE")} active`,
      sub: `${lifecycleCount("UNDER_REVIEW")} review · ${lifecycleCount("RETIRED")} retired`,
    },
  ];

  return (
    <div className="p-6 md:p-8" data-testid="admin-amips-page">
      <h1 className="text-xl font-bold text-slate-900">AMIPS Intelligence</h1>
      <p className="mt-1 text-sm text-slate-500">
        Automotive Market Intelligence Publishing System — database health, sync
        controls, and metro readiness for Tier C/D generation.
      </p>

      {/* Section 1 — Database Health */}
      <section className="mt-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Database Health
        </h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {health.map((h) => (
            <div key={h.label} className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-xs font-medium text-slate-500">{h.label}</p>
              <p className="mt-1 text-lg font-bold text-slate-900">{h.value}</p>
              <p className="text-xs text-slate-400">{h.sub}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Section 2 — Sync Controls */}
      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Sync Controls
        </h2>
        <div className="mt-3">
          <AmipsSyncControls />
        </div>
      </section>

      {/* Section 3 — Top Metro Readiness */}
      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Top Metro Readiness
        </h2>
        <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-4 py-2">Metro</th>
                <th className="px-4 py-2">State</th>
                <th className="px-4 py-2">Dealers</th>
                <th className="px-4 py-2">Market Score</th>
                <th className="px-4 py-2">Queue Items</th>
                <th className="px-4 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {metroDefs.map((def) => {
                const dealers = dealersInMetro.get(def.metro) ?? 0;
                const leverage = marketByMetro.get(def.metro)?.buyerLeverageScore ?? null;
                const queue = queueByMetroMap.get(def.metro) ?? 0;
                const r = readiness(dealers, leverage);
                return (
                  <tr key={def.metro} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-2 font-medium text-slate-900">{def.metro}</td>
                    <td className="px-4 py-2 text-slate-500">{def.state}</td>
                    <td className="px-4 py-2 text-slate-700">{dealers}</td>
                    <td className="px-4 py-2 text-slate-700">
                      {leverage === null ? "—" : leverage.toFixed(1)}
                    </td>
                    <td className="px-4 py-2 text-slate-700">{queue}</td>
                    <td className="px-4 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${r.cls}`}>
                        {r.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Section 4 — Indexation Gate (per publish-week cohort) */}
      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Indexation Gate
        </h2>
        <p className="mt-1 text-xs text-slate-400">
          Indexed ÷ submitted per publish-week cohort. ≥70% scale · 50–69% hold ·
          &lt;50% pause.
        </p>
        <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-4 py-2">Cohort Week</th>
                <th className="px-4 py-2">Submitted</th>
                <th className="px-4 py-2">Indexed</th>
                <th className="px-4 py-2">Rate</th>
                <th className="px-4 py-2">Decision</th>
              </tr>
            </thead>
            <tbody>
              {indexationGates.length === 0 ? (
                <tr>
                  <td className="px-4 py-3 text-slate-400" colSpan={5}>
                    No published cohorts yet.
                  </td>
                </tr>
              ) : (
                indexationGates.map((g) => (
                  <tr key={g.cohortWeek} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-2 font-medium text-slate-900">{g.cohortWeek}</td>
                    <td className="px-4 py-2 text-slate-700">{g.submitted}</td>
                    <td className="px-4 py-2 text-slate-700">{g.indexed}</td>
                    <td className="px-4 py-2 text-slate-700">
                      {(g.indexationRate * 100).toFixed(0)}%
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${indexationCls(g.decision)}`}
                      >
                        {g.decision}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
