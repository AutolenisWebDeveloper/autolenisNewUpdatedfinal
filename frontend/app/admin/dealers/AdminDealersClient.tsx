"use client";

import StatCard from "@/components/ui/patterns/StatCard";
import { useState, useCallback } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import {
  Users, Search, RefreshCw, ChevronDown, X,
  SlidersHorizontal, CheckCircle2, Clock,
  Ban, XCircle, Gavel, FileText, Trophy, Package,
  ShieldAlert, AlertTriangle, Eye,
  ClipboardList, UserPlus,
} from "lucide-react";
import type { AdminDealerKpis } from "@/lib/services/admin/admin-dealer-command-center.service";
import { api, apiErrorMessage } from "@/lib/api/client";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DealerListRow {
  id: string;
  dealershipName: string;
  email: string;
  phone: string | null;
  city: string | null;
  state: string | null;
  status: string;
  tier: string;
  scorecardTier: string | null;
  onboardingStep: string;
  inventoryCount: number;
  offerCount: number;
  invitationCount: number;
  activeBids: number;
  dealsWon: number;
  approvalDate: string | null;
  hasComplianceFlag: boolean;
  createdAt: string;
}

interface Props {
  initialDealers: DealerListRow[];
  initialTotal: number;
  kpis: AdminDealerKpis;
}

type ActionType = "approve" | "suspend" | "reactivate" | "terminate" | "note";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// ─── Badges ───────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { variant: "amber" | "green" | "destructive" | "secondary"; label: string }> = {
    PENDING: { variant: "amber", label: "Pending" },
    ACTIVE: { variant: "green", label: "Active" },
    SUSPENDED: { variant: "destructive", label: "Suspended" },
    TERMINATED: { variant: "secondary", label: "Terminated" },
  };
  const cfg = map[status] ?? { variant: "secondary" as const, label: status };
  return <Badge variant={cfg.variant} className="text-[10px] font-semibold">{cfg.label}</Badge>;
}

function TierBadge({ tier }: { tier: string }) {
  const map: Record<string, { variant: "secondary" | "amber" | "default" | "blue"; label: string }> = {
    STANDARD: { variant: "secondary", label: "Standard" },
    SILVER: { variant: "secondary", label: "Silver" },
    GOLD: { variant: "amber", label: "Gold" },
    PLATINUM: { variant: "default", label: "Platinum" },
  };
  const cfg = map[tier] ?? { variant: "secondary" as const, label: tier };
  return <Badge variant={cfg.variant} className="text-[10px]">{cfg.label}</Badge>;
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

// ─── Main Component ───────────────────────────────────────────────────────────

export function AdminDealersClient({ initialDealers, initialTotal, kpis }: Props) {
  const [dealers, setDealers] = useState<DealerListRow[]>(initialDealers);
  const [total, setTotal] = useState(initialTotal);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [tierFilter, setTierFilter] = useState("");
  const [inventoryTypeFilter, setInventoryTypeFilter] = useState("");
  const [serviceAreaFilter, setServiceAreaFilter] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const perPage = 50;

  // Action modal state
  const [actionModal, setActionModal] = useState<{
    type: ActionType;
    dealerId: string;
    dealerName: string;
  } | null>(null);
  const [actionInput, setActionInput] = useState("");
  const [actionLoading, setActionLoading] = useState(false);

  const showToast = (msg: string, type: "success" | "error" = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const fetchDealers = useCallback(async (params: Record<string, string>) => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams(params).toString();
      const data = await api.get<{ dealers: DealerListRow[]; total: number }>("/api/admin/dealers?" + qs);
      setDealers(data.dealers); setTotal(data.total);
    } catch (err) {
      setError(apiErrorMessage(err, "Failed to load dealers"));
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
    if (tierFilter) params.tier = tierFilter;
    if (inventoryTypeFilter) params.inventoryType = inventoryTypeFilter;
    if (serviceAreaFilter) params.serviceArea = serviceAreaFilter.trim();
    fetchDealers(params);
  }, [query, statusFilter, tierFilter, inventoryTypeFilter, serviceAreaFilter, fetchDealers]);

  const clearFilters = () => {
    setQuery(""); setStatusFilter(""); setTierFilter("");
    setInventoryTypeFilter(""); setServiceAreaFilter("");
    fetchDealers({ page: "1", perPage: String(perPage) });
  };

  const hasFilters = !!(query || statusFilter || tierFilter || inventoryTypeFilter || serviceAreaFilter);

  function openAction(type: ActionType, dealerId: string, dealerName: string) {
    setActionInput("");
    setActionModal({ type, dealerId, dealerName });
    setOpenMenu(null);
  }

  async function submitActionModal(e: React.FormEvent) {
    e.preventDefault();
    if (!actionModal) return;
    if (actionModal.type !== "approve" && !actionInput.trim()) return;
    setActionLoading(true);
    try {
      const endpointMap: Record<ActionType, string> = {
        approve: `/api/admin/dealers/${actionModal.dealerId}/approve`,
        suspend: `/api/admin/dealers/${actionModal.dealerId}/suspend`,
        reactivate: `/api/admin/dealers/${actionModal.dealerId}/reactivate`,
        terminate: `/api/admin/dealers/${actionModal.dealerId}/terminate`,
        note: `/api/admin/dealers/${actionModal.dealerId}/note`,
      };
      const bodyMap: Record<ActionType, object> = {
        approve: { reason: actionInput.trim() || "Approved from dealers list" },
        suspend: { reason: actionInput.trim() },
        reactivate: { reason: actionInput.trim() },
        terminate: { reason: actionInput.trim() },
        note: { content: actionInput.trim(), type: "GENERAL" },
      };
      const successMap: Record<ActionType, string> = {
        approve: `${actionModal.dealerName} approved`,
        suspend: `${actionModal.dealerName} suspended`,
        reactivate: `${actionModal.dealerName} reactivated`,
        terminate: `${actionModal.dealerName} terminated`,
        note: `Note added to ${actionModal.dealerName}`,
      };
      try {
        await api.post(endpointMap[actionModal.type], bodyMap[actionModal.type]);
        showToast(successMap[actionModal.type]);
        applyFilters();
      } catch (err) {
        showToast(apiErrorMessage(err, "Action failed"), "error");
      }
    } finally {
      setActionLoading(false);
      setActionModal(null);
      setActionInput("");
    }
  }

  const modalConfig: Record<ActionType, { title: string; placeholder: string; submitLabel: string; destructive: boolean; requireReason: boolean }> = {
    approve: { title: "Approve Dealer", placeholder: "Approval reason (optional)…", submitLabel: "Approve Dealer", destructive: false, requireReason: false },
    suspend: { title: "Suspend Dealer", placeholder: "Reason for suspension (required)…", submitLabel: "Suspend Dealer", destructive: true, requireReason: true },
    reactivate: { title: "Reactivate Dealer", placeholder: "Reason for reactivation…", submitLabel: "Reactivate", destructive: false, requireReason: true },
    terminate: { title: "Terminate Dealer", placeholder: "Reason for termination (required)…", submitLabel: "Terminate Dealer", destructive: true, requireReason: true },
    note: { title: "Add Internal Note", placeholder: "Note content…", submitLabel: "Add Note", destructive: false, requireReason: true },
  };

  const totalPages = Math.ceil(total / perPage);

  return (
    <div className="p-4 md:p-6 lg:p-8 min-h-screen bg-slate-50" data-testid="admin-dealers-page">
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
              Dealer: <strong>{actionModal.dealerName}</strong>
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
            <Users size={18} className="text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 leading-none">Dealer Operations</h1>
            <p className="text-xs text-slate-500 mt-0.5">{total.toLocaleString()} total dealers</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Link
            href="/admin/dealers/applications"
            data-testid="admin-dealers-applications-link"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 border border-slate-200 hover:border-amber-300 hover:bg-amber-50 text-slate-700 hover:text-amber-700 rounded-lg text-xs font-semibold transition-colors"
          >
            <ClipboardList size={13} />
            Pending Applications
            {kpis.pending > 0 && (
              <span className="ml-1 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-amber-100 text-amber-700 text-[10px] font-bold">
                {kpis.pending}
              </span>
            )}
          </Link>
          <Link
            href="/admin/dealers/invite"
            data-testid="admin-dealers-invite-link"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-al-primary hover:bg-al-primary-hover text-white rounded-lg text-xs font-semibold transition-colors"
          >
            <UserPlus size={13} />
            Invite Dealer
          </Link>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
        <StatCard icon={Users} label="Total Dealers" value={kpis.total.toLocaleString()} tone="indigo" testId="kpi-dealers-total" />
        <StatCard icon={Clock} label="Pending Applications" value={kpis.pending.toLocaleString()} tone="warning" testId="kpi-dealers-pending" />
        <StatCard icon={CheckCircle2} label="Active Dealers" value={kpis.active.toLocaleString()} tone="success" testId="kpi-dealers-active" />
        <StatCard icon={Ban} label="Suspended" value={kpis.suspended.toLocaleString()} tone="danger" testId="kpi-dealers-suspended" />
        <StatCard icon={XCircle} label="Terminated" value={kpis.terminated.toLocaleString()} tone="neutral" testId="kpi-dealers-terminated" />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
        <StatCard icon={Gavel} label="Active Auctions" value={kpis.withActiveAuctions.toLocaleString()} tone="brand" testId="kpi-dealers-auctions" />
        <StatCard icon={FileText} label="Submitted Offers" value={kpis.withSubmittedOffers.toLocaleString()} tone="indigo" testId="kpi-dealers-offers" />
        <StatCard icon={Trophy} label="Won Deals" value={kpis.withWonDeals.toLocaleString()} tone="success" testId="kpi-dealers-won" />
        <StatCard icon={Package} label="Total Inventory" value={kpis.totalInventory.toLocaleString()} tone="brand" testId="kpi-dealers-inventory" />
        <StatCard icon={ShieldAlert} label="Compliance Issues" value={kpis.complianceIssues.toLocaleString()} tone="warning" testId="kpi-dealers-compliance" />
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
              placeholder="Search by dealer name, email, phone, city, state…"
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
                <option value="TERMINATED">Terminated</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Tier</label>
              <select
                value={tierFilter}
                onChange={(e) => setTierFilter(e.target.value)}
                className="border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-purple-500 bg-white"
              >
                <option value="">All Tiers</option>
                <option value="STANDARD">Standard</option>
                <option value="SILVER">Silver</option>
                <option value="GOLD">Gold</option>
                <option value="PLATINUM">Platinum</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Inventory Type</label>
              <select
                value={inventoryTypeFilter}
                onChange={(e) => setInventoryTypeFilter(e.target.value)}
                className="border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-purple-500 bg-white"
              >
                <option value="">Any Inventory</option>
                <option value="New">New</option>
                <option value="Used">Used</option>
                <option value="Certified Pre-Owned">Certified Pre-Owned</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Service Area (State)</label>
              <input
                value={serviceAreaFilter}
                onChange={(e) => setServiceAreaFilter(e.target.value.toUpperCase().slice(0, 2))}
                onKeyDown={(e) => e.key === "Enter" && applyFilters()}
                placeholder="e.g. TX"
                maxLength={2}
                className="border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 w-24 uppercase focus:outline-none focus:ring-2 focus:ring-purple-500 bg-white"
              />
            </div>
          </div>
        )}
      </div>

      {/* Table */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        {/* Table Header */}
        <div className="hidden lg:grid grid-cols-[2fr_1.5fr_1fr_1fr_0.8fr_0.8fr_0.7fr_0.6fr_0.6fr_0.7fr_100px] gap-2 px-5 py-3 border-b border-slate-100 bg-slate-50/50">
          {["Dealership", "Email", "Phone", "City/State", "Status", "Tier", "Inventory", "Active Bids", "Won Deals", "Approval Date", "Actions"].map((h) => (
            <span key={h} className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">{h}</span>
          ))}
        </div>

        {loading && (
          <div className="divide-y divide-slate-50" data-testid="dealers-skeleton" aria-busy="true">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-5 py-3.5 animate-pulse">
                <div className="flex-1 min-w-0">
                  <div className="h-3.5 w-44 bg-slate-200 rounded mb-1.5" />
                  <div className="h-2.5 w-40 bg-slate-100 rounded" />
                </div>
                <div className="hidden lg:block h-3 w-40 bg-slate-100 rounded" />
                <div className="hidden lg:block h-5 w-16 bg-slate-100 rounded-full" />
                <div className="hidden lg:block h-5 w-16 bg-slate-100 rounded-full" />
                <div className="hidden lg:block h-3 w-10 bg-slate-100 rounded" />
                <div className="hidden lg:block h-3 w-10 bg-slate-100 rounded" />
                <div className="hidden lg:block h-3 w-20 bg-slate-100 rounded" />
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

        {!loading && !error && dealers.length === 0 && (
          <div className="py-16 text-center">
            <Users size={40} className="text-slate-300 mx-auto mb-3" />
            <p className="text-slate-600 font-semibold text-base">No dealers found</p>
            <p className="text-slate-400 text-sm mt-1">
              {hasFilters ? "Try adjusting your filters or search query." : "No dealers found in the system."}
            </p>
            {hasFilters && (
              <button onClick={clearFilters} className="mt-3 text-purple-600 text-sm hover:underline">Clear filters</button>
            )}
          </div>
        )}

        {!loading && !error && dealers.map((d) => (
          <div
            key={d.id}
            className={"grid lg:grid-cols-[2fr_1.5fr_1fr_1fr_0.8fr_0.8fr_0.7fr_0.6fr_0.6fr_0.7fr_100px] gap-2 px-5 py-3.5 border-b border-slate-50 hover:bg-slate-50/80 transition-colors " + (d.hasComplianceFlag ? "border-l-2 border-l-orange-400" : "")}
          >
            {/* Dealership Name */}
            <div className="flex flex-col justify-center min-w-0">
              <div className="flex items-center gap-1.5">
                <Link href={"/admin/dealers/" + d.id} className="font-semibold text-slate-900 text-sm hover:text-purple-700 transition-colors truncate">
                  {d.dealershipName}
                </Link>
                {d.hasComplianceFlag && (
                  <ShieldAlert size={11} className="text-orange-500 flex-shrink-0" />
                )}
              </div>
              <span className="text-[11px] text-slate-400 truncate">{d.id.slice(-8)} · Step {d.onboardingStep}</span>
            </div>

            {/* Email */}
            <div className="items-center min-w-0 hidden lg:flex">
              <span className="text-sm text-slate-600 truncate">{d.email}</span>
            </div>

            {/* Phone */}
            <div className="items-center hidden lg:flex">
              <span className="text-sm text-slate-500">{d.phone ?? "—"}</span>
            </div>

            {/* City/State */}
            <div className="items-center hidden lg:flex">
              <span className="text-sm text-slate-600">
                {d.city && d.state ? `${d.city}, ${d.state}` : d.city ?? d.state ?? "—"}
              </span>
            </div>

            {/* Status */}
            <div className="items-center hidden lg:flex">
              <StatusBadge status={d.status} />
            </div>

            {/* Tier */}
            <div className="items-center hidden lg:flex">
              <TierBadge tier={d.tier} />
            </div>

            {/* Inventory */}
            <div className="items-center hidden lg:flex">
              <span className="text-sm font-medium text-slate-700">{d.inventoryCount}</span>
            </div>

            {/* Active Bids */}
            <div className="items-center hidden lg:flex">
              <span className="text-sm font-medium text-slate-700">{d.activeBids}</span>
            </div>

            {/* Won Deals */}
            <div className="items-center hidden lg:flex">
              <span className="text-sm font-medium text-slate-700">{d.dealsWon}</span>
            </div>

            {/* Approval Date */}
            <div className="items-center hidden lg:flex">
              <span className="text-xs text-slate-400">{d.approvalDate ? fmtDate(d.approvalDate) : "—"}</span>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-1 relative">
              <Link
                href={"/admin/dealers/" + d.id}
                className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-purple-100 text-slate-600 hover:text-purple-700 flex items-center justify-center transition-colors"
                title="View dealer"
              >
                <Eye size={13} />
              </Link>
              <div className="relative">
                <button
                  onClick={() => setOpenMenu(openMenu === d.id ? null : d.id)}
                  className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center transition-colors"
                  title="More actions"
                >
                  <ChevronDown size={13} />
                </button>
                {openMenu === d.id && (
                  <div className="absolute right-0 top-8 z-30 bg-white border border-slate-200 rounded-xl shadow-xl py-1 min-w-[200px]" onMouseLeave={() => setOpenMenu(null)}>
                    <Link href={"/admin/dealers/" + d.id} className="flex items-center gap-2.5 px-3.5 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors" onClick={() => setOpenMenu(null)}>
                      <Eye size={13} /> View Command Center
                    </Link>
                    <div className="border-t border-slate-100 my-1" />
                    <Link href={"/admin/dealers/" + d.id + "?tab=inventory"} className="flex items-center gap-2.5 px-3.5 py-2 text-sm text-slate-600 hover:bg-slate-50 transition-colors" onClick={() => setOpenMenu(null)}>
                      <Package size={13} /> View Inventory
                    </Link>
                    <Link href={"/admin/dealers/" + d.id + "?tab=auctions"} className="flex items-center gap-2.5 px-3.5 py-2 text-sm text-slate-600 hover:bg-slate-50 transition-colors" onClick={() => setOpenMenu(null)}>
                      <Gavel size={13} /> View Auctions
                    </Link>
                    <Link href={"/admin/dealers/" + d.id + "?tab=offers"} className="flex items-center gap-2.5 px-3.5 py-2 text-sm text-slate-600 hover:bg-slate-50 transition-colors" onClick={() => setOpenMenu(null)}>
                      <FileText size={13} /> View Offers
                    </Link>
                    <Link href={"/admin/dealers/" + d.id + "?tab=deals"} className="flex items-center gap-2.5 px-3.5 py-2 text-sm text-slate-600 hover:bg-slate-50 transition-colors" onClick={() => setOpenMenu(null)}>
                      <Trophy size={13} /> View Deals
                    </Link>
                    <Link href={"/admin/dealers/" + d.id + "?tab=contracts"} className="flex items-center gap-2.5 px-3.5 py-2 text-sm text-slate-600 hover:bg-slate-50 transition-colors" onClick={() => setOpenMenu(null)}>
                      <ShieldAlert size={13} /> View Contracts
                    </Link>
                    <Link href={"/admin/dealers/" + d.id + "?tab=documents"} className="flex items-center gap-2.5 px-3.5 py-2 text-sm text-slate-600 hover:bg-slate-50 transition-colors" onClick={() => setOpenMenu(null)}>
                      <FileText size={13} /> View Documents
                    </Link>
                    <div className="border-t border-slate-100 my-1" />
                    {d.status === "PENDING" && (
                      <button onClick={() => openAction("approve", d.id, d.dealershipName)} className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-green-700 hover:bg-green-50 transition-colors text-left">
                        <CheckCircle2 size={13} /> Approve
                      </button>
                    )}
                    {d.status === "ACTIVE" && (
                      <button onClick={() => openAction("suspend", d.id, d.dealershipName)} className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-amber-700 hover:bg-amber-50 transition-colors text-left">
                        <Ban size={13} /> Suspend
                      </button>
                    )}
                    {d.status === "SUSPENDED" && (
                      <button onClick={() => openAction("reactivate", d.id, d.dealershipName)} className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-blue-700 hover:bg-blue-50 transition-colors text-left">
                        <CheckCircle2 size={13} /> Reactivate
                      </button>
                    )}
                    {d.status !== "TERMINATED" && (
                      <button onClick={() => openAction("terminate", d.id, d.dealershipName)} className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors text-left">
                        <XCircle size={13} /> Terminate
                      </button>
                    )}
                    <div className="border-t border-slate-100 my-1" />
                    <button onClick={() => openAction("note", d.id, d.dealershipName)} className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors text-left">
                      <FileText size={13} /> Add Note
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}

        {/* Footer */}
        {!loading && !error && dealers.length > 0 && (
          <div className="px-5 py-3 bg-slate-50/50 border-t border-slate-100 flex items-center justify-between">
            <span className="text-xs text-slate-500">Showing {dealers.length} of {total.toLocaleString()} dealers</span>
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
