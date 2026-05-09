import { requireAdmin } from "@/lib/auth/admin-session";
import {
  PARTNER_NAME,
  PARTNER_ID,
  PARTNER_REDIRECT_BASE,
  PARTNER_AFFILIATE_ID,
  EXCLUDED_STATES,
} from "@/lib/services/refinance/refinance-lead.service";
import { Handshake, ExternalLink } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function AdminRefinancePartnerPage() {
  await requireAdmin();

  return (
    <div className="p-6 md:p-10 max-w-3xl" data-testid="admin-refinance-partner-page">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#111827] tracking-tight flex items-center gap-2">
          <Handshake size={22} className="text-[#0B5FD1]" /> Partner Info
        </h1>
        <p className="text-sm text-[#4B5563] mt-1">
          The lender all qualified refinance leads are referred to.
        </p>
      </div>

      <section className="bg-white border border-[#E5E7EB] rounded-xl p-6 mb-4" data-testid="partner-identity">
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-y-3 text-sm">
          <div>
            <dt className="text-xs text-[#94A3B8]">Partner name</dt>
            <dd className="text-[#111827] font-medium">{PARTNER_NAME}</dd>
          </div>
          <div>
            <dt className="text-xs text-[#94A3B8]">Internal partner ID</dt>
            <dd className="text-[#111827] font-medium font-[family-name:var(--font-mono)]">{PARTNER_ID}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-xs text-[#94A3B8]">Referral base URL</dt>
            <dd className="text-[#111827] font-medium font-[family-name:var(--font-mono)] text-xs break-all" data-testid="partner-base-url">
              {PARTNER_REDIRECT_BASE}?aid={PARTNER_AFFILIATE_ID}&opt_1=
              <span className="text-[#94A3B8]">[leadId]</span>
            </dd>
          </div>
        </dl>
        <p className="text-xs text-[#4B5563] leading-relaxed mt-4">
          Each qualified lead is appended as the{" "}
          <code className="text-[#0B5FD1] font-[family-name:var(--font-mono)]">opt_1</code> subid, making every referral traceable back to the originating AutoLenis user.
        </p>
      </section>

      <section className="bg-white border border-[#E5E7EB] rounded-xl p-6 mb-4" data-testid="partner-process">
        <h2 className="text-xs font-bold uppercase tracking-wider text-[#4B5563] mb-3">How referrals flow</h2>
        <ol className="list-decimal list-inside space-y-1.5 text-sm text-[#4B5563]">
          <li>User completes the eligibility screening on /refinance/eligibility.</li>
          <li>If qualified, AutoLenis mints a unique leadId (CUID) and shows /refinance/confirm.</li>
          <li>User clicks &ldquo;Continue to Partner Application&rdquo; — the lead is marked REDIRECTED and the partner URL opens in a new tab.</li>
          <li>OpenRoad Lending handles all underwriting, credit decisions, and loan origination independently.</li>
        </ol>
      </section>

      <section className="bg-white border border-[#E5E7EB] rounded-xl p-6 mb-4" data-testid="partner-excluded-states">
        <h2 className="text-xs font-bold uppercase tracking-wider text-[#4B5563] mb-3">Non-lending states (Exhibit B)</h2>
        <div className="flex flex-wrap gap-1.5">
          {EXCLUDED_STATES.map((s) => (
            <span
              key={s}
              className="px-2.5 py-1 text-xs font-semibold bg-[#F8F9FB] border border-[#E5E7EB] text-[#4B5563] rounded-full"
            >
              {s}
            </span>
          ))}
        </div>
      </section>

      <a
        href="https://www.openroadlending.com/"
        target="_blank"
        rel="noopener noreferrer"
        data-testid="partner-site-link"
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#0B5FD1] hover:text-[#0A4DB8]"
      >
        Visit OpenRoad Lending <ExternalLink size={11} />
      </a>
    </div>
  );
}
