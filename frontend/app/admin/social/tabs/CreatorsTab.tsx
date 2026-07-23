"use client";
// Creators tab — extracted from SocialDashboardClient.tsx (lazy-loaded). fmtUsd is
// Creators-only and kept local.
import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { fetchJson } from "../_shared/fetchJson";
import { fmtNum } from "../_shared/format";
import { StatCard } from "../_shared/StatCard";
import { PLATFORMS, platformIcon } from "../_shared/ui";
import type { CreatorsResponse } from "../_shared/types";

const CREATOR_STATUS_STYLES: Record<string, string> = {
  ACTIVE: "bg-emerald-100 text-emerald-700",
  PENDING: "bg-amber-100 text-amber-700",
  PAUSED: "bg-slate-100 text-slate-600",
  REMOVED: "bg-rose-100 text-rose-700",
};

function CreatorStatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold ${CREATOR_STATUS_STYLES[status] ?? "bg-slate-100 text-slate-600"}`}>
      {status}
    </span>
  );
}
function fmtUsd(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

const CREATOR_STATUSES = ["PENDING", "ACTIVE", "PAUSED", "REMOVED"] as const;

function CreatorsTab({ showToast }: { showToast: (m: string) => void }) {
  const [data, setData] = useState<CreatorsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await fetchJson<CreatorsResponse>("/api/admin/social/creators"));
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to load creators");
    } finally {
      setLoading(false);
    }
  }, [showToast]);
  useEffect(() => { void load(); }, [load]);

  // New-creator form state.
  const [form, setForm] = useState({
    name: "", email: "", platform: "instagram", handle: "",
    followerCount: "", commissionRate: "", affiliateId: "",
  });
  const [saving, setSaving] = useState(false);

  const createCreator = async () => {
    if (!form.name.trim()) { showToast("Name is required"); return; }
    setSaving(true);
    try {
      await fetchJson("/api/admin/social/creators", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      showToast("Creator added");
      setShowForm(false);
      setForm({ name: "", email: "", platform: "instagram", handle: "", followerCount: "", commissionRate: "", affiliateId: "" });
      await load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to add creator");
    } finally {
      setSaving(false);
    }
  };

  const updateCreator = async (id: string, patch: { commissionRate?: string; status?: string }) => {
    try {
      await fetchJson("/api/admin/social/creators", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...patch }),
      });
      setEditId(null);
      await load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to update creator");
    }
  };

  const stats = data?.stats;
  const creators = data?.creators ?? [];

  return (
    <div className="space-y-6">
      {/* Stats row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Total Creators" value={stats ? fmtNum(stats.total) : "—"} accent="text-al-primary" />
        <StatCard label="Active Creators" value={stats ? fmtNum(stats.active) : "—"} accent="text-emerald-600" />
        <StatCard label="Total Clicks" value={stats ? fmtNum(stats.totalClicks) : "—"} accent="text-indigo-600" />
        <StatCard label="Revenue Attributed" value={stats ? fmtUsd(stats.revenueAttributedCents) : "—"} accent="text-emerald-600" />
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2">
        <button
          data-testid="creator-add"
          onClick={() => setShowForm((s) => !s)}
          className="px-3 py-1.5 rounded-lg bg-al-primary text-white text-xs font-semibold hover:bg-al-primary-hover"
        >
          {showForm ? "Cancel" : "Add Creator"}
        </button>
        <button
          onClick={() => void load()}
          className="ml-auto flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white border border-[#E2E8F0] text-xs font-semibold text-[#64748B] hover:text-[#0F172A]"
        >
          <RefreshCw size={12} /> Refresh
        </button>
      </div>

      {/* Add-creator inline form */}
      {showForm && (
        <div className="bg-white border border-[#E2E8F0] rounded-2xl shadow-sm p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <label className="text-xs text-[#64748B] space-y-1">
            <span className="font-semibold">Name *</span>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full bg-white border border-[#E2E8F0] rounded-lg px-3 py-1.5 text-xs text-[#0F172A]" />
          </label>
          <label className="text-xs text-[#64748B] space-y-1">
            <span className="font-semibold">Email</span>
            <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
              className="w-full bg-white border border-[#E2E8F0] rounded-lg px-3 py-1.5 text-xs text-[#0F172A]" />
          </label>
          <label className="text-xs text-[#64748B] space-y-1">
            <span className="font-semibold">Platform</span>
            <select value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value })}
              className="w-full bg-white border border-[#E2E8F0] rounded-lg px-3 py-1.5 text-xs text-[#0F172A]">
              {PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          <label className="text-xs text-[#64748B] space-y-1">
            <span className="font-semibold">Handle</span>
            <input value={form.handle} onChange={(e) => setForm({ ...form, handle: e.target.value })}
              className="w-full bg-white border border-[#E2E8F0] rounded-lg px-3 py-1.5 text-xs text-[#0F172A]" />
          </label>
          <label className="text-xs text-[#64748B] space-y-1">
            <span className="font-semibold">Follower Count</span>
            <input type="number" value={form.followerCount} onChange={(e) => setForm({ ...form, followerCount: e.target.value })}
              className="w-full bg-white border border-[#E2E8F0] rounded-lg px-3 py-1.5 text-xs text-[#0F172A]" />
          </label>
          <label className="text-xs text-[#64748B] space-y-1">
            <span className="font-semibold">Commission Rate %</span>
            <input type="number" value={form.commissionRate} onChange={(e) => setForm({ ...form, commissionRate: e.target.value })}
              className="w-full bg-white border border-[#E2E8F0] rounded-lg px-3 py-1.5 text-xs text-[#0F172A]" />
          </label>
          <label className="text-xs text-[#64748B] space-y-1">
            <span className="font-semibold">Affiliate ID (optional)</span>
            <input value={form.affiliateId} onChange={(e) => setForm({ ...form, affiliateId: e.target.value })}
              className="w-full bg-white border border-[#E2E8F0] rounded-lg px-3 py-1.5 text-xs text-[#0F172A]" />
          </label>
          <div className="flex items-end">
            <button data-testid="creator-save" onClick={() => void createCreator()} disabled={saving}
              className="px-4 py-1.5 rounded-lg bg-al-primary text-white text-xs font-semibold hover:bg-al-primary-hover disabled:opacity-60">
              {saving ? "Saving…" : "Save Creator"}
            </button>
          </div>
        </div>
      )}

      {/* Creators table */}
      <div className="bg-white border border-[#E2E8F0] rounded-2xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-[#F8FAFC] text-[#64748B]">
              <tr>
                <th className="text-left font-semibold px-4 py-2">Name</th>
                <th className="text-left font-semibold px-4 py-2">Platform</th>
                <th className="text-left font-semibold px-4 py-2">Handle</th>
                <th className="text-left font-semibold px-4 py-2">Status</th>
                <th className="text-right font-semibold px-4 py-2">Packages Sent</th>
                <th className="text-right font-semibold px-4 py-2">Clicks</th>
                <th className="text-right font-semibold px-4 py-2">Leads</th>
                <th className="text-right font-semibold px-4 py-2">Revenue</th>
                <th className="text-right font-semibold px-4 py-2">Commission</th>
                <th className="text-right font-semibold px-4 py-2">Edit</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={10} className="px-4 py-8 text-center text-[#94A3B8]">Loading creators…</td></tr>
              )}
              {!loading && creators.length === 0 && (
                <tr><td colSpan={10} className="px-4 py-8 text-center text-[#94A3B8]">No creators yet.</td></tr>
              )}
              {!loading && creators.map((c) => (
                <tr key={c.id} className="border-t border-[#F1F5F9] hover:bg-[#F8FAFC]">
                  <td className="px-4 py-2 font-medium text-[#0F172A]">{c.name}</td>
                  <td className="px-4 py-2 capitalize text-[#475569]">
                    <span className="inline-flex items-center gap-1">{platformIcon(c.platform, 12)} {c.platform}</span>
                  </td>
                  <td className="px-4 py-2 text-[#475569]">{c.handle ?? "—"}</td>
                  <td className="px-4 py-2">
                    {editId === c.id ? (
                      <select defaultValue={c.status}
                        onChange={(e) => void updateCreator(c.id, { status: e.target.value })}
                        className="bg-white border border-[#E2E8F0] rounded-lg px-2 py-1 text-[10px] text-[#0F172A]">
                        {CREATOR_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    ) : (
                      <CreatorStatusBadge status={c.status} />
                    )}
                  </td>
                  <td className="px-4 py-2 text-right text-[#475569]">{fmtNum(c.packagesSent)}</td>
                  <td className="px-4 py-2 text-right text-[#475569]">{fmtNum(c.clicks)}</td>
                  <td className="px-4 py-2 text-right text-[#475569]">{fmtNum(c.leads)}</td>
                  <td className="px-4 py-2 text-right text-emerald-600 font-semibold">{fmtUsd(c.revenueCents)}</td>
                  <td className="px-4 py-2 text-right">
                    {editId === c.id ? (
                      <input type="number" defaultValue={c.commissionRate ?? 0}
                        onBlur={(e) => void updateCreator(c.id, { commissionRate: e.target.value })}
                        className="w-16 bg-white border border-[#E2E8F0] rounded-lg px-2 py-1 text-[10px] text-right text-[#0F172A]" />
                    ) : (
                      <span className="text-[#475569]">{c.commissionRate ?? 0}%</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button
                      onClick={() => setEditId(editId === c.id ? null : c.id)}
                      className="text-al-primary font-semibold hover:underline">
                      {editId === c.id ? "Done" : "Edit"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── Tab 6: Settings ─────────────────────────────────────────────────────────

export default CreatorsTab;
