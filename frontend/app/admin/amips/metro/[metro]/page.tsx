import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, MapPinned, Building2, Gauge, Target, FileText } from "lucide-react";
import { requireAdmin } from "@/lib/auth/admin-session";
import { loadMetroProfile } from "@/lib/amips/intelligence/executive-intelligence";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ metro: string }>;
}

const LIFECYCLE_CHIP: Record<string, string> = {
  ACTIVE: "bg-[#ECFDF5] text-[#059669]",
  UNDER_REVIEW: "bg-[#FFFBEB] text-[#D97706]",
  REFRESH_REQUIRED: "bg-[#EFF6FF] text-[#0B5FD1]",
  RETIRED: "bg-[#F1F5F9] text-[#64748B]",
};

function ScoreStat({ label, value, suffix = "/10" }: { label: string; value: number | null; suffix?: string }) {
  return (
    <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 shadow-sm">
      <p className="text-[10px] text-[#94A3B8] font-medium uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-bold font-mono text-[#0F172A] mt-2 leading-none">
        {value != null ? value.toFixed(1) : "—"}
        {value != null && <span className="text-sm text-[#94A3B8] font-normal">{suffix}</span>}
      </p>
    </div>
  );
}

export default async function MetroProfilePage({ params }: Props) {
  await requireAdmin();
  const { metro: raw } = await params;
  const metro = decodeURIComponent(raw);
  const profile = await loadMetroProfile(metro);
  if (!profile) notFound();

  return (
    <div className="min-h-screen bg-[#F4F6FA] p-6 md:p-8 max-w-[1200px] mx-auto">
      <Link href="/admin/amips" className="inline-flex items-center gap-1 text-xs font-semibold text-[#64748B] hover:text-[#0B5FD1] transition-colors mb-4">
        <ChevronLeft size={14} /> Market Intelligence Center
      </Link>

      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <MapPinned size={13} className="text-[#0B5FD1]" />
            <p className="text-[10px] text-[#94A3B8] font-semibold uppercase tracking-widest">Metro Intelligence Profile</p>
          </div>
          <h1 className="text-2xl font-bold text-[#0F172A] tracking-tight">{profile.metro}, {profile.state}</h1>
          <p className="text-sm text-[#94A3B8] mt-0.5">
            {profile.population != null ? `${(profile.population / 1_000_000).toFixed(1)}M residents · ` : ""}
            {profile.dealers} tracked dealers · {profile.vehicles.length} scored vehicles
            {profile.lastUpdated ? ` · data as of ${profile.lastUpdated}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-2xl border border-[#E2E8F0] bg-white px-4 py-3 shadow-sm">
          <Target size={16} className="text-[#0B5FD1]" />
          <div>
            <p className="text-[10px] text-[#94A3B8] font-medium uppercase tracking-wide">Opportunity</p>
            <p className="text-xl font-bold font-mono text-[#0F172A] leading-none">{profile.opportunityScore}<span className="text-xs text-[#94A3B8] font-normal">/100</span></p>
          </div>
          <span className="ml-1 rounded-full bg-[#F1F5F9] px-2 py-0.5 text-[10px] font-semibold text-[#475569]">{profile.opportunityDriver}</span>
        </div>
      </header>

      {/* Market scores */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <ScoreStat label="Vehicle Demand" value={profile.demandScore} />
        <ScoreStat label="Competition" value={profile.competitionScore} />
        <ScoreStat label="Inventory" value={profile.inventoryScore} />
        <ScoreStat label="Buyer Leverage" value={profile.buyerLeverage} />
      </div>

      {profile.seasonalNote && (
        <div className="rounded-2xl border border-[#E2E8F0] bg-white p-4 shadow-sm mb-6">
          <p className="text-[10px] font-bold text-[#94A3B8] uppercase tracking-[0.12em] mb-1">Seasonal Signal</p>
          <p className="text-sm text-[#374151]">{profile.seasonalNote}</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Vehicles in this metro */}
        <div className="lg:col-span-2">
          <div className="flex items-center gap-2 mb-3">
            <Gauge size={13} className="text-[#0B5FD1]" />
            <p className="text-[10px] font-bold text-[#94A3B8] uppercase tracking-[0.15em]">Vehicle Buyer Advantage</p>
          </div>
          <div className="rounded-2xl border border-[#E2E8F0] bg-white shadow-sm overflow-hidden">
            {profile.vehicles.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-[#94A3B8]">No scored vehicles for this metro yet.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC] text-left text-[10px] uppercase tracking-[0.12em] text-[#94A3B8]">
                    <th className="px-5 py-3 font-bold">Vehicle</th>
                    <th className="px-5 py-3 font-bold text-right">Buyer Advantage</th>
                    <th className="px-5 py-3 font-bold text-right">Dealers</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F1F5F9]">
                  {profile.vehicles.map((v) => (
                    <tr key={`${v.make}-${v.model}`} className="hover:bg-[#F8FAFF] transition-colors">
                      <td className="px-5 py-3">
                        <Link href={`/admin/amips/vehicle/${encodeURIComponent(v.make)}/${encodeURIComponent(v.model)}`}
                          className="font-semibold text-[#0F172A] hover:text-[#0B5FD1] transition-colors">
                          {v.make} {v.model}
                        </Link>
                      </td>
                      <td className="px-5 py-3 text-right font-mono font-semibold text-[#0F172A]">{v.advantage.toFixed(1)}</td>
                      <td className="px-5 py-3 text-right font-mono text-[#374151]">{v.dealers}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Dealer brands + pages */}
        <div className="space-y-5">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Building2 size={13} className="text-[#0B5FD1]" />
              <p className="text-[10px] font-bold text-[#94A3B8] uppercase tracking-[0.15em]">Dealer Brand Mix</p>
            </div>
            <div className="rounded-2xl border border-[#E2E8F0] bg-white shadow-sm overflow-hidden">
              {profile.topBrands.length === 0 ? (
                <p className="px-5 py-6 text-center text-sm text-[#94A3B8]">No dealer brand data.</p>
              ) : (
                <div className="divide-y divide-[#F1F5F9]">
                  {profile.topBrands.map((b) => (
                    <div key={b.brand} className="flex items-center justify-between px-5 py-2.5 text-sm">
                      <span className="text-[#374151]">{b.brand}</span>
                      <span className="font-mono font-semibold text-[#0F172A]">{b.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Published pages */}
      <div className="mt-6">
        <div className="flex items-center gap-2 mb-3">
          <FileText size={13} className="text-[#0B5FD1]" />
          <p className="text-[10px] font-bold text-[#94A3B8] uppercase tracking-[0.15em]">Published Pages ({profile.pages.length})</p>
        </div>
        <div className="rounded-2xl border border-[#E2E8F0] bg-white shadow-sm overflow-hidden">
          {profile.pages.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-[#94A3B8]">No pages published for this metro yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC] text-left text-[10px] uppercase tracking-[0.12em] text-[#94A3B8]">
                    <th className="px-5 py-3 font-bold">Title</th>
                    <th className="px-5 py-3 font-bold">Status</th>
                    <th className="px-5 py-3 font-bold text-right">Impressions</th>
                    <th className="px-5 py-3 font-bold text-right">Clicks</th>
                    <th className="px-5 py-3 font-bold text-right">Leads</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F1F5F9]">
                  {profile.pages.map((p) => (
                    <tr key={p.slug} className="hover:bg-[#F8FAFF] transition-colors">
                      <td className="px-5 py-3">
                        <Link href={`/intelligence/${p.slug}`} className="font-medium text-[#0F172A] hover:text-[#0B5FD1] transition-colors">{p.title}</Link>
                      </td>
                      <td className="px-5 py-3">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${LIFECYCLE_CHIP[p.lifecycleStatus] ?? "bg-[#F1F5F9] text-[#64748B]"}`}>{p.lifecycleStatus}</span>
                      </td>
                      <td className="px-5 py-3 text-right font-mono text-[#374151]">{p.impressions.toLocaleString("en-US")}</td>
                      <td className="px-5 py-3 text-right font-mono text-[#374151]">{p.clicks.toLocaleString("en-US")}</td>
                      <td className="px-5 py-3 text-right font-mono text-[#374151]">{p.leads.toLocaleString("en-US")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
