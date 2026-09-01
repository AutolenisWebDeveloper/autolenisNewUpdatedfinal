"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { PrequalAdminPanel } from "./PrequalAdminPanel";
import BuyerJourneyTab from "./BuyerJourneyTab";
import LaunchAuctionPanel from "@/components/admin/LaunchAuctionPanel";
import {
  User, Mail, Phone, Calendar, Clock, Edit2,
  Bell, UserCheck, PlayCircle, Flag, CheckCircle2,
  AlertTriangle, CreditCard, Briefcase, FileText,
  Shield, Pen, Package, MessageSquare, Activity,
  ChevronRight, ExternalLink, RefreshCw, X,
  ShieldAlert, Gavel, Search, BookOpen, Car,
  PauseCircle, StopCircle, ArrowRight, ArrowLeft,
  DollarSign, Lock, Users,
  Archive, ArchiveRestore, Unlock, Trash2, AlertCircle,
} from "lucide-react";
import type {
  BuyerActionAvailability,
} from "@/lib/services/admin/admin-buyer-command-center.service";
import { api, apiErrorMessage } from "@/lib/api/client";

// ─── Types ───────────────────────────────────────────────────────────────────

type BuyerData = {
  buyer: {
    id: string; firstName: string; lastName: string; phone: string | null;
    address: string | null; city: string | null; state: string | null; zip: string | null;
    email: string; supabaseId: string; plan: string; planUpgradedAt: string | null;
    onboardingComplete: boolean; termsAcceptedAt: string | null;
    employmentStatus: string | null; incomeRange: string | null;
    affiliateId: string | null; createdAt: string; updatedAt: string;
    // Lifecycle
    archivedAt: string | null; disabledAt: string | null; purgedAt: string | null;
    // Suspension
    isSuspended: boolean; suspendedAt: string | null; suspendedReason: string | null;
  };
  preQualification: {
    id: string; decision: string; tier: string | null; maxOtdAmountCents: number;
    expiresAt: string; checkOfacAlert: boolean; isExternal: boolean;
    createdAt: string; updatedAt: string;
    creditScore?: number | null; idvScore?: number | null; mlaCovered?: boolean;
    fraudWarning?: string | null; adverseReasonCodes?: string[];
    deceasedFlag?: boolean; bankruptcyFlag?: boolean;
  } | null;
  externalPreApprovals: Array<{
    id: string; status: string; lenderName: string | null;
    approvedAmountCents: number | null; aprRate: number | null;
    termMonths: number | null; expiryDate: string | null; createdAt: string;
  }>;
  deals: Array<{
    id: string; status: string; financingPath: string | null;
    insuranceStatus: string; feePaidAt: string | null; feeAmountCents: number | null;
    stripeFeePIId: string | null; feeRefundedAt: string | null;
    feeRefundedAmountCents: number | null;
    contractShieldScore: number | null; contractShieldStatus: string | null;
    riskScore: number | null; riskTier: string | null; createdAt: string;
    offer: {
      otdPriceCents: number; dealerId: string;
      dealerName: string; dealerCity: string | null; dealerState: string | null;
    } | null;
    eSignEnvelope: {
      status: string; docusignEnvelopeId: string | null;
      sentAt: string | null; completedAt: string | null;
    } | null;
    pickup: {
      status: string; scheduledAt: string | null; completedAt: string | null;
      location: string | null; qrCodeImage: string | null;
    } | null;
    financing: {
      path: string; lenderName: string | null; approvedAmountCents: number | null;
      aprRate: number | null; termMonths: number | null;
      monthlyPaymentCents: number | null; status: string;
    } | null;
    latestContractVersion: { status: string; version: number; uploadedAt: string } | null;
    latestContractScan: { status: string; score: number; fixListCount: number } | null;
    serviceFeePayment: { amountCents: number; netAmountCents: number; paidAt: string | null } | null;
  }>;
  auctions: Array<{
    id: string; status: string; startedAt: string | null; endsAt: string | null;
    closedAt: string | null; offerCount: number; invitationCount: number; createdAt: string;
  }>;
  deposits: Array<{
    id: string; amountCents: number; status: string;
    stripePaymentIntentId: string | null; refundedAt: string | null; createdAt: string;
  }>;
  documents: Array<{
    id: string; type: string; name: string; isVerified: boolean;
    verifiedAt: string | null; uploadedAt: string;
  }>;
  insurancePolicies: Array<{
    id: string; status: string; providerName: string | null;
    policyNumber: string | null; proofUrl: string | null; verifiedAt: string | null;
  }>;
  insuranceQuotes: Array<{
    id: string; status: string; providerName: string | null;
    premiumCents: number | null; createdAt: string;
  }>;
  shortlistCount: number;
  vehicleRequests: Array<{
    id: string; status: string; makePreference: string | null;
    modelPreference: string | null; createdAt: string;
  }>;
  activityEvents: Array<{ id: string; eventType: string; title: string; createdAt: string }>;
  auditLogs: Array<{
    id: string; action: string; adminEmail: string; reason: string | null;
    metadata: unknown; createdAt: string;
  }>;
  supportNotes: Array<{
    id: string; type: string; content: string; adminId: string; createdAt: string;
  }>;
  exceptionStatus: { isActive: boolean; reason: string | null };
  assignedAdmin: string | null;
};

interface Props {
  data: BuyerData;
  availability: BuyerActionAvailability;
  initialTab?: string;
  prequalPanelExtras?: {
    source: string | null;
    hasConsent: boolean;
    consentAcceptedAt: string | null;
    profileMissingFields: string[];
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

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
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return mins + "m ago";
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + "h ago";
  const days = Math.floor(hrs / 24);
  return days + "d ago";
}

const DEAL_STAGES = [
  "PENDING", "ACTIVE", "FINANCING_PENDING", "FEE_PENDING", "FEE_PAID",
  "INSURANCE_PENDING", "CONTRACT_PENDING", "CONTRACT_REVIEW", "CONTRACT_APPROVED",
  "SIGNING_PENDING", "SIGNED", "PICKUP_SCHEDULED", "PICKUP_COMPLETE", "COMPLETED",
];

// ─── Section Card ─────────────────────────────────────────────────────────────

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
      <span className="text-xs text-slate-500 min-w-[120px] flex-shrink-0">{label}</span>
      <span className="text-xs text-slate-800 text-right font-medium">{value}</span>
    </div>
  );
}

// ─── Modals ──────────────────────────────────────────────────────────────────

function ConfirmModal({
  title, description, submitLabel = "Confirm", destructive = false,
  requireReason = true, onCancel, onConfirm,
}: {
  title: string; description: string; submitLabel?: string; destructive?: boolean;
  requireReason?: boolean; onCancel: () => void;
  onConfirm: (reason: string, extra?: Record<string, string>) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (requireReason && !reason.trim()) { setError("Reason is required"); return; }
    setLoading(true); setError(null);
    try { await onConfirm(reason); }
    catch (err) { setError(apiErrorMessage(err, "Action failed")); }
    finally { setLoading(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 p-6 w-full max-w-md">
        <div className="flex items-start justify-between mb-4">
          <h3 className={"font-bold text-lg " + (destructive ? "text-red-700" : "text-slate-900")}>{title}</h3>
          <button onClick={onCancel} className="text-slate-400 hover:text-slate-600 ml-2 mt-0.5"><X size={18} /></button>
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
            <button type="submit" disabled={loading} className={"flex-1 rounded-xl py-2.5 text-sm font-semibold text-white disabled:opacity-50 transition-colors " + (destructive ? "bg-red-600 hover:bg-red-700" : "bg-al-primary hover:bg-purple-800")}>
              {loading ? "Processing..." : submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function EditProfileModal({ buyer, onClose, onSuccess }: {
  buyer: BuyerData["buyer"]; onClose: () => void; onSuccess: () => void;
}) {
  const [form, setForm] = useState({
    firstName: buyer.firstName, lastName: buyer.lastName,
    phone: buyer.phone ?? "", address: buyer.address ?? "",
    city: buyer.city ?? "", state: buyer.state ?? "", zip: buyer.zip ?? "",
    reason: "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.reason.trim()) { setError("Reason is required"); return; }
    setLoading(true); setError(null);
    try {
      await api.patch("/api/admin/buyers/" + buyer.id, form);
      onSuccess();
    } catch (err) {
      setError(apiErrorMessage(err, "Update failed"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-slate-900 font-bold text-lg">Edit Buyer Profile</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>
        {error && <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2.5 text-red-700 text-sm mb-4">{error}</div>}
        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-slate-600 mb-1 block">First Name</label>
              <input value={form.firstName} onChange={e => setForm(f => ({...f, firstName: e.target.value}))} required className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 mb-1 block">Last Name</label>
              <input value={form.lastName} onChange={e => setForm(f => ({...f, lastName: e.target.value}))} required className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600 mb-1 block">Phone</label>
            <input value={form.phone} onChange={e => setForm(f => ({...f, phone: e.target.value}))} className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600 mb-1 block">Address</label>
            <input value={form.address} onChange={e => setForm(f => ({...f, address: e.target.value}))} className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-1">
              <label className="text-xs font-medium text-slate-600 mb-1 block">City</label>
              <input value={form.city} onChange={e => setForm(f => ({...f, city: e.target.value}))} className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 mb-1 block">State</label>
              <input value={form.state} maxLength={2} onChange={e => setForm(f => ({...f, state: e.target.value.toUpperCase()}))} className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 mb-1 block">ZIP</label>
              <input value={form.zip} onChange={e => setForm(f => ({...f, zip: e.target.value}))} className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600 mb-1 block">Reason for change *</label>
            <textarea value={form.reason} onChange={e => setForm(f => ({...f, reason: e.target.value}))} rows={2} required placeholder="Provide a reason for this profile update" className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-slate-900 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-purple-500" />
          </div>
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="flex-1 border border-slate-200 text-slate-600 rounded-lg py-2.5 text-sm hover:bg-slate-50 transition-colors">Cancel</button>
            <button type="submit" disabled={loading} className="flex-1 bg-al-primary hover:bg-purple-800 text-white rounded-lg py-2.5 text-sm font-semibold disabled:opacity-50 transition-colors">{loading ? "Saving..." : "Save Changes"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function AddNoteModal({ buyerId, onClose, onSuccess }: {
  buyerId: string; onClose: () => void; onSuccess: () => void;
}) {
  const [content, setContent] = useState("");
  const [type, setType] = useState("GENERAL");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!content.trim()) { setError("Note content is required"); return; }
    setLoading(true); setError(null);
    try {
      await api.post("/api/admin/buyers/" + buyerId + "/note", { content: content.trim(), type });
      onSuccess();
    } catch (err) {
      setError(apiErrorMessage(err, "Failed to add note"));
    } finally {
      setLoading(false);
    }
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
            <option value="REFUND">Refund</option>
            <option value="COMPLAINT">Complaint</option>
            <option value="IMPERSONATION">Impersonation</option>
          </select>
          <textarea value={content} onChange={e => setContent(e.target.value)} rows={4} maxLength={2000} placeholder="Internal note visible to admins only..." className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-slate-800 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-purple-500" />
          <p className="text-[10px] text-slate-400 text-right">{content.length}/2000</p>
          <div className="flex gap-3">
            <button type="button" onClick={onClose} className="flex-1 border border-slate-200 text-slate-600 rounded-lg py-2.5 text-sm hover:bg-slate-50">Cancel</button>
            <button type="submit" disabled={loading} className="flex-1 bg-al-primary hover:bg-purple-800 text-white rounded-lg py-2.5 text-sm font-semibold disabled:opacity-50">{loading ? "Saving..." : "Add Note"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function MoveWorkflowModal({ buyerId, dealId, currentStatus, onClose, onSuccess }: {
  buyerId: string; dealId: string; currentStatus: string; onClose: () => void; onSuccess: () => void;
}) {
  const [targetStatus, setTargetStatus] = useState("");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const moveableStages = DEAL_STAGES.filter((s) => !["PENDING", "CANCELLED", "COMPLETED", "REFUNDED"].includes(s));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!targetStatus) { setError("Select a target stage"); return; }
    if (!reason.trim()) { setError("Reason is required"); return; }
    setLoading(true); setError(null);
    try {
      await api.post("/api/admin/buyers/" + buyerId + "/workflow/move", { dealId, targetStatus, reason });
      onSuccess();
    } catch (err) {
      setError(apiErrorMessage(err, "Stage move failed"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 p-6 w-full max-w-md">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-slate-900 font-bold text-lg">Move Workflow Stage</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
          <p className="text-amber-800 text-xs font-medium">This action overrides the deal workflow. A reason is required and will be logged to the audit trail.</p>
        </div>
        {error && <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2.5 text-red-700 text-sm mb-3">{error}</div>}
        <form onSubmit={submit} className="space-y-3">
          <div>
            <p className="text-xs text-slate-500 mb-1">Current stage: <span className="font-semibold text-slate-700">{currentStatus}</span></p>
            <label className="text-xs font-medium text-slate-600 mb-1 block">Move to stage</label>
            <select value={targetStatus} onChange={e => setTargetStatus(e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-slate-700 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500">
              <option value="">Select target stage…</option>
              {moveableStages.map(s => (
                <option key={s} value={s}>{s.replace(/_/g, " ")}</option>
              ))}
            </select>
          </div>
          <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} placeholder="Reason for stage change (required)" className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-slate-800 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-purple-500" />
          <div className="flex gap-3">
            <button type="button" onClick={onClose} className="flex-1 border border-slate-200 text-slate-600 rounded-lg py-2.5 text-sm hover:bg-slate-50">Cancel</button>
            <button type="submit" disabled={loading} className="flex-1 bg-al-primary hover:bg-purple-800 text-white rounded-lg py-2.5 text-sm font-semibold disabled:opacity-50">{loading ? "Moving..." : "Move Stage"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Delete Confirm Modal ─────────────────────────────────────────────────────

function DeleteConfirmModal({
  buyerName, buyerId, onCancel, onSuccess, onRedirect,
}: {
  buyerName: string; buyerId: string; onCancel: () => void;
  onSuccess: () => void; onRedirect: () => void;
}) {
  const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [eligibility, setEligibility] = useState<{
    eligible: boolean; hardDeleteSafe: boolean; blockers: string[];
  } | null>(null);
  const [checking, setChecking] = useState(false);

  async function checkEligibility() {
    setChecking(true); setError(null);
    try {
      const data = await api.get<{ eligible: boolean; hardDeleteSafe: boolean; blockers: string[] }>(`/api/admin/buyers/${buyerId}/delete-eligibility`);
      setEligibility(data);
    } catch (err) { setError(apiErrorMessage(err, "Check failed")); }
    finally { setChecking(false); }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (confirmation !== "DELETE") { setError("Type DELETE to confirm"); return; }
    if (!reason.trim()) { setError("Reason is required"); return; }
    if (!eligibility?.hardDeleteSafe) { setError("Hard delete not allowed — use Privacy Purge instead"); return; }
    setLoading(true); setError(null);
    try {
      await api.del(`/api/admin/buyers/${buyerId}`, { json: { reason, confirmation } });
      onSuccess();
      setTimeout(onRedirect, 1500);
    } catch (err) { setError(apiErrorMessage(err, "Delete failed")); }
    finally { setLoading(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="bg-white rounded-2xl shadow-2xl border border-red-200 p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-start gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center flex-shrink-0">
            <Trash2 size={18} className="text-red-600" />
          </div>
          <div>
            <h3 className="font-bold text-lg text-red-700">Permanently Delete Buyer</h3>
            <p className="text-sm text-slate-500 mt-0.5">Buyer: <strong>{buyerName}</strong> · ID: {buyerId.slice(-10)}</p>
          </div>
          <button onClick={onCancel} className="ml-auto text-slate-400 hover:text-slate-600 mt-0.5"><X size={18} /></button>
        </div>

        {!eligibility && (
          <div className="mb-4">
            <p className="text-sm text-slate-600 mb-3">Before deleting, check deletion eligibility to ensure this action is safe.</p>
            <button onClick={checkEligibility} disabled={checking} className="flex items-center gap-2 px-4 py-2.5 bg-slate-700 text-white rounded-xl text-sm font-semibold hover:bg-slate-800 disabled:opacity-50 transition-colors">
              {checking ? <RefreshCw size={13} className="animate-spin" /> : <AlertCircle size={13} />}
              {checking ? "Checking…" : "Check Deletion Eligibility"}
            </button>
          </div>
        )}

        {eligibility && (
          <div className={"mb-4 rounded-xl p-4 border " + (eligibility.hardDeleteSafe ? "bg-green-50 border-green-200" : eligibility.eligible ? "bg-amber-50 border-amber-200" : "bg-red-50 border-red-200")}>
            <div className="flex items-center gap-2 mb-2">
              {eligibility.hardDeleteSafe
                ? <CheckCircle2 size={15} className="text-green-600" />
                : eligibility.eligible
                ? <AlertTriangle size={15} className="text-amber-600" />
                : <AlertCircle size={15} className="text-red-600" />}
              <span className={"text-sm font-semibold " + (eligibility.hardDeleteSafe ? "text-green-700" : eligibility.eligible ? "text-amber-700" : "text-red-700")}>
                {eligibility.hardDeleteSafe
                  ? "Hard delete is safe"
                  : eligibility.eligible
                  ? "Only privacy purge is safe (retention requirements)"
                  : "Deletion blocked — resolve active records first"}
              </span>
            </div>
            {eligibility.blockers.length > 0 && (
              <ul className="space-y-1 mt-2">
                {eligibility.blockers.map((b, i) => (
                  <li key={i} className="text-xs text-slate-700 flex items-start gap-1.5">
                    <span className="text-red-400 mt-0.5 flex-shrink-0">•</span>{b}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {error && <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2.5 text-red-700 text-sm mb-3">{error}</div>}

        {eligibility?.hardDeleteSafe && (
          <form onSubmit={submit} className="space-y-3">
            <div className="bg-red-50 border border-red-200 rounded-xl p-3">
              <p className="text-xs text-red-700 font-semibold mb-1">⚠ This action is IRREVERSIBLE</p>
              <p className="text-xs text-red-600">The buyer profile, authentication account, and all related records will be permanently deleted.</p>
            </div>
            <textarea
              value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder="Reason for permanent deletion (required)" rows={3}
              className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-slate-800 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-red-500"
            />
            <div>
              <label className="text-xs font-medium text-slate-700 block mb-1.5">Type <code className="bg-red-100 px-1.5 py-0.5 rounded font-mono text-red-700">DELETE</code> to confirm</label>
              <input
                value={confirmation} onChange={(e) => setConfirmation(e.target.value)}
                placeholder="DELETE" className="w-full border border-red-200 rounded-xl px-3 py-2.5 text-slate-900 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-red-500"
              />
            </div>
            <div className="flex gap-3 pt-1">
              <button type="button" onClick={onCancel} className="flex-1 border border-slate-200 text-slate-600 rounded-xl py-2.5 text-sm hover:bg-slate-50">Cancel</button>
              <button type="submit" disabled={loading || confirmation !== "DELETE"} className="flex-1 bg-red-600 hover:bg-red-700 text-white rounded-xl py-2.5 text-sm font-semibold disabled:opacity-50 transition-colors">
                {loading ? "Deleting…" : "Permanently Delete"}
              </button>
            </div>
          </form>
        )}

        {eligibility && !eligibility.hardDeleteSafe && !eligibility.eligible && (
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onCancel} className="flex-1 border border-slate-200 text-slate-600 rounded-xl py-2.5 text-sm hover:bg-slate-50">Close</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Privacy Purge Modal ──────────────────────────────────────────────────────

function PrivacyPurgeModal({
  buyerName, buyerId, onCancel, onSuccess,
}: {
  buyerName: string; buyerId: string; onCancel: () => void; onSuccess: () => void;
}) {
  const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (confirmation !== "DELETE") { setError("Type DELETE to confirm"); return; }
    if (!reason.trim()) { setError("Reason is required"); return; }
    setLoading(true); setError(null);
    try {
      await api.post(`/api/admin/buyers/${buyerId}/privacy-purge`, { reason, confirmation });
      onSuccess();
    } catch (err) { setError(apiErrorMessage(err, "Purge failed")); }
    finally { setLoading(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="bg-white rounded-2xl shadow-2xl border border-amber-200 p-6 w-full max-w-lg">
        <div className="flex items-start gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center flex-shrink-0">
            <Shield size={18} className="text-amber-600" />
          </div>
          <div>
            <h3 className="font-bold text-lg text-amber-700">Privacy-Safe Purge</h3>
            <p className="text-sm text-slate-500 mt-0.5">Buyer: <strong>{buyerName}</strong></p>
          </div>
          <button onClick={onCancel} className="ml-auto text-slate-400 hover:text-slate-600 mt-0.5"><X size={18} /></button>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4">
          <p className="text-xs text-amber-800 font-semibold mb-1">What this does:</p>
          <ul className="text-xs text-amber-700 space-y-0.5">
            <li>• Anonymizes name, phone, address, and email (PII removed)</li>
            <li>• Disables login access</li>
            <li>• Removes from active buyer lists</li>
            <li>• Preserves all financial records, deals, contracts, audit logs</li>
            <li>• Marks profile as PURGED — irreversible</li>
          </ul>
        </div>
        {error && <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2.5 text-red-700 text-sm mb-3">{error}</div>}
        <form onSubmit={submit} className="space-y-3">
          <textarea
            value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder="Reason for privacy purge (required)" rows={3}
            className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-slate-800 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-amber-500"
          />
          <div>
            <label className="text-xs font-medium text-slate-700 block mb-1.5">Type <code className="bg-amber-100 px-1.5 py-0.5 rounded font-mono text-amber-700">DELETE</code> to confirm</label>
            <input
              value={confirmation} onChange={(e) => setConfirmation(e.target.value)}
              placeholder="DELETE" className="w-full border border-amber-200 rounded-xl px-3 py-2.5 text-slate-900 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onCancel} className="flex-1 border border-slate-200 text-slate-600 rounded-xl py-2.5 text-sm hover:bg-slate-50">Cancel</button>
            <button type="submit" disabled={loading || confirmation !== "DELETE"} className="flex-1 bg-amber-600 hover:bg-amber-700 text-white rounded-xl py-2.5 text-sm font-semibold disabled:opacity-50 transition-colors">
              {loading ? "Purging…" : "Privacy Purge"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Admin Danger Zone ────────────────────────────────────────────────────────

function AdminDangerZone({
  buyer, availability,
  onArchive, onRestore, onDisable, onReactivate, onDelete, onPrivacyPurge,
}: {
  buyer: BuyerData["buyer"];
  availability: BuyerActionAvailability;
  onArchive: () => void; onRestore: () => void;
  onDisable: () => void; onReactivate: () => void;
  onDelete: () => void; onPrivacyPurge: () => void;
}) {
  const isArchived = !!buyer.archivedAt;
  const isDisabled = !!buyer.disabledAt;
  const isPurged   = !!buyer.purgedAt;

  return (
    <div className="space-y-4">
      {/* Lifecycle Status Banner */}
      {(isArchived || isDisabled || isPurged) && (
        <div className={"rounded-xl p-4 border flex items-start gap-3 " + (isPurged ? "bg-red-50 border-red-200" : isArchived ? "bg-slate-50 border-slate-300" : "bg-amber-50 border-amber-200")}>
          <AlertTriangle size={16} className={"flex-shrink-0 mt-0.5 " + (isPurged ? "text-red-500" : isArchived ? "text-slate-500" : "text-amber-500")} />
          <div>
            <p className={"text-sm font-semibold " + (isPurged ? "text-red-700" : isArchived ? "text-slate-700" : "text-amber-700")}>
              {isPurged ? "Buyer profile has been purged" : isArchived ? "Buyer profile is archived" : "Buyer login access is disabled"}
            </p>
            <p className="text-xs text-slate-500 mt-0.5">
              {isPurged && `Purged on ${new Date(buyer.purgedAt!).toLocaleString()}`}
              {!isPurged && isArchived && `Archived on ${new Date(buyer.archivedAt!).toLocaleString()}`}
              {!isPurged && !isArchived && isDisabled && `Disabled on ${new Date(buyer.disabledAt!).toLocaleString()}`}
            </p>
          </div>
        </div>
      )}

      {/* Archive / Restore */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2.5">
          <Archive size={15} className="text-slate-400" />
          <h3 className="font-semibold text-slate-800 text-sm">Archive</h3>
        </div>
        <div className="p-5">
          <p className="text-sm text-slate-600 mb-4">
            Archive removes the buyer from active lists while preserving all history, deals, payments, and documents. You can restore an archived buyer at any time.
          </p>
          <div className="flex gap-3">
            {availability.canArchive && (
              <button onClick={onArchive} className="flex items-center gap-2 px-4 py-2.5 bg-slate-700 hover:bg-slate-800 text-white rounded-xl text-sm font-semibold transition-colors">
                <Archive size={14} /> Archive Buyer
              </button>
            )}
            {availability.canRestore && (
              <button onClick={onRestore} className="flex items-center gap-2 px-4 py-2.5 bg-green-700 hover:bg-green-800 text-white rounded-xl text-sm font-semibold transition-colors">
                <ArchiveRestore size={14} /> Restore Buyer
              </button>
            )}
            {isPurged && (
              <span className="text-sm text-slate-400 italic">Archive/restore not available for purged profiles</span>
            )}
          </div>
        </div>
      </div>

      {/* Disable / Reactivate */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2.5">
          <Lock size={15} className="text-slate-400" />
          <h3 className="font-semibold text-slate-800 text-sm">Login Access</h3>
        </div>
        <div className="p-5">
          <p className="text-sm text-slate-600 mb-2">
            Disable sets <code className="bg-slate-100 px-1 rounded text-xs font-mono">Buyer.disabledAt</code> and records the restriction in the audit log. Admin can reactivate at any time.
          </p>
          <div className="text-xs bg-red-50 border border-red-200 rounded-lg px-3 py-2.5 mb-4 space-y-1">
            <p className="font-semibold text-red-700">⚠ Security Gap — Login blocking not enforced in buyer portal</p>
            <p className="text-red-600">
              <code className="bg-red-100 px-1 rounded font-mono">Buyer.disabledAt</code> is recorded in the database but is <strong>not checked</strong> by the buyer portal auth layer (<code className="bg-red-100 px-1 rounded font-mono">getRequestBuyer</code> / <code className="bg-red-100 px-1 rounded font-mono">getAuthenticatedBuyer</code>). A disabled buyer can still log in and access the buyer portal until this is addressed.
            </p>
            <p className="text-red-600 font-medium">
              Buyer portal auth enforcement must be handled in a separate auth/security PR.
            </p>
          </div>
          <div className="flex gap-3">
            {availability.canDisable && (
              <button onClick={onDisable} className="flex items-center gap-2 px-4 py-2.5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-sm font-semibold transition-colors">
                <Lock size={14} /> Disable Access
              </button>
            )}
            {availability.canReactivate && (
              <button onClick={onReactivate} className="flex items-center gap-2 px-4 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-xl text-sm font-semibold transition-colors">
                <Unlock size={14} /> Reactivate Access
              </button>
            )}
            {isPurged && (
              <span className="text-sm text-slate-400 italic">Access management not available for purged profiles</span>
            )}
          </div>
        </div>
      </div>

      {/* Permanent Delete */}
      {!isPurged && (
        <div className="bg-white border border-red-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-red-100 flex items-center gap-2.5 bg-red-50/50">
            <Trash2 size={15} className="text-red-400" />
            <h3 className="font-semibold text-red-700 text-sm">Permanent Delete</h3>
            <span className="ml-auto text-[10px] font-bold bg-red-100 text-red-700 px-2 py-0.5 rounded-full">SUPER_ADMIN ONLY</span>
          </div>
          <div className="p-5">
            <p className="text-sm text-slate-600 mb-2">
              Permanently and irreversibly delete this buyer profile. A deletion eligibility check will be performed first. If retention records exist (completed deals, payments, contracts), only privacy purge will be allowed.
            </p>
            <div className="flex gap-3 flex-wrap">
              <button onClick={onDelete} className="flex items-center gap-2 px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-sm font-semibold transition-colors">
                <Trash2 size={14} /> Permanently Delete
              </button>
              <button onClick={onPrivacyPurge} className="flex items-center gap-2 px-4 py-2.5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-sm font-semibold transition-colors">
                <Shield size={14} /> Privacy-Safe Purge
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Documented Gaps */}
      <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5">
        <h4 className="text-xs font-semibold text-slate-600 mb-3 uppercase tracking-wide">Documented Gaps</h4>
        <ul className="space-y-2 text-xs text-slate-500">
          <li className="flex items-start gap-2"><AlertCircle size={12} className="text-red-400 flex-shrink-0 mt-0.5" /><span><strong className="text-red-700">Auth Enforcement Gap (SECURITY):</strong> <code className="bg-slate-100 px-0.5 rounded font-mono">Buyer.disabledAt</code> is set when disabling a buyer but is <em>not</em> checked by <code className="bg-slate-100 px-0.5 rounded font-mono">getRequestBuyer()</code> or <code className="bg-slate-100 px-0.5 rounded font-mono">getAuthenticatedBuyer()</code>. Disabled buyers retain full portal access. Enforcement requires a dedicated auth/security PR.</span></li>
          <li className="flex items-start gap-2"><AlertCircle size={12} className="text-amber-400 flex-shrink-0 mt-0.5" /><span><strong>Supabase Session Invalidation:</strong> Setting <code className="bg-slate-100 px-0.5 rounded font-mono">disabledAt</code> does not invalidate existing Supabase sessions. Active sessions remain valid until expiry. Full revocation requires the Supabase Admin API (not yet integrated).</span></li>
          <li className="flex items-start gap-2"><AlertCircle size={12} className="text-amber-400 flex-shrink-0 mt-0.5" /><span><strong>Supabase User Deletion:</strong> Hard delete removes the DB User record but does not delete the corresponding Supabase auth user. Supabase Admin API call required post-delete.</span></li>
          <li className="flex items-start gap-2"><AlertCircle size={12} className="text-amber-400 flex-shrink-0 mt-0.5" /><span><strong>Merge Duplicates:</strong> Duplicate buyer profile merging is not supported — no schema merge tracking fields exist. This is a future feature.</span></li>
          <li className="flex items-start gap-2"><AlertCircle size={12} className="text-amber-400 flex-shrink-0 mt-0.5" /><span><strong>Elevated RBAC:</strong> Delete and purge check for SUPER_ADMIN role. No further permission tiers (e.g. COMPLIANCE_ADMIN override) are currently supported.</span></li>
        </ul>
      </div>
    </div>
  );
}

// ─── Journey Stage Progress ───────────────────────────────────────────────────

function JourneyStage({ label, done, active }: { label: string; done: boolean; active: boolean }) {
  return (
    <div className={"flex flex-col items-center gap-1 " + (active ? "opacity-100" : done ? "opacity-80" : "opacity-40")}>
      <div className={"w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold " + (done ? "bg-green-500 text-white" : active ? "bg-purple-600 text-white" : "bg-slate-200 text-slate-500")}>
        {done ? "✓" : "·"}
      </div>
      <span className={"text-[9px] font-medium text-center leading-none max-w-[48px] " + (active ? "text-purple-700" : done ? "text-green-700" : "text-slate-400")}>{label}</span>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

type ModalType =
  | "editProfile" | "sendReminder" | "sendInvite" | "assignAdmin"
  | "markException" | "resolveException" | "pauseWorkflow" | "resumeWorkflow"
  | "cancelWorkflow" | "moveWorkflow" | "addNote"
  | "archiveBuyer" | "restoreBuyer" | "disableAccess" | "reactivateAccess"
  | "deleteBuyer" | "privacyPurge"
  | "suspendAccount" | "unsuspendAccount" | "resetPassword"
  | "upgradePlan" | "downgradePlan" | "overrideDeposit";

export default function AdminBuyerCommandCenter({ data, availability, initialTab, prequalPanelExtras }: Props) {
  const { buyer, preQualification, deals, auctions, deposits, documents,
    insurancePolicies, insuranceQuotes, shortlistCount, vehicleRequests,
    activityEvents, auditLogs, supportNotes, exceptionStatus, assignedAdmin } = data;

  const router = useRouter();
  const [modal, setModal] = useState<ModalType | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);
  const [activeTab, setActiveTab] = useState(initialTab ?? "overview");
  const [refreshing, setRefreshing] = useState(false);

  const hasOpenAuction = auctions.some((a) => ["PENDING", "ACTIVE"].includes(a.status));
  const buyerFullName = `${buyer.firstName ?? ""} ${buyer.lastName ?? ""}`.trim() || buyer.email;

  const activeDeal = deals.find((d) => !["CANCELLED", "COMPLETED", "REFUNDED"].includes(d.status));
  const depositTotal = deposits.filter((d) => d.status === "PAID").reduce((s, d) => s + d.amountCents, 0);
  const failedDeposits = deposits.filter((d) => d.status === "FAILED");

  const showToast = (msg: string, type: "success" | "error" = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };

  const handleSuccess = (msg: string) => {
    setModal(null);
    showToast(msg);
    // Trigger page refresh
    setRefreshing(true);
    setTimeout(() => window.location.reload(), 1200);
  };

  async function doAction(endpoint: string, body: Record<string, string>, successMsg: string) {
    await api.post("/api/admin/buyers/" + buyer.id + "/" + endpoint, body);
    handleSuccess(successMsg);
  }

  const tabs = [
    { id: "overview", label: "Overview" },
    { id: "journey",  label: "Journey" },
    { id: "payments", label: "Payments" },
    { id: "deals", label: "Deals" },
    { id: "auctions", label: "Auctions" },
    { id: "documents", label: "Documents" },
    { id: "activity", label: "Activity" },
    { id: "notes", label: "Notes" },
    { id: "danger", label: "⚠ Admin Actions" },
  ];

  const journeyStages = [
    { key: "account", label: "Account", done: true },
    { key: "onboarding", label: "Onboarding", done: buyer.onboardingComplete },
    { key: "prequal", label: "Prequal", done: !!preQualification },
    { key: "deposit", label: "Deposit", done: deposits.some((d) => d.status === "PAID") },
    { key: "auction", label: "Auction", done: auctions.some((a) => a.status !== "PENDING") },
    { key: "deal", label: "Deal", done: !!activeDeal },
    { key: "financing", label: "Financing", done: !!activeDeal?.financing },
    { key: "fee", label: "Fee", done: !!(activeDeal?.feePaidAt) },
    { key: "insurance", label: "Insurance", done: ["VERIFIED", "POLICY_BOUND", "EXTERNAL_UPLOADED"].includes(activeDeal?.insuranceStatus ?? "") },
    { key: "contract", label: "Contract", done: !!(activeDeal?.latestContractVersion) },
    { key: "esign", label: "E-Sign", done: activeDeal?.eSignEnvelope?.status === "COMPLETED" },
    { key: "pickup", label: "Pickup", done: activeDeal?.pickup?.status === "COMPLETED" },
    { key: "complete", label: "Complete", done: deals.some((d) => d.status === "COMPLETED") },
  ];

  const currentJourneyIdx = [...journeyStages].reverse().findIndex((s) => s.done);
  const activeJourneyKey = currentJourneyIdx >= 0 ? journeyStages[journeyStages.length - 1 - currentJourneyIdx + 1]?.key : "account";

  return (
    <div className="min-h-screen bg-slate-50" data-testid="admin-buyer-command-center">
      {/* Toast */}
      {toast && (
        <div className={"fixed top-4 right-4 z-50 px-4 py-3 rounded-xl text-sm shadow-xl font-medium flex items-center gap-2 max-w-sm " + (toast.type === "success" ? "bg-green-600 text-white" : "bg-red-600 text-white")}>
          {toast.type === "success" ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
          <span>{toast.msg}</span>
          {refreshing && <RefreshCw size={13} className="animate-spin ml-1" />}
        </div>
      )}

      {/* Modals */}
      {modal === "editProfile" && (
        <EditProfileModal buyer={buyer} onClose={() => setModal(null)} onSuccess={() => handleSuccess("Profile updated")} />
      )}
      {modal === "addNote" && (
        <AddNoteModal buyerId={buyer.id} onClose={() => setModal(null)} onSuccess={() => handleSuccess("Note added")} />
      )}
      {modal === "moveWorkflow" && activeDeal && (
        <MoveWorkflowModal
          buyerId={buyer.id} dealId={activeDeal.id} currentStatus={activeDeal.status}
          onClose={() => setModal(null)} onSuccess={() => handleSuccess("Workflow stage moved")}
        />
      )}
      {modal === "sendReminder" && (
        <ConfirmModal
          title="Send Reminder" description={"Send an in-app reminder message to " + buyer.firstName + " " + buyer.lastName + "."}
          submitLabel="Send Reminder" requireReason={true}
          onCancel={() => setModal(null)}
          onConfirm={async (reason) => {
            await doAction("reminder", { message: "This is a reminder from the AutoLenis team regarding your account. Please log in to continue.", reason }, "Reminder sent to " + buyer.firstName);
          }}
        />
      )}
      {modal === "sendInvite" && (
        <ConfirmModal
          title="Send Account Invite" description={"Send a sign-in invitation email to " + buyer.email + "."}
          submitLabel="Send Invite" requireReason={true}
          onCancel={() => setModal(null)}
          onConfirm={async (reason) => {
            await doAction("invite", { reason }, "Invite sent to " + buyer.email);
          }}
        />
      )}
      {modal === "assignAdmin" && (
        <ConfirmModal
          title="Assign to Admin Queue" description="Assign this buyer to a specific admin for follow-up. Enter the admin email below as the reason."
          submitLabel="Assign" requireReason={true}
          onCancel={() => setModal(null)}
          onConfirm={async (reason) => {
            await doAction("assign", { assignedTo: reason.trim(), reason: "Admin assignment from command center" }, "Buyer assigned");
          }}
        />
      )}
      {modal === "markException" && (
        <ConfirmModal
          title="Flag as Exception" description="Mark this buyer's account as an exception requiring immediate admin attention." destructive
          submitLabel="Flag Exception" requireReason={true}
          onCancel={() => setModal(null)}
          onConfirm={async (reason) => { await doAction("exception", { reason }, "Exception flagged"); }}
        />
      )}
      {modal === "resolveException" && (
        <ConfirmModal
          title="Resolve Exception" description="Mark this exception as resolved." submitLabel="Resolve Exception" requireReason={true}
          onCancel={() => setModal(null)}
          onConfirm={async (reason) => { await doAction("exception/resolve", { reason }, "Exception resolved"); }}
        />
      )}
      {modal === "pauseWorkflow" && availability.activeAuctionId && (
        <ConfirmModal
          title="Pause Workflow" description="Cancel the active auction, pausing this buyer's deal workflow. This requires a reason and will be audit logged." destructive
          submitLabel="Pause Workflow" requireReason={true}
          onCancel={() => setModal(null)}
          onConfirm={async (reason) => { await doAction("workflow/pause", { auctionId: availability.activeAuctionId!, reason }, "Workflow paused"); }}
        />
      )}
      {modal === "resumeWorkflow" && availability.activeAuctionId && (
        <ConfirmModal
          title="Resume Workflow" description="Reactivate the pending auction for this buyer."
          submitLabel="Resume Workflow" requireReason={true}
          onCancel={() => setModal(null)}
          onConfirm={async (reason) => { await doAction("workflow/resume", { auctionId: availability.activeAuctionId!, reason }, "Workflow resumed"); }}
        />
      )}
      {modal === "cancelWorkflow" && availability.activeDealId && (
        <ConfirmModal
          title="Cancel Workflow" description="Cancel the active deal for this buyer. This is irreversible without admin override." destructive
          submitLabel="Cancel Deal" requireReason={true}
          onCancel={() => setModal(null)}
          onConfirm={async (reason) => { await doAction("workflow/cancel", { dealId: availability.activeDealId!, reason }, "Deal workflow cancelled"); }}
        />
      )}

      {/* ─── Lifecycle Modals ────────────────────────────────────────────────── */}
      {modal === "archiveBuyer" && (
        <ConfirmModal
          title="Archive Buyer" description={`Archive ${buyer.firstName} ${buyer.lastName}? This removes them from active buyer lists but preserves all history, deals, and payments. You can restore them later.`}
          submitLabel="Archive Buyer" destructive={false} requireReason={true}
          onCancel={() => setModal(null)}
          onConfirm={async (reason) => { await doAction("archive", { reason }, "Buyer archived"); }}
        />
      )}
      {modal === "restoreBuyer" && (
        <ConfirmModal
          title="Restore Buyer" description={`Restore ${buyer.firstName} ${buyer.lastName} from archived status? This returns them to active buyer lists.`}
          submitLabel="Restore Buyer" destructive={false} requireReason={true}
          onCancel={() => setModal(null)}
          onConfirm={async (reason) => { await doAction("restore", { reason }, "Buyer restored"); }}
        />
      )}
      {modal === "disableAccess" && (
        <ConfirmModal
          title="Disable Login Access" description={`This records Buyer.disabledAt for ${buyer.firstName} ${buyer.lastName} and audit logs the action. NOTE: The buyer portal auth layer does not currently enforce this flag — buyer portal access remains active until a dedicated auth/security PR is merged.`}
          submitLabel="Disable Access" destructive={true} requireReason={true}
          onCancel={() => setModal(null)}
          onConfirm={async (reason) => { await doAction("disable", { reason }, "Buyer access disabled"); }}
        />
      )}
      {modal === "reactivateAccess" && (
        <ConfirmModal
          title="Reactivate Access" description={`Reactivate login access for ${buyer.firstName} ${buyer.lastName}? This clears the disabled flag on their account.`}
          submitLabel="Reactivate" destructive={false} requireReason={true}
          onCancel={() => setModal(null)}
          onConfirm={async (reason) => { await doAction("reactivate", { reason }, "Buyer access reactivated"); }}
        />
      )}
      {modal === "deleteBuyer" && (
        <DeleteConfirmModal
          buyerName={`${buyer.firstName} ${buyer.lastName}`}
          buyerId={buyer.id}
          onCancel={() => setModal(null)}
          onSuccess={() => handleSuccess("Buyer permanently deleted")}
          onRedirect={() => { window.location.href = "/admin/buyers"; }}
        />
      )}
      {modal === "privacyPurge" && (
        <PrivacyPurgeModal
          buyerName={`${buyer.firstName} ${buyer.lastName}`}
          buyerId={buyer.id}
          onCancel={() => setModal(null)}
          onSuccess={() => handleSuccess("Buyer PII purged")}
        />
      )}

      {/* ─── Suspension Modals ────────────────────────────────────────────────── */}
      {modal === "suspendAccount" && (
        <ConfirmModal
          title="Suspend Account"
          description={`Suspend ${buyer.firstName} ${buyer.lastName}'s account? The buyer will be immediately blocked from accessing the buyer portal. Sessions will be revoked.`}
          submitLabel="Suspend Account" destructive requireReason
          onCancel={() => setModal(null)}
          onConfirm={async (reason) => { await doAction("suspend", { reason }, "Buyer account suspended"); }}
        />
      )}
      {modal === "unsuspendAccount" && (
        <ConfirmModal
          title="Unsuspend Account"
          description={`Restore portal access for ${buyer.firstName} ${buyer.lastName}? They will be able to log in immediately.`}
          submitLabel="Unsuspend Account" requireReason
          onCancel={() => setModal(null)}
          onConfirm={async (reason) => { await doAction("unsuspend", { reason }, "Buyer account unsuspended"); }}
        />
      )}
      {modal === "resetPassword" && (
        <ConfirmModal
          title="Send Password Reset"
          description={`Send a password reset email to ${buyer.email}?`}
          submitLabel="Send Reset Email" requireReason
          onCancel={() => setModal(null)}
          onConfirm={async (reason) => { await doAction("reset-password", { reason }, `Password reset email sent to ${buyer.email}`); }}
        />
      )}
      {modal === "upgradePlan" && (
        <ConfirmModal
          title="Upgrade to Premium"
          description={`Upgrade ${buyer.firstName} ${buyer.lastName} to the PREMIUM plan? Premium benefits apply immediately.`}
          submitLabel="Upgrade to Premium" requireReason
          onCancel={() => setModal(null)}
          onConfirm={async (reason) => { await doAction("plan", { plan: "PREMIUM", reason }, "Buyer upgraded to Premium"); }}
        />
      )}
      {modal === "downgradePlan" && (
        <ConfirmModal
          title="Downgrade to Standard"
          description={`Downgrade ${buyer.firstName} ${buyer.lastName} to the STANDARD plan? This removes Premium benefits immediately.`}
          submitLabel="Downgrade to Standard" destructive requireReason
          onCancel={() => setModal(null)}
          onConfirm={async (reason) => { await doAction("plan", { plan: "STANDARD", reason }, "Buyer downgraded to Standard"); }}
        />
      )}
      {modal === "overrideDeposit" && (
        <ConfirmModal
          title="Override Deposit (mark PAID)"
          description={`Record a PAID Auction Access Deposit for ${buyer.firstName} ${buyer.lastName} without Stripe. Use only for verified manual/offline payments — the buyer is notified and the journey advances to deposit_paid.`}
          submitLabel="Mark Deposit Paid" requireReason
          onCancel={() => setModal(null)}
          onConfirm={async (reason) => { await doAction("deposit/override", { reason }, "Deposit override recorded — buyer notified"); }}
        />
      )}

      {/* ─── Hero Header ─────────────────────────────────────────────────────── */}
      <div className="bg-white border-b border-slate-200 px-4 sm:px-6 lg:px-8 py-5">
        {/* Breadcrumb */}
        <div className="flex items-center gap-1.5 text-xs text-slate-400 mb-4">
          <Link href="/admin/buyers" className="hover:text-purple-600 transition-colors">Buyers</Link>
          <ChevronRight size={12} />
          <span className="text-slate-600 font-medium">{buyer.firstName} {buyer.lastName}</span>
        </div>

        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-2xl bg-al-primary flex items-center justify-center flex-shrink-0 shadow-md">
              <span className="text-white text-lg font-bold">{buyer.firstName[0]}{buyer.lastName[0]}</span>
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl font-bold text-slate-900">{buyer.firstName} {buyer.lastName}</h1>
                {exceptionStatus.isActive && (
                  <Badge variant="destructive" className="text-[10px] flex items-center gap-1">
                    <ShieldAlert size={10} /> Exception
                  </Badge>
                )}
                <Badge variant={buyer.plan === "PREMIUM" ? "default" : "secondary"} className="text-[10px]">
                  {buyer.plan}
                </Badge>
                {buyer.purgedAt && <Badge variant="destructive" className="text-[10px]">Purged</Badge>}
                {!buyer.purgedAt && buyer.archivedAt && <Badge variant="secondary" className="text-[10px]">Archived</Badge>}
                {!buyer.purgedAt && buyer.disabledAt && <Badge variant="amber" className="text-[10px]">Access Disabled</Badge>}
              </div>
              <div className="flex flex-wrap items-center gap-3 mt-1.5 text-xs text-slate-500">
                <span className="flex items-center gap-1"><Mail size={11} />{buyer.email}</span>
                {buyer.phone && <span className="flex items-center gap-1"><Phone size={11} />{buyer.phone}</span>}
                <span className="flex items-center gap-1"><Calendar size={11} />Joined {fmtDate(buyer.createdAt)}</span>
                <span className="flex items-center gap-1 font-mono text-[10px] bg-slate-100 px-1.5 py-0.5 rounded">{buyer.id.slice(-10)}</span>
                {assignedAdmin && <span className="flex items-center gap-1 text-purple-600"><UserCheck size={11} />{assignedAdmin}</span>}
                {activityEvents[0] && <span className="flex items-center gap-1"><Clock size={11} />Active {timeAgo(activityEvents[0].createdAt)}</span>}
              </div>
            </div>
          </div>

          {/* Primary CTA Actions */}
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setModal("editProfile")} className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition-colors">
              <Edit2 size={12} /> Edit
            </button>
            <button onClick={() => setModal("sendReminder")} className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition-colors">
              <Bell size={12} /> Reminder
            </button>
            <button onClick={() => setModal("sendInvite")} className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition-colors">
              <Mail size={12} /> Invite
            </button>
            <button onClick={() => setModal("assignAdmin")} className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition-colors">
              <UserCheck size={12} /> Assign
            </button>
            {availability.canPauseWorkflow && (
              <button onClick={() => setModal("pauseWorkflow")} className="flex items-center gap-1.5 px-3 py-2 bg-amber-100 hover:bg-amber-200 text-amber-700 rounded-xl text-xs font-semibold transition-colors">
                <PauseCircle size={12} /> Pause
              </button>
            )}
            {availability.canResumeWorkflow && (
              <button onClick={() => setModal("resumeWorkflow")} className="flex items-center gap-1.5 px-3 py-2 bg-green-100 hover:bg-green-200 text-green-700 rounded-xl text-xs font-semibold transition-colors">
                <PlayCircle size={12} /> Resume
              </button>
            )}
            {availability.canCancelWorkflow && (
              <button onClick={() => setModal("cancelWorkflow")} className="flex items-center gap-1.5 px-3 py-2 bg-red-100 hover:bg-red-200 text-red-700 rounded-xl text-xs font-semibold transition-colors">
                <StopCircle size={12} /> Cancel
              </button>
            )}
            {availability.canMoveWorkflow && (
              <button onClick={() => setModal("moveWorkflow")} className="flex items-center gap-1.5 px-3 py-2 bg-purple-100 hover:bg-purple-200 text-purple-700 rounded-xl text-xs font-semibold transition-colors">
                <ArrowRight size={12} /> Move Stage
              </button>
            )}
            {availability.canMarkException && (
              <button onClick={() => setModal("markException")} className="flex items-center gap-1.5 px-3 py-2 bg-rose-100 hover:bg-rose-200 text-rose-700 rounded-xl text-xs font-semibold transition-colors">
                <Flag size={12} /> Flag
              </button>
            )}
            {availability.canResolveException && (
              <button onClick={() => setModal("resolveException")} className="flex items-center gap-1.5 px-3 py-2 bg-green-100 hover:bg-green-200 text-green-700 rounded-xl text-xs font-semibold transition-colors">
                <CheckCircle2 size={12} /> Resolve
              </button>
            )}
            {activeDeal && (
              <Link href={"/admin/payments?buyerId=" + buyer.id} className="flex items-center gap-1.5 px-3 py-2 bg-blue-100 hover:bg-blue-200 text-blue-700 rounded-xl text-xs font-semibold transition-colors">
                <CreditCard size={12} /> Payments
              </Link>
            )}
          </div>
        </div>

        {/* Journey Progress Bar */}
        <div className="mt-5 pt-4 border-t border-slate-100">
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-3">Buyer Journey</p>
          <div className="flex items-start gap-1 overflow-x-auto pb-1">
            {journeyStages.map((s, i) => (
              <div key={s.key} className="flex items-center gap-1">
                <JourneyStage label={s.label} done={s.done} active={s.key === activeJourneyKey} />
                {i < journeyStages.length - 1 && (
                  <div className={"h-0.5 w-3 mt-3 flex-shrink-0 " + (s.done ? "bg-green-400" : "bg-slate-200")} />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* OFAC Alert Banner */}
      {preQualification?.checkOfacAlert && (
        <div className="mx-4 sm:mx-6 lg:mx-8 mt-4 bg-red-50 border-2 border-red-300 rounded-2xl p-4" data-testid="ofac-alert-banner">
          <div className="flex items-center gap-2">
            <Lock size={18} className="text-red-700 flex-shrink-0" />
            <div>
              <p className="font-bold text-red-800 text-sm">OFAC Alert — Compliance Review Required</p>
              <p className="text-xs text-red-600 mt-0.5">This buyer has an OFAC flag. Do NOT approve any workflow steps without compliance sign-off. See <Link href="/admin/manual-reviews" className="underline">Manual Reviews</Link>.</p>
            </div>
          </div>
        </div>
      )}

      {/* Exception Banner */}
      {exceptionStatus.isActive && (
        <div className="mx-4 sm:mx-6 lg:mx-8 mt-4 bg-rose-50 border border-rose-300 rounded-2xl p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <ShieldAlert size={16} className="text-rose-700 flex-shrink-0" />
              <div>
                <p className="font-bold text-rose-800 text-sm">Active Exception</p>
                {exceptionStatus.reason && <p className="text-xs text-rose-600 mt-0.5">{exceptionStatus.reason}</p>}
              </div>
            </div>
            <button onClick={() => setModal("resolveException")} className="text-xs text-rose-700 hover:text-rose-900 font-semibold border border-rose-300 rounded-lg px-3 py-1.5 hover:bg-rose-100 transition-colors">Resolve</button>
          </div>
        </div>
      )}

      {/* Tab Navigation */}
      <div className="px-4 sm:px-6 lg:px-8 pt-5">
        <div className="flex gap-1 border-b border-slate-200 overflow-x-auto">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={"px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors " + (activeTab === t.id ? "border-al-primary text-al-primary" : "border-transparent text-slate-500 hover:text-slate-700")}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      <div className="px-4 sm:px-6 lg:px-8 py-5 space-y-4">

        {/* ─── Overview Tab ─────────────────────────────────────────────── */}
        {activeTab === "overview" && (
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">

            {/* A. Buyer Identity */}
            <SectionCard title="Buyer Identity" icon={<User size={15} />}>
              <div className="space-y-0">
                <InfoRow label="Full Name" value={buyer.firstName + " " + buyer.lastName} />
                <InfoRow label="Email" value={<span className="break-all">{buyer.email}</span>} />
                <InfoRow label="Phone" value={buyer.phone ?? "—"} />
                <InfoRow label="Address" value={[buyer.address, buyer.city, buyer.state, buyer.zip].filter(Boolean).join(", ") || "—"} />
                <InfoRow label="Onboarding" value={buyer.onboardingComplete ? <Badge variant="green" className="text-[10px]">Complete</Badge> : <Badge variant="amber" className="text-[10px]">Pending</Badge>} />
                <InfoRow label="Plan" value={buyer.plan} />
                <InfoRow label="Terms Accepted" value={buyer.termsAcceptedAt ? fmtDate(buyer.termsAcceptedAt) : "—"} />
                <InfoRow label="Joined" value={fmtDate(buyer.createdAt)} />
                <InfoRow label="Employment" value={buyer.employmentStatus ?? "—"} />
                <InfoRow label="Income Range" value={buyer.incomeRange ?? "—"} />
              </div>
            </SectionCard>

            {/* B. Prequalification */}
            <SectionCard title="Prequalification & Buying Power" icon={<DollarSign size={15} />}>
              {preQualification ? (
                <div className="space-y-0">
                  <InfoRow label="Decision" value={
                    <Badge variant={preQualification.decision === "APPROVED" ? "green" : preQualification.decision === "DECLINED" ? "destructive" : "amber"} className="text-[10px]">
                      {preQualification.decision}
                    </Badge>
                  } />
                  <InfoRow label="Buying Power" value={<span className="font-bold text-green-700 text-base">{fmtCents(preQualification.maxOtdAmountCents)}</span>} />
                  <InfoRow label="Tier" value={preQualification.tier ?? "—"} />
                  <InfoRow label="Expires" value={fmtDate(preQualification.expiresAt)} />
                  <InfoRow label="External" value={preQualification.isExternal ? "Yes" : "No"} />
                  <InfoRow label="OFAC Alert" value={preQualification.checkOfacAlert ? <Badge variant="destructive" className="text-[10px]">FLAGGED</Badge> : <Badge variant="green" className="text-[10px]">Clear</Badge>} />
                  <InfoRow label="Prequal ID" value={<span className="font-mono text-[10px]">{preQualification.id.slice(-8)}</span>} />
                  <div className="pt-3 flex gap-2">
                    <Link href={"/admin/prequal/" + preQualification.id} className="text-xs text-purple-600 hover:underline flex items-center gap-1" data-testid="buyer-view-prequal-link"><ExternalLink size={11} />View Prequal</Link>
                    <span className="text-slate-300">·</span>
                    <Link href="/admin/manual-reviews" className="text-xs text-purple-600 hover:underline flex items-center gap-1"><ExternalLink size={11} />Manual Reviews</Link>
                  </div>
                </div>
              ) : (
                <div className="py-6 text-center">
                  <Search size={24} className="text-slate-300 mx-auto mb-2" />
                  <p className="text-slate-500 text-sm font-medium">No prequalification on file</p>
                  <div className="mt-3 flex justify-center gap-3">
                    <Link href={"/admin/external-preapprovals?buyerId=" + buyer.id} className="text-xs text-purple-600 hover:underline">View external prequals</Link>
                  </div>
                </div>
              )}
              {data.externalPreApprovals.length > 0 && (
                <div className="mt-4 pt-3 border-t border-slate-100">
                  <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-2">External Pre-Approvals</p>
                  {data.externalPreApprovals.slice(0, 2).map((e) => (
                    <div key={e.id} className="bg-blue-50 rounded-lg p-2 mb-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-blue-800">{e.lenderName ?? "Unknown Lender"}</span>
                        <Badge variant="blue" className="text-[10px]">{e.status}</Badge>
                      </div>
                      {e.approvedAmountCents && <p className="text-[11px] text-blue-700 mt-0.5">Up to {fmtCents(e.approvedAmountCents)} · {e.aprRate ? e.aprRate + "% APR" : ""}</p>}
                    </div>
                  ))}
                  <Link href={"/admin/external-preapprovals?buyerId=" + buyer.id} className="text-[11px] text-purple-600 hover:underline mt-1 block">View all →</Link>
                </div>
              )}
            </SectionCard>

            {/* Full prequal workflow — MicroBilt iPredict + Manual Override */}
            {prequalPanelExtras && (
              <div className="lg:col-span-2">
                <PrequalAdminPanel
                  buyerId={buyer.id}
                  buyer={{
                    firstName: buyer.firstName,
                    lastName: buyer.lastName,
                    email: buyer.email,
                    address: buyer.address,
                    city: buyer.city,
                    state: buyer.state,
                    zip: buyer.zip,
                    employmentStatus: buyer.employmentStatus,
                    incomeRange: buyer.incomeRange,
                  }}
                  existingPrequal={
                    preQualification
                      ? {
                          id: preQualification.id,
                          decision: preQualification.decision,
                          tier: preQualification.tier,
                          maxOtdAmountCents: preQualification.maxOtdAmountCents,
                          expiresAt: preQualification.expiresAt,
                          isValid: new Date(preQualification.expiresAt) > new Date(),
                          checkOfacAlert: preQualification.checkOfacAlert,
                          isExternal: preQualification.isExternal,
                          source: prequalPanelExtras.source ?? "",
                          createdAt: preQualification.createdAt,
                          updatedAt: preQualification.updatedAt,
                          creditScore: preQualification.creditScore ?? null,
                          idvScore: preQualification.idvScore ?? null,
                          mlaCovered: preQualification.mlaCovered ?? false,
                          fraudWarning: preQualification.fraudWarning ?? null,
                          adverseReasonCodes: preQualification.adverseReasonCodes ?? [],
                          deceasedFlag: preQualification.deceasedFlag ?? false,
                          bankruptcyFlag: preQualification.bankruptcyFlag ?? false,
                        }
                      : null
                  }
                  hasConsent={prequalPanelExtras.hasConsent}
                  consentAcceptedAt={prequalPanelExtras.consentAcceptedAt}
                  profileMissingFields={prequalPanelExtras.profileMissingFields}
                />
              </div>
            )}

            {/* N. Risk / Exception */}
            <SectionCard title="Risk & Exception" icon={<ShieldAlert size={15} />} className={exceptionStatus.isActive ? "border-rose-300" : ""}>
              <div className="space-y-0">
                <InfoRow label="Exception Status" value={exceptionStatus.isActive ? <Badge variant="destructive" className="text-[10px]">Active</Badge> : <Badge variant="green" className="text-[10px]">Clear</Badge>} />
                {exceptionStatus.reason && <InfoRow label="Exception Reason" value={<span className="text-red-600 text-xs">{exceptionStatus.reason}</span>} />}
                <InfoRow label="OFAC Flag" value={preQualification?.checkOfacAlert ? <Badge variant="destructive" className="text-[10px]">Flagged</Badge> : <Badge variant="green" className="text-[10px]">Clear</Badge>} />
                {activeDeal?.riskTier && <InfoRow label="Risk Tier" value={activeDeal.riskTier} />}
              </div>
              <div className="pt-3 flex flex-wrap gap-2">
                {availability.canMarkException && (
                  <button onClick={() => setModal("markException")} className="text-xs text-rose-600 hover:underline flex items-center gap-1"><Flag size={11} />Flag Exception</button>
                )}
                {availability.canResolveException && (
                  <button onClick={() => setModal("resolveException")} className="text-xs text-green-600 hover:underline flex items-center gap-1"><CheckCircle2 size={11} />Resolve</button>
                )}
                <Link href="/admin/compliance/ofac" className="text-xs text-purple-600 hover:underline flex items-center gap-1"><ExternalLink size={11} />OFAC Queue</Link>
              </div>
            </SectionCard>

          </div>
        )}

        {/* ─── Journey Tab ──────────────────────────────────────────────── */}
        {activeTab === "journey" && (
          <div className="p-6" data-testid="buyer-journey-tab">
            <div className="mb-5">
              <h2 className="text-base font-bold text-slate-900">Buyer Journey</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Stage-by-stage progress. Select stages below to unlock them manually.
                All unlock actions are logged to the admin audit trail.
              </p>
            </div>
            <BuyerJourneyTab buyerId={buyer.id} />
          </div>
        )}

        {/* ─── Payments Tab ─────────────────────────────────────────────── */}
        {activeTab === "payments" && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <SectionCard title="Deposits" icon={<CreditCard size={15} />}>
              {deposits.length === 0 ? (
                <div className="text-center py-4">
                  <p className="text-slate-400 text-sm">No deposits on file</p>
                  {!buyer.purgedAt && (
                    <button
                      onClick={() => setModal("overrideDeposit")}
                      className="mt-3 inline-flex items-center gap-1.5 px-3 py-2 bg-amber-100 hover:bg-amber-200 text-amber-700 rounded-xl text-xs font-semibold transition-colors"
                    >
                      <CreditCard size={12} /> Override Deposit (mark PAID)
                    </button>
                  )}
                </div>
              ) : (
                <>
                  <div className="mb-3 flex items-center justify-between">
                    <span className="text-xs text-slate-500">Total paid</span>
                    <span className="font-bold text-green-700">{fmtCents(depositTotal)}</span>
                  </div>
                  {failedDeposits.length > 0 && (
                    <div className="bg-red-50 border border-red-200 rounded-lg p-2.5 mb-3">
                      <p className="text-xs font-semibold text-red-700 flex items-center gap-1"><AlertTriangle size={12} />{failedDeposits.length} failed deposit(s)</p>
                    </div>
                  )}
                  {deposits.map((d) => (
                    <div key={d.id} className="flex items-center justify-between py-2 border-b border-slate-50 last:border-0">
                      <div>
                        <p className="text-xs font-semibold text-slate-800">{fmtCents(d.amountCents)}</p>
                        <p className="text-[10px] text-slate-400">{fmtDate(d.createdAt)}</p>
                        {d.stripePaymentIntentId && <p className="text-[10px] font-mono text-slate-300">{d.stripePaymentIntentId.slice(0, 20)}…</p>}
                      </div>
                      <Badge
                        variant={d.status === "PAID" ? "green" : d.status === "FAILED" ? "destructive" : d.status === "REFUNDED" ? "amber" : "secondary"}
                        className="text-[10px]"
                      >{d.status}</Badge>
                    </div>
                  ))}
                  {!deposits.some((d) => d.status === "PAID") && !buyer.purgedAt && (
                    <button
                      onClick={() => setModal("overrideDeposit")}
                      className="mt-3 w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-amber-100 hover:bg-amber-200 text-amber-700 rounded-xl text-xs font-semibold transition-colors"
                    >
                      <CreditCard size={12} /> Override Deposit (mark PAID)
                    </button>
                  )}
                  <div className="pt-3 flex gap-3">
                    <Link href="/admin/payments/deposits" className="text-xs text-purple-600 hover:underline flex items-center gap-1"><ExternalLink size={11} />All Deposits</Link>
                    <Link href="/admin/payments/refunds" className="text-xs text-purple-600 hover:underline flex items-center gap-1"><ExternalLink size={11} />Refunds</Link>
                  </div>
                </>
              )}
            </SectionCard>

            <SectionCard title="Service Fee Payments" icon={<DollarSign size={15} />}>
              {deals.filter((d) => d.serviceFeePayment).length === 0 ? (
                <p className="text-slate-400 text-sm text-center py-4">No service fees paid</p>
              ) : (
                <>
                  {deals.filter((d) => d.serviceFeePayment).map((d) => (
                    <div key={d.id} className="bg-slate-50 rounded-xl p-3 mb-2">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-semibold text-slate-700">{fmtCents(d.serviceFeePayment!.amountCents)}</span>
                        {d.serviceFeePayment!.paidAt ? <Badge variant="green" className="text-[10px]">Paid</Badge> : <Badge variant="amber" className="text-[10px]">Pending</Badge>}
                      </div>
                      <p className="text-[10px] text-slate-500">Net: {fmtCents(d.serviceFeePayment!.netAmountCents)} · Deal {d.id.slice(-6)}</p>
                      {d.serviceFeePayment!.paidAt && <p className="text-[10px] text-slate-400">{fmtDate(d.serviceFeePayment!.paidAt)}</p>}
                    </div>
                  ))}
                  <Link href="/admin/payments" className="text-xs text-purple-600 hover:underline mt-2 flex items-center gap-1"><ExternalLink size={11} />All Concierge Fees</Link>
                </>
              )}
            </SectionCard>
          </div>
        )}

        {/* ─── Deals Tab ────────────────────────────────────────────────── */}
        {activeTab === "deals" && (
          <div className="space-y-4">
            {deals.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center">
                <Briefcase size={32} className="text-slate-300 mx-auto mb-3" />
                <p className="text-slate-500 font-medium">No deals yet</p>
              </div>
            ) : deals.map((d) => (
              <div key={d.id} className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                <div className={"px-5 py-4 border-b border-slate-100 flex items-center justify-between " + (["CANCELLED", "REFUNDED"].includes(d.status) ? "bg-slate-50" : "")}>
                  <div className="flex items-center gap-3">
                    <Briefcase size={15} className="text-slate-400" />
                    <div>
                      <p className="text-sm font-bold text-slate-900">Deal {d.id.slice(-8)}</p>
                      <p className="text-[11px] text-slate-400">{fmtDate(d.createdAt)}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={d.status === "COMPLETED" ? "green" : ["CANCELLED", "REFUNDED"].includes(d.status) ? "secondary" : "blue"}
                      className="text-[10px]"
                    >{d.status.replace(/_/g, " ")}</Badge>
                    <Link href={"/admin/deals/" + d.id} className="text-xs text-purple-600 hover:underline flex items-center gap-1"><ExternalLink size={11} />View</Link>
                  </div>
                </div>
                <div className="p-5 grid grid-cols-2 lg:grid-cols-4 gap-3">
                  {d.offer && (
                    <>
                      <div className="bg-slate-50 rounded-xl p-3">
                        <p className="text-[10px] text-slate-400 mb-0.5">OTD Price</p>
                        <p className="font-bold text-slate-900 text-sm">{fmtCents(d.offer.otdPriceCents)}</p>
                      </div>
                      <div className="bg-slate-50 rounded-xl p-3">
                        <p className="text-[10px] text-slate-400 mb-0.5">Dealer</p>
                        <p className="font-semibold text-slate-800 text-xs truncate">{d.offer.dealerName}</p>
                        <p className="text-[10px] text-slate-400">{d.offer.dealerCity}, {d.offer.dealerState}</p>
                      </div>
                    </>
                  )}
                  <div className="bg-slate-50 rounded-xl p-3">
                    <p className="text-[10px] text-slate-400 mb-0.5">Financing</p>
                    <p className="text-xs font-semibold text-slate-800">{d.financingPath ?? "—"}</p>
                    {d.financing && <p className="text-[10px] text-slate-400">{d.financing.lenderName ?? ""}</p>}
                  </div>
                  <div className="bg-slate-50 rounded-xl p-3">
                    <p className="text-[10px] text-slate-400 mb-0.5">Insurance</p>
                    <p className="text-xs font-semibold text-slate-800">{d.insuranceStatus.replace(/_/g, " ")}</p>
                  </div>
                  {d.feePaidAt && (
                    <div className="bg-green-50 rounded-xl p-3">
                      <p className="text-[10px] text-green-600 mb-0.5">Fee Paid</p>
                      <p className="font-semibold text-green-800 text-xs">{fmtCents(d.feeAmountCents)} · {fmtDate(d.feePaidAt)}</p>
                    </div>
                  )}
                  {d.latestContractScan && (
                    <div className={"rounded-xl p-3 " + (d.latestContractScan.status === "PASS" ? "bg-green-50" : d.latestContractScan.status === "FAIL" ? "bg-red-50" : "bg-amber-50")}>
                      <p className="text-[10px] text-slate-500 mb-0.5">Contract Shield</p>
                      <p className="font-semibold text-sm">{d.latestContractScan.score}/100 · {d.latestContractScan.status}</p>
                      {d.latestContractScan.fixListCount > 0 && <p className="text-[10px] text-orange-600">{d.latestContractScan.fixListCount} issues</p>}
                    </div>
                  )}
                  {d.eSignEnvelope && (
                    <div className="bg-slate-50 rounded-xl p-3">
                      <p className="text-[10px] text-slate-400 mb-0.5">E-Sign</p>
                      <p className="text-xs font-semibold text-slate-800">{d.eSignEnvelope.status}</p>
                      {d.eSignEnvelope.completedAt && <p className="text-[10px] text-green-600">{fmtDate(d.eSignEnvelope.completedAt)}</p>}
                    </div>
                  )}
                  {d.pickup && (
                    <div className="bg-slate-50 rounded-xl p-3">
                      <p className="text-[10px] text-slate-400 mb-0.5">Pickup</p>
                      <p className="text-xs font-semibold text-slate-800">{d.pickup.status}</p>
                      {d.pickup.scheduledAt && <p className="text-[10px] text-slate-400">{fmtDate(d.pickup.scheduledAt)}</p>}
                    </div>
                  )}
                </div>
                <div className="px-5 pb-4 flex gap-3">
                  <Link href={"/admin/deals/" + d.id} className="text-xs text-purple-600 hover:underline flex items-center gap-1"><ExternalLink size={11} />Deal Detail</Link>
                  <Link href={"/admin/deals/" + d.id + "/billing"} className="text-xs text-purple-600 hover:underline flex items-center gap-1"><ExternalLink size={11} />Billing</Link>
                  {d.eSignEnvelope && <Link href={"/admin/deals/" + d.id + "/esign"} className="text-xs text-purple-600 hover:underline flex items-center gap-1"><ExternalLink size={11} />E-Sign</Link>}
                  {d.pickup && <Link href={"/admin/deals/" + d.id + "/pickup"} className="text-xs text-purple-600 hover:underline flex items-center gap-1"><ExternalLink size={11} />Pickup</Link>}
                </div>
              </div>
            ))}
            {availability.canMoveWorkflow && activeDeal && (
              <div className="flex gap-2 pt-1">
                <button onClick={() => setModal("moveWorkflow")} className="flex items-center gap-1.5 px-4 py-2.5 bg-purple-100 hover:bg-purple-200 text-purple-700 rounded-xl text-xs font-semibold transition-colors">
                  <ArrowRight size={12} /> Move Workflow Stage
                </button>
                <button onClick={() => setModal("cancelWorkflow")} className="flex items-center gap-1.5 px-4 py-2.5 bg-red-100 hover:bg-red-200 text-red-700 rounded-xl text-xs font-semibold transition-colors">
                  <StopCircle size={12} /> Cancel Deal
                </button>
              </div>
            )}
          </div>
        )}

        {/* ─── Auctions Tab ─────────────────────────────────────────────── */}
        {activeTab === "auctions" && (
          <div className="space-y-3">
            {auctions.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-2xl p-6 text-center">
                <Gavel size={28} className="text-slate-300 mx-auto mb-2" />
                <p className="text-slate-500 font-medium text-sm">No auctions yet</p>
              </div>
            ) : auctions.map((a) => (
              <div key={a.id} className="bg-white border border-slate-200 rounded-2xl p-4 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <Gavel size={15} className="text-slate-400" />
                  <div>
                    <p className="text-sm font-semibold text-slate-900">Auction {a.id.slice(-8)}</p>
                    <p className="text-[11px] text-slate-400">{fmtDate(a.createdAt)} · {a.invitationCount} dealers · {a.offerCount} offers</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge
                    variant={a.status === "ACTIVE" ? "blue" : a.status === "CLOSED" ? "green" : a.status === "CANCELLED" ? "destructive" : "secondary"}
                    className="text-[10px]"
                  >{a.status}</Badge>
                  <Link href={"/admin/auctions/" + a.id} className="text-xs text-purple-600 hover:underline flex items-center gap-1"><ExternalLink size={11} />View</Link>
                </div>
              </div>
            ))}

            {!hasOpenAuction && (
              <LaunchAuctionPanel
                buyerId={buyer.id}
                buyerName={buyerFullName}
                onLaunched={(auctionId) => router.push(`/admin/auctions/${auctionId}`)}
              />
            )}
            {/* Shortlist */}
            <div className="bg-white border border-slate-200 rounded-2xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <Search size={14} className="text-slate-400" />
                <span className="text-sm font-semibold text-slate-700">Vehicle Activity</span>
              </div>
              <div className="flex items-center gap-4 text-sm">
                <div>
                  <p className="text-[10px] text-slate-400">Shortlist</p>
                  <p className="font-bold text-slate-800">{shortlistCount}</p>
                </div>
                <div>
                  <p className="text-[10px] text-slate-400">Requests</p>
                  <p className="font-bold text-slate-800">{vehicleRequests.length}</p>
                </div>
              </div>
              {vehicleRequests.length > 0 && (
                <div className="mt-3 space-y-1.5">
                  {vehicleRequests.slice(0, 3).map((r) => (
                    <div key={r.id} className="flex items-center justify-between bg-slate-50 rounded-lg p-2">
                      <div>
                        <p className="text-xs text-slate-700 font-medium">{r.makePreference} {r.modelPreference}</p>
                        <p className="text-[10px] text-slate-400">{fmtDate(r.createdAt)}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="text-[10px]">{r.status}</Badge>
                        <Link href={"/admin/requests/" + r.id} className="text-[10px] text-purple-600 hover:underline">View</Link>
                      </div>
                    </div>
                  ))}
                  {vehicleRequests.length > 3 && <Link href={"/admin/requests?buyerId=" + buyer.id} className="text-xs text-purple-600 hover:underline">View all {vehicleRequests.length} →</Link>}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ─── Documents Tab ────────────────────────────────────────────── */}
        {activeTab === "documents" && (
          <div className="space-y-4">
            <SectionCard title="Documents" icon={<FileText size={15} />}>
              {documents.length === 0 ? (
                <p className="text-slate-400 text-sm text-center py-4">No documents uploaded</p>
              ) : (
                <div className="space-y-2">
                  {documents.map((d) => (
                    <div key={d.id} className="flex items-center justify-between bg-slate-50 rounded-xl p-3">
                      <div className="flex items-center gap-2">
                        <FileText size={13} className="text-slate-400 flex-shrink-0" />
                        <div>
                          <p className="text-xs font-semibold text-slate-800">{d.name}</p>
                          <p className="text-[10px] text-slate-400">{d.type} · {fmtDate(d.uploadedAt)}</p>
                        </div>
                      </div>
                      <Badge
                        variant={d.isVerified ? "green" : "amber"}
                        className="text-[10px]"
                      >{d.isVerified ? "Verified" : "Pending"}</Badge>
                    </div>
                  ))}
                </div>
              )}
              <div className="pt-3">
                <Link href="/admin/documents" className="text-xs text-purple-600 hover:underline flex items-center gap-1"><ExternalLink size={11} />All Documents</Link>
              </div>
            </SectionCard>

            {/* Insurance */}
            <SectionCard title="Insurance" icon={<Shield size={15} />}>
              {insurancePolicies.length === 0 && insuranceQuotes.length === 0 ? (
                <p className="text-slate-400 text-sm text-center py-4">No insurance on file</p>
              ) : (
                <>
                  {insurancePolicies.map((p) => (
                    <div key={p.id} className="bg-slate-50 rounded-xl p-3 mb-2">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-semibold text-slate-800">{p.providerName ?? "Unknown Provider"}</p>
                        <Badge variant={p.status === "ACTIVE" ? "green" : "secondary"} className="text-[10px]">{p.status}</Badge>
                      </div>
                      {p.policyNumber && <p className="text-[10px] text-slate-400 mt-0.5">Policy #{p.policyNumber}</p>}
                      {p.verifiedAt && <p className="text-[10px] text-green-600 mt-0.5">Verified {fmtDate(p.verifiedAt)}</p>}
                    </div>
                  ))}
                  {activeDeal && (
                    <Link href={"/admin/deals/" + activeDeal.id + "/insurance"} className="text-xs text-purple-600 hover:underline flex items-center gap-1 mt-2"><ExternalLink size={11} />Insurance Detail</Link>
                  )}
                </>
              )}
            </SectionCard>

            {/* Contract */}
            {activeDeal && (
              <SectionCard title="Contract & E-Sign" icon={<Pen size={15} />}>
                {activeDeal.latestContractVersion ? (
                  <div className="space-y-0">
                    <InfoRow label="Version" value={activeDeal.latestContractVersion.version.toString()} />
                    <InfoRow label="Status" value={activeDeal.latestContractVersion.status} />
                    <InfoRow label="Uploaded" value={fmtDate(activeDeal.latestContractVersion.uploadedAt)} />
                    {activeDeal.latestContractScan && (
                      <>
                        <InfoRow label="Shield Score" value={activeDeal.latestContractScan.score + "/100"} />
                        <InfoRow label="Shield Status" value={activeDeal.latestContractScan.status} />
                        {activeDeal.latestContractScan.fixListCount > 0 && (
                          <InfoRow label="Issues" value={<Badge variant="amber" className="text-[10px]">{activeDeal.latestContractScan.fixListCount} items</Badge>} />
                        )}
                      </>
                    )}
                    {activeDeal.eSignEnvelope && (
                      <>
                        <InfoRow label="E-Sign Status" value={activeDeal.eSignEnvelope.status} />
                        {activeDeal.eSignEnvelope.docusignEnvelopeId && (
                          <InfoRow label="Envelope ID" value={<span className="font-mono text-[10px]">{activeDeal.eSignEnvelope.docusignEnvelopeId.slice(0, 12)}…</span>} />
                        )}
                        {activeDeal.eSignEnvelope.completedAt && <InfoRow label="Signed At" value={fmtDate(activeDeal.eSignEnvelope.completedAt)} />}
                      </>
                    )}
                  </div>
                ) : (
                  <p className="text-slate-400 text-sm text-center py-2">No contract uploaded</p>
                )}
                <div className="pt-3 flex gap-3">
                  <Link href="/admin/contracts" className="text-xs text-purple-600 hover:underline flex items-center gap-1"><ExternalLink size={11} />Contracts</Link>
                  <Link href={"/admin/deals/" + activeDeal.id + "/esign"} className="text-xs text-purple-600 hover:underline flex items-center gap-1"><ExternalLink size={11} />E-Sign</Link>
                </div>
              </SectionCard>
            )}

            {/* Pickup */}
            {activeDeal?.pickup && (
              <SectionCard title="Pickup" icon={<Package size={15} />}>
                <div className="space-y-0">
                  <InfoRow label="Status" value={<Badge variant={activeDeal.pickup.status === "COMPLETED" ? "green" : activeDeal.pickup.status === "EXCEPTION" ? "destructive" : "blue"} className="text-[10px]">{activeDeal.pickup.status}</Badge>} />
                  {activeDeal.pickup.scheduledAt && <InfoRow label="Scheduled" value={fmtDateTime(activeDeal.pickup.scheduledAt)} />}
                  {activeDeal.pickup.completedAt && <InfoRow label="Completed" value={fmtDateTime(activeDeal.pickup.completedAt)} />}
                  {activeDeal.pickup.location && <InfoRow label="Location" value={activeDeal.pickup.location} />}
                </div>
                <Link href={"/admin/deals/" + activeDeal.id + "/pickup"} className="text-xs text-purple-600 hover:underline mt-3 flex items-center gap-1"><ExternalLink size={11} />Pickup Detail</Link>
              </SectionCard>
            )}
          </div>
        )}

        {/* ─── Activity Tab ─────────────────────────────────────────────── */}
        {activeTab === "activity" && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <SectionCard title="Audit Trail" icon={<Activity size={15} />}>
              <div className="space-y-3 max-h-[600px] overflow-y-auto pr-1">
                {auditLogs.length === 0 ? (
                  <p className="text-slate-400 text-sm text-center py-4">No admin actions recorded</p>
                ) : auditLogs.map((log) => (
                  <div key={log.id} className="flex gap-2.5">
                    <div className="w-1 rounded-full bg-purple-200 flex-shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-slate-800">{log.action.replace(/_/g, " ")}</p>
                      <p className="text-[10px] text-slate-500">{log.adminEmail} · {timeAgo(log.createdAt)}</p>
                      {log.reason && <p className="text-[10px] text-slate-400 mt-0.5 italic">"{log.reason}"</p>}
                    </div>
                  </div>
                ))}
              </div>
              <div className="pt-3">
                <Link href="/admin/audit-log" className="text-xs text-purple-600 hover:underline flex items-center gap-1"><ExternalLink size={11} />All Audit Logs</Link>
              </div>
            </SectionCard>

            <SectionCard title="Buyer Activity" icon={<Clock size={15} />}>
              <div className="space-y-2 max-h-[600px] overflow-y-auto pr-1">
                {activityEvents.length === 0 ? (
                  <p className="text-slate-400 text-sm text-center py-4">No activity recorded</p>
                ) : activityEvents.map((e) => (
                  <div key={e.id} className="bg-slate-50 rounded-lg p-2">
                    <p className="text-xs font-medium text-slate-800">{e.title}</p>
                    <p className="text-[10px] text-slate-400">{e.eventType} · {timeAgo(e.createdAt)}</p>
                  </div>
                ))}
              </div>
            </SectionCard>
          </div>
        )}

        {/* ─── Notes Tab ────────────────────────────────────────────────── */}
        {activeTab === "notes" && (
          <div>
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-sm font-semibold text-slate-700">Internal Notes</h3>
              <button onClick={() => setModal("addNote")} className="flex items-center gap-1.5 px-4 py-2 bg-al-primary hover:bg-purple-800 text-white rounded-xl text-xs font-semibold transition-colors">
                <MessageSquare size={12} /> Add Note
              </button>
            </div>
            {supportNotes.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center">
                <MessageSquare size={28} className="text-slate-300 mx-auto mb-3" />
                <p className="text-slate-500 font-medium">No internal notes yet</p>
                <button onClick={() => setModal("addNote")} className="mt-3 text-purple-600 text-sm hover:underline">Add first note</button>
              </div>
            ) : (
              <div className="space-y-3">
                {supportNotes.map((n) => (
                  <div key={n.id} className="bg-white border border-slate-200 rounded-2xl p-4">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2">
                        <Badge variant={n.type === "ESCALATION" ? "destructive" : n.type === "REFUND" ? "amber" : "secondary"} className="text-[10px]">{n.type}</Badge>
                        <span className="text-[10px] text-slate-400">{fmtDateTime(n.createdAt)}</span>
                      </div>
                      <span className="text-[10px] text-slate-400 font-mono">{n.adminId.slice(-6)}</span>
                    </div>
                    <p className="text-sm text-slate-700 whitespace-pre-wrap">{n.content}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ─── Overview Additional sections (always visible below grid) ── */}
        {activeTab === "overview" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-0">
            {/* Quick Links */}
            <SectionCard title="Quick Links" icon={<ExternalLink size={15} />}>
              <div className="space-y-1.5">
                {[
                  { label: "All Buyers", href: "/admin/buyers", icon: <Users size={11} /> },
                  { label: "Payments", href: "/admin/payments", icon: <CreditCard size={11} /> },
                  { label: "Deposits", href: "/admin/payments/deposits", icon: <DollarSign size={11} /> },
                  { label: "Refunds", href: "/admin/payments/refunds", icon: <ArrowLeft size={11} /> },
                  { label: "Preapprovals", href: "/admin/external-preapprovals", icon: <Shield size={11} /> },
                  { label: "External Prequals", href: "/admin/external-preapprovals", icon: <BookOpen size={11} /> },
                  { label: "Manual Reviews", href: "/admin/manual-reviews", icon: <Search size={11} /> },
                  { label: "Deals", href: "/admin/deals", icon: <Briefcase size={11} /> },
                  { label: "Auctions", href: "/admin/auctions", icon: <Gavel size={11} /> },
                  { label: "Documents", href: "/admin/documents", icon: <FileText size={11} /> },
                  { label: "Contracts", href: "/admin/contracts", icon: <Pen size={11} /> },
                  { label: "Pickups", href: "/admin/pickups", icon: <Package size={11} /> },
                  { label: "Notifications", href: "/admin/notifications", icon: <Bell size={11} /> },
                  { label: "Support", href: "/admin/support", icon: <MessageSquare size={11} /> },
                  { label: "Requests", href: "/admin/requests", icon: <Car size={11} /> },
                ].map((l) => (
                  <Link key={l.href} href={l.href} className="flex items-center gap-2 text-xs text-slate-600 hover:text-purple-700 hover:bg-purple-50 px-2 py-1.5 rounded-lg transition-colors">
                    <span className="text-slate-400">{l.icon}</span>{l.label}
                  </Link>
                ))}
              </div>
            </SectionCard>
          </div>
        )}

        {/* ─── Admin Danger Zone Tab ─────────────────────────────────────── */}
        {activeTab === "danger" && (
          <div className="space-y-6">
            {/* Suspension */}
            <div className="bg-white border border-amber-200 rounded-2xl shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-amber-100 flex items-center gap-2.5">
                <PauseCircle size={15} className="text-amber-500" />
                <h3 className="font-semibold text-slate-800 text-sm">Account Suspension</h3>
              </div>
              <div className="p-5">
                <p className="text-sm text-slate-600 mb-4">
                  Suspending immediately revokes all active sessions and blocks buyer portal access. The proxy layer redirects suspended buyers to a suspension notice page.
                </p>
                {buyer.isSuspended && (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4 text-xs text-amber-800">
                    <strong>Suspended</strong> since {buyer.suspendedAt ? new Date(buyer.suspendedAt).toLocaleString() : "unknown"}.
                    {buyer.suspendedReason && <> Reason: {buyer.suspendedReason}</>}
                  </div>
                )}
                <div className="flex gap-3">
                  {!buyer.isSuspended ? (
                    <button onClick={() => setModal("suspendAccount")} className="flex items-center gap-2 px-4 py-2.5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-sm font-semibold transition-colors">
                      <PauseCircle size={14} /> Suspend Account
                    </button>
                  ) : (
                    <button onClick={() => setModal("unsuspendAccount")} className="flex items-center gap-2 px-4 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-xl text-sm font-semibold transition-colors">
                      <Unlock size={14} /> Unsuspend Account
                    </button>
                  )}
                  <button onClick={() => setModal("resetPassword")} className="flex items-center gap-2 px-4 py-2.5 bg-slate-600 hover:bg-slate-700 text-white rounded-xl text-sm font-semibold transition-colors">
                    <Lock size={14} /> Send Password Reset
                  </button>
                </div>
              </div>
            </div>

            {/* Plan Management */}
            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2.5">
                <CreditCard size={15} className="text-slate-400" />
                <h3 className="font-semibold text-slate-800 text-sm">Plan Management</h3>
              </div>
              <div className="p-5">
                <p className="text-sm text-slate-600 mb-4">
                  Current plan: <strong>{buyer.plan}</strong>
                  {buyer.planUpgradedAt && <span className="text-slate-400 ml-1">(upgraded {new Date(buyer.planUpgradedAt).toLocaleDateString()})</span>}
                </p>
                <div className="flex gap-3">
                  {buyer.plan === "STANDARD" ? (
                    <button onClick={() => setModal("upgradePlan")} className="flex items-center gap-2 px-4 py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-sm font-semibold transition-colors">
                      <ArrowRight size={14} /> Upgrade to Premium
                    </button>
                  ) : (
                    <button onClick={() => setModal("downgradePlan")} className="flex items-center gap-2 px-4 py-2.5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-sm font-semibold transition-colors">
                      <ArrowLeft size={14} /> Downgrade to Standard
                    </button>
                  )}
                </div>
              </div>
            </div>

            <AdminDangerZone
              buyer={buyer}
              availability={availability}
              onArchive={() => setModal("archiveBuyer")}
              onRestore={() => setModal("restoreBuyer")}
              onDisable={() => setModal("disableAccess")}
              onReactivate={() => setModal("reactivateAccess")}
              onDelete={() => setModal("deleteBuyer")}
              onPrivacyPurge={() => setModal("privacyPurge")}
            />
          </div>
        )}

      </div>
    </div>
  );
}

