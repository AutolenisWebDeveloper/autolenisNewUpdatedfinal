"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import {
  ChevronRight, X, RefreshCw, AlertTriangle, CheckCircle2,
  Mail, Phone, MapPin, Calendar, Package, FileText, Gavel,
  Bell, Shield, ShieldAlert, MessageSquare, Activity,
  Clock, Ban, XCircle, Trophy, Users, Building2,
  Edit2, Flag, CheckCircle,
} from "lucide-react";
import type {
  DealerActionAvailability,
} from "@/lib/services/admin/admin-dealer-command-center.service";
import { api, apiErrorMessage } from "@/lib/api/client";

// Dealer documents live in a private Supabase bucket. Fetch a short-lived
// signed URL from the authorized admin route at click time, then open it — the
// raw storage path is never sent to the browser.
async function openSignedDealerDocument(documentId: string) {
  const win = window.open("", "_blank", "noopener,noreferrer");
  try {
    const res = await fetch(`/api/admin/dealers/documents/${documentId}/signed-url`);
    const json = (await res.json()) as { data?: { signedUrl?: string }; error?: { message?: string } };
    const signedUrl = json?.data?.signedUrl;
    if (!res.ok || !signedUrl) {
      if (win) win.close();
      alert(json?.error?.message ?? "Unable to open document. Please try again.");
      return;
    }
    if (win) win.location.href = signedUrl;
    else window.location.href = signedUrl;
  } catch {
    if (win) win.close();
    alert("Unable to open document. Please try again.");
  }
}

// ─── Contract Scan Fix Item type ─────────────────────────────────────────────
// ContractScan.fixList is a JSON array of rule violations from Contract Shield.
// Each item may contain a description, rule name, severity, and other fields.
type ContractScanFixItem = {
  description?: string;
  rule?: string;
  severity?: string;
  [key: string]: unknown;
};

// ─── Local Types ──────────────────────────────────────────────────────────────

type DealerDetail = {
  dealer: {
    id: string;
    dealershipName: string;
    email: string;
    supabaseId: string;
    phone: string | null;
    address: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
    status: string;
    tier: string;
    scorecardTier: string | null;
    onboardingStep: string;
    licenseNumber: string | null;
    agreedToTermsAt: string | null;
    currentAuctionLoad: number;
    createdAt: string;
    updatedAt: string;
  };
  inventory: Array<{
    id: string;
    year: number;
    make: string;
    model: string;
    trim: string | null;
    priceCents: number;
    condition: string | null;
    isActive: boolean;
    createdAt: string;
  }>;
  offers: Array<{
    id: string;
    status: string;
    otdPriceCents: number;
    vehiclePriceCents: number;
    submittedAt: string | null;
    createdAt: string;
    dealStatus: string | null;
    dealId: string | null;
    auctionId: string | null;
    auctionStatus: string | null;
  }>;
  invitations: Array<{
    id: string;
    auctionId: string;
    sentAt: string;
    viewedAt: string | null;
    respondedAt: string | null;
    auction: {
      id: string;
      status: string;
      startedAt: string | null;
      endsAt: string | null;
    } | null;
  }>;
  deals: Array<{
    id: string;
    status: string;
    offerId: string | null;
    offerStatus: string | null;
    otdPriceCents: number | null;
    createdAt: string;
    latestContractScan: {
      id: string;
      score: number;
      status: string;
      /** Array of Contract Shield rule violations — see ContractScanFixItem */
      fixList: ContractScanFixItem[];
      scannedAt: string;
    } | null;
  }>;
  scorecardSnapshots: Array<{
    tier: string;
    offerWinRate: number;
    dealCompletionRate: number;
    auctionResponseRate: number;
    avgResponseHours: number;
    junkFeeRatio: number;
    snapshotDate: string;
  }>;
  notifications: Array<{
    id: string;
    type: string;
    title: string;
    body: string;
    readAt: string | null;
    createdAt: string;
  }>;
  feedConfig: {
    id: string;
    isActive: boolean;
    feedUrl: string;
    format: string;
    lastSyncAt: string | null;
    createdAt: string;
  } | null;
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
    name: string;
    mimeType: string | null;
    sizeBytes: number | null;
    isVerified: boolean;
    verifiedAt: string | null;
    uploadedAt: string;
  }>;
  dealerPayments: Array<{
    id: string;
    dealId: string | null;
    amountCents: number;
    type: string;
    status: string;
    processedAt: string | null;
    createdAt: string;
  }>;
  dealerApplication: {
    id: string;
    dealershipName: string;
    dealershipType: string;
    state: string;
    city: string;
    zip: string;
    licenseNumber: string;
    contactName: string;
    contactEmail: string;
    contactPhone: string | null;
    annualVolume: string | null;
    notes: string | null;
    status: string;
    reviewedBy: string | null;
    reviewedAt: string | null;
    rejectReason: string | null;
    createdAt: string;
  } | null;
  dealerLicenses: Array<{
    id: string;
    licenseNum: string;
    state: string;
    expiresAt: string | null;
    documentUrl: string | null;
    isActive: boolean;
    createdAt: string;
  }>;
};

interface Props {
  data: DealerDetail;
  availability: DealerActionAvailability;
  initialTab?: string;
}

type ModalType =
  | "approve" | "suspend" | "reactivate" | "terminate"
  | "note" | "profile-edit" | "compliance-flag" | "compliance-resolve"
  | "tier-override";

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
      <span className="text-xs text-slate-500 min-w-[140px] flex-shrink-0">{label}</span>
      <span className="text-xs text-slate-800 text-right font-medium">{value}</span>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    PENDING: "amber",
    ACTIVE: "green",
    SUSPENDED: "destructive",
    TERMINATED: "secondary",
  };
  const variant = (map[status] ?? "secondary") as "amber" | "green" | "destructive" | "secondary";
  const labels: Record<string, string> = { PENDING: "Pending", ACTIVE: "Active", SUSPENDED: "Suspended", TERMINATED: "Terminated" };
  return <Badge variant={variant} className="text-xs font-semibold">{labels[status] ?? status}</Badge>;
}

function TierBadge({ tier }: { tier: string }) {
  const map: Record<string, "secondary" | "amber" | "default"> = {
    STANDARD: "secondary", SILVER: "secondary", GOLD: "amber", PLATINUM: "default",
  };
  return <Badge variant={map[tier] ?? "secondary"} className="text-xs">{tier}</Badge>;
}

// ─── Modals ───────────────────────────────────────────────────────────────────

function TierOverrideModal({ dealerName, currentTier, dealerId, onClose, onSuccess }: {
  dealerName: string; currentTier: string; dealerId: string; onClose: () => void; onSuccess: () => void;
}) {
  const [tier, setTier] = useState(currentTier);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!reason.trim()) { setError("Reason is required"); return; }
    if (reason.trim().length < 10) { setError("Reason must be at least 10 characters"); return; }
    setLoading(true); setError(null);
    try {
      await api.post(`/api/admin/dealers/${dealerId}/tier`, { tier, reason });
      onSuccess();
    } catch (err) {
      setError(apiErrorMessage(err, "Tier update failed"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 p-6 w-full max-w-md">
        <div className="flex items-start justify-between mb-4">
          <h3 className="font-bold text-lg text-slate-900">Override Dealer Tier — {dealerName}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 ml-2"><X size={18} /></button>
        </div>
        {error && <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2.5 text-red-700 text-sm mb-3">{error}</div>}
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">New Tier</label>
            <select value={tier} onChange={e => setTier(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-slate-700 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500">
              <option value="STANDARD">STANDARD</option>
              <option value="GOLD">GOLD</option>
              <option value="PLATINUM">PLATINUM</option>
              <option value="PROBATION">PROBATION</option>
            </select>
          </div>
          <textarea
            value={reason} onChange={e => setReason(e.target.value)}
            rows={3} placeholder="Reason for tier change (min 10 chars, required)"
            className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-slate-800 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-purple-500"
          />
          <div className="flex gap-3">
            <button type="button" onClick={onClose} className="flex-1 border border-slate-200 text-slate-600 rounded-xl py-2.5 text-sm hover:bg-slate-50">Cancel</button>
            <button type="submit" disabled={loading || reason.trim().length < 10} className="flex-1 bg-al-primary hover:bg-purple-800 text-white rounded-xl py-2.5 text-sm font-semibold disabled:opacity-50">
              {loading ? "Updating..." : "Update Tier"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

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
    catch (err) { setError(apiErrorMessage(err, "Action failed")); }
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
            <button type="submit" disabled={loading} className={"flex-1 rounded-xl py-2.5 text-sm font-semibold text-white disabled:opacity-50 transition-colors " + (destructive ? "bg-red-600 hover:bg-red-700" : "bg-al-primary hover:bg-purple-800")}>
              {loading ? "Processing..." : submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function AddNoteModal({ dealerId, onClose, onSuccess }: {
  dealerId: string; onClose: () => void; onSuccess: () => void;
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
      await api.post("/api/admin/dealers/" + dealerId + "/note", { content: content.trim(), type });
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
            <button type="submit" disabled={loading} className="flex-1 bg-al-primary hover:bg-purple-800 text-white rounded-lg py-2.5 text-sm font-semibold disabled:opacity-50">
              {loading ? "Saving..." : "Add Note"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function EditProfileModal({ dealer, onClose, onSuccess }: {
  dealer: DealerDetail["dealer"]; onClose: () => void; onSuccess: () => void;
}) {
  const [form, setForm] = useState({
    dealershipName: dealer.dealershipName,
    phone: dealer.phone ?? "",
    address: dealer.address ?? "",
    city: dealer.city ?? "",
    state: dealer.state ?? "",
    zip: dealer.zip ?? "",
    licenseNumber: dealer.licenseNumber ?? "",
    reason: "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.reason.trim()) { setError("Reason is required"); return; }
    setLoading(true); setError(null);
    try {
      await api.patch("/api/admin/dealers/" + dealer.id, form);
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
          <h3 className="text-slate-900 font-bold text-lg">Edit Dealer Profile</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>
        {error && <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2.5 text-red-700 text-sm mb-4">{error}</div>}
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="text-xs font-medium text-slate-600 mb-1 block">Dealership Name</label>
            <input value={form.dealershipName} onChange={e => setForm(f => ({...f, dealershipName: e.target.value}))} required className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-slate-600 mb-1 block">Phone</label>
              <input value={form.phone} onChange={e => setForm(f => ({...f, phone: e.target.value}))} className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 mb-1 block">License Number</label>
              <input value={form.licenseNumber} onChange={e => setForm(f => ({...f, licenseNumber: e.target.value}))} className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600 mb-1 block">Address</label>
            <input value={form.address} onChange={e => setForm(f => ({...f, address: e.target.value}))} className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
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
            <textarea value={form.reason} onChange={e => setForm(f => ({...f, reason: e.target.value}))} rows={2} required placeholder="Reason for this profile update" className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-slate-900 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-purple-500" />
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

// ─── Main Component ───────────────────────────────────────────────────────────

export default function AdminDealerCommandCenter({ data, availability, initialTab }: Props) {
  const { dealer, inventory, offers, invitations, deals, scorecardSnapshots, auditLogs, supportNotes, complianceStatus, notifications, feedConfig, documents, dealerPayments, dealerApplication, dealerLicenses } = data;

  const [modal, setModal] = useState<ModalType | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);
  const [activeTab, setActiveTab] = useState(initialTab ?? "overview");
  const [refreshing, setRefreshing] = useState(false);

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
    await api.post("/api/admin/dealers/" + dealer.id + "/" + endpoint, body);
    handleSuccess(successMsg);
  }

  const tabs = [
    { id: "overview", label: "Overview" },
    { id: "profile", label: "Profile" },
    { id: "onboarding", label: "Onboarding" },
    { id: "inventory", label: "Inventory" },
    { id: "auctions", label: "Auctions" },
    { id: "offers", label: "Offers" },
    { id: "deals", label: "Deals" },
    { id: "contracts", label: "Contracts" },
    { id: "documents", label: "Documents" },
    { id: "payments", label: "Payments" },
    { id: "notifications", label: "Notifications" },
    { id: "compliance", label: "Compliance" },
    { id: "notes", label: "Notes" },
    { id: "audit-log", label: "Audit Log" },
    { id: "admin-actions", label: "⚙ Admin Actions" },
  ];

  const latestScorecard = scorecardSnapshots[0] ?? null;

  return (
    <div className="min-h-screen bg-slate-50" data-testid="admin-dealer-command-center">
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
          title="Approve Dealer" description={"Approve " + dealer.dealershipName + " as an active dealer?"}
          submitLabel="Approve Dealer" requireReason={false}
          onCancel={() => setModal(null)}
          onConfirm={async (reason) => { await doAction("approve", { reason: reason || "Approved from admin command center" }, "Dealer approved"); }}
        />
      )}
      {modal === "suspend" && (
        <ConfirmModal
          title="Suspend Dealer" description={"Suspend " + dealer.dealershipName + "? They will lose access to auctions and offers."} destructive
          submitLabel="Suspend Dealer" requireReason={true}
          onCancel={() => setModal(null)}
          onConfirm={async (reason) => { await doAction("suspend", { reason }, "Dealer suspended"); }}
        />
      )}
      {modal === "reactivate" && (
        <ConfirmModal
          title="Reactivate Dealer" description={"Reactivate " + dealer.dealershipName + " from suspended status?"}
          submitLabel="Reactivate" requireReason={true}
          onCancel={() => setModal(null)}
          onConfirm={async (reason) => { await doAction("reactivate", { reason }, "Dealer reactivated"); }}
        />
      )}
      {modal === "terminate" && (
        <ConfirmModal
          title="Terminate Dealer" description={"Permanently terminate " + dealer.dealershipName + "? This is a serious action."} destructive
          submitLabel="Terminate Dealer" requireReason={true}
          onCancel={() => setModal(null)}
          onConfirm={async (reason) => { await doAction("terminate", { reason }, "Dealer terminated"); }}
        />
      )}
      {modal === "note" && (
        <AddNoteModal dealerId={dealer.id} onClose={() => setModal(null)} onSuccess={() => handleSuccess("Note added")} />
      )}
      {modal === "profile-edit" && (
        <EditProfileModal dealer={dealer} onClose={() => setModal(null)} onSuccess={() => handleSuccess("Profile updated")} />
      )}
      {modal === "compliance-flag" && (
        <ConfirmModal
          title="Flag Compliance Issue" description={"Flag a compliance issue for " + dealer.dealershipName + ". This will be logged to the audit trail."} destructive
          submitLabel="Flag Issue" requireReason={true}
          onCancel={() => setModal(null)}
          onConfirm={async (reason) => { await doAction("compliance/flag", { reason }, "Compliance issue flagged"); }}
        />
      )}
      {modal === "compliance-resolve" && (
        <ConfirmModal
          title="Resolve Compliance Issue" description={"Mark the compliance issue for " + dealer.dealershipName + " as resolved."}
          submitLabel="Resolve Issue" requireReason={true}
          onCancel={() => setModal(null)}
          onConfirm={async (reason) => { await doAction("compliance/resolve", { reason }, "Compliance issue resolved"); }}
        />
      )}
      {modal === "tier-override" && (
        <TierOverrideModal
          dealerName={dealer.dealershipName}
          currentTier={dealer.tier}
          dealerId={dealer.id}
          onClose={() => setModal(null)}
          onSuccess={() => handleSuccess("Dealer tier updated")}
        />
      )}

      {/* ─── Hero Header ─────────────────────────────────────────────────────── */}
      <div className="bg-white border-b border-slate-200 px-4 sm:px-6 lg:px-8 py-5">
        <div className="flex items-center gap-1.5 text-xs text-slate-400 mb-4">
          <Link href="/admin/dashboard" className="hover:text-purple-600 transition-colors">Admin</Link>
          <ChevronRight size={12} />
          <Link href="/admin/dealers" className="hover:text-purple-600 transition-colors">Dealers</Link>
          <ChevronRight size={12} />
          <span className="text-slate-600 font-medium">{dealer.dealershipName}</span>
        </div>

        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-2xl bg-al-primary flex items-center justify-center flex-shrink-0 shadow-md">
              <span className="text-white text-lg font-bold">{dealer.dealershipName[0]?.toUpperCase() ?? "D"}</span>
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl font-bold text-slate-900">{dealer.dealershipName}</h1>
                <StatusBadge status={dealer.status} />
                <TierBadge tier={dealer.tier} />
                {complianceStatus.hasFlag && (
                  <Badge variant="destructive" className="text-[10px] flex items-center gap-1">
                    <ShieldAlert size={10} /> Compliance Flag
                  </Badge>
                )}
              </div>
              <div className="flex flex-wrap gap-3 mt-1.5 text-xs text-slate-500">
                <span className="flex items-center gap-1"><Mail size={11} />{dealer.email}</span>
                {dealer.phone && <span className="flex items-center gap-1"><Phone size={11} />{dealer.phone}</span>}
                {(dealer.city || dealer.state) && (
                  <span className="flex items-center gap-1">
                    <MapPin size={11} />
                    {[dealer.city, dealer.state].filter(Boolean).join(", ")}
                  </span>
                )}
                <span className="flex items-center gap-1"><Calendar size={11} />Joined {fmtDate(dealer.createdAt)}</span>
                <span className="flex items-center gap-1"><Building2 size={11} />Step {dealer.onboardingStep}</span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {availability.canApprove && (
              <button onClick={() => setModal("approve")} className="flex items-center gap-1.5 px-3.5 py-2 bg-green-600 hover:bg-green-700 text-white rounded-xl text-xs font-semibold transition-colors shadow-sm">
                <CheckCircle size={13} /> Approve
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
              className={"px-4 py-3.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap " + (activeTab === tab.id ? "border-al-primary text-al-primary" : "border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300")}
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
            {/* Stats row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                { label: "Inventory", value: inventory.length, icon: <Package size={16} className="text-cyan-600" />, color: "bg-cyan-50" },
                { label: "Total Offers", value: offers.length, icon: <FileText size={16} className="text-indigo-600" />, color: "bg-indigo-50" },
                { label: "Active Auctions", value: invitations.filter(i => i.auction?.status === "ACTIVE").length, icon: <Gavel size={16} className="text-blue-600" />, color: "bg-blue-50" },
                { label: "Total Deals", value: deals.length, icon: <Trophy size={16} className="text-emerald-600" />, color: "bg-emerald-50" },
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
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                { label: "Documents", value: documents.length, icon: <FileText size={16} className="text-slate-500" />, color: "bg-slate-100" },
                { label: "Payments", value: dealerPayments.length, icon: <Clock size={16} className="text-purple-600" />, color: "bg-purple-50" },
                { label: "Invitations", value: invitations.length, icon: <Bell size={16} className="text-orange-600" />, color: "bg-orange-50" },
                { label: "Unread Notifs", value: notifications.filter(n => !n.readAt).length, icon: <Bell size={16} className="text-red-600" />, color: "bg-red-50" },
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
              {/* Scorecard Snapshot */}
              {latestScorecard && (
                <SectionCard title="Scorecard Snapshot" icon={<Trophy size={14} />}>
                  <InfoRow label="Tier" value={<TierBadge tier={latestScorecard.tier} />} />
                  <InfoRow label="Win Rate" value={(latestScorecard.offerWinRate * 100).toFixed(1) + "%"} />
                  <InfoRow label="Completion Rate" value={(latestScorecard.dealCompletionRate * 100).toFixed(1) + "%"} />
                  <InfoRow label="Response Rate" value={(latestScorecard.auctionResponseRate * 100).toFixed(1) + "%"} />
                  <InfoRow label="Avg Response" value={latestScorecard.avgResponseHours.toFixed(1) + " hrs"} />
                  <InfoRow label="Snapshot Date" value={fmtDate(latestScorecard.snapshotDate)} />
                </SectionCard>
              )}

              {/* Quick Actions */}
              <SectionCard title="Quick Actions" icon={<Activity size={14} />}>
                <div className="space-y-2">
                  {availability.canApprove && (
                    <button onClick={() => setModal("approve")} className="w-full flex items-center gap-2.5 px-4 py-3 bg-green-50 hover:bg-green-100 text-green-800 rounded-xl text-sm font-medium transition-colors text-left">
                      <CheckCircle size={15} /> Approve Dealer Application
                    </button>
                  )}
                  {availability.canSuspend && (
                    <button onClick={() => setModal("suspend")} className="w-full flex items-center gap-2.5 px-4 py-3 bg-amber-50 hover:bg-amber-100 text-amber-800 rounded-xl text-sm font-medium transition-colors text-left">
                      <Ban size={15} /> Suspend Dealer
                    </button>
                  )}
                  {availability.canReactivate && (
                    <button onClick={() => setModal("reactivate")} className="w-full flex items-center gap-2.5 px-4 py-3 bg-blue-50 hover:bg-blue-100 text-blue-800 rounded-xl text-sm font-medium transition-colors text-left">
                      <CheckCircle2 size={15} /> Reactivate Dealer
                    </button>
                  )}
                  {availability.canTerminate && (
                    <button onClick={() => setModal("terminate")} className="w-full flex items-center gap-2.5 px-4 py-3 bg-red-50 hover:bg-red-100 text-red-800 rounded-xl text-sm font-medium transition-colors text-left">
                      <XCircle size={15} /> Terminate Dealer
                    </button>
                  )}
                  {!availability.canApprove && !availability.canSuspend && !availability.canReactivate && !availability.canTerminate && (
                    <p className="text-sm text-slate-400 text-center py-2">No lifecycle actions available for {dealer.status} status</p>
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

            {/* DMS Feed Status */}
            {feedConfig && (
              <SectionCard title="DMS Feed" icon={<RefreshCw size={14} />}>
                <InfoRow label="Status" value={<Badge variant={feedConfig.isActive ? "green" : "secondary"} className="text-[10px]">{feedConfig.isActive ? "Active" : "Inactive"}</Badge>} />
                <InfoRow label="Feed URL" value={<span className="text-xs font-mono truncate max-w-xs block">{feedConfig.feedUrl}</span>} />
                <InfoRow label="Format" value={feedConfig.format} />
                <InfoRow label="Last Sync" value={fmtDateTime(feedConfig.lastSyncAt)} />
              </SectionCard>
            )}
          </div>
        )}

        {/* ── Profile Tab ── */}
        {activeTab === "profile" && (
          <div className="max-w-2xl">
            <SectionCard title="Dealer Profile" icon={<Building2 size={14} />}>
              <InfoRow label="Dealership Name" value={dealer.dealershipName} />
              <InfoRow label="Email" value={dealer.email} />
              <InfoRow label="Phone" value={dealer.phone ?? "—"} />
              <InfoRow label="Address" value={dealer.address ?? "—"} />
              <InfoRow label="City" value={dealer.city ?? "—"} />
              <InfoRow label="State" value={dealer.state ?? "—"} />
              <InfoRow label="ZIP" value={dealer.zip ?? "—"} />
              <InfoRow label="Status" value={<StatusBadge status={dealer.status} />} />
              <InfoRow label="Tier" value={<TierBadge tier={dealer.tier} />} />
              <InfoRow label="License Number" value={dealer.licenseNumber ?? "—"} />
              <InfoRow label="Onboarding Step" value={"Step " + dealer.onboardingStep} />
              <InfoRow label="Agreed to Terms" value={fmtDateTime(dealer.agreedToTermsAt)} />
              <InfoRow label="Auction Load" value={String(dealer.currentAuctionLoad)} />
              <InfoRow label="Created" value={fmtDateTime(dealer.createdAt)} />
              <InfoRow label="Updated" value={fmtDateTime(dealer.updatedAt)} />
              <InfoRow label="Supabase ID" value={<code className="text-[10px] bg-slate-100 px-1.5 py-0.5 rounded">{dealer.supabaseId}</code>} />
              <div className="pt-4">
                <button onClick={() => setModal("profile-edit")} className="flex items-center gap-2 px-4 py-2.5 bg-al-primary hover:bg-purple-800 text-white rounded-xl text-sm font-semibold transition-colors">
                  <Edit2 size={13} /> Edit Profile
                </button>
              </div>
            </SectionCard>
          </div>
        )}

        {/* ── Onboarding Tab ── */}
        {activeTab === "onboarding" && (
          <div className="max-w-2xl">
            <SectionCard title="Onboarding Status" icon={<Users size={14} />}>
              {(() => {
                const STEPS = ["BUSINESS_INFO", "LICENSE", "TERMS", "REVIEW", "APPROVED"];
                const stepIdx = STEPS.indexOf(dealer.onboardingStep);
                const pct = stepIdx >= 0 ? Math.round(((stepIdx + 1) / STEPS.length) * 100) : 20;
                const STEP_LABELS: Record<string, string> = {
                  BUSINESS_INFO: "Business Info",
                  LICENSE: "License Upload",
                  TERMS: "Terms Agreed",
                  REVIEW: "Admin Review",
                  APPROVED: "Approved",
                };
                return (
                  <>
                    <div className="mb-5">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-medium text-slate-600">{STEP_LABELS[dealer.onboardingStep] ?? dealer.onboardingStep}</span>
                        <span className="text-xs text-slate-400">{pct}%</span>
                      </div>
                      <div className="w-full bg-slate-100 rounded-full h-2">
                        <div className="bg-al-primary h-2 rounded-full transition-all" style={{ width: pct + "%" }} />
                      </div>
                    </div>
                    <div className="space-y-2">
                      {STEPS.map((s, i) => {
                        const done = stepIdx >= i;
                        return (
                          <div key={s} className={"flex items-center gap-3 p-3 rounded-xl border " + (done ? "bg-green-50 border-green-200" : "bg-slate-50 border-slate-100")}>
                            <div className={"w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 " + (done ? "bg-green-500" : "bg-slate-200")}>
                              {done ? <CheckCircle2 size={13} className="text-white" /> : <span className="text-[10px] font-bold text-slate-500">{i + 1}</span>}
                            </div>
                            <span className={"text-sm font-medium " + (done ? "text-green-800" : "text-slate-500")}>{STEP_LABELS[s] ?? s}</span>
                          </div>
                        );
                      })}
                    </div>
                  </>
                );
              })()}
              <div className="mt-5 pt-4 border-t border-slate-100 space-y-1">
                <InfoRow label="License Number" value={dealer.licenseNumber ?? "Not provided"} />
                <InfoRow label="Agreed to Terms" value={fmtDateTime(dealer.agreedToTermsAt)} />
              </div>
            </SectionCard>

            {/* Dealer Application */}
            {dealerApplication && (
              <SectionCard title="Application Record" icon={<FileText size={14} />}>
                <InfoRow label="Application Status" value={<Badge variant={dealerApplication.status === "APPROVED" ? "green" : dealerApplication.status === "REJECTED" ? "destructive" : "amber"} className="text-[10px]">{dealerApplication.status}</Badge>} />
                <InfoRow label="Contact Name" value={dealerApplication.contactName} />
                <InfoRow label="Contact Email" value={dealerApplication.contactEmail} />
                <InfoRow label="Contact Phone" value={dealerApplication.contactPhone ?? "—"} />
                <InfoRow label="Dealership Type" value={dealerApplication.dealershipType} />
                <InfoRow label="Annual Volume" value={dealerApplication.annualVolume ?? "—"} />
                <InfoRow label="License Number" value={dealerApplication.licenseNumber} />
                <InfoRow label="State / City" value={dealerApplication.city + ", " + dealerApplication.state} />
                {dealerApplication.reviewedBy && (
                  <InfoRow label="Reviewed By" value={dealerApplication.reviewedBy} />
                )}
                {dealerApplication.reviewedAt && (
                  <InfoRow label="Reviewed At" value={fmtDateTime(dealerApplication.reviewedAt)} />
                )}
                {dealerApplication.rejectReason && (
                  <InfoRow label="Reject Reason" value={<span className="text-red-600">{dealerApplication.rejectReason}</span>} />
                )}
                <InfoRow label="Applied" value={fmtDate(dealerApplication.createdAt)} />
              </SectionCard>
            )}

            {/* Dealer Licenses */}
            {dealerLicenses.length > 0 && (
              <SectionCard title={"Licenses (" + dealerLicenses.length + ")"} icon={<Shield size={14} />}>
                {dealerLicenses.map((lic) => (
                  <div key={lic.id} className={"p-3 rounded-xl border mb-2 last:mb-0 " + (lic.isActive ? "bg-green-50 border-green-200" : "bg-slate-50 border-slate-100")}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-semibold text-slate-800">{lic.licenseNum} · {lic.state}</span>
                      <Badge variant={lic.isActive ? "green" : "secondary"} className="text-[10px]">{lic.isActive ? "Active" : "Inactive"}</Badge>
                    </div>
                    <p className="text-xs text-slate-500">Expires: {fmtDate(lic.expiresAt)} · Added: {fmtDate(lic.createdAt)}</p>
                    {lic.documentUrl && (
                      <a href={lic.documentUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-purple-600 hover:underline mt-1 inline-block">View Document</a>
                    )}
                  </div>
                ))}
              </SectionCard>
            )}
          </div>
        )}

        {/* ── Inventory Tab ── */}
        {activeTab === "inventory" && (
          <div>
            <h2 className="text-sm font-semibold text-slate-700 mb-3">Inventory ({inventory.length} items)</h2>
            {inventory.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-2xl py-16 text-center">
                <Package size={36} className="text-slate-300 mx-auto mb-3" />
                <p className="text-slate-500 font-medium">No inventory items</p>
              </div>
            ) : (
              <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                <div className="hidden lg:grid grid-cols-[1fr_1fr_1fr_0.8fr_0.8fr_0.7fr_0.8fr_0.8fr] gap-2 px-5 py-3 border-b border-slate-100 bg-slate-50/50">
                  {["Year", "Make", "Model", "Trim", "Price", "Condition", "Active", "Added"].map(h => (
                    <span key={h} className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">{h}</span>
                  ))}
                </div>
                {inventory.map((item) => (
                  <div key={item.id} className="grid lg:grid-cols-[1fr_1fr_1fr_0.8fr_0.8fr_0.7fr_0.8fr_0.8fr] gap-2 px-5 py-3.5 border-b border-slate-50 hover:bg-slate-50/70 transition-colors">
                    <span className="text-sm text-slate-800 font-medium">{item.year}</span>
                    <span className="text-sm text-slate-700">{item.make}</span>
                    <span className="text-sm text-slate-700">{item.model}</span>
                    <span className="text-sm text-slate-500">{item.trim ?? "—"}</span>
                    <span className="text-sm font-semibold text-slate-800">{fmtCents(item.priceCents)}</span>
                    <span className="text-xs text-slate-500">{item.condition ?? "—"}</span>
                    <span>{item.isActive ? <Badge variant="green" className="text-[10px]">Active</Badge> : <Badge variant="secondary" className="text-[10px]">Inactive</Badge>}</span>
                    <span className="text-xs text-slate-400">{fmtDate(item.createdAt)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Auctions Tab ── */}
        {activeTab === "auctions" && (
          <div>
            <h2 className="text-sm font-semibold text-slate-700 mb-3">Auction Invitations ({invitations.length})</h2>
            {invitations.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-2xl py-16 text-center">
                <Gavel size={36} className="text-slate-300 mx-auto mb-3" />
                <p className="text-slate-500 font-medium">No auction invitations</p>
              </div>
            ) : (
              <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                <div className="hidden lg:grid grid-cols-[1.5fr_1fr_1fr_1fr_1fr] gap-2 px-5 py-3 border-b border-slate-100 bg-slate-50/50">
                  {["Auction ID", "Auction Status", "Sent At", "Viewed At", "Responded At"].map(h => (
                    <span key={h} className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">{h}</span>
                  ))}
                </div>
                {invitations.map((inv) => (
                  <div key={inv.id} className="grid lg:grid-cols-[1.5fr_1fr_1fr_1fr_1fr] gap-2 px-5 py-3.5 border-b border-slate-50 hover:bg-slate-50/70 transition-colors">
                    <span className="text-xs font-mono text-slate-600">{inv.auctionId.slice(-12)}</span>
                    <span>{inv.auction ? <Badge variant={inv.auction.status === "ACTIVE" ? "green" : "secondary"} className="text-[10px]">{inv.auction.status}</Badge> : <span className="text-slate-400 text-xs">—</span>}</span>
                    <span className="text-xs text-slate-600">{fmtDate(inv.sentAt)}</span>
                    <span className="text-xs text-slate-500">{fmtDate(inv.viewedAt)}</span>
                    <span className="text-xs text-slate-500">{fmtDate(inv.respondedAt)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Offers Tab ── */}
        {activeTab === "offers" && (
          <div>
            <h2 className="text-sm font-semibold text-slate-700 mb-3">Offers ({offers.length})</h2>
            {offers.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-2xl py-16 text-center">
                <FileText size={36} className="text-slate-300 mx-auto mb-3" />
                <p className="text-slate-500 font-medium">No offers submitted</p>
              </div>
            ) : (
              <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                <div className="hidden lg:grid grid-cols-[1.5fr_1fr_1fr_1fr_1fr_1fr] gap-2 px-5 py-3 border-b border-slate-100 bg-slate-50/50">
                  {["Auction ID", "Status", "OTD Price", "Vehicle Price", "Submitted At", "Deal Status"].map(h => (
                    <span key={h} className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">{h}</span>
                  ))}
                </div>
                {offers.map((offer) => (
                  <div key={offer.id} className="grid lg:grid-cols-[1.5fr_1fr_1fr_1fr_1fr_1fr] gap-2 px-5 py-3.5 border-b border-slate-50 hover:bg-slate-50/70 transition-colors">
                    <span className="text-xs font-mono text-slate-600">{offer.auctionId?.slice(-12) ?? "—"}</span>
                    <Badge variant={offer.status === "SUBMITTED" ? "green" : offer.status === "WON" ? "default" : "secondary"} className="text-[10px] w-fit">{offer.status}</Badge>
                    <span className="text-sm font-semibold text-slate-800">{fmtCents(offer.otdPriceCents)}</span>
                    <span className="text-sm text-slate-700">{fmtCents(offer.vehiclePriceCents)}</span>
                    <span className="text-xs text-slate-500">{fmtDate(offer.submittedAt)}</span>
                    <span className="text-xs text-slate-500">{offer.dealStatus ?? "—"}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Deals Tab ── */}
        {activeTab === "deals" && (
          <div>
            <h2 className="text-sm font-semibold text-slate-700 mb-3">Deals ({deals.length})</h2>
            {deals.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-2xl py-16 text-center">
                <Trophy size={36} className="text-slate-300 mx-auto mb-3" />
                <p className="text-slate-500 font-medium">No deals found</p>
              </div>
            ) : (
              <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                <div className="hidden lg:grid grid-cols-[1.5fr_1fr_1fr_1fr_1fr] gap-2 px-5 py-3 border-b border-slate-100 bg-slate-50/50">
                  {["Deal ID", "Status", "Offer Status", "OTD Price", "Created"].map(h => (
                    <span key={h} className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">{h}</span>
                  ))}
                </div>
                {deals.map((deal) => (
                  <div key={deal.id} className="grid lg:grid-cols-[1.5fr_1fr_1fr_1fr_1fr] gap-2 px-5 py-3.5 border-b border-slate-50 hover:bg-slate-50/70 transition-colors">
                    <span className="text-xs font-mono text-slate-600">{deal.id.slice(-12)}</span>
                    <Badge variant={deal.status === "COMPLETED" ? "green" : deal.status === "CANCELLED" ? "destructive" : "blue"} className="text-[10px] w-fit">{deal.status}</Badge>
                    <span className="text-xs text-slate-500">{deal.offerStatus ?? "—"}</span>
                    <span className="text-sm font-semibold text-slate-800">{fmtCents(deal.otdPriceCents)}</span>
                    <span className="text-xs text-slate-400">{fmtDate(deal.createdAt)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Contracts Tab ── */}
        {activeTab === "contracts" && (
          <div>
            <h2 className="text-sm font-semibold text-slate-700 mb-3">Contract Shield — Deals ({deals.length})</h2>
            {deals.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-2xl py-16 text-center">
                <Shield size={36} className="text-slate-300 mx-auto mb-3" />
                <p className="text-slate-500 font-medium">No deals with contract scans</p>
                <p className="text-xs text-slate-400 mt-1">Contract scan data is available once deals have been created.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {deals.map((deal) => (
                  <div key={deal.id} className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <code className="text-xs font-mono text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">···{deal.id.slice(-12)}</code>
                        <Badge variant={deal.status === "COMPLETED" ? "green" : deal.status === "CANCELLED" ? "destructive" : "blue"} className="text-[10px]">{deal.status}</Badge>
                        <span className="text-xs text-slate-500">{fmtCents(deal.otdPriceCents)}</span>
                      </div>
                      <span className="text-xs text-slate-400">{fmtDate(deal.createdAt)}</span>
                    </div>
                    {deal.latestContractScan ? (
                      <div className={"rounded-xl p-3 border " + (deal.latestContractScan.status === "PASS" ? "bg-green-50 border-green-200" : deal.latestContractScan.status === "FAIL" ? "bg-red-50 border-red-200" : "bg-amber-50 border-amber-200")}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-semibold text-slate-700">Contract Scan</span>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-slate-800">Score: {deal.latestContractScan.score}</span>
                            <Badge variant={deal.latestContractScan.status === "PASS" ? "green" : deal.latestContractScan.status === "FAIL" ? "destructive" : "amber"} className="text-[10px]">
                              {deal.latestContractScan.status}
                            </Badge>
                          </div>
                        </div>
                        <p className="text-[11px] text-slate-500">Scanned {fmtDate(deal.latestContractScan.scannedAt)}</p>
                        {deal.latestContractScan.fixList.length > 0 && (
                          <div className="mt-2">
                            <p className="text-[11px] font-semibold text-slate-600 mb-1">Fix List ({deal.latestContractScan.fixList.length} items):</p>
                            <ul className="space-y-0.5">
                              {deal.latestContractScan.fixList.slice(0, 5).map((item, i) => (
                                <li key={i} className="text-[11px] text-slate-600 flex items-start gap-1.5">
                                  <ShieldAlert size={10} className="text-red-500 mt-0.5 flex-shrink-0" />
                                  {item.description ?? item.rule ?? JSON.stringify(item)}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="rounded-xl p-3 border border-slate-100 bg-slate-50">
                        <p className="text-xs text-slate-400">No contract scan for this deal</p>
                      </div>
                    )}
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
                <p className="text-slate-500 font-medium">No documents on file</p>
                <p className="text-xs text-slate-400 mt-1">Documents uploaded by or for this dealer will appear here.</p>
              </div>
            ) : (
              <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                <div className="hidden lg:grid grid-cols-[2fr_1fr_0.8fr_0.8fr_1fr_1fr_0.8fr] gap-2 px-5 py-3 border-b border-slate-100 bg-slate-50/50">
                  {["Name", "Type", "MIME", "Size", "Uploaded", "Verified At", "Verified"].map(h => (
                    <span key={h} className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">{h}</span>
                  ))}
                </div>
                {documents.map((doc) => (
                  <div key={doc.id} className="grid lg:grid-cols-[2fr_1fr_0.8fr_0.8fr_1fr_1fr_0.8fr] gap-2 px-5 py-3.5 border-b border-slate-50 hover:bg-slate-50/70 transition-colors">
                    <button type="button" onClick={() => openSignedDealerDocument(doc.id)} className="text-left text-sm font-medium text-purple-700 hover:underline truncate">{doc.name}</button>
                    <span className="text-xs text-slate-600">{doc.type.replace(/_/g, " ")}</span>
                    <span className="text-xs text-slate-500">{doc.mimeType ?? "—"}</span>
                    <span className="text-xs text-slate-500">{doc.sizeBytes ? Math.round(doc.sizeBytes / 1024) + " KB" : "—"}</span>
                    <span className="text-xs text-slate-500">{fmtDate(doc.uploadedAt)}</span>
                    <span className="text-xs text-slate-500">{fmtDate(doc.verifiedAt)}</span>
                    <span>{doc.isVerified ? <Badge variant="green" className="text-[10px]">Yes</Badge> : <Badge variant="secondary" className="text-[10px]">No</Badge>}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Payments/Billing Tab ── */}
        {activeTab === "payments" && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {[
                { label: "Total Payments", value: String(dealerPayments.length), color: "bg-purple-50", icon: <FileText size={14} className="text-purple-600" /> },
                { label: "Total Amount", value: fmtCents(dealerPayments.reduce((s, p) => s + p.amountCents, 0)), color: "bg-green-50", icon: <Trophy size={14} className="text-green-600" /> },
                { label: "Pending", value: String(dealerPayments.filter(p => p.status === "PENDING").length), color: "bg-amber-50", icon: <Clock size={14} className="text-amber-600" /> },
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
            <h2 className="text-sm font-semibold text-slate-700">Payment Records ({dealerPayments.length})</h2>
            {dealerPayments.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-2xl py-16 text-center">
                <FileText size={36} className="text-slate-300 mx-auto mb-3" />
                <p className="text-slate-500 font-medium">No payment records</p>
                <p className="text-xs text-slate-400 mt-1">Dealer payment records will appear here once created.</p>
              </div>
            ) : (
              <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                <div className="hidden lg:grid grid-cols-[1fr_1fr_1fr_1fr_1fr_1fr] gap-2 px-5 py-3 border-b border-slate-100 bg-slate-50/50">
                  {["Amount", "Type", "Status", "Deal ID", "Processed", "Created"].map(h => (
                    <span key={h} className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">{h}</span>
                  ))}
                </div>
                {dealerPayments.map((p) => (
                  <div key={p.id} className="grid lg:grid-cols-[1fr_1fr_1fr_1fr_1fr_1fr] gap-2 px-5 py-3.5 border-b border-slate-50 hover:bg-slate-50/70 transition-colors">
                    <span className="text-sm font-semibold text-slate-800">{fmtCents(p.amountCents)}</span>
                    <span className="text-xs text-slate-600">{p.type}</span>
                    <Badge variant={p.status === "PAID" ? "green" : p.status === "PENDING" ? "amber" : "destructive"} className="text-[10px] w-fit">{p.status}</Badge>
                    <span className="text-xs font-mono text-slate-500">{p.dealId ? "···" + p.dealId.slice(-8) : "—"}</span>
                    <span className="text-xs text-slate-500">{fmtDate(p.processedAt)}</span>
                    <span className="text-xs text-slate-400">{fmtDate(p.createdAt)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Notifications Tab ── */}
        {activeTab === "notifications" && (
          <div>
            <h2 className="text-sm font-semibold text-slate-700 mb-3">Notifications ({notifications.length})</h2>
            {notifications.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-2xl py-16 text-center">
                <Bell size={36} className="text-slate-300 mx-auto mb-3" />
                <p className="text-slate-500 font-medium">No notifications</p>
              </div>
            ) : (
              <div className="space-y-2">
                {notifications.map((n) => (
                  <div key={n.id} className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3">
                        <div className={"w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 " + (n.readAt ? "bg-slate-100" : "bg-purple-50")}>
                          <Bell size={14} className={n.readAt ? "text-slate-400" : "text-purple-600"} />
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-slate-800">{n.title}</p>
                          <p className="text-xs text-slate-600 mt-0.5">{n.body}</p>
                          <p className="text-[11px] text-slate-400 mt-1">{n.type} · {fmtDateTime(n.createdAt)}</p>
                        </div>
                      </div>
                      <Badge variant={n.readAt ? "secondary" : "amber"} className="text-[10px] flex-shrink-0">
                        {n.readAt ? "Read" : "Unread"}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Compliance Tab ── */}
        {activeTab === "compliance" && (
          <div className="max-w-2xl space-y-5">
            <SectionCard title="OFAC / Compliance Review" icon={<Shield size={14} />}>
              {complianceStatus.hasFlag ? (
                <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-4">
                  <div className="flex items-center gap-2 mb-1">
                    <ShieldAlert size={15} className="text-red-600" />
                    <span className="text-sm font-semibold text-red-700">Under review — flag active</span>
                  </div>
                  <p className="text-xs text-red-500 mt-0.5">Dealer is flagged for OFAC / sanctions / compliance review. Clear the flag to resume standing.</p>
                  {complianceStatus.reason && (
                    <p className="text-sm text-red-600 mt-1.5"><span className="font-medium">Reason:</span> {complianceStatus.reason}</p>
                  )}
                </div>
              ) : (
                <div className="bg-green-50 border border-green-200 rounded-xl p-4 mb-4">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 size={15} className="text-green-600" />
                    <span className="text-sm font-medium text-green-700">Clear — no active OFAC / compliance flag</span>
                  </div>
                </div>
              )}
              <div className="flex gap-3">
                {!complianceStatus.hasFlag ? (
                  <button onClick={() => setModal("compliance-flag")} className="flex items-center gap-2 px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-sm font-semibold transition-colors">
                    <Flag size={13} /> Flag for Review
                  </button>
                ) : (
                  <button onClick={() => setModal("compliance-resolve")} className="flex items-center gap-2 px-4 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-xl text-sm font-semibold transition-colors">
                    <CheckCircle2 size={13} /> Clear Flag
                  </button>
                )}
              </div>
            </SectionCard>

            <SectionCard title="Compliance Audit History" icon={<Activity size={14} />}>
              {auditLogs.filter(l => l.action === "DEALER_COMPLIANCE_FLAGGED" || l.action === "DEALER_COMPLIANCE_RESOLVED").length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-4">No compliance history</p>
              ) : (
                <div className="space-y-2">
                  {auditLogs
                    .filter(l => l.action === "DEALER_COMPLIANCE_FLAGGED" || l.action === "DEALER_COMPLIANCE_RESOLVED")
                    .map((log) => (
                      <div key={log.id} className={"flex items-start gap-3 p-3 rounded-xl border " + (log.action === "DEALER_COMPLIANCE_FLAGGED" ? "bg-red-50 border-red-100" : "bg-green-50 border-green-100")}>
                        <div className={"w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 " + (log.action === "DEALER_COMPLIANCE_FLAGGED" ? "bg-red-200" : "bg-green-200")}>
                          {log.action === "DEALER_COMPLIANCE_FLAGGED"
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
              <button onClick={() => setModal("note")} className="flex items-center gap-1.5 px-3.5 py-2 bg-al-primary hover:bg-purple-800 text-white rounded-xl text-xs font-semibold transition-colors">
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
                      <p className="text-sm font-semibold text-slate-800">Approve Dealer</p>
                      <p className="text-xs text-slate-500">Approve this pending dealer application</p>
                    </div>
                    <button onClick={() => setModal("approve")} className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-xl text-xs font-semibold transition-colors">
                      Approve
                    </button>
                  </div>
                )}
                {availability.canSuspend && (
                  <div className="flex items-center justify-between p-3 border border-amber-100 rounded-xl bg-amber-50/50">
                    <div>
                      <p className="text-sm font-semibold text-slate-800">Suspend Dealer</p>
                      <p className="text-xs text-slate-500">Temporarily suspend dealer access</p>
                    </div>
                    <button onClick={() => setModal("suspend")} className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-semibold transition-colors">
                      Suspend
                    </button>
                  </div>
                )}
                {availability.canReactivate && (
                  <div className="flex items-center justify-between p-3 border border-blue-100 rounded-xl bg-blue-50/50">
                    <div>
                      <p className="text-sm font-semibold text-slate-800">Reactivate Dealer</p>
                      <p className="text-xs text-slate-500">Restore dealer from suspended status</p>
                    </div>
                    <button onClick={() => setModal("reactivate")} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold transition-colors">
                      Reactivate
                    </button>
                  </div>
                )}
                {availability.canTerminate && (
                  <div className="flex items-center justify-between p-3 border border-red-100 rounded-xl bg-red-50/50">
                    <div>
                      <p className="text-sm font-semibold text-slate-800">Terminate Dealer</p>
                      <p className="text-xs text-slate-500">Permanently terminate dealer account</p>
                    </div>
                    <button onClick={() => setModal("terminate")} className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-semibold transition-colors">
                      Terminate
                    </button>
                  </div>
                )}
                <div className="flex items-center justify-between p-3 border border-purple-100 rounded-xl bg-purple-50/30">
                  <div>
                    <p className="text-sm font-semibold text-slate-800">Override Tier</p>
                    <p className="text-xs text-slate-500">Current: <strong>{dealer.tier}</strong> — change to STANDARD / GOLD / PLATINUM / PROBATION</p>
                  </div>
                  <button onClick={() => setModal("tier-override")} className="px-4 py-2 bg-al-primary hover:bg-purple-800 text-white rounded-xl text-xs font-semibold transition-colors">
                    Override Tier
                  </button>
                </div>
              </div>
            </SectionCard>

            {/* Profile & Notes */}
            <SectionCard title="Profile & Notes" icon={<Edit2 size={14} />}>
              <div className="space-y-2">
                <div className="flex items-center justify-between p-3 border border-slate-100 rounded-xl">
                  <div>
                    <p className="text-sm font-semibold text-slate-800">Update Profile</p>
                    <p className="text-xs text-slate-500">Edit dealer profile information</p>
                  </div>
                  <button onClick={() => setModal("profile-edit")} className="px-4 py-2 bg-al-primary hover:bg-purple-800 text-white rounded-xl text-xs font-semibold transition-colors">
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
                      <p className="text-xs text-slate-500">Mark this dealer for compliance review</p>
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
