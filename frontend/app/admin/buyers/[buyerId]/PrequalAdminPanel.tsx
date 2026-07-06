"use client";

// PrequalAdminPanel.tsx
// Full multi-step admin panel for buyer prequalification on /admin/buyers/[buyerId].
//
// Implements two clearly separated workflows:
//   1. "Run MicroBilt iPredict" — real provider run with consent enforcement
//   2. "Manual Admin Prequalification Override" — no provider call, direct DB write
//
// State machine:
//   panel → ipredict_form → ipredict_confirm → ipredict_running → ipredict_result
//   panel → override_form → override_running → override_result

import { useState, useCallback, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import {
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  Loader2,
  ShieldAlert,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Info,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ExistingPrequal {
  id: string;
  decision: string;
  tier: string | null;
  maxOtdAmountCents: number;
  expiresAt: string;
  isValid: boolean;
  checkOfacAlert: boolean;
  isExternal: boolean;
  source: string;
  createdAt: string;
  updatedAt: string;
  // iPredict_6.yaml risk detail (admin-only — never exposed to buyer).
  creditScore?: number | null;
  idvScore?: number | null;
  mlaCovered?: boolean;
  fraudWarning?: string | null;
  adverseReasonCodes?: string[];
  deceasedFlag?: boolean;
  bankruptcyFlag?: boolean;
}

// Credit-score band label (iPredict scoring range 300–850 per spec).
function creditScoreBand(score: number): string {
  if (score >= 720) return "Strong";
  if (score >= 660) return "Good";
  if (score >= 600) return "Fair";
  return "Weak";
}

// IDV score risk band (higher = lower risk per MicroBilt IDV scale).
function idvScoreBand(score: number): string {
  if (score >= 900) return "Low Risk";
  if (score >= 700) return "Moderate Risk";
  return "Elevated Risk";
}

function RiskRow({ label, value, alert = false }: { label: string; value: string; alert?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-slate-100 last:border-0">
      <span className="text-xs text-slate-500">{label}</span>
      <span className={`text-sm font-medium ${alert ? "text-red-700" : "text-slate-800"}`}>{value}</span>
    </div>
  );
}

interface BuyerProfile {
  firstName: string;
  lastName: string;
  email: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  employmentStatus: string | null;
  incomeRange: string | null;
}

export interface PrequalAdminPanelProps {
  buyerId: string;
  buyer: BuyerProfile;
  existingPrequal: ExistingPrequal | null;
  hasConsent: boolean;
  consentAcceptedAt: string | null;
  profileMissingFields: string[];
}

interface IPredictForm {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  employmentStatus: string;
  employerName: string;
  monthlyIncomeUsd: string;
  lengthOfEmployment: string;
  // Consent acknowledgment fields
  consentSource: string;
  consentTimestamp: string;
  authorizationSummary: string;
  authorizationReference: string;
  adminCertification: boolean;
  reason: string;
}

interface OverrideForm {
  decision: string;
  tier: string;
  maxOtdAmountCents: string;
  checkOfacAlert: boolean;
  reason: string;
}

interface IPredictRunResult {
  status: string;
  prequal: {
    id: string;
    decision: string;
    tier: string | null;
    maxOtdAmountCents: number;
    expiresAt: string;
    checkOfacAlert: boolean;
  } | null;
  mocked: boolean;
  providerReason?: string;
  approvalEmailSent: boolean;
  adverseActionSent: boolean;
  auditLogId: string;
  ranAt: string;
  adminId: string;
  adminEmail: string;
  consentSource: string;
  consentTimestamp: string;
  authorizationSummary: string;
  authorizationReference?: string;
}

interface OverrideResult {
  prequal: {
    id: string;
    decision: string;
    tier: string | null;
    maxOtdAmountCents: number;
    expiresAt: string;
  };
}

type PanelState =
  | { view: "panel" }
  | { view: "ipredict_form" }
  | { view: "ipredict_confirm" }
  | { view: "ipredict_running" }
  | { view: "ipredict_result"; result: IPredictRunResult }
  | { view: "override_form" }
  | { view: "override_running" }
  | { view: "override_result"; result: OverrideResult };

// ─── Formatting helpers ───────────────────────────────────────────────────────

function fmtCents(cents: number) {
  return `$${(cents / 100).toLocaleString()}`;
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function decisionBadge(decision: string) {
  switch (decision) {
    case "APPROVED":       return <Badge variant="green">Approved</Badge>;
    case "DECLINED":       return <Badge variant="destructive">Declined</Badge>;
    case "MANUAL_REVIEW":  return <Badge variant="amber">Manual Review</Badge>;
    case "OFAC_REVIEW":
    case "OFAC_ESCALATED": return <Badge variant="destructive">OFAC Review</Badge>;
    case "PENDING":        return <Badge variant="secondary">Pending</Badge>;
    default:               return <Badge variant="secondary">{decision}</Badge>;
  }
}

function sourceLabel(source: string) {
  switch (source) {
    case "admin_ipredict": return "Admin MicroBilt iPredict";
    case "admin_manual":   return "Admin Manual Override";
    case "ipredict":       return "MicroBilt iPredict (Buyer)";
    default:               return "External Pre-Approval";
  }
}

function runStatusLabel(status: string): { label: string; variant: "green" | "destructive" | "amber" | "secondary" } {
  switch (status) {
    case "APPROVED":       return { label: "Approved",           variant: "green" };
    case "DECLINED":       return { label: "Declined",           variant: "destructive" };
    case "MANUAL_REVIEW":  return { label: "Manual Review",      variant: "amber" };
    case "OFAC_REVIEW":    return { label: "OFAC Review",        variant: "destructive" };
    case "MOCKED":         return { label: "Sandbox Mock",       variant: "secondary" };
    case "PROVIDER_ERROR": return { label: "Provider Error",     variant: "destructive" };
    case "CONSENT_MISSING":return { label: "Consent Required",   variant: "destructive" };
    default:               return { label: status,               variant: "secondary" };
  }
}

// ─── Consent source helpers ───────────────────────────────────────────────────

const CONSENT_SOURCES: Array<{ value: string; label: string }> = [
  { value: "EXISTING_PREQUAL_CONSENT",       label: "Existing platform consent" },
  { value: "PHONE_VERBAL_AUTHORIZATION",      label: "Phone/verbal authorization" },
  { value: "EMAIL_AUTHORIZATION",             label: "Email authorization" },
  { value: "TEXT_AUTHORIZATION",              label: "Text/SMS authorization" },
  { value: "SIGNED_DOCUMENT_AUTHORIZATION",   label: "Signed document authorization" },
  { value: "IN_PERSON_AUTHORIZATION",         label: "In-person authorization" },
];

function consentSourceLabel(value: string): string {
  return CONSENT_SOURCES.find(s => s.value === value)?.label ?? value;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function FieldRow({
  label,
  value,
  source,
}: {
  label: string;
  value: string;
  source: "profile" | "admin";
}) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-slate-100 last:border-0">
      <span className="text-xs text-slate-500 w-32 shrink-0">{label}</span>
      <span className="text-sm text-slate-800 flex-1 text-right font-mono">{value || "—"}</span>
      <span
        className={`text-xs ml-3 px-1.5 py-0.5 rounded font-medium ${
          source === "profile"
            ? "bg-blue-50 text-blue-600"
            : "bg-amber-50 text-amber-700"
        }`}
      >
        {source === "profile" ? "profile" : "admin"}
      </span>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function PrequalAdminPanel({
  buyerId,
  buyer,
  existingPrequal: initialPrequal,
  hasConsent: initialHasConsent,
  consentAcceptedAt: initialConsentAt,
  profileMissingFields,
}: PrequalAdminPanelProps) {
  const [state, setState] = useState<PanelState>({ view: "panel" });
  const [currentPrequal, setCurrentPrequal] = useState<ExistingPrequal | null>(initialPrequal);
  const [hasConsent, setHasConsent] = useState(initialHasConsent);
  const [consentAcceptedAt, setConsentAcceptedAt] = useState<string | null>(initialConsentAt);
  const [refreshing, setRefreshing] = useState(false);

  // iPredict form state — prefill from buyer profile where available
  const [ipForm, setIpForm] = useState<IPredictForm>({
    firstName:          buyer.firstName,
    lastName:           buyer.lastName,
    dateOfBirth:        "",
    address:            buyer.address ?? "",
    city:               buyer.city ?? "",
    state:              buyer.state ?? "",
    zip:                buyer.zip ?? "",
    employmentStatus:   buyer.employmentStatus ?? "",
    employerName:       "",
    monthlyIncomeUsd:   "",
    lengthOfEmployment: "",
    consentSource:       "",
    consentTimestamp:    "",
    authorizationSummary: "",
    authorizationReference: "",
    adminCertification:  false,
    reason:              "",
  });

  // Override form state
  const [ovForm, setOvForm] = useState<OverrideForm>({
    decision:          "",
    tier:              "",
    maxOtdAmountCents: "",
    checkOfacAlert:    false,
    reason:            "",
  });

  const [formError, setFormError] = useState<string | null>(null);

  // ── History + Resend actions ───────────────────────────────────────────────
  interface ComplianceEventEntry {
    id: string;
    eventType: string;
    prequalApplicationId: string | null;
    metadata: unknown;
    createdAt: string;
  }
  interface AdminAuditEntry {
    id: string;
    action: string;
    adminEmail: string;
    reason: string | null;
    metadata: unknown;
    createdAt: string;
  }
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [complianceEvents, setComplianceEvents] = useState<ComplianceEventEntry[]>([]);
  const [adminAuditLogs, setAdminAuditLogs] = useState<AdminAuditEntry[]>([]);
  const [resendStatus, setResendStatus] = useState<{ kind: "ok" | "error"; message: string } | null>(null);
  const [resending, setResending] = useState<"APPROVED" | "ADVERSE_ACTION" | null>(null);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const res = await fetch(`/api/admin/buyers/${buyerId}/prequal/history`);
      const json = await res.json() as {
        success?: boolean;
        data?: { complianceEvents: ComplianceEventEntry[]; adminAuditLogs: AdminAuditEntry[] };
      };
      if (json.success && json.data) {
        setComplianceEvents(json.data.complianceEvents);
        setAdminAuditLogs(json.data.adminAuditLogs);
      }
    } catch {
      // Non-fatal — surface as empty list
    }
    setHistoryLoading(false);
  }, [buyerId]);

  useEffect(() => {
    if (historyOpen && complianceEvents.length === 0 && adminAuditLogs.length === 0 && !historyLoading) {
      void loadHistory();
    }
  }, [historyOpen, complianceEvents.length, adminAuditLogs.length, historyLoading, loadHistory]);

  const resendEmail = useCallback(async (kind: "APPROVED" | "ADVERSE_ACTION") => {
    setResendStatus(null);
    setResending(kind);
    try {
      const res = await fetch(`/api/admin/buyers/${buyerId}/prequal/resend-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind }),
      });
      const json = await res.json() as { success?: boolean; error?: { message: string } };
      if (!res.ok || !json.success) {
        setResendStatus({ kind: "error", message: json.error?.message ?? "Failed to send email" });
      } else {
        setResendStatus({
          kind: "ok",
          message: kind === "APPROVED" ? "Approval email re-sent." : "Adverse-action email re-sent.",
        });
        // Refresh history so the new audit entry shows up
        await loadHistory();
      }
    } catch {
      setResendStatus({ kind: "error", message: "Network error. Please try again." });
    }
    setResending(null);
  }, [buyerId, loadHistory]);

  // ── Refresh panel data via GET endpoint ────────────────────────────────────
  const refreshPanelData = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch(`/api/admin/buyers/${buyerId}/prequal`);
      const json = await res.json() as {
        success?: boolean;
        data?: {
          existingPrequal: ExistingPrequal | null;
          hasConsent: boolean;
          consentAcceptedAt: string | null;
        };
      };
      if (json.success && json.data) {
        setCurrentPrequal(json.data.existingPrequal);
        setHasConsent(json.data.hasConsent);
        setConsentAcceptedAt(json.data.consentAcceptedAt);
      }
    } catch { /* ignore */ }
    setRefreshing(false);
  }, [buyerId]);

  // ── Determine which form fields came from the buyer profile ───────────────
  function ipFieldSource(field: keyof IPredictForm): "profile" | "admin" {
    switch (field) {
      case "firstName":  return buyer.firstName ? "profile" : "admin";
      case "lastName":   return buyer.lastName ? "profile" : "admin";
      case "address":    return buyer.address ? "profile" : "admin";
      case "city":       return buyer.city ? "profile" : "admin";
      case "state":      return buyer.state ? "profile" : "admin";
      case "zip":        return buyer.zip ? "profile" : "admin";
      default:           return "admin";
    }
  }

  // ── iPredict form validation ───────────────────────────────────────────────
  function validateIPredictForm(): string | null {
    if (!ipForm.firstName.trim()) return "First name is required";
    if (!ipForm.lastName.trim())  return "Last name is required";
    if (!ipForm.dateOfBirth.trim()) return "Date of birth is required (MM/DD/YYYY)";
    if (!/^(0[1-9]|1[0-2])\/(0[1-9]|[12]\d|3[01])\/\d{4}$/.test(ipForm.dateOfBirth))
      return "Date of birth must be MM/DD/YYYY";
    if (!ipForm.address.trim())   return "Address is required";
    if (!ipForm.city.trim())      return "City is required";
    if (!ipForm.state.trim() || !/^[A-Za-z]{2}$/.test(ipForm.state))
      return "State must be a 2-letter code";
    if (!/^\d{5}$/.test(ipForm.zip)) return "ZIP must be 5 digits";
    // Consent acknowledgment fields
    if (!ipForm.consentSource)    return "Consent source is required";
    if (!ipForm.consentTimestamp.trim()) return "Consent date/time is required";
    if (!ipForm.authorizationSummary.trim()) return "Authorization summary is required";
    if (!ipForm.reason.trim())    return "Reason note is required";
    if (!ipForm.adminCertification)
      return "Admin certification checkbox is required";
    return null;
  }

  // ── Run iPredict ───────────────────────────────────────────────────────────
  async function runIPredict() {
    setState({ view: "ipredict_running" });
    setFormError(null);

    try {
      const res = await fetch(`/api/admin/buyers/${buyerId}/prequal/run-ipredict`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName:    ipForm.firstName.trim(),
          lastName:     ipForm.lastName.trim(),
          dateOfBirth:  ipForm.dateOfBirth.trim(),
          address:      ipForm.address.trim(),
          city:         ipForm.city.trim(),
          state:        ipForm.state.trim().toUpperCase(),
          zip:          ipForm.zip.trim(),
          employmentStatus:   ipForm.employmentStatus.trim() || undefined,
          employerName:       ipForm.employerName.trim() || undefined,
          monthlyIncomeUsd:   ipForm.monthlyIncomeUsd ? parseFloat(ipForm.monthlyIncomeUsd) : undefined,
          lengthOfEmployment: ipForm.lengthOfEmployment.trim() || undefined,
          consentSource:        ipForm.consentSource,
          consentTimestamp:     new Date(ipForm.consentTimestamp).toISOString(),
          authorizationSummary: ipForm.authorizationSummary.trim(),
          authorizationReference: ipForm.authorizationReference.trim() || undefined,
          adminCertification:   true,
          reason:               ipForm.reason.trim(),
        }),
      });

      const json = await res.json() as {
        success?: boolean;
        data?: IPredictRunResult;
        error?: { code: string; message: string };
      };

      if (!res.ok || !json.success || !json.data) {
        const msg = json.error?.message ?? "Failed to run iPredict";
        setState({ view: "ipredict_form" });
        setFormError(msg);
        return;
      }

      const result = json.data;
      if (result.prequal) {
        setCurrentPrequal({
          id: result.prequal.id,
          decision: result.prequal.decision,
          tier: result.prequal.tier,
          maxOtdAmountCents: result.prequal.maxOtdAmountCents,
          expiresAt: result.prequal.expiresAt,
          isValid: new Date(result.prequal.expiresAt) > new Date(),
          checkOfacAlert: result.prequal.checkOfacAlert,
          isExternal: false,
          source: "admin_ipredict",
          createdAt: result.ranAt,
          updatedAt: result.ranAt,
        });
        // Admin-initiated run creates a consent record — update state
        setHasConsent(true);
        setConsentAcceptedAt(result.ranAt);
      }

      setState({ view: "ipredict_result", result });
    } catch {
      setState({ view: "ipredict_form" });
      setFormError("Network error. Please try again.");
    }
  }

  // ── Submit manual override ─────────────────────────────────────────────────
  async function submitOverride() {
    setFormError(null);
    if (!ovForm.decision) { setFormError("Decision is required"); return; }
    const amount = parseInt(ovForm.maxOtdAmountCents, 10);
    if (!amount || amount <= 0) { setFormError("Max OTD amount must be a positive number (in cents)"); return; }
    if (!ovForm.reason.trim()) { setFormError("Reason note is required"); return; }

    setState({ view: "override_running" });

    try {
      const res = await fetch(`/api/admin/buyers/${buyerId}/prequal/manual-override`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decision:          ovForm.decision,
          tier:              ovForm.tier || undefined,
          maxOtdAmountCents: amount,
          reason:            ovForm.reason.trim(),
          checkOfacAlert:    ovForm.checkOfacAlert,
        }),
      });

      const json = await res.json() as {
        success?: boolean;
        data?: { prequal: OverrideResult["prequal"] };
        error?: { code: string; message: string };
      };

      if (!res.ok || !json.success || !json.data) {
        const msg = json.error?.message ?? "Override failed";
        setState({ view: "override_form" });
        setFormError(msg);
        return;
      }

      const { prequal } = json.data;
      setCurrentPrequal({
        id: prequal.id,
        decision: prequal.decision,
        tier: prequal.tier,
        maxOtdAmountCents: prequal.maxOtdAmountCents,
        expiresAt: prequal.expiresAt,
        isValid: new Date(prequal.expiresAt) > new Date(),
        checkOfacAlert: ovForm.checkOfacAlert,
        isExternal: false,
        source: "admin_manual",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      setState({ view: "override_result", result: { prequal } });
    } catch {
      setState({ view: "override_form" });
      setFormError("Network error. Please try again.");
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  // ── PANEL: status overview + action buttons ────────────────────────────────
  if (state.view === "panel") {
    return (
      <div className="mt-6" data-testid="prequal-admin-panel">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-bold text-slate-900">Prequalification Admin Panel</h2>
          <button
            onClick={refreshPanelData}
            disabled={refreshing}
            className="text-xs text-slate-400 hover:text-slate-700 flex items-center gap-1"
            data-testid="prequal-panel-refresh"
          >
            <RefreshCw size={12} className={refreshing ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>

        {/* Current Status Card */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 mb-4" data-testid="prequal-status-card">
          {currentPrequal ? (
            <>
              <div className="flex items-start justify-between mb-3">
                <div>
                  {decisionBadge(currentPrequal.decision)}
                  {currentPrequal.checkOfacAlert && (
                    <Badge variant="destructive" className="ml-2">OFAC Alert</Badge>
                  )}
                  {!currentPrequal.isValid && (
                    <Badge variant="secondary" className="ml-2">Expired</Badge>
                  )}
                </div>
                <span className="text-xs text-slate-400">{sourceLabel(currentPrequal.source)}</span>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                {[
                  { label: "Tier",         value: currentPrequal.tier ?? "—" },
                  { label: "Max OTD",      value: fmtCents(currentPrequal.maxOtdAmountCents) },
                  { label: "Expires",      value: fmtDate(currentPrequal.expiresAt) },
                  { label: "Last updated", value: fmtDateTime(currentPrequal.updatedAt) },
                ].map(f => (
                  <div key={f.label}>
                    <p className="text-xs text-slate-400">{f.label}</p>
                    <p className="font-semibold text-slate-800">{f.value}</p>
                  </div>
                ))}
              </div>
              {currentPrequal.checkOfacAlert && (
                <div className="mt-3 bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2">
                  <ShieldAlert size={16} className="text-red-600 shrink-0 mt-0.5" />
                  <p className="text-xs text-red-700">
                    OFAC alert flagged — manual compliance review required before any approval.
                  </p>
                </div>
              )}
            </>
          ) : (
            <div className="flex items-center gap-2 text-slate-400" data-testid="no-prequal-status">
              <Info size={16} />
              <span className="text-sm">No prequalification on file for this buyer.</span>
            </div>
          )}
        </div>

        {/* Risk Detail (iPredict_6.yaml — admin-only, never shown to buyer) */}
        {currentPrequal && (
          currentPrequal.creditScore != null ||
          currentPrequal.idvScore != null ||
          currentPrequal.mlaCovered ||
          currentPrequal.fraudWarning ||
          currentPrequal.deceasedFlag ||
          currentPrequal.bankruptcyFlag ||
          (currentPrequal.adverseReasonCodes?.length ?? 0) > 0
        ) && (
          <div className="bg-white border border-slate-200 rounded-xl p-4 mb-4" data-testid="prequal-risk-detail-card">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
              Risk Detail — iPredict™ (admin only)
            </p>
            <div className="space-y-0">
              <RiskRow
                label="Credit Score"
                value={
                  currentPrequal.creditScore != null
                    ? `${currentPrequal.creditScore} (${creditScoreBand(currentPrequal.creditScore)})`
                    : "—"
                }
              />
              <RiskRow
                label="IDV Score"
                value={
                  currentPrequal.idvScore != null
                    ? `${currentPrequal.idvScore} (${idvScoreBand(currentPrequal.idvScore)})`
                    : "—"
                }
              />
              <RiskRow
                label="MLA Status"
                value={currentPrequal.mlaCovered ? "Covered Borrower" : "Not Covered"}
                alert={!!currentPrequal.mlaCovered}
              />
              <RiskRow
                label="Fraud Warning"
                value={
                  currentPrequal.fraudWarning && currentPrequal.fraudWarning !== "N"
                    ? currentPrequal.fraudWarning
                    : "None"
                }
                alert={!!currentPrequal.fraudWarning && currentPrequal.fraudWarning !== "N"}
              />
              <RiskRow
                label="Deceased"
                value={currentPrequal.deceasedFlag ? "Yes" : "No"}
                alert={!!currentPrequal.deceasedFlag}
              />
              <RiskRow
                label="Bankruptcy"
                value={currentPrequal.bankruptcyFlag ? "Yes" : "No"}
                alert={!!currentPrequal.bankruptcyFlag}
              />
              <RiskRow
                label="Adverse Codes"
                value={
                  currentPrequal.adverseReasonCodes && currentPrequal.adverseReasonCodes.length > 0
                    ? currentPrequal.adverseReasonCodes.join(", ")
                    : "—"
                }
              />
            </div>
          </div>
        )}

        {/* Consent Status */}
        <div className="bg-white border border-slate-200 rounded-xl p-4 mb-4" data-testid="consent-status-card">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">FCRA Consent Status</p>
          {hasConsent ? (
            <div className="flex items-center gap-2">
              <CheckCircle2 size={15} className="text-green-600" />
              <span className="text-sm text-slate-700">Existing buyer consent on file</span>
              {consentAcceptedAt && (
                <span className="text-xs text-slate-400 ml-1">— recorded {fmtDate(consentAcceptedAt)}</span>
              )}
            </div>
          ) : (
            <div className="flex items-start gap-2">
              <Info size={15} className="text-slate-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm text-slate-700">No in-platform consent on file</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  Admin may still run iPredict by recording valid external buyer authorization
                  (phone, email, text, signed document, or in-person). Select the appropriate
                  consent source in the iPredict form.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Profile data completeness */}
        {profileMissingFields.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-4" data-testid="profile-missing-fields">
            <p className="text-xs font-semibold text-amber-700 mb-1">
              Profile fields missing ({profileMissingFields.length})
            </p>
            <p className="text-xs text-amber-600">
              {profileMissingFields.join(", ")} — you can enter these in the iPredict form below.
            </p>
          </div>
        )}

        {/* Action buttons */}
        <div className="space-y-3" data-testid="prequal-action-buttons">
          {/* Real iPredict run */}
          <div className="border-2 border-al-primary/20 rounded-xl p-4 bg-al-primary/5">
            <p className="text-xs font-semibold text-al-primary uppercase tracking-wide mb-1">
              MicroBilt iPredict — Real Provider Run
            </p>
            <p className="text-xs text-slate-500 mb-3">
              Calls MicroBilt iPredict soft-pull on behalf of the buyer. Requires prior buyer consent.
            </p>
            <Button
              onClick={() => { setFormError(null); setState({ view: "ipredict_form" }); }}
              data-testid="btn-run-ipredict"
            >
              Run MicroBilt iPredict
            </Button>
          </div>

          {/* Manual override */}
          <div className="border border-slate-200 rounded-xl p-4 bg-white">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
              Manual Admin Prequalification Override
            </p>
            <p className="text-xs text-slate-400 mb-3">
              Set decision directly without calling MicroBilt. Does not use or imply a consumer report.
            </p>
            <Button
              variant="outline"
              onClick={() => { setFormError(null); setState({ view: "override_form" }); }}
              data-testid="btn-manual-override"
            >
              Manual Admin Prequalification Override
            </Button>
          </div>

          {/* Resend decision email */}
          {currentPrequal && (currentPrequal.decision === "APPROVED" || currentPrequal.decision === "DECLINED") && (
            <div className="border border-slate-200 rounded-xl p-4 bg-white" data-testid="prequal-resend-section">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
                Resend Decision Email
              </p>
              <p className="text-xs text-slate-400 mb-3">
                Re-send the {currentPrequal.decision === "APPROVED" ? "approval" : "FCRA adverse-action"} email to the buyer. The original send is preserved in the email log.
              </p>
              {resendStatus && (
                <div
                  data-testid="prequal-resend-status"
                  className={`mb-3 text-xs px-3 py-2 rounded border ${resendStatus.kind === "ok" ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-red-50 border-red-200 text-red-700"}`}
                >
                  {resendStatus.message}
                </div>
              )}
              {currentPrequal.decision === "APPROVED" ? (
                <Button
                  variant="outline"
                  onClick={() => resendEmail("APPROVED")}
                  data-testid="btn-resend-approval"
                  disabled={resending !== null}
                >
                  {resending === "APPROVED" ? "Sending…" : "Resend Approval Email"}
                </Button>
              ) : (
                <Button
                  variant="outline"
                  onClick={() => resendEmail("ADVERSE_ACTION")}
                  data-testid="btn-resend-adverse-action"
                  disabled={resending !== null}
                >
                  {resending === "ADVERSE_ACTION" ? "Sending…" : "Resend Adverse-Action Email"}
                </Button>
              )}
            </div>
          )}

          {/* History */}
          <div className="border border-slate-200 rounded-xl bg-white" data-testid="prequal-history-section">
            <button
              type="button"
              onClick={() => setHistoryOpen((o) => !o)}
              className="w-full flex items-center justify-between px-4 py-3 text-left"
              data-testid="prequal-history-toggle"
            >
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                  Compliance &amp; Audit History
                </p>
                <p className="text-xs text-slate-400 mt-0.5">
                  ComplianceEvents (emails, notices) and AdminAuditLog entries for this buyer's prequal.
                </p>
              </div>
              {historyOpen ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
            </button>
            {historyOpen && (
              <div className="border-t border-slate-100 px-4 py-3 space-y-4">
                {historyLoading && (
                  <div className="flex items-center gap-2 text-xs text-slate-400">
                    <Loader2 size={12} className="animate-spin" /> Loading history…
                  </div>
                )}
                {!historyLoading && (
                  <>
                    <div>
                      <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-2">Compliance events ({complianceEvents.length})</p>
                      {complianceEvents.length === 0 ? (
                        <p className="text-xs text-slate-400">No compliance events recorded.</p>
                      ) : (
                        <ul className="space-y-1.5 max-h-64 overflow-y-auto pr-1" data-testid="prequal-compliance-events">
                          {complianceEvents.map((e) => (
                            <li key={e.id} className="text-xs flex items-start justify-between gap-3 border-b border-slate-50 pb-1.5 last:border-0">
                              <span className="font-mono text-slate-700">{e.eventType}</span>
                              <span className="text-slate-400 shrink-0">{fmtDateTime(e.createdAt)}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-2">Admin audit log ({adminAuditLogs.length})</p>
                      {adminAuditLogs.length === 0 ? (
                        <p className="text-xs text-slate-400">No admin actions recorded.</p>
                      ) : (
                        <ul className="space-y-1.5 max-h-64 overflow-y-auto pr-1" data-testid="prequal-admin-audit-logs">
                          {adminAuditLogs.map((a) => (
                            <li key={a.id} className="text-xs border-b border-slate-50 pb-1.5 last:border-0">
                              <div className="flex items-start justify-between gap-3">
                                <span className="font-mono text-slate-700">{a.action}</span>
                                <span className="text-slate-400 shrink-0">{fmtDateTime(a.createdAt)}</span>
                              </div>
                              <p className="text-slate-500 mt-0.5">
                                {a.adminEmail}
                                {a.reason ? ` — ${a.reason}` : ""}
                              </p>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── iPREDICT FORM ──────────────────────────────────────────────────────────
  if (state.view === "ipredict_form") {
    const validationError = formError;
    return (
      <div className="mt-6" data-testid="ipredict-form-section">
        <div className="flex items-center gap-3 mb-4">
          <button
            onClick={() => setState({ view: "panel" })}
            className="text-sm text-slate-400 hover:text-slate-700"
            data-testid="ipredict-form-back"
          >
            ← Back
          </button>
          <h2 className="text-base font-bold text-slate-900">Run MicroBilt iPredict</h2>
        </div>

        {/* Consent gate — show even if passed just as reminder */}
        {!hasConsent && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-4" data-testid="consent-info-banner">
            <div className="flex items-start gap-2">
              <Info size={18} className="text-blue-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-blue-800">No In-Platform Consent on File</p>
                <p className="text-sm text-blue-700 mt-1">
                  You may still run iPredict by recording the buyer&apos;s external authorization below.
                  Select the appropriate consent source and complete all required fields.
                </p>
              </div>
            </div>
          </div>
        )}

        {validationError && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-4 text-sm text-red-700" data-testid="ipredict-form-error">
            {validationError}
          </div>
        )}

        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <p className="text-xs text-slate-500 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
            <strong>Field sources:</strong>{" "}
            <span className="inline-block bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded text-xs font-medium">profile</span>
            {" "}= prefilled from buyer profile.{" "}
            <span className="inline-block bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded text-xs font-medium">admin</span>
            {" "}= entered by admin for this run only (not stored in profile).
          </p>

          {/* Required PII fields */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="ip-firstname">
                First Name <span className="text-red-500">*</span>
                <span className={`ml-2 text-xs px-1.5 py-0.5 rounded font-medium ${ipFieldSource("firstName") === "profile" ? "bg-blue-50 text-blue-600" : "bg-amber-50 text-amber-700"}`}>
                  {ipFieldSource("firstName")}
                </span>
              </Label>
              <Input
                id="ip-firstname"
                data-testid="ip-firstname"
                className="mt-1"
                value={ipForm.firstName}
                onChange={e => setIpForm(f => ({ ...f, firstName: e.target.value }))}
                required
              />
            </div>
            <div>
              <Label htmlFor="ip-lastname">
                Last Name <span className="text-red-500">*</span>
                <span className={`ml-2 text-xs px-1.5 py-0.5 rounded font-medium ${ipFieldSource("lastName") === "profile" ? "bg-blue-50 text-blue-600" : "bg-amber-50 text-amber-700"}`}>
                  {ipFieldSource("lastName")}
                </span>
              </Label>
              <Input
                id="ip-lastname"
                data-testid="ip-lastname"
                className="mt-1"
                value={ipForm.lastName}
                onChange={e => setIpForm(f => ({ ...f, lastName: e.target.value }))}
                required
              />
            </div>
          </div>

          <div>
            <Label htmlFor="ip-dob">
              Date of Birth (MM/DD/YYYY) <span className="text-red-500">*</span>
              <span className="ml-2 text-xs bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded font-medium">admin</span>
            </Label>
            <Input
              id="ip-dob"
              data-testid="ip-dob"
              className="mt-1"
              placeholder="MM/DD/YYYY"
              value={ipForm.dateOfBirth}
              onChange={e => setIpForm(f => ({ ...f, dateOfBirth: e.target.value }))}
              required
            />
            <p className="text-xs text-slate-400 mt-0.5">Date of birth is not stored in buyer profile — admin must enter for each run.</p>
          </div>

          <div>
            <Label htmlFor="ip-address">
              Address <span className="text-red-500">*</span>
              <span className={`ml-2 text-xs px-1.5 py-0.5 rounded font-medium ${ipFieldSource("address") === "profile" ? "bg-blue-50 text-blue-600" : "bg-amber-50 text-amber-700"}`}>
                {ipFieldSource("address")}
              </span>
            </Label>
            <Input
              id="ip-address"
              data-testid="ip-address"
              className="mt-1"
              placeholder="123 Main St"
              value={ipForm.address}
              onChange={e => setIpForm(f => ({ ...f, address: e.target.value }))}
              required
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-1">
              <Label htmlFor="ip-city">
                City <span className="text-red-500">*</span>
                <span className={`ml-1 text-xs px-1.5 py-0.5 rounded font-medium ${ipFieldSource("city") === "profile" ? "bg-blue-50 text-blue-600" : "bg-amber-50 text-amber-700"}`}>
                  {ipFieldSource("city")}
                </span>
              </Label>
              <Input
                id="ip-city"
                data-testid="ip-city"
                className="mt-1"
                value={ipForm.city}
                onChange={e => setIpForm(f => ({ ...f, city: e.target.value }))}
                required
              />
            </div>
            <div>
              <Label htmlFor="ip-state">
                State <span className="text-red-500">*</span>
                <span className={`ml-1 text-xs px-1.5 py-0.5 rounded font-medium ${ipFieldSource("state") === "profile" ? "bg-blue-50 text-blue-600" : "bg-amber-50 text-amber-700"}`}>
                  {ipFieldSource("state")}
                </span>
              </Label>
              <Input
                id="ip-state"
                data-testid="ip-state"
                className="mt-1"
                placeholder="CA"
                maxLength={2}
                value={ipForm.state}
                onChange={e => setIpForm(f => ({ ...f, state: e.target.value.toUpperCase() }))}
                required
              />
            </div>
            <div>
              <Label htmlFor="ip-zip">
                ZIP <span className="text-red-500">*</span>
                <span className={`ml-1 text-xs px-1.5 py-0.5 rounded font-medium ${ipFieldSource("zip") === "profile" ? "bg-blue-50 text-blue-600" : "bg-amber-50 text-amber-700"}`}>
                  {ipFieldSource("zip")}
                </span>
              </Label>
              <Input
                id="ip-zip"
                data-testid="ip-zip"
                className="mt-1"
                placeholder="90210"
                maxLength={5}
                value={ipForm.zip}
                onChange={e => setIpForm(f => ({ ...f, zip: e.target.value }))}
                required
              />
            </div>
          </div>

          {/* Optional internal fields */}
          <details className="border border-slate-100 rounded-lg">
            <summary className="cursor-pointer px-4 py-2.5 text-sm text-slate-600 font-medium select-none">
              Optional employment / income fields (internal only — not sent to MicroBilt)
            </summary>
            <div className="px-4 pb-4 pt-2 space-y-3">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="ip-employment">Employment Status</Label>
                  <Input
                    id="ip-employment"
                    data-testid="ip-employment"
                    className="mt-1"
                    placeholder="Employed / Self-employed / Unemployed"
                    value={ipForm.employmentStatus}
                    onChange={e => setIpForm(f => ({ ...f, employmentStatus: e.target.value }))}
                  />
                </div>
                <div>
                  <Label htmlFor="ip-employer">Employer Name</Label>
                  <Input
                    id="ip-employer"
                    data-testid="ip-employer"
                    className="mt-1"
                    value={ipForm.employerName}
                    onChange={e => setIpForm(f => ({ ...f, employerName: e.target.value }))}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="ip-income">Monthly Income (USD)</Label>
                  <Input
                    id="ip-income"
                    data-testid="ip-income"
                    type="number"
                    min={0}
                    className="mt-1"
                    placeholder="4500"
                    value={ipForm.monthlyIncomeUsd}
                    onChange={e => setIpForm(f => ({ ...f, monthlyIncomeUsd: e.target.value }))}
                  />
                </div>
                <div>
                  <Label htmlFor="ip-tenure">Length of Employment</Label>
                  <Input
                    id="ip-tenure"
                    data-testid="ip-tenure"
                    className="mt-1"
                    placeholder="2 years"
                    value={ipForm.lengthOfEmployment}
                    onChange={e => setIpForm(f => ({ ...f, lengthOfEmployment: e.target.value }))}
                  />
                </div>
              </div>
            </div>
          </details>

          {/* ── Consent Acknowledgment Section ──────────────────────────────── */}
          <div className="border-2 border-al-primary/30 rounded-xl p-4 space-y-4 bg-al-primary/5">
            <p className="text-xs font-semibold text-al-primary uppercase tracking-wide">
              Buyer Authorization / Consent Acknowledgment
            </p>

            {/* 1. Consent source */}
            <div>
              <Label htmlFor="ip-consent-source">
                Consent Source <span className="text-red-500">*</span>
              </Label>
              <Select
                id="ip-consent-source"
                data-testid="ip-consent-source"
                className="mt-1"
                value={ipForm.consentSource}
                onChange={e => setIpForm(f => ({ ...f, consentSource: e.target.value }))}
                required
              >
                <option value="">Select consent source…</option>
                {CONSENT_SOURCES.map(s => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </Select>
              {ipForm.consentSource === "EXISTING_PREQUAL_CONSENT" && !hasConsent && (
                <p className="text-xs text-red-600 mt-1">
                  ⚠ No in-platform consent record found for this buyer. Choose an external authorization source.
                </p>
              )}
            </div>

            {/* 2. Consent date/time */}
            <div>
              <Label htmlFor="ip-consent-ts">
                Authorization Date &amp; Time <span className="text-red-500">*</span>
              </Label>
              <Input
                id="ip-consent-ts"
                data-testid="ip-consent-ts"
                type="datetime-local"
                className="mt-1"
                value={ipForm.consentTimestamp}
                onChange={e => setIpForm(f => ({ ...f, consentTimestamp: e.target.value }))}
                required
              />
              <p className="text-xs text-slate-400 mt-0.5">When did the buyer give authorization?</p>
            </div>

            {/* 3. Authorization summary */}
            <div>
              <Label htmlFor="ip-auth-summary">
                Authorization Summary <span className="text-red-500">*</span>
              </Label>
              <Textarea
                id="ip-auth-summary"
                data-testid="ip-auth-summary"
                className="mt-1"
                placeholder="Buyer authorized AutoLenis to run iPredict prequalification by phone on [date]."
                value={ipForm.authorizationSummary}
                onChange={e => setIpForm(f => ({ ...f, authorizationSummary: e.target.value }))}
                required
              />
              <p className="text-xs text-slate-400 mt-0.5">
                Describe how and when the buyer gave authorization. This is stored as the consent record.
              </p>
            </div>

            {/* 4. Authorization reference (optional) */}
            <div>
              <Label htmlFor="ip-auth-ref">
                Authorization Reference <span className="text-xs text-slate-400">(optional)</span>
              </Label>
              <Input
                id="ip-auth-ref"
                data-testid="ip-auth-ref"
                className="mt-1"
                placeholder="e.g. email subject, call note, signed form name, SMS thread note"
                value={ipForm.authorizationReference}
                onChange={e => setIpForm(f => ({ ...f, authorizationReference: e.target.value }))}
              />
            </div>

            {/* 5. Admin certification checkbox */}
            <label className="flex items-start gap-3 cursor-pointer" data-testid="ip-admin-certification-label">
              <input
                type="checkbox"
                data-testid="ip-admin-certification"
                className="mt-1 h-4 w-4 accent-al-primary"
                checked={ipForm.adminCertification}
                onChange={e => setIpForm(f => ({ ...f, adminCertification: e.target.checked }))}
              />
              <span className="text-sm text-slate-700">
                <span className="font-semibold">Admin Certification:</span>{" "}
                I certify that the buyer authorized AutoLenis to run this MicroBilt iPredict
                prequalification, and I understand this action may involve consumer-report-related
                data and must only be performed with valid buyer authorization.
              </span>
            </label>
          </div>

          {/* 6. Admin reason note */}
          <div>
            <Label htmlFor="ip-reason">
              Admin Reason Note <span className="text-red-500">*</span>
            </Label>
            <Textarea
              id="ip-reason"
              data-testid="ip-reason"
              className="mt-1"
              placeholder="Explain why this admin-initiated iPredict run is being performed…"
              value={ipForm.reason}
              onChange={e => setIpForm(f => ({ ...f, reason: e.target.value }))}
            />
          </div>

          <div className="flex gap-3 pt-2">
            <Button variant="outline" onClick={() => setState({ view: "panel" })} data-testid="ipredict-form-cancel">
              Cancel
            </Button>
            <Button
              onClick={() => {
                const err = validateIPredictForm();
                if (err) { setFormError(err); return; }
                setFormError(null);
                setState({ view: "ipredict_confirm" });
              }}
              data-testid="ipredict-form-continue"
            >
              Review &amp; Confirm →
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ── iPREDICT CONFIRM ───────────────────────────────────────────────────────
  if (state.view === "ipredict_confirm") {
    return (
      <div className="mt-6" data-testid="ipredict-confirm-section">
        {/* Overlay-style confirmation panel */}
        <div className="border-2 border-al-primary rounded-xl bg-white shadow-lg p-6">
          <h2 className="text-base font-bold text-slate-900 mb-1 flex items-center gap-2">
            <ShieldAlert size={18} className="text-al-primary" />
            Confirm MicroBilt iPredict Run
          </h2>
          <p className="text-xs text-slate-500 mb-5">
            Review all details carefully. This will initiate a real soft-pull from MicroBilt on behalf of the buyer.
          </p>

          {/* Buyer identity */}
          <div className="bg-slate-50 rounded-lg p-4 mb-4">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Buyer</p>
            <p className="text-sm text-slate-800 font-semibold">
              {buyer.firstName} {buyer.lastName}
            </p>
            <p className="text-xs text-slate-500">{buyer.email}</p>
            <p className="text-xs text-slate-400 font-mono mt-1">ID: {buyerId}</p>
          </div>

          {/* Data summary */}
          <div className="bg-slate-50 rounded-lg p-4 mb-4">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
              iPredict Input Data
            </p>
            <FieldRow label="First name"    value={ipForm.firstName}   source={ipFieldSource("firstName")} />
            <FieldRow label="Last name"     value={ipForm.lastName}    source={ipFieldSource("lastName")} />
            <FieldRow label="Date of birth" value={ipForm.dateOfBirth} source="admin" />
            <FieldRow label="Address"       value={ipForm.address}     source={ipFieldSource("address")} />
            <FieldRow label="City"          value={ipForm.city}        source={ipFieldSource("city")} />
            <FieldRow label="State"         value={ipForm.state}       source={ipFieldSource("state")} />
            <FieldRow label="ZIP"           value={ipForm.zip}         source={ipFieldSource("zip")} />
          </div>

          {/* Consent */}
          <div className="bg-green-50 border border-green-200 rounded-lg p-3 mb-4">
            <p className="text-xs font-semibold text-green-800 mb-1">Consent / Authorization</p>
            <div className="flex items-start gap-2">
              <CheckCircle2 size={15} className="text-green-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-green-800">
                  Source: {consentSourceLabel(ipForm.consentSource)}
                </p>
                <p className="text-xs text-green-700 mt-0.5">
                  Authorized: {ipForm.consentTimestamp
                    ? new Date(ipForm.consentTimestamp).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" })
                    : "—"}
                </p>
                <p className="text-xs text-green-700 mt-0.5">{ipForm.authorizationSummary}</p>
                {ipForm.authorizationReference && (
                  <p className="text-xs text-green-600 mt-0.5">Ref: {ipForm.authorizationReference}</p>
                )}
              </div>
            </div>
            <div className="mt-2 flex items-center gap-1.5">
              <CheckCircle2 size={13} className="text-green-600" />
              <span className="text-xs text-green-800 font-medium">Admin certification completed</span>
            </div>
          </div>

          {/* FCRA warning */}
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
            <p className="text-xs font-semibold text-amber-800">FCRA / Permissible Purpose Notice</p>
            <p className="text-xs text-amber-700 mt-1">
              This action initiates a MicroBilt soft-pull consumer report under FCRA § 604. Ensure
              that a valid permissible purpose exists and that the buyer has previously authorized
              AutoLenis to obtain credit information. The result will be subject to adverse action
              notice requirements under FCRA § 615 if declined.
            </p>
          </div>

          {/* Reason note */}
          <div className="bg-slate-50 rounded-lg p-3 mb-5">
            <p className="text-xs font-semibold text-slate-500 mb-1">Admin Reason Note</p>
            <p className="text-sm text-slate-700">{ipForm.reason}</p>
          </div>

          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={() => setState({ view: "ipredict_form" })}
              data-testid="ipredict-confirm-back"
            >
              ← Edit Details
            </Button>
            <Button onClick={runIPredict} data-testid="ipredict-confirm-run">
              Confirm & Run MicroBilt iPredict
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ── iPREDICT RUNNING ───────────────────────────────────────────────────────
  if (state.view === "ipredict_running") {
    return (
      <div className="mt-6 flex flex-col items-center py-12" data-testid="ipredict-running">
        <Loader2 size={36} className="text-al-primary animate-spin mb-4" />
        <p className="text-base font-semibold text-slate-900">Running MicroBilt iPredict…</p>
        <p className="text-sm text-slate-500 mt-1">Calling MicroBilt — this may take up to 10 seconds.</p>
      </div>
    );
  }

  // ── iPREDICT RESULT ────────────────────────────────────────────────────────
  if (state.view === "ipredict_result") {
    const { result } = state;
    const statusInfo = runStatusLabel(result.status);

    return (
      <div className="mt-6" data-testid="ipredict-result-section">
        <h2 className="text-base font-bold text-slate-900 mb-4">iPredict Run Result</h2>

        {/* Status banner */}
        <div
          className={`rounded-xl border-2 p-5 mb-4 ${
            result.status === "APPROVED" || result.status === "MOCKED"
              ? "bg-green-50 border-green-300"
              : result.status === "DECLINED" || result.status === "OFAC_REVIEW" || result.status === "PROVIDER_ERROR" || result.status === "CONSENT_MISSING"
              ? "bg-red-50 border-red-300"
              : "bg-amber-50 border-amber-300"
          }`}
          data-testid="ipredict-result-banner"
        >
          <div className="flex items-center gap-3 mb-3">
            {result.status === "APPROVED" || result.status === "MOCKED" ? (
              <CheckCircle2 size={24} className="text-green-600" />
            ) : result.status === "DECLINED" || result.status === "OFAC_REVIEW" ? (
              <XCircle size={24} className="text-red-600" />
            ) : (
              <Clock size={24} className="text-amber-600" />
            )}
            <div>
              <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>
              {result.mocked && (
                <Badge variant="secondary" className="ml-2">Sandbox Mock</Badge>
              )}
            </div>
          </div>

          {result.prequal && (
            <div className="grid grid-cols-2 gap-3 text-sm">
              {[
                { label: "Decision",  value: result.prequal.decision },
                { label: "Tier",      value: result.prequal.tier ?? "—" },
                { label: "Max OTD",   value: fmtCents(result.prequal.maxOtdAmountCents) },
                { label: "Expires",   value: fmtDate(result.prequal.expiresAt) },
              ].map(f => (
                <div key={f.label}>
                  <p className="text-xs text-slate-500">{f.label}</p>
                  <p className="font-semibold text-slate-800">{f.value}</p>
                </div>
              ))}
            </div>
          )}

          {result.prequal?.checkOfacAlert && (
            <div className="mt-3 bg-red-100 border border-red-300 rounded-lg p-3 flex items-start gap-2">
              <ShieldAlert size={15} className="text-red-700 shrink-0 mt-0.5" />
              <p className="text-xs text-red-800 font-semibold">
                OFAC alert flagged — decision set to OFAC_REVIEW. Manual compliance review required.
              </p>
            </div>
          )}
        </div>

        {/* Status detail */}
        {result.status === "CONSENT_MISSING" && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-4" data-testid="result-consent-missing">
            <p className="font-semibold text-red-800 text-sm">Run Blocked — No Consent</p>
            <p className="text-xs text-red-600 mt-1">
              No FCRA consent record was found for this buyer. The iPredict run was blocked.
              The buyer must complete the consent process before this can be retried.
            </p>
          </div>
        )}

        {result.status === "PROVIDER_ERROR" && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-4" data-testid="result-provider-error">
            <p className="font-semibold text-amber-800 text-sm">Provider Error / Timeout</p>
            <p className="text-xs text-amber-700 mt-1">
              MicroBilt returned an error or timed out. Reason: {result.providerReason ?? "unknown"}.
              Decision was set to MANUAL_REVIEW. You may retry the run.
            </p>
          </div>
        )}

        {/* Compliance actions */}
        <div className="bg-white border border-slate-200 rounded-xl p-4 mb-4 space-y-2" data-testid="result-compliance-actions">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Compliance Actions</p>
          <div className="flex items-center gap-2 text-sm">
            {result.approvalEmailSent
              ? <CheckCircle2 size={14} className="text-green-600" />
              : <XCircle size={14} className="text-slate-300" />}
            <span className="text-slate-700">Approval notice email sent to buyer</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            {result.adverseActionSent
              ? <CheckCircle2 size={14} className="text-green-600" />
              : <XCircle size={14} className="text-slate-300" />}
            <span className="text-slate-700">FCRA § 615 adverse action notice sent</span>
          </div>
        </div>

        {/* Audit metadata */}
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 mb-5 text-xs text-slate-500 space-y-1" data-testid="result-audit-meta">
          <p><span className="font-semibold">Provider:</span> MicroBilt iPredict</p>
          <p><span className="font-semibold">Run at:</span> {fmtDateTime(result.ranAt)}</p>
          <p><span className="font-semibold">Run by:</span> {result.adminEmail}</p>
          <p><span className="font-semibold">Consent source:</span> {consentSourceLabel(result.consentSource)}</p>
          <p>
            <span className="font-semibold">Consent date:</span>{" "}
            {result.consentTimestamp
              ? new Date(result.consentTimestamp).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" })
              : "—"}
          </p>
          <p><span className="font-semibold">Authorization recorded by Admin:</span> {result.authorizationSummary}</p>
          {result.authorizationReference && (
            <p><span className="font-semibold">Authorization reference:</span> {result.authorizationReference}</p>
          )}
          {result.auditLogId && (
            <p><span className="font-semibold">Audit log ID:</span> <span className="font-mono">{result.auditLogId.slice(-12)}</span></p>
          )}
          {result.prequal?.id && (
            <p><span className="font-semibold">Prequal ID:</span> <span className="font-mono">{result.prequal.id.slice(-12)}</span></p>
          )}
        </div>

        {/* Next actions */}
        <div className="space-y-2" data-testid="result-next-actions">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Next Actions</p>
          <Button
            variant="outline"
            onClick={async () => { await refreshPanelData(); setState({ view: "panel" }); }}
            data-testid="result-back-to-panel"
          >
            Back to Prequalification Panel
          </Button>
          {(result.status === "PROVIDER_ERROR") && (
            <Button
              onClick={() => { setFormError(null); setState({ view: "ipredict_form" }); }}
              variant="secondary"
              data-testid="result-retry-ipredict"
            >
              Retry iPredict Run
            </Button>
          )}
          {(result.status === "OFAC_REVIEW" || result.status === "MANUAL_REVIEW") && (
            <Button
              variant="secondary"
              href={`/admin/queues`}
              data-testid="result-view-queues"
            >
              View Manual Review Queue
            </Button>
          )}
          <Button variant="ghost" href={`/admin/buyers/${buyerId}`} data-testid="result-view-buyer">
            View Full Buyer Profile
          </Button>
        </div>
      </div>
    );
  }

  // ── OVERRIDE FORM ──────────────────────────────────────────────────────────
  if (state.view === "override_form") {
    return (
      <div className="mt-6" data-testid="override-form-section">
        <div className="flex items-center gap-3 mb-4">
          <button
            onClick={() => setState({ view: "panel" })}
            className="text-sm text-slate-400 hover:text-slate-700"
            data-testid="override-form-back"
          >
            ← Back
          </button>
          <h2 className="text-base font-bold text-slate-900">Manual Admin Prequalification Override</h2>
        </div>

        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4">
          <p className="text-xs text-amber-700">
            This sets the buyer's prequalification directly <strong>without calling MicroBilt</strong>.
            The result will be labeled &ldquo;Admin Manual Override&rdquo; — it does not constitute or imply a consumer report.
          </p>
        </div>

        {formError && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-4 text-sm text-red-700" data-testid="override-form-error">
            {formError}
          </div>
        )}

        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="ov-decision">Decision <span className="text-red-500">*</span></Label>
              <Select
                id="ov-decision"
                data-testid="ov-decision"
                className="mt-1"
                value={ovForm.decision}
                onChange={e => setOvForm(f => ({ ...f, decision: e.target.value }))}
                required
              >
                <option value="">Select decision…</option>
                <option value="APPROVED">Approved</option>
                <option value="DECLINED">Declined</option>
                <option value="MANUAL_REVIEW">Manual Review</option>
                <option value="OFAC_REVIEW">OFAC Review</option>
                <option value="PENDING">Pending</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="ov-tier">Tier (optional)</Label>
              <Select
                id="ov-tier"
                data-testid="ov-tier"
                className="mt-1"
                value={ovForm.tier}
                onChange={e => setOvForm(f => ({ ...f, tier: e.target.value }))}
              >
                <option value="">No tier</option>
                <option value="STRONG">Strong</option>
                <option value="GOOD">Good</option>
                <option value="FAIR">Fair</option>
                <option value="WEAK">Weak</option>
                <option value="DECLINED">Declined</option>
              </Select>
            </div>
          </div>

          <div>
            <Label htmlFor="ov-amount">Max OTD Amount (cents) <span className="text-red-500">*</span></Label>
            <Input
              id="ov-amount"
              data-testid="ov-amount"
              type="number"
              min={1}
              className="mt-1"
              placeholder="3500000 = $35,000"
              value={ovForm.maxOtdAmountCents}
              onChange={e => setOvForm(f => ({ ...f, maxOtdAmountCents: e.target.value }))}
              required
            />
            {ovForm.maxOtdAmountCents && !isNaN(parseInt(ovForm.maxOtdAmountCents, 10)) && (
              <p className="text-xs text-slate-400 mt-0.5">
                = {fmtCents(parseInt(ovForm.maxOtdAmountCents, 10))}
              </p>
            )}
          </div>

          <label className="flex items-center gap-3 cursor-pointer" data-testid="ov-ofac-label">
            <input
              type="checkbox"
              data-testid="ov-ofac"
              className="h-4 w-4 accent-red-600"
              checked={ovForm.checkOfacAlert}
              onChange={e => setOvForm(f => ({ ...f, checkOfacAlert: e.target.checked }))}
            />
            <span className="text-sm text-slate-700">
              Flag OFAC alert — will set decision to OFAC_REVIEW regardless of selected decision
            </span>
          </label>

          <div>
            <Label htmlFor="ov-reason">Admin Reason Note <span className="text-red-500">*</span></Label>
            <Textarea
              id="ov-reason"
              data-testid="ov-reason"
              className="mt-1"
              placeholder="Explain the reason for this manual override…"
              value={ovForm.reason}
              onChange={e => setOvForm(f => ({ ...f, reason: e.target.value }))}
            />
          </div>

          <div className="flex gap-3 pt-2">
            <Button variant="outline" onClick={() => setState({ view: "panel" })} data-testid="override-cancel">
              Cancel
            </Button>
            <Button variant="secondary" onClick={submitOverride} data-testid="override-submit">
              Save Manual Override
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ── OVERRIDE RUNNING ───────────────────────────────────────────────────────
  if (state.view === "override_running") {
    return (
      <div className="mt-6 flex flex-col items-center py-12" data-testid="override-running">
        <Loader2 size={36} className="text-slate-500 animate-spin mb-4" />
        <p className="text-base font-semibold text-slate-900">Saving manual override…</p>
      </div>
    );
  }

  // ── OVERRIDE RESULT ────────────────────────────────────────────────────────
  if (state.view === "override_result") {
    const { result } = state;
    return (
      <div className="mt-6" data-testid="override-result-section">
        <h2 className="text-base font-bold text-slate-900 mb-4">Manual Override Saved</h2>

        <div className="bg-white border-2 border-slate-200 rounded-xl p-5 mb-4">
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle2 size={18} className="text-green-600" />
            <span className="text-sm font-semibold text-slate-900">Override applied successfully</span>
            <Badge variant="secondary" className="ml-auto">Admin Manual</Badge>
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            {[
              { label: "Decision",  value: result.prequal.decision },
              { label: "Tier",      value: result.prequal.tier ?? "—" },
              { label: "Max OTD",   value: fmtCents(result.prequal.maxOtdAmountCents) },
              { label: "Expires",   value: fmtDate(result.prequal.expiresAt) },
            ].map(f => (
              <div key={f.label}>
                <p className="text-xs text-slate-400">{f.label}</p>
                <p className="font-semibold text-slate-800">{f.value}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <Button
            variant="outline"
            onClick={async () => { await refreshPanelData(); setState({ view: "panel" }); }}
            data-testid="override-result-back"
          >
            Back to Prequalification Panel
          </Button>
          <Button variant="ghost" href={`/admin/buyers/${buyerId}`} data-testid="override-result-view-buyer">
            View Full Buyer Profile
          </Button>
        </div>
      </div>
    );
  }

  return null;
}
