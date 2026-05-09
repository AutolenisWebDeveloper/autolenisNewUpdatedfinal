// /admin/requests/[requestId] — System 4C admin case management
// Tabs: Research Log | Due Diligence | Offer Creation (gated) | Buyer Updates | Status

import { requireAdmin } from "@/lib/auth/admin-session";
import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { ClipboardList, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import { parseRequestNotes } from "@/lib/services/vehicle-request/notes-parser";
import AdminOfferComposer from "@/components/admin/AdminOfferComposer";
import CompleteCheckpointButton from "@/components/admin/CompleteCheckpointButton";
import AdminRequestActionButtons from "@/components/admin/AdminRequestActionButtons";
import {
  paymentMethodLabel,
  preApprovalStatusLabel,
  purchaseTimeframeLabel,
} from "@/lib/services/vehicle-request/car-request-financing.service";

interface Props { params: Promise<{ requestId: string }> }
export const dynamic = "force-dynamic";

const ADMIN_BADGE_STYLES: Record<string, string> = {
  NEEDS_PREQUAL:          "bg-slate-100 text-slate-600",
  OUTSIDE_APPROVAL:       "bg-blue-100 text-blue-700",
  CASH_BUYER:             "bg-green-100 text-green-700",
  LEASE_PROSPECT:         "bg-purple-100 text-purple-700",
  FINANCING_OPPORTUNITY:  "bg-amber-100 text-amber-700",
};

export default async function AdminRequestDetailPage({ params }: Props) {
  const { requestId } = await params;
  await requireAdmin();

  const req = await prisma.vehicleRequest.findUnique({
    where: { id: requestId },
    include: {
      buyer: true,
      financing: true,
      researchLogs: { orderBy: { createdAt: "desc" } },
      checkpoints: { orderBy: { order: "asc" } },
      offers: { orderBy: { createdAt: "desc" } },
      buyerUpdates: { orderBy: { createdAt: "desc" } },
      events: { orderBy: { createdAt: "desc" }, take: 20 },
    },
  });
  if (!req) notFound();

  const allCheckpointsDone = req.checkpoints.length > 0 && req.checkpoints.every(c => c.completed);
  const canSendOffer = allCheckpointsDone && req.status === "ACTIVE_SOURCING";
  const { text: notesText, meta } = parseRequestNotes(req.notes);

  const fin = req.financing;

  // Approval expiry warning (within 14 days)
  let expiryDaysLeft: number | null = null;
  if (fin?.approvalExpiresAt) {
    const msLeft = new Date(fin.approvalExpiresAt).getTime() - Date.now();
    expiryDaysLeft = Math.ceil(msLeft / (1000 * 60 * 60 * 24));
  }
  const showExpiryWarning = expiryDaysLeft !== null && expiryDaysLeft <= 14;

  return (
    <div className="p-6 md:p-8 max-w-4xl" data-testid="admin-request-detail-page">
      <div className="flex items-center gap-3 mb-2">
        <ClipboardList size={20} className="text-[#0B5FD1]" />
        <h1 className="text-xl font-bold text-slate-900">Request #{requestId.slice(-8)}</h1>
        <Badge variant="secondary">{req.status}</Badge>
        {fin?.adminBadge && (
          <span
            data-testid="admin-badge-detail"
            className={`text-xs font-semibold px-2.5 py-1 rounded-full ${ADMIN_BADGE_STYLES[fin.adminBadge] ?? "bg-slate-100 text-slate-600"}`}
          >
            {fin.adminBadge.replace(/_/g, " ")}
          </span>
        )}
        {fin?.leadQualityScore != null && (
          <span className="text-xs font-mono text-slate-500" data-testid="lead-score-detail">
            Score: {fin.leadQualityScore}/100
          </span>
        )}
      </div>
      <p className="text-sm text-slate-500 mb-6">Buyer: {req.buyer.firstName} {req.buyer.lastName} · {req.createdAt.toLocaleDateString()}</p>

      {/* Approval expiry warning */}
      {showExpiryWarning && expiryDaysLeft !== null && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-800" data-testid="expiry-warning">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <p className="text-sm font-medium">
            {expiryDaysLeft <= 0
              ? "Pre-approval has expired."
              : `Approval expires in ${expiryDaysLeft} day${expiryDaysLeft === 1 ? "" : "s"} — act promptly.`}
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-8">
        <div className="space-y-6">
          {/* Vehicle request */}
          <div className="bg-white border border-slate-200 rounded-xl p-5" data-testid="request-vehicle-info">
            <p className="font-semibold text-slate-800 text-sm mb-3">Vehicle Request</p>
            <dl className="space-y-2 text-sm">
              {[
                { label: "Make", value: req.makePreference ?? "Any" },
                { label: "Model", value: req.modelPreference ?? "Any" },
                { label: "Vehicle type", value: meta?.vehicleType ?? "—" },
                { label: "Condition", value: meta?.condition ?? "—" },
                { label: "Timeline", value: meta?.timeline ?? "—" },
                { label: "ZIP", value: meta?.zip ?? "—" },
                { label: "Year range", value: req.yearMin ? `${req.yearMin}–${req.yearMax ?? "present"}` : "Any" },
                { label: "Max budget", value: req.maxBudgetCents ? `$${(req.maxBudgetCents / 100).toLocaleString()}` : "Not specified" },
                { label: "Down payment", value: meta?.downPaymentCents ? `$${(meta.downPaymentCents / 100).toLocaleString()}` : "—" },
                { label: "Monthly target", value: meta?.monthlyTargetCents ? `$${(meta.monthlyTargetCents / 100).toLocaleString()}` : "—" },
                { label: "Trim", value: meta?.trim ?? "—" },
                { label: "Max mileage", value: meta?.maxMileage ? `${meta.maxMileage.toLocaleString()} mi` : "—" },
              ].map(f => (
                <div key={f.label} className="flex justify-between">
                  <dt className="text-slate-400">{f.label}</dt>
                  <dd className="font-medium text-slate-800">{f.value}</dd>
                </div>
              ))}
            </dl>
            {meta?.features && meta.features.length > 0 && (
              <div className="mt-3 border-t border-slate-100 pt-3">
                <p className="text-slate-400 text-xs mb-1.5">Must-have features</p>
                <div className="flex flex-wrap gap-1.5">
                  {meta.features.map(f => (
                    <span key={f} className="rounded-full bg-[#F8F9FB] border border-[#E5E7EB] px-2 py-0.5 text-xs text-[#0B5FD1]">{f}</span>
                  ))}
                </div>
              </div>
            )}
            {notesText && <p className="text-xs text-slate-500 mt-3 border-t border-slate-100 pt-3 whitespace-pre-line">{notesText}</p>}
          </div>

          {/* Financing section — admin-only, full detail */}
          <div className="bg-white border border-slate-200 rounded-xl p-5" data-testid="admin-financing-section">
            <p className="font-semibold text-slate-800 text-sm mb-3">Financing &amp; Prequalification</p>
            {!fin ? (
              <p className="text-sm text-slate-400">No financing info provided by buyer.</p>
            ) : (
              <>
                {fin.preApprovalStatus === "WANTS_HELP" && (
                  <div className="mb-4 flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 p-3 text-amber-800" data-testid="wants-financing-help-banner">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                    <div>
                      <p className="text-sm font-semibold">Buyer wants financing help</p>
                      <p className="text-xs mt-0.5">Route this buyer to the prequal flow manually.</p>
                    </div>
                  </div>
                )}
                <dl className="space-y-2 text-sm">
                  {[
                    { label: "Payment method", value: paymentMethodLabel(fin.paymentMethod) },
                    { label: "Pre-approval status", value: preApprovalStatusLabel(fin.preApprovalStatus) },
                    { label: "Lender name", value: fin.lenderName ?? "—" },
                    { label: "Approved amount", value: fin.approvedAmountCents != null ? `$${(fin.approvedAmountCents / 100).toLocaleString()}` : "—" },
                    { label: "APR", value: fin.quotedApr != null ? `${Number(fin.quotedApr).toFixed(2)}%` : "—" },
                    { label: "Approval expires", value: fin.approvalExpiresAt ? new Date(fin.approvalExpiresAt).toLocaleDateString() : "—" },
                    { label: "Down payment", value: fin.downPaymentCents != null ? `$${(fin.downPaymentCents / 100).toLocaleString()}` : "—" },
                    { label: "Monthly payment target", value: fin.monthlyPaymentTargetCents != null ? `$${(fin.monthlyPaymentTargetCents / 100).toLocaleString()}` : "—" },
                    { label: "Credit range", value: fin.estimatedCreditRange ?? "—" },
                    { label: "Annual income", value: fin.estimatedAnnualIncomeCents != null ? `$${(fin.estimatedAnnualIncomeCents / 100).toLocaleString()}` : "—" },
                    { label: "Proof of funds", value: fin.proofOfFundsAvailable == null ? "—" : fin.proofOfFundsAvailable ? "Yes" : "No" },
                    { label: "Max budget (cash)", value: fin.maxBudgetCents != null ? `$${(fin.maxBudgetCents / 100).toLocaleString()}` : "—" },
                    { label: "Lease term", value: fin.leaseTermMonths != null ? `${fin.leaseTermMonths} months` : "—" },
                    { label: "Lease miles/year", value: fin.leaseMilesPerYear != null ? fin.leaseMilesPerYear.toLocaleString() : "—" },
                    { label: "Trade-in", value: fin.tradeIn == null ? "—" : fin.tradeIn ? "Yes" : "No" },
                    { label: "Purchase timeframe", value: purchaseTimeframeLabel(fin.purchaseTimeframe) },
                    { label: "Lead quality score", value: fin.leadQualityScore != null ? `${fin.leadQualityScore}/100` : "—" },
                  ].map(f => (
                    <div key={f.label} className="flex justify-between">
                      <dt className="text-slate-400">{f.label}</dt>
                      <dd className="font-medium text-slate-800">{f.value}</dd>
                    </div>
                  ))}
                </dl>
                {fin.preApprovalLetterUrl && (
                  <div className="mt-3 border-t border-slate-100 pt-3">
                    <a href={fin.preApprovalLetterUrl} target="_blank" rel="noopener noreferrer"
                      className="text-xs text-[#0B5FD1] hover:underline" data-testid="pre-approval-letter-link">
                      View pre-approval letter →
                    </a>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Due diligence checkpoints — gate enforcement */}
          <div className="bg-white border border-slate-200 rounded-xl p-5" data-testid="due-diligence-checkpoints">
            <p className="font-semibold text-slate-800 text-sm mb-3">Due Diligence Checkpoints</p>
            {req.checkpoints.length === 0 ? (
              <p className="text-sm text-slate-400">No checkpoints defined</p>
            ) : (
              <div className="space-y-2">
                {req.checkpoints.map(cp => (
                  <div key={cp.id} data-testid={`checkpoint-${cp.id}`}
                    className={`flex items-center gap-3 p-3 rounded-lg ${cp.completed ? "bg-green-50" : "bg-slate-50"}`}>
                    {cp.completed ? <CheckCircle2 size={15} className="text-green-500" /> : <XCircle size={15} className="text-slate-300" />}
                    <span className="text-sm text-slate-700">{cp.name}</span>
                    {cp.completed
                      ? <span className="text-xs text-slate-400 ml-auto">{cp.completedAt?.toLocaleDateString()}</span>
                      : <span className="ml-auto"><CompleteCheckpointButton requestId={req.id} checkpointId={cp.id} /></span>}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Offer creation — GATED until all checkpoints complete */}
          <div className="bg-white border border-slate-200 rounded-xl p-5" data-testid="offer-creation-section">
            <p className="font-semibold text-slate-800 text-sm mb-2">Offer Creation</p>
            {!allCheckpointsDone ? (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-700" data-testid="offer-gate-warning">
                Complete all due diligence checkpoints before sending an offer. This gate is enforced server-side.
              </div>
            ) : req.offers.length > 0 ? (
              <div>
                <p className="text-sm text-slate-600 mb-2">{req.offers.length} offer{req.offers.length !== 1 ? "s" : ""} created</p>
                {req.offers.map(o => (
                  <div key={o.id} className="flex items-center justify-between bg-slate-50 rounded-lg p-3 text-sm" data-testid={`offer-item-${o.id}`}>
                    <span className="font-medium">${(o.priceCents / 100).toLocaleString()}</span>
                    <Badge variant="secondary" className="text-xs">{o.status}</Badge>
                  </div>
                ))}
              </div>
            ) : (
              <AdminOfferComposer
                requestId={req.id}
                defaultMake={req.makePreference ?? ""}
                defaultModel={req.modelPreference ?? ""}
                defaultPriceCents={req.maxBudgetCents ?? 2500000}
                disabled={!canSendOffer}
              />
            )}
          </div>
        </div>

        {/* Right: Research logs + events */}
        <div className="space-y-6">
          {/* Research logs */}
          <div className="bg-white border border-slate-200 rounded-xl p-5" data-testid="research-logs">
            <p className="font-semibold text-slate-800 text-sm mb-3">Research Log ({req.researchLogs.length})</p>
            {req.researchLogs.length === 0 ? (
              <p className="text-sm text-slate-400">No research entries yet</p>
            ) : (
              <div className="space-y-2 max-h-40 overflow-y-auto">
                {req.researchLogs.map(l => (
                  <div key={l.id} className="text-xs text-slate-600 bg-slate-50 rounded-lg p-2" data-testid={`research-log-${l.id}`}>
                    {l.notes} {l.sourceUrl && <a href={l.sourceUrl} target="_blank" className="text-[#0B5FD1] hover:underline">→ Source</a>}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Audit trail */}
          <div className="bg-white border border-slate-200 rounded-xl p-5" data-testid="audit-trail">
            <p className="font-semibold text-slate-800 text-sm mb-3">Audit Trail</p>
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {req.events.map(e => (
                <div key={e.id} className="text-xs text-slate-500 flex items-center justify-between" data-testid={`event-${e.id}`}>
                  <span className="font-medium text-slate-700">{e.eventType}</span>
                  <span>{e.createdAt.toLocaleDateString()}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Admin actions */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-2" data-testid="admin-actions">
            <p className="font-semibold text-slate-800 text-sm mb-2">Actions</p>
            <AdminRequestActionButtons requestId={req.id} status={req.status} />
          </div>
        </div>
      </div>
    </div>
  );
}
