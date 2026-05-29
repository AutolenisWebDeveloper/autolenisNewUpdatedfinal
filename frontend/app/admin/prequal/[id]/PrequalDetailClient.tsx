"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  ShieldAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PrequalDetailData {
  id: string;
  buyer: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string | null;
  };
  decision: string;
  tier: string | null;
  maxOtdAmountCents: number;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  isExternal: boolean;
  hasRawResponse: boolean;
  checkOfacAlert: boolean;
  rawResponseSnippet: { length: number; preview: string } | null;
  canViewRawResponse: boolean;
  risk: {
    creditScore: number | null;
    idvScore: number | null;
    mlaCovered: boolean;
    fraudWarning: string | null;
    deceasedFlag: boolean;
    bankruptcyFlag: boolean;
    adverseReasonCodes: string[];
  };
  financial: {
    housingStatus: string | null;
    monthlyHousingPaymentCents: number | null;
    monthlyOtherDebtCents: number | null;
    effectiveIncomeCents: number | null;
    monthlyIncomeCents: number | null;
    frontEndDtiBps: number | null;
    backEndDtiBps: number | null;
    benchmarkAprBps: number | null;
  };
  employment: {
    employmentStatus: string | null;
    employerName: string | null;
    lengthOfEmployment: string | null;
    monthlyIncomeCents: number | null;
  };
  consent: {
    acceptedAt: string;
    userAgent: string | null;
    ipAddress: string | null;
    termsVersion: string | null;
    consentText: string;
  } | null;
  complianceEvents: Array<{ id: string; eventType: string; createdAt: string }>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

type PrequalSource = "INTERNAL" | "EXTERNAL" | "OVERRIDE";

function getPrequalSource(p: Pick<PrequalDetailData, "isExternal" | "hasRawResponse">): PrequalSource {
  if (p.isExternal) return "EXTERNAL";
  if (p.hasRawResponse) return "INTERNAL";
  return "OVERRIDE";
}

function fmtCents(cents: number | null) {
  if (cents == null) return "—";
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 0 })}`;
}
function fmtBps(bps: number | null) {
  if (bps == null) return "—";
  return `${(bps / 100).toFixed(2)}%`;
}
function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
function fmtDateTime(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
function daysFromNow(iso: string) {
  const days = Math.ceil((new Date(iso).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  return days;
}

function creditScoreBand(score: number | null): string {
  if (score == null) return "—";
  if (score >= 720) return "Strong";
  if (score >= 660) return "Good";
  if (score >= 600) return "Fair";
  return "Weak";
}
function idvScoreBand(score: number | null): string {
  if (score == null) return "—";
  if (score >= 900) return "Low Risk";
  if (score >= 700) return "Moderate Risk";
  return "Elevated Risk";
}

function SourceBadge({ source }: { source: PrequalSource }) {
  const map: Record<PrequalSource, { label: string; cls: string }> = {
    INTERNAL: { label: "INTERNAL PREQUAL", cls: "bg-blue-50 text-blue-700 border-blue-200" },
    EXTERNAL: { label: "EXTERNAL PREQUAL", cls: "bg-amber-50 text-amber-700 border-amber-200" },
    OVERRIDE: { label: "MANUAL OVERRIDE", cls: "bg-purple-50 text-purple-700 border-purple-200" },
  };
  const { label, cls } = map[source];
  return (
    <span
      className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold border ${cls}`}
      data-testid="prequal-source-badge"
    >
      {label}
    </span>
  );
}

function DecisionBadge({ decision }: { decision: string }) {
  const map: Record<string, string> = {
    APPROVED: "bg-emerald-50 text-emerald-700 border-emerald-200",
    DECLINED: "bg-red-50 text-red-700 border-red-200",
    PENDING: "bg-slate-50 text-slate-600 border-slate-200",
    MANUAL_REVIEW: "bg-amber-50 text-amber-700 border-amber-200",
    OFAC_REVIEW: "bg-red-50 text-red-700 border-red-200",
    OFAC_ESCALATED: "bg-red-50 text-red-700 border-red-200",
  };
  const cls = map[decision] ?? "bg-slate-50 text-slate-700 border-slate-200";
  return (
    <span
      className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold border ${cls}`}
      data-testid="prequal-decision-badge"
    >
      {decision.replace(/_/g, " ")}
    </span>
  );
}

function Card({ title, children, testId }: { title: string; children: React.ReactNode; testId?: string }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5" data-testid={testId}>
      <h2 className="text-sm font-semibold text-slate-800 mb-4">{title}</h2>
      <div className="space-y-0">{children}</div>
    </div>
  );
}

function Row({ label, value, alert = false }: { label: string; value: React.ReactNode; alert?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-slate-100 last:border-0">
      <span className="text-xs text-slate-500">{label}</span>
      <span className={`text-sm font-medium text-right ${alert ? "text-red-700" : "text-slate-800"}`}>{value}</span>
    </div>
  );
}

// ─── Action panel ─────────────────────────────────────────────────────────────

type ActionType = "APPROVE" | "DECLINE" | "OVERRIDE";

function ActionPanel({
  data,
  onSuccess,
}: {
  data: PrequalDetailData;
  onSuccess: (msg: string) => void;
}) {
  const [action, setAction] = useState<ActionType | null>(null);
  const [reason, setReason] = useState("");
  const [overrideAmount, setOverrideAmount] = useState("");
  const [overrideTier, setOverrideTier] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<ActionType | null>(null);

  const router = useRouter();

  function reset() {
    setAction(null);
    setReason("");
    setOverrideAmount("");
    setOverrideTier("");
    setError(null);
    setConfirming(null);
  }

  function openConfirm(a: ActionType) {
    setError(null);
    if (!reason.trim()) {
      setError("Reason is required before submitting a manual decision.");
      return;
    }
    if (a === "OVERRIDE") {
      const cents = Math.round(Number(overrideAmount) * 100);
      if (!Number.isFinite(cents) || cents < 800000 || cents > 8500000) {
        setError("Override amount must be between $8,000 and $85,000.");
        return;
      }
      if (!overrideTier) {
        setError("Override requires a tier.");
        return;
      }
    }
    setConfirming(a);
  }

  async function submit(a: ActionType) {
    setSubmitting(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { action: a, reason: reason.trim() };
      if (a === "OVERRIDE") {
        body.maxOtdAmountCents = Math.round(Number(overrideAmount) * 100);
        body.tier = overrideTier;
      }
      const res = await fetch(`/api/admin/prequal/${data.id}/decide`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json?.error?.message ?? "Failed to update prequal.");
      }
      onSuccess(
        a === "APPROVE" ? "Prequal approved" : a === "DECLINE" ? "Prequal declined" : "Prequal overridden",
      );
      reset();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update prequal.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl p-5" data-testid="prequal-action-panel">
      <div className="flex items-center gap-2 mb-3">
        <ShieldAlert size={16} className="text-amber-700" />
        <h2 className="text-sm font-semibold text-amber-900">Manual Decision Required</h2>
      </div>
      <p className="text-xs text-amber-800 mb-4">
        This prequal is in <strong>{data.decision.replace(/_/g, " ")}</strong>. Choose an action below — every action
        creates a permanent audit log entry and notifies the buyer via email.
      </p>

      <label className="block text-xs font-semibold text-slate-700 mb-1" htmlFor="prequal-reason">
        Reason (required, stored in audit log)
      </label>
      <textarea
        id="prequal-reason"
        data-testid="prequal-reason-input"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={2000}
        rows={3}
        placeholder="e.g. 'Reviewed bank statements — income verified, OFAC re-checked clear.'"
        className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 bg-white mb-4"
      />

      {action === "OVERRIDE" && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1" htmlFor="prequal-override-amount">
              Max OTD Amount (USD, 8,000–85,000)
            </label>
            <input
              id="prequal-override-amount"
              data-testid="prequal-override-amount"
              type="number"
              min={8000}
              max={85000}
              step={100}
              value={overrideAmount}
              onChange={(e) => setOverrideAmount(e.target.value)}
              placeholder="e.g. 25000"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 bg-white"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1" htmlFor="prequal-override-tier">
              Tier
            </label>
            <select
              id="prequal-override-tier"
              data-testid="prequal-override-tier"
              value={overrideTier}
              onChange={(e) => setOverrideTier(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-amber-500 bg-white"
            >
              <option value="">Select tier…</option>
              <option value="STRONG">STRONG</option>
              <option value="GOOD">GOOD</option>
              <option value="FAIR">FAIR</option>
              <option value="WEAK">WEAK</option>
            </select>
          </div>
        </div>
      )}

      {error && (
        <div className="mb-3 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 flex items-center gap-2">
          <AlertTriangle size={13} />
          {error}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          variant="green"
          size="sm"
          data-testid="prequal-approve-btn"
          disabled={submitting}
          onClick={() => {
            setAction("APPROVE");
            openConfirm("APPROVE");
          }}
        >
          <CheckCircle2 size={14} />
          Approve
        </Button>
        <Button
          variant="destructive"
          size="sm"
          data-testid="prequal-decline-btn"
          disabled={submitting}
          onClick={() => {
            setAction("DECLINE");
            openConfirm("DECLINE");
          }}
        >
          <XCircle size={14} />
          Decline
        </Button>
        <Button
          variant="default"
          size="sm"
          data-testid="prequal-override-btn"
          disabled={submitting}
          onClick={() => {
            if (action !== "OVERRIDE") {
              setAction("OVERRIDE");
              setError(null);
              return;
            }
            openConfirm("OVERRIDE");
          }}
        >
          {action === "OVERRIDE" ? "Submit Override" : "Override with Custom Amount"}
        </Button>
      </div>

      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" role="dialog">
          <div
            className="bg-white rounded-xl border border-slate-200 max-w-md w-full p-5"
            data-testid="prequal-confirm-modal"
          >
            <h3 className="text-sm font-bold text-slate-900 mb-3">
              {confirming === "APPROVE"
                ? "Approve this prequal?"
                : confirming === "DECLINE"
                  ? "Decline this prequal?"
                  : "Override with custom amount?"}
            </h3>
            <ul className="text-xs text-slate-600 space-y-1 mb-4 list-disc list-inside">
              <li>
                Set decision to <strong>{confirming === "DECLINE" ? "DECLINED" : "APPROVED"}</strong>
              </li>
              <li>Notify the buyer via email</li>
              <li>Create a permanent audit log entry</li>
              <li>This cannot be undone via this UI.</li>
            </ul>
            <div className="flex gap-2 justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirming(null)}
                disabled={submitting}
                data-testid="prequal-confirm-cancel"
              >
                Cancel
              </Button>
              <Button
                variant={confirming === "DECLINE" ? "destructive" : "default"}
                size="sm"
                onClick={() => submit(confirming)}
                disabled={submitting}
                data-testid="prequal-confirm-submit"
              >
                {submitting ? <Loader2 size={13} className="animate-spin" /> : "Confirm"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Root component ──────────────────────────────────────────────────────────

export default function PrequalDetailClient({ data }: { data: PrequalDetailData }) {
  const source = useMemo(() => getPrequalSource(data), [data]);
  const [rawOpen, setRawOpen] = useState(false);
  const [consentOpen, setConsentOpen] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  const showActionPanel = ["MANUAL_REVIEW", "OFAC_REVIEW", "OFAC_ESCALATED", "PENDING"].includes(data.decision);
  const expiresIn = daysFromNow(data.expiresAt);
  const fullName = `${data.buyer.firstName} ${data.buyer.lastName}`.trim();

  function showToast(msg: string) {
    setToast({ msg, type: "success" });
    window.setTimeout(() => setToast(null), 4000);
  }

  return (
    <div className="p-6 md:p-8 max-w-6xl" data-testid="admin-prequal-detail-page">
      {/* Header */}
      <div className="mb-6">
        <Link
          href="/admin/prequal"
          className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 mb-3"
          data-testid="prequal-back-link"
        >
          <ArrowLeft size={12} />
          Back to prequalifications
        </Link>
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-slate-900">
              <Link
                href={`/admin/buyers/${data.buyer.id}`}
                className="hover:underline"
                data-testid="prequal-buyer-link"
              >
                {fullName || "Unnamed Buyer"}
              </Link>
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">{data.buyer.email}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SourceBadge source={source} />
            <DecisionBadge decision={data.decision} />
            {data.checkOfacAlert && (
              <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold border bg-red-50 text-red-700 border-red-200">
                OFAC FLAG
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-1 mt-3 text-[11px] text-slate-500">
          <span>Created: <span className="text-slate-700">{fmtDateTime(data.createdAt)}</span></span>
          <span>Updated: <span className="text-slate-700">{fmtDateTime(data.updatedAt)}</span></span>
          <span>Expires: <span className="text-slate-700">{fmtDate(data.expiresAt)}</span></span>
        </div>
      </div>

      {/* Decision summary */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mb-6">
        <div className="bg-white border border-slate-200 rounded-xl p-4" data-testid="prequal-summary-decision">
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1">Decision</p>
          <p className="text-lg font-bold text-slate-900">{data.decision.replace(/_/g, " ")}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4" data-testid="prequal-summary-budget">
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1">Max OTD Budget</p>
          <p className="text-lg font-bold text-emerald-700">{fmtCents(data.maxOtdAmountCents)}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4" data-testid="prequal-summary-tier">
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1">Tier</p>
          <p className="text-lg font-bold text-slate-900">{data.tier ?? "—"}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4" data-testid="prequal-summary-expires">
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1">Expires</p>
          <p className="text-sm font-bold text-slate-900">{fmtDate(data.expiresAt)}</p>
          <p className="text-[11px] text-slate-500 mt-0.5">
            {expiresIn > 0 ? `${expiresIn} days remaining` : "Expired"}
          </p>
        </div>
      </div>

      {/* Action panel */}
      {showActionPanel && (
        <div className="mb-6">
          <ActionPanel data={data} onSuccess={showToast} />
        </div>
      )}

      {/* Cards grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        {source === "INTERNAL" && (
          <Card title="iPredict Risk Detail" testId="prequal-risk-card">
            <Row
              label="Credit Score"
              value={
                data.risk.creditScore != null
                  ? `${data.risk.creditScore} · ${creditScoreBand(data.risk.creditScore)}`
                  : "—"
              }
            />
            <Row
              label="IDV Score"
              value={
                data.risk.idvScore != null
                  ? `${data.risk.idvScore} · ${idvScoreBand(data.risk.idvScore)}`
                  : "—"
              }
            />
            <Row label="MLA Status" value={data.risk.mlaCovered ? "Covered" : "Not Covered"} alert={data.risk.mlaCovered} />
            <Row label="Fraud Warning" value={data.risk.fraudWarning ?? "None"} alert={!!data.risk.fraudWarning} />
            <Row label="Deceased Flag" value={data.risk.deceasedFlag ? "Yes" : "No"} alert={data.risk.deceasedFlag} />
            <Row label="Bankruptcy Flag" value={data.risk.bankruptcyFlag ? "Yes" : "No"} alert={data.risk.bankruptcyFlag} />
            <Row
              label="Adverse Reason Codes"
              value={data.risk.adverseReasonCodes.length > 0 ? data.risk.adverseReasonCodes.join(", ") : "—"}
              alert={data.risk.adverseReasonCodes.length > 0}
            />
          </Card>
        )}

        <Card title="Financial Detail" testId="prequal-financial-card">
          <Row label="Housing Status" value={data.financial.housingStatus ?? "—"} />
          <Row label="Monthly Housing Payment" value={fmtCents(data.financial.monthlyHousingPaymentCents)} />
          <Row label="Monthly Other Debt" value={fmtCents(data.financial.monthlyOtherDebtCents)} />
          <Row label="Effective Income" value={fmtCents(data.financial.effectiveIncomeCents)} />
          <Row
            label="Total Monthly Obligations"
            value={fmtCents(
              (data.financial.monthlyHousingPaymentCents ?? 0) + (data.financial.monthlyOtherDebtCents ?? 0) || null,
            )}
          />
          <Row label="Front-end DTI" value={fmtBps(data.financial.frontEndDtiBps)} />
          <Row label="Back-end DTI" value={fmtBps(data.financial.backEndDtiBps)} />
          <Row label="Benchmark APR" value={fmtBps(data.financial.benchmarkAprBps)} />
        </Card>

        <Card title="Employment Detail" testId="prequal-employment-card">
          <Row label="Employment Status" value={data.employment.employmentStatus ?? "—"} />
          <Row label="Employer Name" value={data.employment.employerName ?? "—"} />
          <Row label="Length of Employment" value={data.employment.lengthOfEmployment ?? "—"} />
          <Row label="Monthly Income (raw)" value={fmtCents(data.employment.monthlyIncomeCents)} />
        </Card>

        <Card title="Consent Audit" testId="prequal-consent-card">
          {data.consent ? (
            <>
              <Row label="Accepted At" value={fmtDateTime(data.consent.acceptedAt)} />
              <Row label="Source" value={consentSourceLabel(data.consent.userAgent)} />
              <Row label="IP Address" value={data.consent.ipAddress ?? "—"} />
              <Row label="User Agent" value={data.consent.userAgent ?? "—"} />
              <Row label="Terms Version" value={data.consent.termsVersion ?? "—"} />
              <button
                type="button"
                onClick={() => setConsentOpen((v) => !v)}
                className="flex items-center gap-1 text-xs font-semibold text-[#0B5FD1] hover:underline mt-3"
                data-testid="prequal-consent-toggle"
              >
                {consentOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                {consentOpen ? "Hide" : "Show"} full consent text
              </button>
              {consentOpen && (
                <pre className="mt-2 px-3 py-2 bg-slate-50 border border-slate-100 rounded-lg text-[11px] text-slate-700 whitespace-pre-wrap break-words max-h-64 overflow-y-auto">
                  {data.consent.consentText}
                </pre>
              )}
            </>
          ) : (
            <p className="text-xs text-slate-500 py-2">No consent record found for this prequal.</p>
          )}
        </Card>
      </div>

      {/* Encrypted raw response */}
      {data.hasRawResponse && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 mb-6">
          <button
            type="button"
            onClick={() => setRawOpen((v) => !v)}
            className="flex items-center justify-between w-full"
            data-testid="prequal-raw-toggle"
            disabled={!data.canViewRawResponse}
          >
            <span className="text-sm font-semibold text-slate-800">
              View Raw iPredict Response (encrypted)
            </span>
            <span className="flex items-center gap-1 text-xs text-slate-500">
              {!data.canViewRawResponse ? "SUPER_ADMIN only" : null}
              {rawOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </span>
          </button>
          {rawOpen && data.canViewRawResponse && data.rawResponseSnippet && (
            <div className="mt-3 px-3 py-2 bg-slate-50 border border-slate-100 rounded-lg">
              <p className="text-[11px] text-slate-500 mb-1">
                Encrypted blob ({data.rawResponseSnippet.length.toLocaleString()} chars). Preview only — first 100 chars:
              </p>
              <pre className="text-[11px] font-mono text-slate-700 whitespace-pre-wrap break-all">
                {data.rawResponseSnippet.preview}
                {data.rawResponseSnippet.length > 100 ? "…" : ""}
              </pre>
              <p className="text-[10px] text-slate-400 mt-2">
                Full decryption requires server-side access via the data export tool.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Activity feed */}
      {data.complianceEvents.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-slate-800 mb-3">Compliance Activity</h2>
          <ul className="divide-y divide-slate-100">
            {data.complianceEvents.map((e) => (
              <li key={e.id} className="flex items-center justify-between py-2">
                <span className="text-xs font-medium text-slate-700">{e.eventType.replace(/_/g, " ")}</span>
                <span className="text-[11px] text-slate-500">{fmtDateTime(e.createdAt)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {toast && (
        <div
          className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-xl text-sm shadow-xl font-medium flex items-center gap-2 max-w-sm ${
            toast.type === "success" ? "bg-green-600 text-white" : "bg-red-600 text-white"
          }`}
          data-testid="prequal-toast"
        >
          {toast.type === "success" ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
          <span>{toast.msg}</span>
        </div>
      )}
    </div>
  );
}

function consentSourceLabel(userAgent: string | null): string {
  if (!userAgent) return "—";
  if (userAgent.startsWith("admin_recorded_")) {
    return `Admin-recorded · ${userAgent.replace(/^admin_recorded_/, "").replace(/_/g, " ")}`;
  }
  if (userAgent.startsWith("admin_ipredict_run:")) {
    return `Admin-initiated · ${userAgent.split(":")[1] ?? ""}`;
  }
  if (userAgent.length > 60) return "Buyer self-serve";
  return userAgent;
}
