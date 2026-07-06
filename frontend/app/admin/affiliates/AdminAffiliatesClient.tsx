"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import {
  Users, Search, RefreshCw, ChevronDown, X,
  SlidersHorizontal, CheckCircle2, Clock,
  Ban, XCircle, Share2, UserCheck, DollarSign,
  CreditCard, Trophy, AlertTriangle, Eye,
  FileText, ShieldAlert,
} from "lucide-react";
import type { AdminAffiliateKpis } from "@/lib/services/admin/admin-affiliate-command-center.service";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AffiliateListRow {
  id: string;
  email: string;
  referralCode: string;
  status: string;
  level: number;
  website: string | null;
  promotionMethod: string | null;
  commissionsCount: number;
  payoutsCount: number;
  childrenCount: number;
  referralsCount: number;
  totalEarnedCents: number;
  pendingPayoutCents: number;
  earningsTier: string;
  hasComplianceFlag: boolean;
  createdAt: string;
}

interface Props {
  initialAffiliates: AffiliateListRow[];
  initialTotal: number;
  kpis: AdminAffiliateKpis;
}

type ActionType = "approve" | "reject" | "suspend" | "reactivate" | "note";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function fmtCents(cents: number): string {
  return "$" + (cents / 100).toLocaleString();
}

// ─── Badges ───────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { variant: "amber" | "green" | "destructive" | "secondary"; label: string }> = {
    PENDING: { variant: "amber", label: "Pending" },
    ACTIVE: { variant: "green", label: "Active" },
    SUSPENDED: { variant: "destructive", label: "Suspended" },
    REJECTED: { variant: "secondary", label: "Rejected" },
  };
  const cfg = map[status] ?? { variant: "secondary" as const, label: status };
  return <Badge variant={cfg.variant} className="text-[10px] font-semibold">{cfg.label}</Badge>;
}

function LevelBadge({ level }: { level: number }) {
  const colors = ["secondary", "blue", "amber", "default"] as const;
  const variant = colors[Math.min(level - 1, 3)] ?? "secondary";
  return <Badge variant={variant} className="text-[10px]">L{level}</Badge>;
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({ icon, label, value, color }: {
  icon: React.ReactNode; label: string; value: string | number; color: string;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 flex items-start gap-3 shadow-sm hover:shadow-md transition-shadow">
      <div className={"w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 " + color}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-2xl font-bold text-slate-900 leading-none">
          {typeof value === "number" ? value.toLocaleString() : value}
        </p>
        <p className="text-xs text-slate-500 mt-1 leading-snug">{label}</p>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function AdminAffiliatesClient({ initialAffiliates, initialTotal, kpis }: Props) {
  const [affiliates, setAffiliates] = useState<AffiliateListRow[]>(initialAffiliates);
  const [total, setTotal] = useState(initialTotal);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [levelFilter, setLevelFilter] = useState("");
  const [earningsTierFilter, setEarningsTierFilter] = useState("");
  const [registeredAfter, setRegisteredAfter] = useState("");
  const [registeredBefore, setRegisteredBefore] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const perPage = 50;

  const [actionModal, setActionModal] = useState<{
    type: ActionType;
    affiliateId: string;
    affiliateEmail: string;
  } | null>(null);
  const [actionInput, setActionInput] = useState("");
  const [actionLoading, setActionLoading] = useState(false);

  const showToast = (msg: string, type: "success" | "error" = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const fetchAffiliates = useCallback(async (params: Record<string, string>) => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams(params).toString();
      const res = await fetch("/api/admin/affiliates?" + qs);
      if (!res.ok) {
        let errMsg = "Failed to load affiliates";
        try {
          const errData = await res.json() as { error?: { message: string } };
          if (errData.error?.message) errMsg = errData.error.message;
        } catch { /* ignore */ }
        throw new Error(errMsg);
      }
      const data = await res.json() as { data?: { affiliates: AffiliateListRow[]; total: number } };
      if (data.data) { setAffiliates(data.data.affiliates); setTotal(data.data.total); }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load affiliates");
    } finally {
      setLoading(false);
    }
  }, []);

  const applyFilters = useCallback((overridePage?: number) => {
    const p = overridePage ?? 1;
    setPage(p);
    const params: Record<string, string> = { page: String(p), perPage: String(perPage) };
    if (query) params.q = query;
    if (statusFilter) params.status = statusFilter;
    if (levelFilter) params.level = levelFilter;
    if (earningsTierFilter) params.earningsTier = earningsTierFilter;
    if (registeredAfter) params.registeredAfter = registeredAfter;
    if (registeredBefore) params.registeredBefore = registeredBefore;
    fetchAffiliates(params);
  }, [query, statusFilter, levelFilter, earningsTierFilter, registeredAfter, registeredBefore, fetchAffiliates]);

  const clearFilters = () => {
    setQuery(""); setStatusFilter(""); setLevelFilter("");
    setEarningsTierFilter(""); setRegisteredAfter(""); setRegisteredBefore("");
    fetchAffiliates({ page: "1", perPage: String(perPage) });
  };

  const hasFilters = !!(query || statusFilter || levelFilter || earningsTierFilter || registeredAfter || registeredBefore);

  function openAction(type: ActionType, affiliateId: string, affiliateEmail: string) {
    setActionInput("");
    setActionModal({ type, affiliateId, affiliateEmail });
    setOpenMenu(null);
  }

  async function submitActionModal(e: React.FormEvent) {
    e.preventDefault();
    if (!actionModal) return;
    if (actionModal.type !== "approve" && !actionInput.trim()) return;
    setActionLoading(true);
    try {
      const endpointMap: Record<ActionType, string> = {
        approve: `/api/admin/affiliates/${actionModal.affiliateId}/approve`,
        reject: `/api/admin/affiliates/${actionModal.affiliateId}/reject`,
        suspend: `/api/admin/affiliates/${actionModal.affiliateId}/suspend`,
        reactivate: `/api/admin/affiliates/${actionModal.affiliateId}/reactivate`,
        note: `/api/admin/affiliates/${actionModal.affiliateId}/note`,
      };
      const bodyMap: Record<ActionType, object> = {
        approve: { reason: actionInput.trim() || "Approved from affiliates list" },
        reject: { reason: actionInput.trim() },
        suspend: { reason: actionInput.trim() },
        reactivate: { reason: actionInput.trim() },
        note: { content: actionInput.trim(), type: "GENERAL" },
      };
      const successMap: Record<ActionType, string> = {
        approve: `${actionModal.affiliateEmail} approved`,
        reject: `${actionModal.affiliateEmail} rejected`,
        suspend: `${actionModal.affiliateEmail} suspended`,
        reactivate: `${actionModal.affiliateEmail} reactivated`,
        note: `Note added to ${actionModal.affiliateEmail}`,
      };
      const res = await fetch(endpointMap[actionModal.type], {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bodyMap[actionModal.type]),
      });
      if (res.ok) {
        showToast(successMap[actionModal.type]);
        applyFilters();
      } else {
        const d = await res.json() as { error?: { message: string } };
        showToast(d.error?.message ?? "Action failed", "error");
      }
    } finally {
      setActionLoading(false);
      setActionModal(null);
      setActionInput("");
    }
  }

  const modalConfig: Record<ActionType, { title: string; placeholder: string; submitLabel: string; destructive: boolean; requireReason: boolean }> = {
    approve: { title: "Approve Affiliate", placeholder: "Approval reason (optional)…", submitLabel: "Approve Affiliate", destructive: false, requireReason: false },
    reject: { title: "Reject Affiliate", placeholder: "Reason for rejection (required)…", submitLabel: "Reject Affiliate", destructive: true, requireReason: true },
    suspend: { title: "Suspend Affiliate", placeholder: "Reason for suspension (required)…", submitLabel: "Suspend Affiliate", destructive: true, requireReason: true },
    reactivate: { title: "Reactivate Affiliate", placeholder: "Reason for reactivation…", submitLabel: "Reactivate", destructive: false, requireReason: true },
    note: { title: "Add Internal Note", placeholder: "Note content…", submitLabel: "Add Note", destructive: false, requireReason: true },
  };

  const totalPages = Math.ceil(total / perPage);

  return (
    <div className="p-4 md:p-6 lg:p-8 min-h-screen bg-slate-50" data-testid="admin-affiliates-page">
      {/* Toast */}
      {toast && (
        <div className={"fixed top-4 right-4 z-50 px-4 py-3 rounded-xl text-sm shadow-xl font-medium flex items-center gap-2 " + (toast.type === "success" ? "bg-green-600 text-white" : "bg-red-600 text-white")}>
          {toast.type === "success" ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
          {toast.msg}
        </div>
      )}

      {/* Action Modal */}
      {actionModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={(e) => e.target === e.currentTarget && setActionModal(null)}>
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h3 className={"font-bold text-lg " + (modalConfig[actionModal.type].destructive ? "text-red-700" : "text-slate-900")}>
                {modalConfig[actionModal.type].title}
              </h3>
              <button onClick={() => setActionModal(null)} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
            </div>
            <p className="text-slate-600 text-sm mb-4">
              Affiliate: <strong>{actionModal.affiliateEmail}</strong>
            </p>
            <form onSubmit={submitActionModal} className="space-y-3">
              <textarea
                value={actionInput}
                onChange={(e) => setActionInput(e.target.value)}
                rows={3}
                required={modalConfig[actionModal.type].requireReason}
                placeholder={modalConfig[actionModal.type].placeholder}
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-slate-800 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
              <div className="flex gap-3">
                <button type="button" onClick={() => setActionModal(null)} className="flex-1 border border-slate-200 text-slate-600 rounded-lg py-2.5 text-sm hover:bg-slate-50 transition-colors">Cancel</button>
                <button
                  type="submit"
                  disabled={actionLoading || (modalConfig[actionModal.type].requireReason && !actionInput.trim())}
                  className={"flex-1 rounded-lg py-2.5 text-sm font-semibold text-white disabled:opacity-50 transition-colors " + (modalConfig[actionModal.type].destructive ? "bg-red-600 hover:bg-red-700" : "bg-al-primary hover:bg-purple-800")}
                >
                  {actionLoading ? "Processing…" : modalConfig[actionModal.type].submitLabel}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-al-primary flex items-center justify-center">
            <Share2 size={18} className="text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 leading-none">Affiliate Operations</h1>
            <p className="text-xs text-slate-500 mt-0.5">{total.toLocaleString()} total affiliates</p>
          </div>
        </div>
      </div>

      {/* KPI Cards — Row 1 */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-3">
        <KpiCard icon={<Users size={16} className="text-purple-700" />} label="Total Affiliates" value={kpis.total} color="bg-purple-50" />
        <KpiCard icon={<Clock size={16} className="text-amber-700" />} label="Pending" value={kpis.pending} color="bg-amber-50" />
        <KpiCard icon={<CheckCircle2 size={16} className="text-green-700" />} label="Active" value={kpis.active} color="bg-green-50" />
        <KpiCard icon={<Ban size={16} className="text-red-700" />} label="Suspended" value={kpis.suspended} color="bg-red-50" />
        <KpiCard icon={<XCircle size={16} className="text-slate-500" />} label="Rejected" value={kpis.rejected} color="bg-slate-100" />
      </div>
      {/* KPI Cards — Row 2 */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
        <KpiCard icon={<Share2 size={16} className="text-blue-700" />} label="Total Referrals" value={kpis.totalReferrals} color="bg-blue-50" />
        <KpiCard icon={<UserCheck size={16} className="text-emerald-700" />} label="Converted Referrals" value={kpis.convertedReferrals} color="bg-emerald-50" />
        <KpiCard icon={<DollarSign size={16} className="text-orange-700" />} label="Commissions Pending" value={fmtCents(kpis.commissionsPendingCents)} color="bg-orange-50" />
        <KpiCard icon={<CreditCard size={16} className="text-teal-700" />} label="Commissions Paid" value={fmtCents(kpis.commissionsPaidCents)} color="bg-teal-50" />
        <KpiCard icon={<Trophy size={16} className="text-yellow-600" />} label="High Performing" value={kpis.highPerforming} color="bg-yellow-50" />
      </div>

      {/* Search + Filter Bar */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4 mb-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1 relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && applyFilters()}
              placeholder="Search by email or referral code…"
              className="w-full pl-9 pr-4 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
          </div>
          <button
            onClick={() => setShowFilters((v) => !v)}
            className={"flex items-center gap-2 px-4 py-2.5 border rounded-xl text-sm font-medium transition-colors " + (showFilters ? "bg-purple-50 border-purple-300 text-purple-700" : "border-slate-200 text-slate-600 hover:bg-slate-50")}
          >
            <SlidersHorizontal size={14} /> Filters <ChevronDown size={12} className={"transition-transform " + (showFilters ? "rotate-180" : "")} />
          </button>
          <button
            onClick={() => applyFilters()}
            disabled={loading}
            className="px-5 py-2.5 bg-al-primary hover:bg-purple-800 text-white rounded-xl text-sm font-semibold transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {loading ? <RefreshCw size={14} className="animate-spin" /> : null}
            Search
          </button>
          {hasFilters && (
            <button onClick={clearFilters} className="px-3 py-2.5 border border-slate-200 text-slate-500 rounded-xl text-sm hover:bg-slate-50 flex items-center gap-1">
              <X size={13} /> Clear
            </button>
          )}
        </div>

        {showFilters && (
          <div className="mt-3 pt-3 border-t border-slate-100 flex flex-wrap gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Status</label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-purple-500 bg-white"
              >
                <option value="">All Statuses</option>
                <option value="PENDING">Pending</option>
                <option value="ACTIVE">Active</option>
                <option value="SUSPENDED">Suspended</option>
                <option value="REJECTED">Rejected</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Level</label>
              <select
                value={levelFilter}
                onChange={(e) => setLevelFilter(e.target.value)}
                className="border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-purple-500 bg-white"
              >
                <option value="">All Levels</option>
                <option value="1">Level 1</option>
                <option value="2">Level 2</option>
                <option value="3">Level 3</option>
                <option value="4">Level 4</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Earnings Tier</label>
              <select
                value={earningsTierFilter}
                onChange={(e) => setEarningsTierFilter(e.target.value)}
                className="border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-purple-500 bg-white"
              >
                <option value="">All Tiers</option>
                <option value="none">None ($0)</option>
                <option value="low">Low (&lt; $100)</option>
                <option value="mid">Mid ($100–$1k)</option>
                <option value="high">High (&gt; $1k)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Registered After</label>
              <input
                type="date"
                value={registeredAfter}
                onChange={(e) => setRegisteredAfter(e.target.value)}
                className="border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-purple-500 bg-white"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Registered Before</label>
              <input
                type="date"
                value={registeredBefore}
                onChange={(e) => setRegisteredBefore(e.target.value)}
                className="border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-purple-500 bg-white"
              />
            </div>
          </div>
        )}
      </div>

      {/* Table */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="hidden lg:grid grid-cols-[2fr_1.2fr_0.8fr_0.7fr_0.8fr_0.8fr_1fr_100px] gap-2 px-5 py-3 border-b border-slate-100 bg-slate-50/50">
          {["Email", "Referral Code", "Status", "Referrals", "Total Earned", "Pending Payout", "Joined", "Actions"].map((h) => (
            <span key={h} className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">{h}</span>
          ))}
        </div>

        {loading && (
          <div className="divide-y divide-slate-50" data-testid="affiliates-skeleton" aria-busy="true">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-5 py-3.5 animate-pulse">
                <div className="flex-1 min-w-0">
                  <div className="h-3.5 w-48 bg-slate-200 rounded mb-1.5" />
                  <div className="h-2.5 w-20 bg-slate-100 rounded" />
                </div>
                <div className="hidden lg:block h-5 w-24 bg-slate-100 rounded-lg" />
                <div className="hidden lg:block h-5 w-16 bg-slate-100 rounded-full" />
                <div className="hidden lg:block h-3 w-10 bg-slate-100 rounded" />
                <div className="hidden lg:block h-3 w-16 bg-slate-100 rounded" />
                <div className="hidden lg:block h-3 w-16 bg-slate-100 rounded" />
                <div className="hidden lg:block h-3 w-16 bg-slate-100 rounded" />
                <div className="h-7 w-16 bg-slate-100 rounded-lg" />
              </div>
            ))}
          </div>
        )}

        {!loading && error && (
          <div className="py-16 text-center">
            <AlertTriangle size={32} className="text-red-400 mx-auto mb-3" />
            <p className="text-slate-700 font-semibold">{error}</p>
            <button onClick={() => applyFilters()} className="mt-3 text-purple-600 text-sm hover:underline">Retry</button>
          </div>
        )}

        {!loading && !error && affiliates.length === 0 && (
          <div className="py-16 text-center">
            <Users size={40} className="text-slate-300 mx-auto mb-3" />
            <p className="text-slate-600 font-semibold text-base">No affiliates found</p>
            <p className="text-slate-400 text-sm mt-1">
              {hasFilters ? "Try adjusting your filters or search query." : "No affiliates found in the system."}
            </p>
            {hasFilters && (
              <button onClick={clearFilters} className="mt-3 text-purple-600 text-sm hover:underline">Clear filters</button>
            )}
          </div>
        )}

        {!loading && !error && affiliates.map((a) => (
          <div
            key={a.id}
            className={"grid lg:grid-cols-[2fr_1.2fr_0.8fr_0.7fr_0.8fr_0.8fr_1fr_100px] gap-2 px-5 py-3.5 border-b border-slate-50 hover:bg-slate-50/80 transition-colors " + (a.hasComplianceFlag ? "border-l-2 border-l-orange-400" : "")}
          >
            {/* Email */}
            <div className="flex flex-col justify-center min-w-0">
              <div className="flex items-center gap-1.5">
                <Link href={"/admin/affiliates/" + a.id} className="font-semibold text-slate-900 text-sm hover:text-purple-700 transition-colors truncate">
                  {a.email}
                </Link>
                <LevelBadge level={a.level} />
                {a.hasComplianceFlag && (
                  <ShieldAlert size={11} className="text-orange-500 flex-shrink-0" />
                )}
              </div>
              <span className="text-[11px] text-slate-400 truncate">{a.id.slice(-8)}</span>
            </div>

            {/* Referral Code */}
            <div className="items-center min-w-0 hidden lg:flex">
              <CopyableBadge value={a.referralCode} />
            </div>

            {/* Status */}
            <div className="items-center hidden lg:flex">
              <StatusBadge status={a.status} />
            </div>

            {/* Referrals */}
            <div className="items-center hidden lg:flex">
              <span className="text-sm font-medium text-slate-700">{a.referralsCount}</span>
            </div>

            {/* Total Earned */}
            <div className="items-center hidden lg:flex">
              <span className="text-sm font-semibold text-slate-800">{fmtCents(a.totalEarnedCents)}</span>
            </div>

            {/* Pending Payout */}
            <div className="items-center hidden lg:flex">
              <span className={"text-sm font-medium " + (a.pendingPayoutCents > 0 ? "text-amber-600" : "text-slate-300")}>
                {fmtCents(a.pendingPayoutCents)}
              </span>
            </div>

            {/* Joined */}
            <div className="items-center hidden lg:flex">
              <span className="text-xs text-slate-400">{fmtDate(a.createdAt)}</span>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-1 relative">
              <Link
                href={"/admin/affiliates/" + a.id}
                className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-purple-100 text-slate-600 hover:text-purple-700 flex items-center justify-center transition-colors"
                title="View affiliate"
              >
                <Eye size={13} />
              </Link>
              <div className="relative">
                <button
                  onClick={() => setOpenMenu(openMenu === a.id ? null : a.id)}
                  className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center transition-colors"
                  title="More actions"
                >
                  <ChevronDown size={13} />
                </button>
                {openMenu === a.id && (
                  <div className="absolute right-0 top-8 z-30 bg-white border border-slate-200 rounded-xl shadow-xl py-1 min-w-[200px]" onMouseLeave={() => setOpenMenu(null)}>
                    <Link href={"/admin/affiliates/" + a.id} className="flex items-center gap-2.5 px-3.5 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors" onClick={() => setOpenMenu(null)}>
                      <Eye size={13} /> View Command Center
                    </Link>
                    <div className="border-t border-slate-100 my-1" />
                    <Link href={"/admin/affiliates/" + a.id + "?tab=referrals"} className="flex items-center gap-2.5 px-3.5 py-2 text-sm text-slate-600 hover:bg-slate-50 transition-colors" onClick={() => setOpenMenu(null)}>
                      <Share2 size={13} /> View Referrals
                    </Link>
                    <Link href={"/admin/affiliates/" + a.id + "?tab=commissions"} className="flex items-center gap-2.5 px-3.5 py-2 text-sm text-slate-600 hover:bg-slate-50 transition-colors" onClick={() => setOpenMenu(null)}>
                      <CreditCard size={13} /> View Commissions
                    </Link>
                    <Link href={"/admin/affiliates/" + a.id + "?tab=payouts"} className="flex items-center gap-2.5 px-3.5 py-2 text-sm text-slate-600 hover:bg-slate-50 transition-colors" onClick={() => setOpenMenu(null)}>
                      <DollarSign size={13} /> View Payouts
                    </Link>
                    <div className="border-t border-slate-100 my-1" />
                    {(a.status === "PENDING" || a.status === "REJECTED" || a.status === "SUSPENDED") && (
                      <button onClick={() => openAction("approve", a.id, a.email)} className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-green-700 hover:bg-green-50 transition-colors text-left">
                        <CheckCircle2 size={13} /> Approve
                      </button>
                    )}
                    {a.status === "PENDING" && (
                      <button onClick={() => openAction("reject", a.id, a.email)} className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors text-left">
                        <XCircle size={13} /> Reject
                      </button>
                    )}
                    {a.status === "ACTIVE" && (
                      <button onClick={() => openAction("suspend", a.id, a.email)} className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-amber-700 hover:bg-amber-50 transition-colors text-left">
                        <Ban size={13} /> Suspend
                      </button>
                    )}
                    {a.status === "SUSPENDED" && (
                      <button onClick={() => openAction("reactivate", a.id, a.email)} className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-blue-700 hover:bg-blue-50 transition-colors text-left">
                        <CheckCircle2 size={13} /> Reactivate
                      </button>
                    )}
                    <div className="border-t border-slate-100 my-1" />
                    <button onClick={() => openAction("note", a.id, a.email)} className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors text-left">
                      <FileText size={13} /> Add Note
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}

        {/* Footer */}
        {!loading && !error && affiliates.length > 0 && (
          <div className="px-5 py-3 bg-slate-50/50 border-t border-slate-100 flex items-center justify-between">
            <span className="text-xs text-slate-500">Showing {affiliates.length} of {total.toLocaleString()} affiliates</span>
            {totalPages > 1 && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { const p = Math.max(1, page - 1); applyFilters(p); }}
                  disabled={page <= 1}
                  className="px-3 py-1.5 text-xs font-medium border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 disabled:opacity-40 transition-colors"
                >
                  Previous
                </button>
                <span className="text-xs text-slate-500">Page {page} of {totalPages}</span>
                <button
                  onClick={() => { const p = Math.min(totalPages, page + 1); applyFilters(p); }}
                  disabled={page >= totalPages}
                  className="px-3 py-1.5 text-xs font-medium border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 disabled:opacity-40 transition-colors"
                >
                  Next
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function CopyableBadge({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }
  return (
    <button
      onClick={copy}
      title="Copy referral code"
      className="flex items-center gap-1 font-mono text-xs bg-slate-100 hover:bg-purple-50 text-slate-700 hover:text-purple-700 px-2 py-1 rounded-lg transition-colors"
    >
      {copied ? <CheckCircle2 size={10} className="text-green-600" /> : null}
      {value}
    </button>
  );
}
