"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import {
  ChevronRight, X, RefreshCw, AlertTriangle, CheckCircle2,
  Mail, Calendar, FileText, Shield, ShieldAlert, MessageSquare,
  Activity, Clock, Ban, XCircle, Trophy, Users, Share2,
  Edit2, Flag, CheckCircle, DollarSign, CreditCard, UserCheck,
  Network, Copy,
} from "lucide-react";
import type { AffiliateActionAvailability } from "@/lib/services/admin/admin-affiliate-command-center.service";
import AdminDocumentActions from "@/components/admin/AdminDocumentActions";

// ─── Local Types ──────────────────────────────────────────────────────────────

type AffiliateDetail = {
  affiliate: {
    id: string;
    email: string;
    supabaseId: string;
    referralCode: string;
    status: string;
    level: number;
    parentId: string | null;
    website: string | null;
    promotionMethod: string | null;
    ftcAcknowledgedAt: string | null;
    weeklyDigestEnabled: boolean;
    lastDigestSentAt: string | null;
    createdAt: string;
    updatedAt: string;
  };
  parent: {
    id: string;
    email: string;
    referralCode: string;
    status: string;
    level: number;
  } | null;
  children: Array<{
    id: string;
    email: string;
    referralCode: string;
    status: string;
    level: number;
    createdAt: string;
  }>;
  commissions: Array<{
    id: string;
    dealId: string;
    level: number;
    rate: number;
    amountCents: number;
    status: string;
    paidAt: string | null;
    createdAt: string;
  }>;
  payouts: Array<{
    id: string;
    amountCents: number;
    status: string;
    method: string | null;
    reference: string | null;
    periodStart: string;
    periodEnd: string;
    requestedAt: string;
    processedAt: string | null;
  }>;
  notifications: Array<{
    id: string;
    type: string;
    title: string;
    body: string;
    readAt: string | null;
    createdAt: string;
  }>;
  referralCount: number;
  convertedCount: number;
  auditLogs: Array<{
    id: string;
    action: string;
    adminEmail: string;
    reason: string | null;
    metadata: unknown;
    createdAt: string;
  }>;
  supportNotes: Array<{
    id: string;
    type: string;
    content: string;
    adminId: string;
    createdAt: string;
  }>;
  complianceStatus: {
    hasFlag: boolean;
    reason: string | null;
  };
  documents: Array<{
    id: string;
    type: string;
    fileName: string;
    fileSizeBytes: number;
    status: string;
    uploadedAt: string;
    reviewedAt: string | null;
    notes: string | null;
  }>;
};

interface Props {
  data: AffiliateDetail;
  availability: AffiliateActionAvailability;
  initialTab?: string;
}

type ModalType =
  | "approve" | "reject" | "suspend" | "reactivate"
  | "note" | "profile-edit" | "compliance-flag" | "compliance-resolve";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtCents(cents: number | null | undefined): string {
  if (cents == null) return "—";
  return "$" + (cents / 100).toLocaleString();
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return mins + "m ago";
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + "h ago";
  return Math.floor(hrs / 24) + "d ago";
}

// ─── Reusable Components ──────────────────────────────────────────────────────

function SectionCard({ title, icon, children, className = "" }: {
  title: string; icon: React.ReactNode; children: React.ReactNode; className?: string;
}) {
  return (
    <div className={"bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden " + className}>
      <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2.5">
        <span className="text-slate-400">{icon}</span>
        <h3 className="font-semibold text-slate-800 text-sm">{title}</h3>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between py-1.5 border-b border-slate-50 last:border-0">
      <span className="text-xs text-slate-500 min-w-[160px] flex-shrink-0">{label}</span>
      <span className="text-xs text-slate-800 text-right font-medium">{value}</span>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    PENDING: "amber",
    ACTIVE: "green",
    SUSPENDED: "destructive",
    REJECTED: "secondary",
  };
  const variant = (map[status] ?? "secondary") as "amber" | "green" | "destructive" | "secondary";
  const labels: Record<string, string> = { PENDING: "Pending", ACTIVE: "Active", SUSPENDED: "Suspended", REJECTED: "Rejected" };
  return <Badge variant={variant} className="text-xs font-semibold">{labels[status] ?? status}</Badge>;
}

function LevelBadge({ level }: { level: number }) {
  const colors = ["secondary", "blue", "amber", "default"] as const;
  const variant = colors[Math.min(level - 1, 3)] ?? "secondary";
  return <Badge variant={variant} className="text-xs">Level {level}</Badge>;
}

function CommissionStatusBadge({ status }: { status: string }) {
  const map: Record<string, "amber" | "blue" | "green" | "destructive" | "secondary"> = {
    PENDING: "amber", APPROVED: "blue", PAID: "green", REVERSED: "destructive",
  };
  return <Badge variant={map[status] ?? "secondary"} className="text-[10px] w-fit">{status}</Badge>;
}

function PayoutStatusBadge({ status }: { status: string }) {
  const map: Record<string, "amber" | "blue" | "green" | "destructive" | "secondary"> = {
    PENDING: "amber", PROCESSING: "blue", PAID: "green", FAILED: "destructive", REVERSED: "secondary",
  };
  return <Badge variant={map[status] ?? "secondary"} className="text-[10px] w-fit">{status}</Badge>;
}

// ─── Modals ───────────────────────────────────────────────────────────────────

function ConfirmModal({
  title, description, submitLabel = "Confirm", destructive = false,
  requireReason = true, onCancel, onConfirm,
}: {
  title: string; description: string; submitLabel?: string; destructive?: boolean;
  requireReason?: boolean; onCancel: () => void;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (requireReason && !reason.trim()) { setError("Reason is required"); return; }
    setLoading(true); setError(null);
    try { await onConfirm(reason); }
    catch (err) { setError(err instanceof Error ? err.message : "Action failed"); }
    finally { setLoading(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 p-6 w-full max-w-md">
        <div className="flex items-start justify-between mb-4">
          <h3 className={"font-bold text-lg " + (destructive ? "text-red-700" : "text-slate-900")}>{title}</h3>
          <button onClick={onCancel} className="text-slate-400 hover:text-slate-600 ml-2"><X size={18} /></button>
        </div>
        <p className="text-slate-600 text-sm mb-4">{description}</p>
        {error && <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2.5 text-red-700 text-sm mb-3">{error}</div>}
        <form onSubmit={submit}>
          {requireReason && (
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason for this action (required)"
              rows={3}
              className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-slate-800 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-purple-500 mb-3"
            />
          )}
          <div className="flex gap-3">
            <button type="button" onClick={onCancel} className="flex-1 border border-slate-200 text-slate-600 rounded-xl py-2.5 text-sm hover:bg-slate-50 transition-colors">Cancel</button>
            <button type="submit" disabled={loading} className={"flex-1 rounded-xl py-2.5 text-sm font-semibold text-white disabled:opacity-50 transition-colors " + (destructive ? "bg-red-600 hover:bg-red-700" : "bg-[#0B5FD1] hover:bg-purple-800")}>
              {loading ? "Processing..." : submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function AddNoteModal({ affiliateId, onClose, onSuccess }: {
  affiliateId: string; onClose: () => void; onSuccess: () => void;
}) {
  const [content, setContent] = useState("");
  const [type, setType] = useState("GENERAL");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!content.trim()) { setError("Note content is required"); return; }
    setLoading(true); setError(null);
    const res = await fetch("/api/admin/affiliates/" + affiliateId + "/note", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: content.trim(), type }),
    });
    const data = await res.json() as { success?: boolean; error?: { message: string } };
    setLoading(false);
    if (!res.ok) { setError(data.error?.message ?? "Failed to add note"); return; }
    onSuccess();
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 p-6 w-full max-w-md">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-slate-900 font-bold text-lg">Add Internal Note</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>
        {error && <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2.5 text-red-700 text-sm mb-3">{error}</div>}
        <form onSubmit={submit} className="space-y-3">
          <select value={type} onChange={e => setType(e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-slate-700 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500">
            <option value="GENERAL">General</option>
            <option value="ESCALATION">Escalation</option>
            <option value="COMPLIANCE">Compliance</option>
            <option value="COMPLAINT">Complaint</option>
          </select>
          <textarea
            value={content} onChange={e => setContent(e.target.value)}
            rows={4} maxLength={2000}
            placeholder="Internal note visible to admins only..."
            className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-slate-800 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-purple-500"
          />
          <p className="text-[10px] text-slate-400 text-right">{content.length}/2000</p>
          <div className="flex gap-3">
            <button type="button" onClick={onClose} className="flex-1 border border-slate-200 text-slate-600 rounded-lg py-2.5 text-sm hover:bg-slate-50">Cancel</button>
            <button type="submit" disabled={loading} className="flex-1 bg-[#0B5FD1] hover:bg-purple-800 text-white rounded-lg py-2.5 text-sm font-semibold disabled:opacity-50">
              {loading ? "Saving..." : "Add Note"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function EditProfileModal({ affiliate, onClose, onSuccess }: {
  affiliate: AffiliateDetail["affiliate"]; onClose: () => void; onSuccess: () => void;
}) {
  const [form, setForm] = useState({
    website: affiliate.website ?? "",
    promotionMethod: affiliate.promotionMethod ?? "",
    reason: "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.reason.trim()) { setError("Reason is required"); return; }
    setLoading(true); setError(null);
    const res = await fetch("/api/admin/affiliates/" + affiliate.id, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json() as { success?: boolean; error?: { message: string } };
    setLoading(false);
    if (!res.ok) { setError(data.error?.message ?? "Update failed"); return; }
    onSuccess();
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 p-6 w-full max-w-lg">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-slate-900 font-bold text-lg">Update Affiliate Profile</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>
        {error && <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2.5 text-red-700 text-sm mb-4">{error}</div>}
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="text-xs font-medium text-slate-600 mb-1 block">Website</label>
            <input value={form.website} onChange={e => setForm(f => ({ ...f, website: e.target.value }))} className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" placeholder="https://..." />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600 mb-1 block">Promotion Method</label>
            <input value={form.promotionMethod} onChange={e => setForm(f => ({ ...f, promotionMethod: e.target.value }))} className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600 mb-1 block">Reason for change *</label>
            <textarea value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} rows={2} required placeholder="Reason for this profile update" className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-slate-900 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-purple-500" />
          </div>
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="flex-1 border border-slate-200 text-slate-600 rounded-lg py-2.5 text-sm hover:bg-slate-50 transition-colors">Cancel</button>
            <button type="submit" disabled={loading} className="flex-1 bg-[#0B5FD1] hover:bg-purple-800 text-white rounded-lg py-2.5 text-sm font-semibold disabled:opacity-50 transition-colors">{loading ? "Saving..." : "Save Changes"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function AdminAffiliateCommandCenter({ data, availability, initialTab }: Props) {
  const { affiliate, parent, children, commissions, payouts, auditLogs, supportNotes, complianceStatus, referralCount, convertedCount, documents } = data;

  const [modal, setModal] = useState<ModalType | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);
  const [activeTab, setActiveTab] = useState(initialTab ?? "overview");
  const [refreshing, setRefreshing] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  const showToast = (msg: string, type: "success" | "error" = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };

  const handleSuccess = (msg: string) => {
    setModal(null);
    showToast(msg);
    setRefreshing(true);
    setTimeout(() => window.location.reload(), 1200);
  };

  async function doAction(endpoint: string, body: Record<string, string>, successMsg: string) {
    const res = await fetch("/api/admin/affiliates/" + affiliate.id + "/" + endpoint, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const d = await res.json() as { success?: boolean; data?: unknown; error?: { message: string } };
    if (!res.ok) throw new Error(d.error?.message ?? "Action failed");
    handleSuccess(successMsg);
  }

  function copyReferralCode() {
    void navigator.clipboard.writeText(affiliate.referralCode).then(() => {
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 1500);
    });
  }

  const tabs = [
    { id: "overview", label: "Overview" },
    { id: "profile", label: "Profile" },
    { id: "application", label: "Application" },
    { id: "referrals", label: "Referrals" },
    { id: "commissions", label: "Commissions" },
    { id: "payouts", label: "Payouts" },
    { id: "documents", label: "Documents" },
    { id: "network", label: "Network" },
    { id: "compliance", label: "Compliance" },
    { id: "notes", label: "Notes" },
    { id: "audit-log", label: "Audit Log" },
    { id: "admin-actions", label: "⚙ Admin Actions" },
  ];

  // Commission totals
  const totalEarned = commissions.reduce((s, c) => s + c.amountCents, 0);
  const totalPending = commissions.filter(c => c.status === "PENDING").reduce((s, c) => s + c.amountCents, 0);
  const totalPaid = commissions.filter(c => c.status === "PAID").reduce((s, c) => s + c.amountCents, 0);
  const totalReversed = commissions.filter(c => c.status === "REVERSED").reduce((s, c) => s + c.amountCents, 0);

  return (
    <div className="min-h-screen bg-slate-50" data-testid="admin-affiliate-command-center">
      {/* Toast */}
      {toast && (
        <div className={"fixed top-4 right-4 z-50 px-4 py-3 rounded-xl text-sm shadow-xl font-medium flex items-center gap-2 max-w-sm " + (toast.type === "success" ? "bg-green-600 text-white" : "bg-red-600 text-white")}>
          {toast.type === "success" ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
          <span>{toast.msg}</span>
          {refreshing && <RefreshCw size={13} className="animate-spin ml-1" />}
        </div>
      )}

      {/* Modals */}
      {modal === "approve" && (
        <ConfirmModal
          title="Approve Affiliate" description={"Approve " + affiliate.email + " as an active affiliate?"}
          submitLabel="Approve Affiliate" requireReason={false}
          onCancel={() => setModal(null)}
          onConfirm={async (reason) => { await doAction("approve", { reason: reason || "Approved from admin command center" }, "Affiliate approved"); }}
        />
      )}
      {modal === "reject" && (
        <ConfirmModal
          title="Reject Affiliate" description={"Reject the application for " + affiliate.email + "."} destructive
          submitLabel="Reject Affiliate" requireReason={true}
          onCancel={() => setModal(null)}
          onConfirm={async (reason) => { await doAction("reject", { reason }, "Affiliate rejected"); }}
        />
      )}
      {modal === "suspend" && (
        <ConfirmModal
          title="Suspend Affiliate" description={"Suspend " + affiliate.email + "? They will lose access to referral features."} destructive
          submitLabel="Suspend Affiliate" requireReason={true}
          onCancel={() => setModal(null)}
          onConfirm={async (reason) => { await doAction("suspend", { reason }, "Affiliate suspended"); }}
        />
      )}
      {modal === "reactivate" && (
        <ConfirmModal
          title="Reactivate Affiliate" description={"Reactivate " + affiliate.email + " from suspended status?"}
          submitLabel="Reactivate" requireReason={true}
          onCancel={() => setModal(null)}
          onConfirm={async (reason) => { await doAction("reactivate", { reason }, "Affiliate reactivated"); }}
        />
      )}
      {modal === "note" && (
        <AddNoteModal affiliateId={affiliate.id} onClose={() => setModal(null)} onSuccess={() => handleSuccess("Note added")} />
      )}
      {modal === "profile-edit" && (
        <EditProfileModal affiliate={affiliate} onClose={() => setModal(null)} onSuccess={() => handleSuccess("Profile updated")} />
      )}
      {modal === "compliance-flag" && (
        <ConfirmModal
          title="Flag Compliance Issue" description={"Flag a compliance issue for " + affiliate.email + ". This will be logged to the audit trail."} destructive
          submitLabel="Flag Issue" requireReason={true}
          onCancel={() => setModal(null)}
          onConfirm={async (reason) => { await doAction("compliance/flag", { reason }, "Compliance issue flagged"); }}
        />
      )}
      {modal === "compliance-resolve" && (
        <ConfirmModal
          title="Resolve Compliance Issue" description={"Mark the compliance issue for " + affiliate.email + " as resolved."}
          submitLabel="Resolve Issue" requireReason={true}
          onCancel={() => setModal(null)}
          onConfirm={async (reason) => { await doAction("compliance/resolve", { reason }, "Compliance issue resolved"); }}
        />
      )}

      {/* ─── Hero Header ─────────────────────────────────────────────────────── */}
      <div className="bg-white border-b border-slate-200 px-4 sm:px-6 lg:px-8 py-5">
        <div className="flex items-center gap-1.5 text-xs text-slate-400 mb-4">
          <Link href="/admin" className="hover:text-purple-600 transition-colors">Admin</Link>
          <ChevronRight size={12} />
          <Link href="/admin/affiliates" className="hover:text-purple-600 transition-colors">Affiliates</Link>
          <ChevronRight size={12} />
          <span className="text-slate-600 font-medium">{affiliate.email}</span>
        </div>

        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-2xl bg-[#0B5FD1] flex items-center justify-center flex-shrink-0 shadow-md">
              <span className="text-white text-lg font-bold">{affiliate.email[0]?.toUpperCase() ?? "A"}</span>
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl font-bold text-slate-900">{affiliate.email}</h1>
                <StatusBadge status={affiliate.status} />
                <LevelBadge level={affiliate.level} />
                {complianceStatus.hasFlag && (
                  <Badge variant="destructive" className="text-[10px] flex items-center gap-1">
                    <ShieldAlert size={10} /> Compliance Flag
                  </Badge>
                )}
              </div>
              <div className="flex flex-wrap gap-3 mt-1.5 text-xs text-slate-500">
                <span className="flex items-center gap-1"><Mail size={11} />{affiliate.email}</span>
                <button
                  onClick={copyReferralCode}
                  className="flex items-center gap-1 font-mono bg-slate-100 hover:bg-purple-50 text-slate-700 hover:text-purple-700 px-2 py-0.5 rounded transition-colors"
                >
                  {copiedCode ? <CheckCircle2 size={10} className="text-green-600" /> : <Copy size={10} />}
                  {affiliate.referralCode}
                </button>
                {parent && (
                  <span className="flex items-center gap-1">
                    <Network size={11} />
                    Parent: <Link href={"/admin/affiliates/" + parent.id} className="text-purple-600 hover:underline ml-0.5">{parent.email}</Link>
                  </span>
                )}
                <span className="flex items-center gap-1"><Calendar size={11} />Joined {fmtDate(affiliate.createdAt)}</span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {availability.canApprove && (
              <button onClick={() => setModal("approve")} className="flex items-center gap-1.5 px-3.5 py-2 bg-green-600 hover:bg-green-700 text-white rounded-xl text-xs font-semibold transition-colors shadow-sm">
                <CheckCircle size={13} /> Approve
              </button>
            )}
            {availability.canReject && (
              <button onClick={() => setModal("reject")} className="flex items-center gap-1.5 px-3.5 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-semibold transition-colors shadow-sm">
                <XCircle size={13} /> Reject
              </button>
            )}
            {availability.canSuspend && (
              <button onClick={() => setModal("suspend")} className="flex items-center gap-1.5 px-3.5 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-semibold transition-colors shadow-sm">
                <Ban size={13} /> Suspend
              </button>
            )}
            {availability.canReactivate && (
              <button onClick={() => setModal("reactivate")} className="flex items-center gap-1.5 px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold transition-colors shadow-sm">
                <CheckCircle2 size={13} /> Reactivate
              </button>
            )}
            <button onClick={() => setModal("note")} className="flex items-center gap-1.5 px-3.5 py-2 border border-slate-200 text-slate-700 hover:bg-slate-50 rounded-xl text-xs font-semibold transition-colors">
              <MessageSquare size={13} /> Add Note
            </button>
          </div>
        </div>
      </div>

      {/* ─── Tabs ─────────────────────────────────────────────────────────────── */}
      <div className="bg-white border-b border-slate-200 px-4 sm:px-6 lg:px-8 overflow-x-auto">
        <div className="flex gap-0 min-w-max">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={"px-4 py-3.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap " + (activeTab === tab.id ? "border-[#0B5FD1] text-[#0B5FD1]" : "border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300")}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* ─── Tab Content ─────────────────────────────────────────────────────── */}
      <div className="px-4 sm:px-6 lg:px-8 py-6 max-w-7xl mx-auto">

        {/* ── Overview Tab ── */}
        {activeTab === "overview" && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                { label: "Total Referrals", value: referralCount, icon: <Share2 size={16} className="text-blue-600" />, color: "bg-blue-50" },
                { label: "Converted Buyers", value: convertedCount, icon: <UserCheck size={16} className="text-emerald-600" />, color: "bg-emerald-50" },
                { label: "Total Commissions", value: fmtCents(totalEarned), icon: <Trophy size={16} className="text-yellow-600" />, color: "bg-yellow-50" },
                { label: "Pending Commissions", value: fmtCents(totalPending), icon: <DollarSign size={16} className="text-orange-600" />, color: "bg-orange-50" },
              ].map((s) => (
                <div key={s.label} className="bg-white border border-slate-200 rounded-xl p-4 flex items-start gap-3 shadow-sm">
                  <div className={"w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 " + s.color}>{s.icon}</div>
                  <div>
                    <p className="text-2xl font-bold text-slate-900 leading-none">{s.value}</p>
                    <p className="text-xs text-slate-500 mt-1">{s.label}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Recent Commissions */}
              <SectionCard title="Recent Commissions" icon={<CreditCard size={14} />}>
                {commissions.slice(0, 5).length === 0 ? (
                  <p className="text-sm text-slate-400 text-center py-4">No commissions yet</p>
                ) : (
                  <div className="space-y-2">
                    {commissions.slice(0, 5).map((c) => (
                      <div key={c.id} className="flex items-center justify-between py-1.5 border-b border-slate-50 last:border-0">
                        <div>
                          <p className="text-xs font-semibold text-slate-800">Deal ···{c.dealId.slice(-8)}</p>
                          <p className="text-xs text-slate-500">Level {c.level} · {(c.rate * 100).toFixed(1)}%</p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs font-bold text-slate-800">{fmtCents(c.amountCents)}</p>
                          <CommissionStatusBadge status={c.status} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </SectionCard>

              {/* Quick Actions */}
              <SectionCard title="Quick Actions" icon={<Activity size={14} />}>
                <div className="space-y-2">
                  {availability.canApprove && (
                    <button onClick={() => setModal("approve")} className="w-full flex items-center gap-2.5 px-4 py-3 bg-green-50 hover:bg-green-100 text-green-800 rounded-xl text-sm font-medium transition-colors text-left">
                      <CheckCircle size={15} /> Approve Affiliate
                    </button>
                  )}
                  {availability.canReject && (
                    <button onClick={() => setModal("reject")} className="w-full flex items-center gap-2.5 px-4 py-3 bg-red-50 hover:bg-red-100 text-red-800 rounded-xl text-sm font-medium transition-colors text-left">
                      <XCircle size={15} /> Reject Affiliate
                    </button>
                  )}
                  {availability.canSuspend && (
                    <button onClick={() => setModal("suspend")} className="w-full flex items-center gap-2.5 px-4 py-3 bg-amber-50 hover:bg-amber-100 text-amber-800 rounded-xl text-sm font-medium transition-colors text-left">
                      <Ban size={15} /> Suspend Affiliate
                    </button>
                  )}
                  {availability.canReactivate && (
                    <button onClick={() => setModal("reactivate")} className="w-full flex items-center gap-2.5 px-4 py-3 bg-blue-50 hover:bg-blue-100 text-blue-800 rounded-xl text-sm font-medium transition-colors text-left">
                      <CheckCircle2 size={15} /> Reactivate Affiliate
                    </button>
                  )}
                  {!availability.canApprove && !availability.canReject && !availability.canSuspend && !availability.canReactivate && (
                    <p className="text-sm text-slate-400 text-center py-2">No lifecycle actions available for {affiliate.status} status</p>
                  )}
                </div>
              </SectionCard>
            </div>

            {/* Recent Activity */}
            <SectionCard title="Recent Activity" icon={<Activity size={14} />}>
              {auditLogs.slice(0, 5).length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-4">No audit log entries</p>
              ) : (
                <div className="space-y-2">
                  {auditLogs.slice(0, 5).map((log) => (
                    <div key={log.id} className="flex items-start gap-3 py-2 border-b border-slate-50 last:border-0">
                      <div className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <Activity size={12} className="text-slate-500" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-slate-800">{log.action.replace(/_/g, " ")}</p>
                        <p className="text-xs text-slate-500">{log.adminEmail} · {timeAgo(log.createdAt)}</p>
                        {log.reason && <p className="text-xs text-slate-400 mt-0.5 truncate">{log.reason}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </SectionCard>
          </div>
        )}

        {/* ── Profile Tab ── */}
        {activeTab === "profile" && (
          <div className="max-w-2xl">
            <SectionCard title="Affiliate Profile" icon={<Users size={14} />}>
              <InfoRow label="Email" value={affiliate.email} />
              <InfoRow label="Referral Code" value={<code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded font-mono">{affiliate.referralCode}</code>} />
              <InfoRow label="Status" value={<StatusBadge status={affiliate.status} />} />
              <InfoRow label="Level" value={<LevelBadge level={affiliate.level} />} />
              <InfoRow label="Promotion Method" value={affiliate.promotionMethod ?? "—"} />
              <InfoRow label="Website" value={affiliate.website ? (
                <a href={affiliate.website} target="_blank" rel="noopener noreferrer" className="text-purple-600 hover:underline">{affiliate.website}</a>
              ) : "—"} />
              <InfoRow label="Weekly Digest" value={affiliate.weeklyDigestEnabled ? "Enabled" : "Disabled"} />
              <InfoRow label="Last Digest Sent" value={fmtDateTime(affiliate.lastDigestSentAt)} />
              <InfoRow label="Parent Affiliate" value={parent ? (
                <Link href={"/admin/affiliates/" + parent.id} className="text-purple-600 hover:underline">{parent.email}</Link>
              ) : "—"} />
              <InfoRow label="Created" value={fmtDateTime(affiliate.createdAt)} />
              <InfoRow label="Updated" value={fmtDateTime(affiliate.updatedAt)} />
              <InfoRow label="Supabase ID" value={<code className="text-[10px] bg-slate-100 px-1.5 py-0.5 rounded">{affiliate.supabaseId}</code>} />
              <div className="pt-4">
                <button onClick={() => setModal("profile-edit")} className="flex items-center gap-2 px-4 py-2.5 bg-[#0B5FD1] hover:bg-purple-800 text-white rounded-xl text-sm font-semibold transition-colors">
                  <Edit2 size={13} /> Edit Profile
                </button>
              </div>
            </SectionCard>
          </div>
        )}

        {/* ── Application Tab ── */}
        {activeTab === "application" && (
          <div className="max-w-2xl">
            <SectionCard title="Application Details" icon={<FileText size={14} />}>
              <InfoRow label="Status" value={<StatusBadge status={affiliate.status} />} />
              <InfoRow label="FTC Acknowledged" value={affiliate.ftcAcknowledgedAt ? (
                <span className="text-green-700 font-medium">{fmtDateTime(affiliate.ftcAcknowledgedAt)}</span>
              ) : (
                <span className="text-slate-400">Not recorded</span>
              )} />
              <InfoRow label="Promotion Method" value={affiliate.promotionMethod ?? "—"} />
              <InfoRow label="Website / Platform" value={affiliate.website ? (
                <a href={affiliate.website} target="_blank" rel="noopener noreferrer" className="text-purple-600 hover:underline">{affiliate.website}</a>
              ) : "—"} />
              <InfoRow label="Applied" value={fmtDate(affiliate.createdAt)} />
            </SectionCard>
          </div>
        )}

        {/* ── Referrals Tab ── */}
        {activeTab === "referrals" && (
          <div className="max-w-2xl space-y-5">
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-white border border-slate-200 rounded-xl p-4 flex items-start gap-3 shadow-sm">
                <div className="w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
                  <Share2 size={16} className="text-blue-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-slate-900 leading-none">{referralCount}</p>
                  <p className="text-xs text-slate-500 mt-1">Total Referrals</p>
                </div>
              </div>
              <div className="bg-white border border-slate-200 rounded-xl p-4 flex items-start gap-3 shadow-sm">
                <div className="w-9 h-9 rounded-lg bg-emerald-50 flex items-center justify-center flex-shrink-0">
                  <UserCheck size={16} className="text-emerald-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-slate-900 leading-none">{convertedCount}</p>
                  <p className="text-xs text-slate-500 mt-1">Converted Buyers</p>
                </div>
              </div>
            </div>
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
              <p className="text-sm text-blue-800 font-medium mb-1">Referred Buyers</p>
              <p className="text-sm text-blue-700">Referred buyers are accessible via the platform buyer list filtered by referral code.</p>
              <Link
                href={"/admin/buyers?referralCode=" + affiliate.referralCode}
                className="inline-flex items-center gap-1.5 mt-3 px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold transition-colors"
              >
                <Share2 size={12} /> View Referred Buyers
              </Link>
            </div>
          </div>
        )}

        {/* ── Commissions Tab ── */}
        {activeTab === "commissions" && (
          <div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-5">
              {[
                { label: "Total Earned", value: fmtCents(totalEarned), color: "bg-purple-50", icon: <Trophy size={14} className="text-purple-600" /> },
                { label: "Pending", value: fmtCents(totalPending), color: "bg-amber-50", icon: <Clock size={14} className="text-amber-600" /> },
                { label: "Paid", value: fmtCents(totalPaid), color: "bg-green-50", icon: <CheckCircle2 size={14} className="text-green-600" /> },
                { label: "Reversed", value: fmtCents(totalReversed), color: "bg-red-50", icon: <XCircle size={14} className="text-red-600" /> },
              ].map((s) => (
                <div key={s.label} className="bg-white border border-slate-200 rounded-xl p-4 flex items-start gap-3 shadow-sm">
                  <div className={"w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 " + s.color}>{s.icon}</div>
                  <div>
                    <p className="text-lg font-bold text-slate-900 leading-none">{s.value}</p>
                    <p className="text-xs text-slate-500 mt-1">{s.label}</p>
                  </div>
                </div>
              ))}
            </div>

            <h2 className="text-sm font-semibold text-slate-700 mb-3">Commissions ({commissions.length})</h2>
            {commissions.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-2xl py-16 text-center">
                <CreditCard size={36} className="text-slate-300 mx-auto mb-3" />
                <p className="text-slate-500 font-medium">No commissions yet</p>
              </div>
            ) : (
              <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                <div className="hidden lg:grid grid-cols-[2fr_0.7fr_0.7fr_1fr_1fr_1fr_1fr] gap-2 px-5 py-3 border-b border-slate-100 bg-slate-50/50">
                  {["Deal ID", "Level", "Rate", "Amount", "Status", "Paid At", "Created"].map(h => (
                    <span key={h} className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">{h}</span>
                  ))}
                </div>
                {commissions.map((c) => (
                  <div key={c.id} className="grid lg:grid-cols-[2fr_0.7fr_0.7fr_1fr_1fr_1fr_1fr] gap-2 px-5 py-3.5 border-b border-slate-50 hover:bg-slate-50/70 transition-colors">
                    <span className="text-xs font-mono text-slate-600">···{c.dealId.slice(-12)}</span>
                    <span className="text-xs text-slate-700">{c.level}</span>
                    <span className="text-xs text-slate-700">{(c.rate * 100).toFixed(1)}%</span>
                    <span className="text-sm font-semibold text-slate-800">{fmtCents(c.amountCents)}</span>
                    <CommissionStatusBadge status={c.status} />
                    <span className="text-xs text-slate-500">{fmtDate(c.paidAt)}</span>
                    <span className="text-xs text-slate-400">{fmtDate(c.createdAt)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Payouts Tab ── */}
        {activeTab === "payouts" && (
          <div>
            <h2 className="text-sm font-semibold text-slate-700 mb-3">Payouts ({payouts.length})</h2>
            {payouts.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-2xl py-16 text-center">
                <DollarSign size={36} className="text-slate-300 mx-auto mb-3" />
                <p className="text-slate-500 font-medium">No payouts yet</p>
              </div>
            ) : (
              <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                <div className="hidden lg:grid grid-cols-[1fr_0.8fr_1fr_1fr_1fr_1fr] gap-2 px-5 py-3 border-b border-slate-100 bg-slate-50/50">
                  {["Amount", "Status", "Method", "Period", "Requested", "Processed"].map(h => (
                    <span key={h} className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">{h}</span>
                  ))}
                </div>
                {payouts.map((p) => (
                  <div key={p.id} className="grid lg:grid-cols-[1fr_0.8fr_1fr_1fr_1fr_1fr] gap-2 px-5 py-3.5 border-b border-slate-50 hover:bg-slate-50/70 transition-colors">
                    <span className="text-sm font-semibold text-slate-800">{fmtCents(p.amountCents)}</span>
                    <PayoutStatusBadge status={p.status} />
                    <span className="text-xs text-slate-500">{p.method ?? "—"}</span>
                    <span className="text-xs text-slate-500">{fmtDate(p.periodStart)} – {fmtDate(p.periodEnd)}</span>
                    <span className="text-xs text-slate-500">{fmtDate(p.requestedAt)}</span>
                    <span className="text-xs text-slate-500">{fmtDate(p.processedAt)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Documents Tab ── */}
        {activeTab === "documents" && (
          <div>
            <h2 className="text-sm font-semibold text-slate-700 mb-3">Documents ({documents.length})</h2>
            {documents.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-2xl py-16 text-center">
                <FileText size={36} className="text-slate-300 mx-auto mb-3" />
                <p className="text-slate-500 font-medium">No documents uploaded yet</p>
              </div>
            ) : (
              <div className="space-y-3">
                {documents.map(doc => (
                  <div key={doc.id} className="flex items-center justify-between border border-slate-100 rounded-lg px-4 py-3 bg-white">
                    <div>
                      <p className="text-sm font-medium text-slate-800">{doc.fileName}</p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {doc.type} · {(doc.fileSizeBytes / 1024).toFixed(0)} KB · {new Date(doc.uploadedAt).toLocaleDateString()}
                        {doc.reviewedAt && ` · Reviewed ${new Date(doc.reviewedAt).toLocaleDateString()}`}
                      </p>
                      {doc.notes && (
                        <p className="text-xs text-slate-500 mt-0.5 italic">{doc.notes}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge variant={
                        doc.status === "APPROVED" ? "green" :
                        doc.status === "REJECTED" ? "destructive" : "secondary"
                      }>{doc.status}</Badge>
                      <AdminDocumentActions
                        documentId={doc.id}
                        status={doc.status}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Network Tab ── */}
        {activeTab === "network" && (
          <div className="space-y-5 max-w-3xl">
            {/* Parent */}
            <SectionCard title="Parent Affiliate" icon={<Network size={14} />}>
              {parent ? (
                <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-100">
                  <div>
                    <Link href={"/admin/affiliates/" + parent.id} className="text-sm font-semibold text-purple-700 hover:underline">{parent.email}</Link>
                    <p className="text-xs text-slate-500 mt-0.5">Code: <code className="font-mono">{parent.referralCode}</code> · Level {parent.level}</p>
                  </div>
                  <StatusBadge status={parent.status} />
                </div>
              ) : (
                <p className="text-sm text-slate-400 text-center py-2">No parent affiliate (top-level)</p>
              )}
            </SectionCard>

            {/* Children */}
            <SectionCard title={"Downline Affiliates (" + children.length + ")"} icon={<Users size={14} />}>
              {children.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-2">No downline affiliates</p>
              ) : (
                <div className="space-y-2">
                  {children.map((c) => (
                    <div key={c.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-100 hover:border-purple-200 transition-colors">
                      <div>
                        <Link href={"/admin/affiliates/" + c.id} className="text-sm font-semibold text-purple-700 hover:underline">{c.email}</Link>
                        <p className="text-xs text-slate-500 mt-0.5">Code: <code className="font-mono">{c.referralCode}</code> · Level {c.level} · Joined {fmtDate(c.createdAt)}</p>
                      </div>
                      <StatusBadge status={c.status} />
                    </div>
                  ))}
                </div>
              )}
            </SectionCard>
          </div>
        )}

        {/* ── Compliance Tab ── */}
        {activeTab === "compliance" && (
          <div className="max-w-2xl space-y-5">
            <SectionCard title="Compliance Status" icon={<Shield size={14} />}>
              {complianceStatus.hasFlag ? (
                <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-4">
                  <div className="flex items-center gap-2 mb-1">
                    <ShieldAlert size={15} className="text-red-600" />
                    <span className="text-sm font-semibold text-red-700">Active Compliance Flag</span>
                  </div>
                  {complianceStatus.reason && (
                    <p className="text-sm text-red-600 mt-1">{complianceStatus.reason}</p>
                  )}
                </div>
              ) : (
                <div className="bg-green-50 border border-green-200 rounded-xl p-4 mb-4 flex items-center gap-2">
                  <CheckCircle2 size={15} className="text-green-600" />
                  <span className="text-sm font-medium text-green-700">No active compliance issues</span>
                </div>
              )}
              <div className="flex gap-3">
                {!complianceStatus.hasFlag ? (
                  <button onClick={() => setModal("compliance-flag")} className="flex items-center gap-2 px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-sm font-semibold transition-colors">
                    <Flag size={13} /> Flag Issue
                  </button>
                ) : (
                  <button onClick={() => setModal("compliance-resolve")} className="flex items-center gap-2 px-4 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-xl text-sm font-semibold transition-colors">
                    <CheckCircle2 size={13} /> Resolve Issue
                  </button>
                )}
              </div>
            </SectionCard>

            <SectionCard title="Compliance Audit History" icon={<Activity size={14} />}>
              {auditLogs.filter(l => l.action === "AFFILIATE_COMPLIANCE_FLAGGED" || l.action === "AFFILIATE_COMPLIANCE_RESOLVED").length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-4">No compliance history</p>
              ) : (
                <div className="space-y-2">
                  {auditLogs
                    .filter(l => l.action === "AFFILIATE_COMPLIANCE_FLAGGED" || l.action === "AFFILIATE_COMPLIANCE_RESOLVED")
                    .map((log) => (
                      <div key={log.id} className={"flex items-start gap-3 p-3 rounded-xl border " + (log.action === "AFFILIATE_COMPLIANCE_FLAGGED" ? "bg-red-50 border-red-100" : "bg-green-50 border-green-100")}>
                        <div className={"w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 " + (log.action === "AFFILIATE_COMPLIANCE_FLAGGED" ? "bg-red-200" : "bg-green-200")}>
                          {log.action === "AFFILIATE_COMPLIANCE_FLAGGED"
                            ? <ShieldAlert size={11} className="text-red-700" />
                            : <CheckCircle2 size={11} className="text-green-700" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold text-slate-800">{log.action.replace(/_/g, " ")}</p>
                          <p className="text-xs text-slate-500">{log.adminEmail} · {fmtDateTime(log.createdAt)}</p>
                          {log.reason && <p className="text-xs text-slate-500 mt-0.5">{log.reason}</p>}
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </SectionCard>
          </div>
        )}

        {/* ── Notes Tab ── */}
        {activeTab === "notes" && (
          <div className="max-w-2xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-slate-700">Internal Notes ({supportNotes.length})</h2>
              <button onClick={() => setModal("note")} className="flex items-center gap-1.5 px-3.5 py-2 bg-[#0B5FD1] hover:bg-purple-800 text-white rounded-xl text-xs font-semibold transition-colors">
                <MessageSquare size={12} /> Add Note
              </button>
            </div>
            {supportNotes.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-2xl py-16 text-center">
                <MessageSquare size={36} className="text-slate-300 mx-auto mb-3" />
                <p className="text-slate-500 font-medium">No internal notes</p>
              </div>
            ) : (
              <div className="space-y-3">
                {supportNotes.map((note) => (
                  <div key={note.id} className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
                    <div className="flex items-center justify-between mb-2">
                      <Badge variant="secondary" className="text-[10px]">{note.type}</Badge>
                      <span className="text-xs text-slate-400">{fmtDateTime(note.createdAt)}</span>
                    </div>
                    <p className="text-sm text-slate-700 whitespace-pre-wrap">{note.content}</p>
                    <p className="text-[11px] text-slate-400 mt-2">Admin: {note.adminId}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Audit Log Tab ── */}
        {activeTab === "audit-log" && (
          <div>
            <h2 className="text-sm font-semibold text-slate-700 mb-3">Audit Log ({auditLogs.length} entries)</h2>
            {auditLogs.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-2xl py-16 text-center">
                <Clock size={36} className="text-slate-300 mx-auto mb-3" />
                <p className="text-slate-500 font-medium">No audit log entries</p>
              </div>
            ) : (
              <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                <div className="hidden lg:grid grid-cols-[1.5fr_1.5fr_1.5fr_2fr_1fr] gap-2 px-5 py-3 border-b border-slate-100 bg-slate-50/50">
                  {["Action", "Admin", "Reason", "Metadata", "Date"].map(h => (
                    <span key={h} className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">{h}</span>
                  ))}
                </div>
                {auditLogs.map((log) => (
                  <div key={log.id} className="grid lg:grid-cols-[1.5fr_1.5fr_1.5fr_2fr_1fr] gap-2 px-5 py-3.5 border-b border-slate-50 hover:bg-slate-50/70 transition-colors">
                    <span className="text-xs font-semibold text-slate-800">{log.action.replace(/_/g, " ")}</span>
                    <span className="text-xs text-slate-600">{log.adminEmail}</span>
                    <span className="text-xs text-slate-500 truncate">{log.reason ?? "—"}</span>
                    <span className="text-[10px] text-slate-400 font-mono truncate">
                      {log.metadata && typeof log.metadata === "object" ? JSON.stringify(log.metadata).slice(0, 60) : "—"}
                    </span>
                    <span className="text-xs text-slate-400">{fmtDate(log.createdAt)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Admin Actions Tab ── */}
        {activeTab === "admin-actions" && (
          <div className="max-w-2xl space-y-4">
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-1">
                <AlertTriangle size={14} className="text-amber-600" />
                <span className="text-sm font-semibold text-amber-800">Admin Actions Zone</span>
              </div>
              <p className="text-xs text-amber-700">All actions are audit-logged with your identity. Destructive actions cannot be undone without a separate restore operation.</p>
            </div>

            {/* Lifecycle Actions */}
            <SectionCard title="Lifecycle Management" icon={<Users size={14} />}>
              <div className="space-y-2">
                {availability.canApprove && (
                  <div className="flex items-center justify-between p-3 border border-slate-100 rounded-xl">
                    <div>
                      <p className="text-sm font-semibold text-slate-800">Approve Affiliate</p>
                      <p className="text-xs text-slate-500">Approve this affiliate application</p>
                    </div>
                    <button onClick={() => setModal("approve")} className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-xl text-xs font-semibold transition-colors">
                      Approve
                    </button>
                  </div>
                )}
                {availability.canReject && (
                  <div className="flex items-center justify-between p-3 border border-red-100 rounded-xl bg-red-50/50">
                    <div>
                      <p className="text-sm font-semibold text-slate-800">Reject Affiliate</p>
                      <p className="text-xs text-slate-500">Reject this pending application</p>
                    </div>
                    <button onClick={() => setModal("reject")} className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-semibold transition-colors">
                      Reject
                    </button>
                  </div>
                )}
                {availability.canSuspend && (
                  <div className="flex items-center justify-between p-3 border border-amber-100 rounded-xl bg-amber-50/50">
                    <div>
                      <p className="text-sm font-semibold text-slate-800">Suspend Affiliate</p>
                      <p className="text-xs text-slate-500">Temporarily suspend affiliate access</p>
                    </div>
                    <button onClick={() => setModal("suspend")} className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-semibold transition-colors">
                      Suspend
                    </button>
                  </div>
                )}
                {availability.canReactivate && (
                  <div className="flex items-center justify-between p-3 border border-blue-100 rounded-xl bg-blue-50/50">
                    <div>
                      <p className="text-sm font-semibold text-slate-800">Reactivate Affiliate</p>
                      <p className="text-xs text-slate-500">Restore affiliate from suspended status</p>
                    </div>
                    <button onClick={() => setModal("reactivate")} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold transition-colors">
                      Reactivate
                    </button>
                  </div>
                )}
                {!availability.canApprove && !availability.canReject && !availability.canSuspend && !availability.canReactivate && (
                  <p className="text-sm text-slate-400 text-center py-3">No lifecycle actions available for current status ({affiliate.status})</p>
                )}
              </div>
            </SectionCard>

            {/* Profile & Notes */}
            <SectionCard title="Profile & Notes" icon={<Edit2 size={14} />}>
              <div className="space-y-2">
                <div className="flex items-center justify-between p-3 border border-slate-100 rounded-xl">
                  <div>
                    <p className="text-sm font-semibold text-slate-800">Update Profile</p>
                    <p className="text-xs text-slate-500">Edit affiliate website and promotion method</p>
                  </div>
                  <button onClick={() => setModal("profile-edit")} className="px-4 py-2 bg-[#0B5FD1] hover:bg-purple-800 text-white rounded-xl text-xs font-semibold transition-colors">
                    Edit
                  </button>
                </div>
                <div className="flex items-center justify-between p-3 border border-slate-100 rounded-xl">
                  <div>
                    <p className="text-sm font-semibold text-slate-800">Add Internal Note</p>
                    <p className="text-xs text-slate-500">Add a note visible to admins only</p>
                  </div>
                  <button onClick={() => setModal("note")} className="px-4 py-2 border border-slate-200 text-slate-700 hover:bg-slate-50 rounded-xl text-xs font-semibold transition-colors">
                    Add Note
                  </button>
                </div>
              </div>
            </SectionCard>

            {/* Compliance */}
            <SectionCard title="Compliance Actions" icon={<Shield size={14} />}>
              <div className="space-y-2">
                {!complianceStatus.hasFlag ? (
                  <div className="flex items-center justify-between p-3 border border-red-100 rounded-xl bg-red-50/30">
                    <div>
                      <p className="text-sm font-semibold text-slate-800">Flag Compliance Issue</p>
                      <p className="text-xs text-slate-500">Flag an issue and add it to the audit log</p>
                    </div>
                    <button onClick={() => setModal("compliance-flag")} className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-semibold transition-colors">
                      Flag Issue
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between p-3 border border-green-100 rounded-xl bg-green-50/30">
                    <div>
                      <p className="text-sm font-semibold text-slate-800">Resolve Compliance Issue</p>
                      <p className="text-xs text-slate-500">Mark the active compliance flag as resolved</p>
                    </div>
                    <button onClick={() => setModal("compliance-resolve")} className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-xl text-xs font-semibold transition-colors">
                      Resolve
                    </button>
                  </div>
                )}
              </div>
            </SectionCard>
          </div>
        )}
      </div>
    </div>
  );
}
