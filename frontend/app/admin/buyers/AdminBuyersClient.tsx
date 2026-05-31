"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import {
  Users, UserPlus, Search, AlertTriangle, RefreshCw,
  ChevronDown, Eye, Edit2, Bell, UserCheck, PlayCircle,
  CreditCard, Briefcase, Flag, SlidersHorizontal, X,
  CheckCircle2, Clock, Zap, TrendingUp, ShieldAlert,
  Archive, ArchiveRestore, Lock, Unlock, Trash2,
} from "lucide-react";
import type { AdminBuyerKpis } from "@/lib/services/admin/admin-buyer-command-center.service";

interface BuyerRow {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  onboardingComplete: boolean;
  plan: string;
  prequalDecision: string | null;
  maxOtdAmountCents: number | null;
  prequalExpiresAt: string | null;
  activeDealStatus: string | null;
  activeDealId: string | null;
  activeAuctionStatus: string | null;
  latestDepositStatus: string | null;
  isException: boolean;
  assignedAdmin: string | null;
  archivedAt: string | null;
  disabledAt: string | null;
  purgedAt: string | null;
  leadScore: number | null;
  leadTemperature: string | null;
  createdAt: string;
  lastActivityAt?: string | null;
}

function LeadTemperatureBadge({ temperature }: { temperature: string | null }) {
  if (!temperature) return null;
  const t = temperature.toLowerCase();
  if (t === "hot") {
    return (
      <span className="inline-flex items-center text-[9px] font-semibold ml-1 px-2 py-0.5 rounded-full bg-red-600 text-white">
        Hot 🔥
      </span>
    );
  }
  if (t === "warm") {
    return (
      <span className="inline-flex items-center text-[9px] font-semibold ml-1 px-2 py-0.5 rounded-full bg-yellow-300 text-gray-800">
        Warm
      </span>
    );
  }
  if (t === "cold") {
    return (
      <span className="inline-flex items-center text-[9px] font-semibold ml-1 px-2 py-0.5 rounded-full bg-blue-600 text-white">
        Cold
      </span>
    );
  }
  return null;
}

interface Props {
  initialBuyers: BuyerRow[];
  initialTotal: number;
  kpis: AdminBuyerKpis;
}

function fmtCents(cents: number | null): string {
  if (cents == null) return "—";
  return "$" + (cents / 100).toLocaleString();
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function PrequalBadge({ decision }: { decision: string | null }) {
  if (!decision) return <span className="text-slate-400 text-xs">—</span>;
  const map: Record<string, { variant: "green" | "amber" | "destructive" | "secondary" | "blue"; label: string }> = {
    APPROVED: { variant: "green", label: "Approved" },
    DECLINED: { variant: "destructive", label: "Declined" },
    PENDING: { variant: "amber", label: "Pending" },
    MANUAL_REVIEW: { variant: "amber", label: "Manual Review" },
    OFAC_ESCALATED: { variant: "destructive", label: "OFAC Alert" },
    OFAC_REVIEW: { variant: "amber", label: "OFAC Review" },
  };
  const cfg = map[decision] ?? { variant: "secondary" as const, label: decision };
  return <Badge variant={cfg.variant} className="text-[10px] font-semibold">{cfg.label}</Badge>;
}

function DealStatusBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-slate-400 text-xs">No deal</span>;
  const label = status.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
  const done = ["COMPLETED", "PICKUP_COMPLETE"].includes(status);
  const bad = ["CANCELLED", "REFUNDED"].includes(status);
  const variant: "green" | "destructive" | "blue" = done ? "green" : bad ? "destructive" : "blue";
  return <Badge variant={variant} className="text-[10px]">{label}</Badge>;
}

interface KpiCardProps {
  icon: React.ReactNode;
  label: string;
  value: number;
  color: string;
  testId?: string;
}
function KpiCard({ icon, label, value, color, testId }: KpiCardProps) {
  return (
    <div className={"bg-white border border-slate-200 rounded-xl p-4 flex items-start gap-3 shadow-sm hover:shadow-md transition-shadow"} data-testid={testId}>
      <div className={"w-9 h-9 rounded-lg flex items-center justify-center " + color + " flex-shrink-0"}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-2xl font-bold text-slate-900 leading-none">{value.toLocaleString()}</p>
        <p className="text-xs text-slate-500 mt-1 leading-snug">{label}</p>
      </div>
    </div>
  );
}

function AddBuyerModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [form, setForm] = useState({ firstName: "", lastName: "", email: "", temporaryPassword: "", plan: "STANDARD" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError(null);
    const res = await fetch("/api/admin/users/create", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userType: "BUYER", ...form }),
    });
    const data = await res.json() as { success?: boolean; error?: string };
    setLoading(false);
    if (!res.ok) { setError(data.error ?? "Failed to create buyer"); return; }
    onSuccess();
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 p-6 w-full max-w-md">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-slate-900 font-bold text-lg">Create Buyer Account</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors"><X size={18} /></button>
        </div>
        {error && <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2.5 text-red-700 text-sm mb-4">{error}</div>}
        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <input placeholder="First Name*" value={form.firstName} onChange={e => setForm(f => ({...f, firstName: e.target.value}))} required className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" />
            <input placeholder="Last Name*" value={form.lastName} onChange={e => setForm(f => ({...f, lastName: e.target.value}))} required className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" />
          </div>
          <input type="email" placeholder="Email*" value={form.email} onChange={e => setForm(f => ({...f, email: e.target.value}))} required className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" />
          <input type="password" placeholder="Temporary Password* (min 8 chars)" value={form.temporaryPassword} onChange={e => setForm(f => ({...f, temporaryPassword: e.target.value}))} required minLength={8} className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" />
          <select value={form.plan} onChange={e => setForm(f => ({...f, plan: e.target.value}))} className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500">
            <option value="STANDARD">Standard Plan</option>
            <option value="PREMIUM">Premium Plan</option>
          </select>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 border border-slate-200 text-slate-600 rounded-lg py-2.5 text-sm hover:bg-slate-50 transition-colors">Cancel</button>
            <button type="submit" disabled={loading} className="flex-1 bg-[#0B5FD1] hover:bg-purple-800 text-white rounded-lg py-2.5 text-sm font-semibold disabled:opacity-50 transition-colors">{loading ? "Creating..." : "Create Buyer"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function AdminBuyersClient({ initialBuyers, initialTotal, kpis }: Props) {
  const [buyers, setBuyers] = useState<BuyerRow[]>(initialBuyers);
  const [total, setTotal] = useState(initialTotal);
  const [query, setQuery] = useState("");
  const [onboardingFilter, setOnboardingFilter] = useState("");
  const [exceptionOnly, setExceptionOnly] = useState(false);
  const [prequalFilter, setPrequalFilter] = useState("");
  const [hasActiveDeal, setHasActiveDeal] = useState(false);
  const [hasActiveAuction, setHasActiveAuction] = useState(false);
  const [registeredAfter, setRegisteredAfter] = useState("");
  const [registeredBefore, setRegisteredBefore] = useState("");
  const [lifecycleStatus, setLifecycleStatus] = useState<"active" | "archived" | "disabled" | "purged" | "all">("active");
  const [showFilters, setShowFilters] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  // Inline action modal state
  const [actionModal, setActionModal] = useState<{
    type: "reminder" | "exception" | "archive" | "restore" | "disable" | "reactivate";
    buyerId: string;
    buyerName: string;
  } | null>(null);
  const [actionInput, setActionInput] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  // Bulk selection
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);

  const showToast = (msg: string, type: "success" | "error" = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const fetchBuyers = useCallback(async (params: Record<string, string>) => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams(params).toString();
      const res = await fetch("/api/admin/buyers?" + qs);
      if (!res.ok) {
        let errMsg = "Failed to load buyers";
        try {
          const errData = await res.json() as { error?: { message: string } };
          if (errData.error?.message) errMsg = errData.error.message;
        } catch { /* ignore parse errors */ }
        throw new Error(errMsg);
      }
      const data = await res.json() as { data?: { buyers: BuyerRow[]; total: number } };
      if (data.data) { setBuyers(data.data.buyers); setTotal(data.data.total); }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load buyers");
    } finally {
      setLoading(false);
    }
  }, []);

  const applyFilters = useCallback((overrideLifecycle?: typeof lifecycleStatus) => {
    const params: Record<string, string> = {};
    if (query) params.q = query;
    if (onboardingFilter) params.onboardingStatus = onboardingFilter;
    if (exceptionOnly) params.exceptionOnly = "true";
    if (prequalFilter) params.prequalStatus = prequalFilter;
    if (hasActiveDeal) params.hasActiveDeal = "true";
    if (hasActiveAuction) params.hasActiveAuction = "true";
    if (registeredAfter) params.registeredAfter = registeredAfter;
    if (registeredBefore) params.registeredBefore = registeredBefore;
    params.lifecycleStatus = overrideLifecycle ?? lifecycleStatus;
    fetchBuyers(params);
  }, [query, onboardingFilter, exceptionOnly, prequalFilter, hasActiveDeal, hasActiveAuction, registeredAfter, registeredBefore, lifecycleStatus, fetchBuyers]);

  const clearFilters = () => {
    setQuery(""); setOnboardingFilter(""); setExceptionOnly(false);
    setPrequalFilter(""); setHasActiveDeal(false); setHasActiveAuction(false);
    setRegisteredAfter(""); setRegisteredBefore("");
    fetchBuyers({ lifecycleStatus });
  };

  const hasFilters = !!(query || onboardingFilter || exceptionOnly || prequalFilter || hasActiveDeal || hasActiveAuction || registeredAfter || registeredBefore);

  function openActionModal(
    type: typeof actionModal extends null ? never : NonNullable<typeof actionModal>["type"],
    buyerId: string, buyerName: string
  ) {
    setActionInput("");
    setActionModal({ type, buyerId, buyerName });
    setOpenMenu(null);
  }

  async function submitActionModal(e: React.FormEvent) {
    e.preventDefault();
    if (!actionModal || !actionInput.trim()) return;
    setActionLoading(true);
    try {
      const endpointMap: Record<string, string> = {
        reminder: `/api/admin/buyers/${actionModal.buyerId}/reminder`,
        exception: `/api/admin/buyers/${actionModal.buyerId}/exception`,
        archive: `/api/admin/buyers/${actionModal.buyerId}/archive`,
        restore: `/api/admin/buyers/${actionModal.buyerId}/restore`,
        disable: `/api/admin/buyers/${actionModal.buyerId}/disable`,
        reactivate: `/api/admin/buyers/${actionModal.buyerId}/reactivate`,
      };
      const bodyMap: Record<string, object> = {
        reminder: { message: actionInput.trim(), reason: "Admin reminder from buyers list" },
        exception: { reason: actionInput.trim() },
        archive: { reason: actionInput.trim() },
        restore: { reason: actionInput.trim() },
        disable: { reason: actionInput.trim() },
        reactivate: { reason: actionInput.trim() },
      };
      const successMap: Record<string, string> = {
        reminder: `Reminder sent to ${actionModal.buyerName}`,
        exception: `${actionModal.buyerName} flagged as exception`,
        archive: `${actionModal.buyerName} archived`,
        restore: `${actionModal.buyerName} restored`,
        disable: `${actionModal.buyerName} access disabled`,
        reactivate: `${actionModal.buyerName} access reactivated`,
      };
      const res = await fetch(endpointMap[actionModal.type], {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bodyMap[actionModal.type]),
      });
      if (res.ok) { showToast(successMap[actionModal.type]); applyFilters(); }
      else { const d = await res.json() as { error?: { message: string } }; showToast(d.error?.message ?? "Action failed", "error"); }
    } finally {
      setActionLoading(false);
      setActionModal(null);
      setActionInput("");
    }
  }

  async function bulkArchive() {
    if (selected.size === 0) return;
    setBulkLoading(true);
    let ok = 0, fail = 0;
    for (const id of selected) {
      const res = await fetch(`/api/admin/buyers/${id}/archive`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Bulk archive from admin buyers list" }),
      });
      if (res.ok) ok++; else fail++;
    }
    setBulkLoading(false);
    setSelected(new Set());
    showToast(`Bulk archive: ${ok} archived${fail ? `, ${fail} failed` : ""}`, fail ? "error" : "success");
    applyFilters();
  }

  async function bulkRestore() {
    if (selected.size === 0) return;
    setBulkLoading(true);
    let ok = 0, fail = 0;
    for (const id of selected) {
      const res = await fetch(`/api/admin/buyers/${id}/restore`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Bulk restore from admin buyers list" }),
      });
      if (res.ok) ok++; else fail++;
    }
    setBulkLoading(false);
    setSelected(new Set());
    showToast(`Bulk restore: ${ok} restored${fail ? `, ${fail} failed` : ""}`, fail ? "error" : "success");
    applyFilters();
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleSelectAll() {
    if (selected.size === buyers.length) setSelected(new Set());
    else setSelected(new Set(buyers.map((b) => b.id)));
  }

  const LIFECYCLE_TABS: { value: typeof lifecycleStatus; label: string }[] = [
    { value: "active", label: "Active" },
    { value: "archived", label: "Archived" },
    { value: "disabled", label: "Disabled" },
    { value: "purged", label: "Purged" },
    { value: "all", label: "All" },
  ];

  const modalConfig: Record<NonNullable<typeof actionModal>["type"], { title: string; placeholder: string; submitLabel: string; destructive: boolean }> = {
    reminder: { title: "Send Reminder", placeholder: "Reminder message…", submitLabel: "Send Reminder", destructive: false },
    exception: { title: "Flag as Exception", placeholder: "Exception reason…", submitLabel: "Flag Exception", destructive: true },
    archive: { title: "Archive Buyer", placeholder: "Reason for archiving…", submitLabel: "Archive Buyer", destructive: false },
    restore: { title: "Restore Buyer", placeholder: "Reason for restoring…", submitLabel: "Restore", destructive: false },
    disable: { title: "Disable Login Access", placeholder: "Reason for disabling access…", submitLabel: "Disable Access", destructive: true },
    reactivate: { title: "Reactivate Access", placeholder: "Reason for reactivating…", submitLabel: "Reactivate", destructive: false },
  };

  return (
    <div className="p-4 md:p-6 lg:p-8 min-h-screen bg-slate-50" data-testid="admin-buyers-page">
      {toast && (
        <div className={"fixed top-4 right-4 z-50 px-4 py-3 rounded-xl text-sm shadow-xl font-medium flex items-center gap-2 " + (toast.type === "success" ? "bg-green-600 text-white" : "bg-red-600 text-white")}>
          {toast.type === "success" ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
          {toast.msg}
        </div>
      )}

      {showAdd && (
        <AddBuyerModal
          onClose={() => setShowAdd(false)}
          onSuccess={() => { setShowAdd(false); showToast("Buyer account created — welcome email sent"); applyFilters(); }}
        />
      )}

      {/* Inline action modal */}
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
              Buyer: <strong>{actionModal.buyerName}</strong>
            </p>
            <form onSubmit={submitActionModal} className="space-y-3">
              <textarea
                value={actionInput}
                onChange={(e) => setActionInput(e.target.value)}
                rows={3}
                required
                placeholder={modalConfig[actionModal.type].placeholder}
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-slate-800 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
              <div className="flex gap-3">
                <button type="button" onClick={() => setActionModal(null)} className="flex-1 border border-slate-200 text-slate-600 rounded-lg py-2.5 text-sm hover:bg-slate-50 transition-colors">Cancel</button>
                <button type="submit" disabled={actionLoading || !actionInput.trim()} className={"flex-1 rounded-lg py-2.5 text-sm font-semibold text-white disabled:opacity-50 transition-colors " + (modalConfig[actionModal.type].destructive ? "bg-red-600 hover:bg-red-700" : "bg-[#0B5FD1] hover:bg-purple-800")}>
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
          <div className="w-9 h-9 rounded-xl bg-[#0B5FD1] flex items-center justify-center">
            <Users size={18} className="text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 leading-none">Buyer Operations</h1>
            <p className="text-xs text-slate-500 mt-0.5">{total.toLocaleString()} total buyers</p>
          </div>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 bg-[#0B5FD1] hover:bg-purple-800 text-white px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors shadow-sm"
        >
          <UserPlus size={15} /> Create Buyer
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3 mb-6">
        <KpiCard icon={<Users size={16} className="text-purple-700" />} label="Total Buyers" value={kpis.total} color="bg-purple-50" testId="kpi-total" />
        <KpiCard icon={<CheckCircle2 size={16} className="text-green-700" />} label="Active" value={kpis.active} color="bg-green-50" testId="kpi-active" />
        <KpiCard icon={<Clock size={16} className="text-amber-700" />} label="Pending Onboard" value={kpis.pendingOnboarding} color="bg-amber-50" testId="kpi-onboarding" />
        <KpiCard icon={<TrendingUp size={16} className="text-blue-700" />} label="Prequalified" value={kpis.prequalified} color="bg-blue-50" testId="kpi-prequal" />
        <KpiCard icon={<Briefcase size={16} className="text-indigo-700" />} label="Active Deals" value={kpis.withActiveDeals} color="bg-indigo-50" testId="kpi-deals" />
        <KpiCard icon={<Zap size={16} className="text-orange-700" />} label="Needs Action" value={kpis.needingAction} color="bg-orange-50" testId="kpi-action" />
        <KpiCard icon={<CreditCard size={16} className="text-red-700" />} label="Payment Issues" value={kpis.paymentIssues} color="bg-red-50" testId="kpi-payments" />
        <KpiCard icon={<ShieldAlert size={16} className="text-rose-700" />} label="Exceptions" value={kpis.exceptionCases} color="bg-rose-50" testId="kpi-exceptions" />
      </div>

      {/* Lifecycle Tabs */}
      <div className="flex gap-1 mb-4 bg-white border border-slate-200 rounded-xl p-1 w-fit shadow-sm">
        {LIFECYCLE_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => {
              setLifecycleStatus(tab.value);
              setSelected(new Set());
              applyFilters(tab.value);
            }}
            className={"px-4 py-2 text-xs font-semibold rounded-lg transition-colors " + (lifecycleStatus === tab.value ? "bg-[#0B5FD1] text-white shadow-sm" : "text-slate-500 hover:text-slate-700 hover:bg-slate-50")}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Bulk Actions */}
      {selected.size > 0 && (
        <div className="mb-4 bg-purple-50 border border-purple-200 rounded-xl px-4 py-3 flex items-center gap-3">
          <span className="text-sm font-medium text-purple-800">{selected.size} selected</span>
          <div className="flex gap-2 ml-auto">
            {lifecycleStatus !== "archived" && (
              <button
                onClick={bulkArchive}
                disabled={bulkLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-slate-700 text-white rounded-lg hover:bg-slate-800 disabled:opacity-50 transition-colors"
              >
                <Archive size={12} /> Bulk Archive
              </button>
            )}
            {lifecycleStatus === "archived" && (
              <button
                onClick={bulkRestore}
                disabled={bulkLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-green-700 text-white rounded-lg hover:bg-green-800 disabled:opacity-50 transition-colors"
              >
                <ArchiveRestore size={12} /> Bulk Restore
              </button>
            )}
            <button onClick={() => setSelected(new Set())} className="px-3 py-1.5 text-xs font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors">Clear</button>
          </div>
        </div>
      )}

      {/* Search + Filter Bar */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4 mb-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1 relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && applyFilters()}
              placeholder="Search by name, email, phone, buyer ID..."
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
            className="px-5 py-2.5 bg-[#0B5FD1] hover:bg-purple-800 text-white rounded-xl text-sm font-semibold transition-colors disabled:opacity-50 flex items-center gap-2"
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
              <label className="block text-xs font-medium text-slate-600 mb-1">Onboarding</label>
              <select
                value={onboardingFilter}
                onChange={(e) => setOnboardingFilter(e.target.value)}
                className="border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-purple-500 bg-white"
              >
                <option value="">All</option>
                <option value="complete">Complete</option>
                <option value="pending">Pending</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Prequal Status</label>
              <select
                value={prequalFilter}
                onChange={(e) => setPrequalFilter(e.target.value)}
                className="border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-purple-500 bg-white"
              >
                <option value="">All</option>
                <option value="APPROVED">Approved</option>
                <option value="DECLINED">Declined</option>
                <option value="PENDING">Pending</option>
                <option value="MANUAL_REVIEW">Manual Review</option>
                <option value="OFAC_REVIEW">OFAC Review</option>
                <option value="none">No Prequal</option>
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
            <div className="flex items-end pb-0.5">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={exceptionOnly}
                  onChange={(e) => setExceptionOnly(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300 text-purple-600 focus:ring-purple-500"
                />
                <span className="text-sm font-medium text-slate-700">Exceptions only</span>
              </label>
            </div>
            <div className="flex items-end pb-0.5">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={hasActiveDeal}
                  onChange={(e) => setHasActiveDeal(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300 text-purple-600 focus:ring-purple-500"
                />
                <span className="text-sm font-medium text-slate-700">Has active deal</span>
              </label>
            </div>
            <div className="flex items-end pb-0.5">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={hasActiveAuction}
                  onChange={(e) => setHasActiveAuction(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300 text-purple-600 focus:ring-purple-500"
                />
                <span className="text-sm font-medium text-slate-700">Has active auction</span>
              </label>
            </div>
          </div>
        )}
      </div>

      {/* Table */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="hidden lg:grid grid-cols-[32px_1.8fr_1.5fr_0.8fr_1fr_1fr_1fr_0.7fr_120px] gap-2 px-5 py-3 border-b border-slate-100 bg-slate-50/50">
          <div>
            <input
              type="checkbox"
              checked={buyers.length > 0 && selected.size === buyers.length}
              onChange={toggleSelectAll}
              className="w-4 h-4 rounded border-slate-300 text-purple-600 focus:ring-purple-500"
            />
          </div>
          {["Buyer", "Email", "Onboarding", "Prequal", "Buying Power", "Deal Status", "Payment", "Actions"].map((h) => (
            <span key={h} className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">{h}</span>
          ))}
        </div>

        {loading && (
          <div className="divide-y divide-slate-50" data-testid="buyers-skeleton" aria-busy="true">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-5 py-3.5 animate-pulse">
                <div className="w-4 h-4 rounded bg-slate-200" />
                <div className="flex-1 min-w-0">
                  <div className="h-3.5 w-40 bg-slate-200 rounded mb-1.5" />
                  <div className="h-2.5 w-56 bg-slate-100 rounded" />
                </div>
                <div className="hidden lg:block h-3 w-44 bg-slate-100 rounded" />
                <div className="hidden lg:block h-5 w-20 bg-slate-100 rounded-full" />
                <div className="hidden lg:block h-5 w-20 bg-slate-100 rounded-full" />
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

        {!loading && !error && buyers.length === 0 && (
          <div className="py-16 text-center">
            <Users size={40} className="text-slate-300 mx-auto mb-3" />
            <p className="text-slate-600 font-semibold text-base">No buyers found</p>
            <p className="text-slate-400 text-sm mt-1">
              {hasFilters ? "Try adjusting your filters or search query." : `No ${lifecycleStatus === "all" ? "" : lifecycleStatus + " "}buyers found.`}
            </p>
            {hasFilters && (
              <button onClick={clearFilters} className="mt-3 text-purple-600 text-sm hover:underline">Clear filters</button>
            )}
          </div>
        )}

        {!loading && !error && buyers.map((b) => {
          const isArchived = !!b.archivedAt;
          const isDisabled = !!b.disabledAt;
          const isPurged = !!b.purgedAt;
          const lifecycleBadge = isPurged
            ? <Badge variant="destructive" className="text-[9px] ml-1">Purged</Badge>
            : isArchived
            ? <Badge variant="secondary" className="text-[9px] ml-1">Archived</Badge>
            : isDisabled
            ? <Badge variant="amber" className="text-[9px] ml-1">Disabled</Badge>
            : null;

          return (
            <div
              key={b.id}
              className={"grid lg:grid-cols-[32px_1.8fr_1.5fr_0.8fr_1fr_1fr_1fr_0.7fr_120px] gap-2 px-5 py-3.5 border-b border-slate-50 hover:bg-slate-50/80 transition-colors " + (b.isException ? "border-l-2 border-l-red-400" : "")}
            >
              <div className="flex items-center">
                <input
                  type="checkbox"
                  checked={selected.has(b.id)}
                  onChange={() => toggleSelect(b.id)}
                  className="w-4 h-4 rounded border-slate-300 text-purple-600 focus:ring-purple-500"
                />
              </div>
              <div className="flex flex-col justify-center min-w-0">
                <div className="flex items-center gap-1">
                  <Link href={"/admin/buyers/" + b.id} className="font-semibold text-slate-900 text-sm hover:text-purple-700 transition-colors truncate">
                    {b.firstName} {b.lastName}
                  </Link>
                  <LeadTemperatureBadge temperature={b.leadTemperature} />
                  {lifecycleBadge}
                  {b.isException && (
                    <span className="text-red-500" title="Exception"><Flag size={10} /></span>
                  )}
                </div>
                <span className="text-[11px] text-slate-400 truncate">
                  {b.id.slice(-8)} · Reg {fmtDate(b.createdAt)}
                  {b.lastActivityAt ? <> · Active {fmtDate(b.lastActivityAt)}</> : null}
                </span>
              </div>
              <div className="items-center min-w-0 hidden lg:flex">
                <span className="text-sm text-slate-600 truncate">{b.email}</span>
              </div>
              <div className="items-center hidden lg:flex">
                {b.onboardingComplete
                  ? <Badge variant="green" className="text-[10px]">Complete</Badge>
                  : <Badge variant="amber" className="text-[10px]">Pending</Badge>
                }
              </div>
              <div className="items-center hidden lg:flex">
                <PrequalBadge decision={b.prequalDecision} />
              </div>
              <div className="items-center hidden lg:flex">
                <span className={"text-sm font-semibold " + (b.maxOtdAmountCents ? "text-slate-800" : "text-slate-300")}>
                  {fmtCents(b.maxOtdAmountCents)}
                </span>
              </div>
              <div className="items-center hidden lg:flex">
                <DealStatusBadge status={b.activeDealStatus} />
              </div>
              <div className="items-center hidden lg:flex">
                {b.latestDepositStatus ? (
                  <Badge
                    variant={b.latestDepositStatus === "PAID" ? "green" : b.latestDepositStatus === "FAILED" ? "destructive" : "amber"}
                    className="text-[10px]"
                  >
                    Deposit: {b.latestDepositStatus.toLowerCase()}
                  </Badge>
                ) : (
                  <span className="text-slate-300 text-xs">—</span>
                )}
              </div>
              <div className="flex items-center gap-1 relative">
                <Link
                  href={"/admin/buyers/" + b.id}
                  className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-purple-100 text-slate-600 hover:text-purple-700 flex items-center justify-center transition-colors"
                  title="View buyer"
                >
                  <Eye size={13} />
                </Link>
                <div className="relative">
                  <button
                    onClick={() => setOpenMenu(openMenu === b.id ? null : b.id)}
                    className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center transition-colors"
                    title="More actions"
                  >
                    <ChevronDown size={13} />
                  </button>
                  {openMenu === b.id && (
                    <div className="absolute right-0 top-8 z-30 bg-white border border-slate-200 rounded-xl shadow-xl py-1 min-w-[180px]" onMouseLeave={() => setOpenMenu(null)}>
                      <Link href={"/admin/buyers/" + b.id} className="flex items-center gap-2.5 px-3.5 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors" onClick={() => setOpenMenu(null)}>
                        <Eye size={13} /> View Buyer
                      </Link>
                      {!isPurged && (
                        <Link href={"/admin/buyers/" + b.id + "?tab=profile"} className="flex items-center gap-2.5 px-3.5 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors" onClick={() => setOpenMenu(null)}>
                          <Edit2 size={13} /> Edit Profile
                        </Link>
                      )}
                      {!isPurged && (
                        <button onClick={() => openActionModal("reminder", b.id, b.firstName + " " + b.lastName)} className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors text-left">
                          <Bell size={13} /> Send Reminder
                        </button>
                      )}
                      <Link href={"/admin/buyers/" + b.id + "?tab=payments"} className="flex items-center gap-2.5 px-3.5 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors" onClick={() => setOpenMenu(null)}>
                        <CreditCard size={13} /> View Payments
                      </Link>
                      {b.activeDealId && (
                        <Link href={"/admin/deals/" + b.activeDealId} className="flex items-center gap-2.5 px-3.5 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors" onClick={() => setOpenMenu(null)}>
                          <Briefcase size={13} /> View Deal
                        </Link>
                      )}
                      {!b.onboardingComplete && !isPurged && (
                        <Link href={"/admin/buyers/" + b.id + "?tab=journey"} className="flex items-center gap-2.5 px-3.5 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors" onClick={() => setOpenMenu(null)}>
                          <PlayCircle size={13} /> Start Onboarding
                        </Link>
                      )}
                      {!b.isException && !isPurged && (
                        <button onClick={() => openActionModal("exception", b.id, b.firstName + " " + b.lastName)} className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors text-left">
                          <Flag size={13} /> Mark Exception
                        </button>
                      )}
                      {!isPurged && (
                        <Link href={"/admin/buyers/" + b.id + "?tab=assign"} className="flex items-center gap-2.5 px-3.5 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors" onClick={() => setOpenMenu(null)}>
                          <UserCheck size={13} /> Assign Admin
                        </Link>
                      )}

                      {/* Lifecycle separator */}
                      {!isPurged && <div className="border-t border-slate-100 my-1" />}

                      {/* Archive / Restore */}
                      {!isPurged && !isArchived && (
                        <button onClick={() => openActionModal("archive", b.id, b.firstName + " " + b.lastName)} className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-slate-600 hover:bg-slate-50 transition-colors text-left">
                          <Archive size={13} /> Archive
                        </button>
                      )}
                      {isArchived && !isPurged && (
                        <button onClick={() => openActionModal("restore", b.id, b.firstName + " " + b.lastName)} className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-green-700 hover:bg-green-50 transition-colors text-left">
                          <ArchiveRestore size={13} /> Restore
                        </button>
                      )}

                      {/* Disable / Reactivate */}
                      {!isPurged && !isDisabled && (
                        <button onClick={() => openActionModal("disable", b.id, b.firstName + " " + b.lastName)} className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-amber-700 hover:bg-amber-50 transition-colors text-left">
                          <Lock size={13} /> Disable Login
                        </button>
                      )}
                      {isDisabled && !isPurged && (
                        <button onClick={() => openActionModal("reactivate", b.id, b.firstName + " " + b.lastName)} className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-green-700 hover:bg-green-50 transition-colors text-left">
                          <Unlock size={13} /> Reactivate Access
                        </button>
                      )}

                      {/* Delete — linked to detail page danger zone (SUPER_ADMIN only) */}
                      {!isPurged && (
                        <Link href={"/admin/buyers/" + b.id + "?tab=danger"} className="flex items-center gap-2.5 px-3.5 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors" onClick={() => setOpenMenu(null)}>
                          <Trash2 size={13} /> Delete / Purge
                        </Link>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {!loading && !error && buyers.length > 0 && (
          <div className="px-5 py-3 bg-slate-50/50 border-t border-slate-100 flex items-center justify-between">
            <span className="text-xs text-slate-500">Showing {buyers.length} of {total.toLocaleString()} buyers</span>
            {total > buyers.length && (
              <span className="text-xs text-slate-400">Refine search to see more</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
