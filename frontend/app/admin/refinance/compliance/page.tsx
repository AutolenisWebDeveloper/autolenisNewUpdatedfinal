import { requireAdmin } from "@/lib/auth/admin-session";
import { CheckCircle2, XCircle, ShieldCheck } from "lucide-react";

export const dynamic = "force-dynamic";

const DO_NOT = [
  "Display or imply a rate, APR, or monthly payment savings",
  "Use the word \"approved\" in relation to AutoLenis making any determination",
  "Embed or frame the OpenRoad Lending application",
  "Retain or process any credit report data ourselves",
  "Expose an approve/reject action on the admin leads view",
];

const DO = [
  "Capture explicit consent and timestamp on every eligibility submission",
  "Store a SHA-256 IP hash for audit without persisting raw IP",
  "Open the partner application in a new tab with rel=\"noopener noreferrer\"",
  "Record every redirect event against the originating lead ID",
  "Log every refinance touchpoint to refinance_compliance_logs",
];

export default async function AdminRefinanceCompliancePage() {
  await requireAdmin();
  return (
    <div className="p-6 md:p-10 max-w-3xl" data-testid="admin-refinance-compliance-page">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#111827] tracking-tight flex items-center gap-2">
          <ShieldCheck size={22} className="text-[#0B5FD1]" /> Compliance Notes
        </h1>
        <p className="text-sm text-[#4B5563] mt-1">
          How AutoLenis handles refinance lead referrals. Static reference for operations and audit.
        </p>
      </div>

      <section className="bg-white border border-[#E5E7EB] rounded-xl p-6 mb-4" data-testid="compliance-role">
        <h2 className="text-xs font-bold uppercase tracking-wider text-[#4B5563] mb-3">Our role</h2>
        <p className="text-sm text-[#4B5563] leading-relaxed">
          AutoLenis is a marketing platform and lead provider. We do not offer, arrange, or negotiate loans. We do not make credit decisions. All refinance applications are processed directly by OpenRoad Lending, an independent lender. Approval, rates, terms, and loan decisions are made solely by OpenRoad Lending and are subject to their underwriting criteria. AutoLenis is not responsible for any lending outcomes.
        </p>
      </section>

      <section className="bg-white border border-[#E5E7EB] rounded-xl p-6 mb-4" data-testid="compliance-dos">
        <h2 className="text-xs font-bold uppercase tracking-wider text-[#4B5563] mb-3">What the system does</h2>
        <ul className="space-y-2">
          {DO.map((x) => (
            <li key={x} className="flex items-start gap-2.5 text-sm text-[#4B5563]">
              <CheckCircle2 size={15} className="text-[#50D14E] mt-0.5 shrink-0" />
              <span>{x}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="bg-white border border-[#E5E7EB] rounded-xl p-6 mb-4" data-testid="compliance-donts">
        <h2 className="text-xs font-bold uppercase tracking-wider text-[#4B5563] mb-3">What the system will never do</h2>
        <ul className="space-y-2">
          {DO_NOT.map((x) => (
            <li key={x} className="flex items-start gap-2.5 text-sm text-[#4B5563]">
              <XCircle size={15} className="text-red-500 mt-0.5 shrink-0" />
              <span>{x}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="bg-white border border-[#E5E7EB] rounded-xl p-6" data-testid="compliance-states">
        <h2 className="text-xs font-bold uppercase tracking-wider text-[#4B5563] mb-3">Non-lending states (Exhibit B)</h2>
        <p className="text-sm text-[#4B5563] leading-relaxed mb-3">
          The OpenRoad Lending refinance program is not available to residents of the following states. The eligibility form blocks submissions from these states at both the UI and API layers.
        </p>
        <div className="flex flex-wrap gap-1.5">
          {["Alaska", "Hawaii", "Montana", "Nevada", "New Hampshire", "North Dakota", "Wisconsin"].map((s) => (
            <span key={s} className="px-2.5 py-1 text-xs font-semibold bg-[#F8F9FB] border border-[#E5E7EB] text-[#4B5563] rounded-full">
              {s}
            </span>
          ))}
        </div>
      </section>
    </div>
  );
}
