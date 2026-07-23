"use client";
// Leads tab (+ lead drawer) — extracted from SocialDashboardClient.tsx (lazy-loaded).
import { useCallback, useEffect, useState } from "react";
import { RefreshCw, X, Users } from "lucide-react";
import { fetchJson } from "../_shared/fetchJson";
import { fmtDateTime, fmtNum } from "../_shared/format";
import { StatCard } from "../_shared/StatCard";
import { PLATFORMS, platformIcon, LeadStatusBadge } from "../_shared/ui";
import type { LeadsResponse, SocialLead } from "../_shared/types";

const LEAD_STATUS_FILTERS = ["all", "NEW", "NURTURING", "CONVERTED", "DEAD"] as const;

function LeadsTab({ showToast }: { showToast: (m: string) => void }) {
  const [data, setData] = useState<LeadsResponse | null>(null);
  const [status, setStatus] = useState<string>("all");
  const [platform, setPlatform] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<SocialLead | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "50" });
      if (status !== "all") params.set("status", status);
      if (platform !== "all") params.set("platform", platform);
      setData(await fetchJson<LeadsResponse>(`/api/admin/social/leads?${params.toString()}`));
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to load leads");
    } finally {
      setLoading(false);
    }
  }, [status, platform, showToast]);
  useEffect(() => { void load(); }, [load]);

  const stats = data?.stats;
  const leads = data?.leads ?? [];

  return (
    <div className="space-y-6">
      {/* Stats row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Leads This Week" value={stats ? fmtNum(stats.thisWeek) : "—"} accent="text-al-primary" />
        <StatCard label="Leads Today" value={stats ? fmtNum(stats.today) : "—"} accent="text-indigo-600" />
        <StatCard label="Top Platform" value={stats ? stats.topPlatform : "—"} />
        <StatCard label="Conversion Rate" value={stats ? `${stats.conversionRate}%` : "—"} accent="text-emerald-600" />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          {LEAD_STATUS_FILTERS.map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold capitalize transition-colors ${
                status === s ? "bg-al-primary text-white" : "bg-white border border-[#E2E8F0] text-[#64748B] hover:text-[#0F172A]"
              }`}
            >
              {s === "all" ? "All" : s.toLowerCase()}
            </button>
          ))}
        </div>
        <select
          value={platform}
          onChange={(e) => setPlatform(e.target.value)}
          className="ml-auto bg-white border border-[#E2E8F0] rounded-lg px-3 py-1.5 text-xs text-[#0F172A]"
        >
          <option value="all">All platforms</option>
          {PLATFORMS.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
        <button
          onClick={() => void load()}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white border border-[#E2E8F0] text-xs font-semibold text-[#64748B] hover:text-[#0F172A]"
        >
          <RefreshCw size={12} /> Refresh
        </button>
      </div>

      {/* Leads table */}
      <div className="bg-white border border-[#E2E8F0] rounded-2xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-[#F8FAFC] text-[#64748B]">
              <tr>
                <th className="text-left font-semibold px-4 py-2">Name</th>
                <th className="text-left font-semibold px-4 py-2">Email</th>
                <th className="text-left font-semibold px-4 py-2">Vehicle</th>
                <th className="text-left font-semibold px-4 py-2">Platform</th>
                <th className="text-left font-semibold px-4 py-2">Landing Page</th>
                <th className="text-left font-semibold px-4 py-2">Status</th>
                <th className="text-left font-semibold px-4 py-2">Step</th>
                <th className="text-left font-semibold px-4 py-2">Date</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-[#94A3B8]">Loading leads…</td></tr>
              )}
              {!loading && leads.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-[#94A3B8]">No social leads yet.</td></tr>
              )}
              {!loading && leads.map((lead) => (
                <tr
                  key={lead.id}
                  onClick={() => setSelected(lead)}
                  className="border-t border-[#F1F5F9] hover:bg-[#F8FAFC] cursor-pointer"
                >
                  <td className="px-4 py-2 font-medium text-[#0F172A]">
                    {lead.firstName} {lead.lastName ?? ""}
                  </td>
                  <td className="px-4 py-2 text-[#475569]">{lead.email}</td>
                  <td className="px-4 py-2 text-[#475569]">{lead.vehicleInterest ?? "—"}</td>
                  <td className="px-4 py-2 capitalize text-[#475569]">
                    <span className="inline-flex items-center gap-1">
                      {lead.platform ? platformIcon(lead.platform, 12) : null}
                      {lead.platform ?? "—"}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-[#475569]">{lead.landingPage ?? "—"}</td>
                  <td className="px-4 py-2"><LeadStatusBadge status={lead.status} /></td>
                  <td className="px-4 py-2 text-[#475569]">{lead.nurtureStep}/5</td>
                  <td className="px-4 py-2 text-[#475569]">{fmtDateTime(lead.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {selected && <LeadDrawer lead={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function LeadDrawer({ lead, onClose }: { lead: SocialLead; onClose: () => void }) {
  const rows: { label: string; value: string }[] = [
    { label: "Name", value: `${lead.firstName} ${lead.lastName ?? ""}`.trim() },
    { label: "Email", value: lead.email },
    { label: "Phone", value: lead.phone ?? "—" },
    { label: "Location", value: [lead.city, lead.state, lead.zip].filter(Boolean).join(", ") || "—" },
    { label: "Vehicle Interest", value: lead.vehicleInterest ?? "—" },
    { label: "Make / Model", value: [lead.make, lead.model].filter(Boolean).join(" ") || "—" },
    { label: "Budget", value: lead.budget ?? "—" },
    { label: "Timeline", value: lead.timeline ?? "—" },
    { label: "Platform", value: lead.platform ?? "—" },
    { label: "Franchise", value: lead.franchise ?? "—" },
    { label: "Landing Page", value: lead.landingPage ?? "—" },
    { label: "UTM Source", value: lead.utmSource ?? "—" },
    { label: "UTM Campaign", value: lead.utmCampaign ?? "—" },
    { label: "UTM Content", value: lead.utmContent ?? "—" },
    { label: "UTM Hook", value: lead.utmHook ?? "—" },
    { label: "Created", value: fmtDateTime(lead.createdAt) },
  ];

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40" onClick={onClose}>
      <div
        className="w-full max-w-md h-full bg-white shadow-2xl overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#E2E8F0] sticky top-0 bg-white">
          <div className="flex items-center gap-2">
            <Users size={16} className="text-al-primary" />
            <h2 className="text-sm font-bold text-[#0F172A]">Lead Detail</h2>
            <LeadStatusBadge status={lead.status} />
          </div>
          <button onClick={onClose} className="text-[#94A3B8] hover:text-[#0F172A]"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-1">
          {rows.map((r) => (
            <div key={r.label} className="flex justify-between gap-4 py-1.5 border-b border-[#F1F5F9] text-xs">
              <span className="text-[#64748B]">{r.label}</span>
              <span className="text-[#0F172A] font-medium text-right break-all">{r.value}</span>
            </div>
          ))}
        </div>

        {/* Nurture history */}
        <div className="px-5 pb-6">
          <h3 className="text-xs font-bold text-[#0F172A] mb-2 mt-2">Nurture History</h3>
          <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl p-4 space-y-1.5 text-xs">
            <div className="flex justify-between"><span className="text-[#64748B]">Sequence</span><span className="text-[#0F172A] font-medium">{lead.nurtureSequence ?? "—"}</span></div>
            <div className="flex justify-between"><span className="text-[#64748B]">Step</span><span className="text-[#0F172A] font-medium">{lead.nurtureStep} of 5</span></div>
            <div className="flex justify-between"><span className="text-[#64748B]">Last Email Sent</span><span className="text-[#0F172A] font-medium">{fmtDateTime(lead.lastEmailSentAt)}</span></div>
            <div className="flex justify-between"><span className="text-[#64748B]">Converted</span><span className="text-[#0F172A] font-medium">{fmtDateTime(lead.convertedAt)}</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}


export default LeadsTab;
