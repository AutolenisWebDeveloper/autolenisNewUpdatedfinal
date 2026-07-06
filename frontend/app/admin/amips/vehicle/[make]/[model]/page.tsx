import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Car, MapPinned, FileText, TrendingUp, TrendingDown } from "lucide-react";
import { requireAdmin } from "@/lib/auth/admin-session";
import { loadVehicleProfile } from "@/lib/amips/intelligence/executive-intelligence";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ make: string; model: string }>;
}

const LIFECYCLE_CHIP: Record<string, string> = {
  ACTIVE: "bg-[#ECFDF5] text-[#059669]",
  UNDER_REVIEW: "bg-[#FFFBEB] text-[#D97706]",
  REFRESH_REQUIRED: "bg-al-primary-subtle text-al-primary",
  RETIRED: "bg-[#F1F5F9] text-[#64748B]",
};

const usd = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;

export default async function VehicleProfilePage({ params }: Props) {
  await requireAdmin();
  const { make: rawMake, model: rawModel } = await params;
  const make = decodeURIComponent(rawMake);
  const model = decodeURIComponent(rawModel);
  const profile = await loadVehicleProfile(make, model);
  if (!profile) notFound();

  const stats: Array<{ label: string; value: string; caption?: string }> = [
    { label: "Avg Buyer Advantage", value: `${profile.avgAdvantage.toFixed(1)}/10`, caption: `across ${profile.metrosCount} metro${profile.metrosCount === 1 ? "" : "s"}` },
    {
      label: "MSRP Range",
      value: profile.msrpRange ? (profile.msrpRange.low === profile.msrpRange.high ? usd(profile.msrpRange.low) : `${usd(profile.msrpRange.low)}–${usd(profile.msrpRange.high)}`) : "—",
      caption: "manufacturer data",
    },
    { label: "Negotiation", value: profile.negotiationDifficulty ? profile.negotiationDifficulty[0].toUpperCase() + profile.negotiationDifficulty.slice(1) : "—", caption: "difficulty" },
    { label: "Incentives", value: profile.activeIncentives ? "Active" : "—", caption: profile.activeIncentives ? "see below" : "none on file" },
  ];

  return (
    <div className="min-h-screen bg-[#F4F6FA] p-6 md:p-8 max-w-[1200px] mx-auto">
      <Link href="/admin/amips" className="inline-flex items-center gap-1 text-xs font-semibold text-[#64748B] hover:text-al-primary transition-colors mb-4">
        <ChevronLeft size={14} /> Market Intelligence Center
      </Link>

      <header className="mb-6">
        <div className="flex items-center gap-2 mb-1.5">
          <Car size={13} className="text-al-primary" />
          <p className="text-[10px] text-[#94A3B8] font-semibold uppercase tracking-widest">Vehicle Intelligence Profile</p>
        </div>
        <h1 className="text-2xl font-bold text-[#0F172A] tracking-tight">{profile.make} {profile.model}</h1>
        <p className="text-sm text-[#94A3B8] mt-0.5">Buyer-advantage intelligence across {profile.metrosCount} scored metro{profile.metrosCount === 1 ? "" : "s"}.</p>
      </header>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {stats.map((s) => (
          <div key={s.label} className="bg-white border border-[#E2E8F0] rounded-2xl p-5 shadow-sm">
            <p className="text-[10px] text-[#94A3B8] font-medium uppercase tracking-wide">{s.label}</p>
            <p className="text-2xl font-bold font-mono text-[#0F172A] mt-2 leading-none">{s.value}</p>
            {s.caption && <p className="text-[10px] text-[#94A3B8] mt-1.5">{s.caption}</p>}
          </div>
        ))}
      </div>

      {/* Best / worst metro */}
      {(profile.bestMetro || profile.worstMetro) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
          {profile.bestMetro && (
            <div className="flex items-center gap-3 rounded-2xl border border-[#A7F3D0] bg-[#ECFDF5] p-4">
              <TrendingUp size={18} className="text-[#059669]" />
              <div>
                <p className="text-[10px] text-[#059669] font-bold uppercase tracking-wide">Best Market</p>
                <p className="text-sm font-bold text-[#0F172A]">{profile.bestMetro.metro} · {profile.bestMetro.advantage.toFixed(1)}/10</p>
              </div>
            </div>
          )}
          {profile.worstMetro && (
            <div className="flex items-center gap-3 rounded-2xl border border-[#FECACA] bg-[#FEF2F2] p-4">
              <TrendingDown size={18} className="text-[#DC2626]" />
              <div>
                <p className="text-[10px] text-[#DC2626] font-bold uppercase tracking-wide">Toughest Market</p>
                <p className="text-sm font-bold text-[#0F172A]">{profile.worstMetro.metro} · {profile.worstMetro.advantage.toFixed(1)}/10</p>
              </div>
            </div>
          )}
        </div>
      )}

      {profile.activeIncentives && (
        <div className="rounded-2xl border border-[#E2E8F0] bg-white p-4 shadow-sm mb-6">
          <p className="text-[10px] font-bold text-[#94A3B8] uppercase tracking-[0.12em] mb-1">Active Incentives</p>
          <p className="text-sm text-[#374151]">{profile.activeIncentives}</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* By metro */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <MapPinned size={13} className="text-al-primary" />
            <p className="text-[10px] font-bold text-[#94A3B8] uppercase tracking-[0.15em]">Buyer Advantage by Metro</p>
          </div>
          <div className="rounded-2xl border border-[#E2E8F0] bg-white shadow-sm overflow-hidden">
            {profile.byMetro.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-[#94A3B8]">No metro scores yet.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC] text-left text-[10px] uppercase tracking-[0.12em] text-[#94A3B8]">
                    <th className="px-5 py-3 font-bold">Metro</th>
                    <th className="px-5 py-3 font-bold text-right">Advantage</th>
                    <th className="px-5 py-3 font-bold text-right">Dealers</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F1F5F9]">
                  {profile.byMetro.map((m) => (
                    <tr key={`${m.metro}-${m.state}`} className="hover:bg-[#F8FAFF] transition-colors">
                      <td className="px-5 py-3">
                        <Link href={`/admin/amips/metro/${encodeURIComponent(m.metro)}`} className="font-semibold text-[#0F172A] hover:text-al-primary transition-colors">{m.metro}</Link>
                        <span className="text-[10px] text-[#94A3B8] ml-1">{m.state}</span>
                      </td>
                      <td className="px-5 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <div className="h-1.5 w-16 rounded-full bg-[#F1F5F9] overflow-hidden">
                            <div className={`h-full rounded-full ${m.advantage >= 6 ? "bg-[#059669]" : "bg-al-primary"}`} style={{ width: `${(m.advantage / 10) * 100}%` }} />
                          </div>
                          <span className="font-mono font-semibold text-[#0F172A] w-8">{m.advantage.toFixed(1)}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3 text-right font-mono text-[#374151]">{m.dealers}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Pages */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <FileText size={13} className="text-al-primary" />
            <p className="text-[10px] font-bold text-[#94A3B8] uppercase tracking-[0.15em]">Published Pages ({profile.pages.length})</p>
          </div>
          <div className="rounded-2xl border border-[#E2E8F0] bg-white shadow-sm overflow-hidden">
            {profile.pages.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-[#94A3B8]">No pages published for this vehicle yet.</p>
            ) : (
              <div className="divide-y divide-[#F1F5F9]">
                {profile.pages.map((p) => (
                  <div key={p.slug} className="px-5 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <Link href={`/intelligence/${p.slug}`} className="text-sm font-medium text-[#0F172A] hover:text-al-primary transition-colors truncate">{p.title}</Link>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${LIFECYCLE_CHIP[p.lifecycleStatus] ?? "bg-[#F1F5F9] text-[#64748B]"}`}>{p.lifecycleStatus}</span>
                    </div>
                    <p className="text-[10px] text-[#94A3B8] mt-1 font-mono">{p.impressions.toLocaleString("en-US")} impressions · {p.clicks.toLocaleString("en-US")} clicks · {p.leads.toLocaleString("en-US")} leads</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
