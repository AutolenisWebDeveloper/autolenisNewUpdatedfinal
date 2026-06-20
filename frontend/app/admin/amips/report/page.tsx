import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requireAdmin } from "@/lib/auth/admin-session";
import { loadExecutiveIntelligence } from "@/lib/amips/intelligence/executive-intelligence";
import PrintButton from "@/components/admin/amips/PrintButton";

export const dynamic = "force-dynamic";

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return <th className={`border-b border-[#E5E7EB] py-2 text-[11px] uppercase tracking-wide text-[#6B7280] ${right ? "text-right" : "text-left"}`}>{children}</th>;
}
function Td({ children, right, bold }: { children: React.ReactNode; right?: boolean; bold?: boolean }) {
  return <td className={`border-b border-[#F3F4F6] py-2 text-sm ${right ? "text-right" : "text-left"} ${bold ? "font-semibold text-[#111827]" : "text-[#374151]"}`}>{children}</td>;
}

export default async function AmipsReportPage() {
  await requireAdmin();
  const intel = await loadExecutiveIntelligence();
  const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const revenue = intel.headline.find((h) => h.key === "revenue")?.value ?? "—";
  const topOpps = intel.opportunities.filter((o) => o.opportunityScore > 0).slice(0, 10);

  return (
    <div className="min-h-screen bg-[#F4F6FA] print:bg-white p-6 md:p-8">
      <div className="max-w-[850px] mx-auto">
        {/* Toolbar (screen only) */}
        <div className="flex items-center justify-between mb-5 print:hidden">
          <Link href="/admin/amips" className="inline-flex items-center gap-1 text-xs font-semibold text-[#64748B] hover:text-[#0B5FD1] transition-colors">
            <ChevronLeft size={14} /> Back to Intelligence Center
          </Link>
          <PrintButton />
        </div>

        {/* Report sheet */}
        <div className="bg-white border border-[#E5E7EB] print:border-0 rounded-2xl print:rounded-none shadow-sm print:shadow-none p-8 md:p-10">
          <header className="border-b-2 border-[#0B5FD1] pb-5 mb-6">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-[#0B5FD1]">AutoLenis · Automotive Market Intelligence</p>
            <h1 className="text-2xl font-bold text-[#111827] mt-1">Executive Market Intelligence Report</h1>
            <p className="text-sm text-[#6B7280] mt-1">{today} · Confidential — internal use</p>
          </header>

          {/* Health + headline */}
          <div className="flex items-center gap-6 mb-6">
            <div className="text-center">
              <p className="text-5xl font-bold text-[#0B5FD1] leading-none">{intel.health.score}</p>
              <p className="text-xs text-[#6B7280] mt-1">/ 100 · {intel.health.grade}</p>
            </div>
            <div className="flex-1 grid grid-cols-2 sm:grid-cols-4 gap-4">
              {intel.headline.map((h) => (
                <div key={h.key}>
                  <p className="text-[10px] uppercase tracking-wide text-[#9CA3AF]">{h.label}</p>
                  <p className="text-lg font-bold text-[#111827]">{h.value}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Health components */}
          <section className="mb-7">
            <h2 className="text-sm font-bold text-[#111827] uppercase tracking-wide mb-2">Market Health Composition</h2>
            <table className="w-full">
              <thead><tr><Th>Component</Th><Th right>Score</Th><Th right>Weight</Th></tr></thead>
              <tbody>
                {intel.health.components.map((c) => (
                  <tr key={c.key}><Td bold>{c.label}</Td><Td right>{c.value}/100</Td><Td right>{Math.round(c.weight * 100)}%</Td></tr>
                ))}
              </tbody>
            </table>
          </section>

          {/* Opportunities */}
          <section className="mb-7">
            <h2 className="text-sm font-bold text-[#111827] uppercase tracking-wide mb-2">Top Market Opportunities</h2>
            <table className="w-full">
              <thead><tr><Th>#</Th><Th>Metro</Th><Th right>Opportunity</Th><Th>Lead Driver</Th><Th right>Demand</Th><Th right>Leverage</Th><Th right>Dealers</Th></tr></thead>
              <tbody>
                {topOpps.length === 0 ? (
                  <tr><Td>—</Td><Td>No scored opportunities yet</Td><Td right>—</Td><Td>—</Td><Td right>—</Td><Td right>—</Td><Td right>—</Td></tr>
                ) : topOpps.map((o, i) => (
                  <tr key={`${o.metro}-${o.state}`}>
                    <Td>{i + 1}</Td>
                    <Td bold>{o.metro}, {o.state}</Td>
                    <Td right>{o.opportunityScore}/100</Td>
                    <Td>{o.driver}</Td>
                    <Td right>{o.demandScore?.toFixed(1) ?? "—"}</Td>
                    <Td right>{o.buyerLeverage?.toFixed(1) ?? "—"}</Td>
                    <Td right>{o.dealers}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {/* Vehicles */}
          {intel.segments.length > 0 && (
            <section className="mb-7">
              <h2 className="text-sm font-bold text-[#111827] uppercase tracking-wide mb-2">Vehicle Buyer Advantage</h2>
              <table className="w-full">
                <thead><tr><Th>Vehicle</Th><Th right>Advantage</Th><Th right>Metros</Th><Th>Outlook</Th></tr></thead>
                <tbody>
                  {intel.segments.map((s) => (
                    <tr key={`${s.make}-${s.model}`}><Td bold>{s.make} {s.model}</Td><Td right>{s.avgBuyerAdvantage.toFixed(1)}/10</Td><Td right>{s.metros}</Td><Td>{s.outlook}</Td></tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {/* Content + risks */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-2">
            <section>
              <h2 className="text-sm font-bold text-[#111827] uppercase tracking-wide mb-2">Content Performance</h2>
              <table className="w-full">
                <tbody>
                  <tr><Td>Active pages</Td><Td right bold>{intel.content.activePages.toLocaleString("en-US")}</Td></tr>
                  <tr><Td>Published (30d)</Td><Td right bold>{intel.content.published30d.toLocaleString("en-US")}</Td></tr>
                  <tr><Td>Impressions</Td><Td right bold>{intel.content.impressions.toLocaleString("en-US")}</Td></tr>
                  <tr><Td>Leads</Td><Td right bold>{intel.content.leads.toLocaleString("en-US")}</Td></tr>
                  <tr><Td>Indexation rate</Td><Td right bold>{Math.round(intel.content.indexationRate * 100)}%</Td></tr>
                  <tr><Td>Revenue run-rate</Td><Td right bold>{revenue}</Td></tr>
                </tbody>
              </table>
            </section>
            <section>
              <h2 className="text-sm font-bold text-[#111827] uppercase tracking-wide mb-2">Risk Watch</h2>
              {intel.risks.length === 0 ? (
                <p className="text-sm text-[#059669]">All clear — no active risks.</p>
              ) : (
                <ul className="space-y-1.5">
                  {intel.risks.map((r) => (
                    <li key={r.id} className="text-sm text-[#374151]">
                      <span className="font-semibold uppercase text-[11px] text-[#6B7280]">{r.severity}</span> · {r.title}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <footer className="mt-8 pt-4 border-t border-[#E5E7EB] text-[11px] text-[#9CA3AF]">
            Every figure is computed from live AutoLenis market data — never estimated. Projections (run-rate, projected output)
            use a stated trailing-window method. Generated {new Date().toISOString().slice(0, 10)}.
          </footer>
        </div>
      </div>
    </div>
  );
}
