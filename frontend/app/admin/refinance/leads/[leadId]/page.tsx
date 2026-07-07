import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/admin-session";
import { getLeadByLeadId, buildPartnerRedirectUrl } from "@/lib/services/refinance/refinance-lead.service";
import { ArrowLeft, Clock, Fingerprint } from "lucide-react";

export const dynamic = "force-dynamic";

function fmt(v: Date | string | null | undefined) {
  if (!v) return "—";
  const d = typeof v === "string" ? new Date(v) : v;
  return d.toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

const STATUS_BADGE: Record<string, string> = {
  SUBMITTED: "bg-[#E5E7EB] text-[#4B5563] border-[#DBEAFE]",
  QUALIFIED: "bg-[#50D14E]/15 text-[#1A6B18] border-[#50D14E]/30",
  INELIGIBLE: "bg-amber-50 text-amber-900 border-amber-200",
  REDIRECTED: "bg-[#53C8E7]/15 text-[#0A6A8A] border-[#53C8E7]/40",
  EXCLUDED_STATE: "bg-red-50 text-red-800 border-red-200",
};

export default async function AdminLeadDetailPage({
  params,
}: {
  params: Promise<{ leadId: string }>;
}) {
  await requireAdmin();
  const { leadId } = await params;
  const lead = await getLeadByLeadId(leadId);
  if (!lead) notFound();

  return (
    <div className="p-6 md:p-10 max-w-4xl" data-testid="admin-lead-detail-page">
      <Link
        href="/admin/refinance/leads"
        className="inline-flex items-center gap-1 text-xs font-semibold text-al-primary hover:text-al-primary-hover mb-4"
        data-testid="lead-detail-back"
      >
        <ArrowLeft size={12} /> Back to leads
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#111827] tracking-tight">
            {lead.firstName} {lead.lastName}
          </h1>
          <p className="text-xs text-[#94A3B8] mt-1 font-[family-name:var(--font-mono)]">
            Lead ID: <span className="text-[#4B5563]" data-testid="lead-detail-leadid">{lead.leadId}</span>
          </p>
        </div>
        <span
          data-testid="lead-detail-status"
          className={`inline-block text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border ${STATUS_BADGE[lead.status] ?? ""}`}
        >
          {lead.status.replace("_", " ")}
        </span>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6 text-xs text-amber-900 leading-relaxed">
        Read-only record. AutoLenis does not make credit decisions on refinance leads. All underwriting and lending decisions belong solely to OpenRoad Lending.
      </div>

      <section className="bg-white border border-[#E5E7EB] rounded-xl p-6 mb-4" data-testid="lead-detail-contact">
        <h2 className="text-xs font-bold uppercase tracking-wider text-[#4B5563] mb-4">Contact</h2>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-y-3 text-sm">
          <div><dt className="text-xs text-[#94A3B8]">Email</dt><dd className="text-[#111827] font-medium">{lead.email}</dd></div>
          <div><dt className="text-xs text-[#94A3B8]">Phone</dt><dd className="text-[#111827] font-medium">{lead.phone}</dd></div>
          <div><dt className="text-xs text-[#94A3B8]">State</dt><dd className="text-[#111827] font-medium">{lead.state}</dd></div>
          <div><dt className="text-xs text-[#94A3B8]">Employment</dt><dd className="text-[#111827] font-medium">{lead.employmentStatus.replace(/_/g, " ")}</dd></div>
        </dl>
      </section>

      <section className="bg-white border border-[#E5E7EB] rounded-xl p-6 mb-4" data-testid="lead-detail-loan">
        <h2 className="text-xs font-bold uppercase tracking-wider text-[#4B5563] mb-4">Loan snapshot (user-reported)</h2>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-y-3 text-sm">
          <div><dt className="text-xs text-[#94A3B8]">Vehicle year</dt><dd className="text-[#111827] font-medium">{lead.vehicleYear}</dd></div>
          <div><dt className="text-xs text-[#94A3B8]">Interest rate band</dt><dd className="text-[#111827] font-medium">{lead.interestRateBand.replace(/_/g, " ")}</dd></div>
          <div><dt className="text-xs text-[#94A3B8]">Loan balance</dt><dd className="text-[#111827] font-medium font-[family-name:var(--font-mono)]">${(lead.loanBalanceCents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</dd></div>
          <div><dt className="text-xs text-[#94A3B8]">Monthly payment</dt><dd className="text-[#111827] font-medium font-[family-name:var(--font-mono)]">${(lead.monthlyPaymentCents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</dd></div>
        </dl>
      </section>

      <section className="bg-white border border-[#E5E7EB] rounded-xl p-6 mb-4" data-testid="lead-detail-audit">
        <h2 className="text-xs font-bold uppercase tracking-wider text-[#4B5563] mb-4 flex items-center gap-1.5">
          <Fingerprint size={13} /> Compliance audit
        </h2>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-y-3 text-sm">
          <div><dt className="text-xs text-[#94A3B8]">Consent given</dt><dd className="text-[#111827] font-medium">{lead.consentGiven ? "Yes" : "No"}</dd></div>
          <div><dt className="text-xs text-[#94A3B8]">Consent timestamp</dt><dd className="text-[#111827] font-medium">{fmt(lead.consentTimestamp)}</dd></div>
          <div><dt className="text-xs text-[#94A3B8]">IP hash (SHA-256)</dt><dd className="text-[#111827] font-medium text-xs font-[family-name:var(--font-mono)] break-all">{lead.ipHash ?? "—"}</dd></div>
          <div><dt className="text-xs text-[#94A3B8]">Source</dt><dd className="text-[#111827] font-medium">{lead.source ?? "—"}</dd></div>
        </dl>
      </section>

      <section className="bg-white border border-[#E5E7EB] rounded-xl p-6 mb-4" data-testid="lead-detail-lifecycle">
        <h2 className="text-xs font-bold uppercase tracking-wider text-[#4B5563] mb-4 flex items-center gap-1.5">
          <Clock size={13} /> Lifecycle
        </h2>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-y-3 text-sm">
          <div><dt className="text-xs text-[#94A3B8]">Submitted</dt><dd className="text-[#111827] font-medium">{fmt(lead.createdAt)}</dd></div>
          <div><dt className="text-xs text-[#94A3B8]">Redirected</dt><dd className="text-[#111827] font-medium">{fmt(lead.redirectedAt)}</dd></div>
        </dl>
        {lead.status === "QUALIFIED" && (
          <p className="mt-4 text-xs text-[#94A3B8] break-all">
            Partner redirect URL:{" "}
            <code className="text-[#4B5563]" data-testid="lead-detail-redirect-url">
              {buildPartnerRedirectUrl(lead.leadId)}
            </code>
          </p>
        )}
      </section>

      {lead.complianceLogs.length > 0 && (
        <section className="bg-white border border-[#E5E7EB] rounded-xl p-6" data-testid="lead-detail-compliance-logs">
          <h2 className="text-xs font-bold uppercase tracking-wider text-[#4B5563] mb-4">Compliance log entries</h2>
          <ul className="space-y-2">
            {lead.complianceLogs.map((log) => (
              <li key={log.id} className="text-xs text-[#4B5563] border-b border-al-primary-subtle last:border-0 pb-2 last:pb-0">
                <span className="font-semibold text-[#111827]">{fmt(log.consentTimestamp)}</span>
                {" — "}TCPA: {log.tcpaConsent ? "Yes" : "No"}
                {log.source ? `, source: ${log.source}` : ""}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
