import type { Metadata } from "next";
import { buildPageMetadata, PAGE_METADATA } from "@/lib/seo/metadata";

export const metadata: Metadata = buildPageMetadata(PAGE_METADATA.prequalConsent);

// Exact FCRA consent text — must NEVER be paraphrased, shortened, or reworded.
// Mirrors microbilt.service.ts:FCRA_CONSENT_TEXT and the prequal page.
const FCRA_CONSENT_TEXT =
  'I understand that by clicking on the I AGREE button immediately following this notice, I am providing "written instructions" to AutoLenis under the Fair Credit Reporting Act authorizing AutoLenis to obtain information from my personal credit profile or other information from MicroBilt. I authorize AutoLenis to obtain such information solely to prequalify me for credit options. Credit Information accessed for my pre-qualification request may be different than the Credit Information accessed by a credit grantor on a date after the date of my original pre-qualification request to make the credit decision.';

export default function PrequalConsentPage() {
  return (
    <article className="max-w-3xl mx-auto px-6 py-20" data-testid="legal-prequal-consent-page">
      <p className="text-xs tracking-widest uppercase font-semibold text-[#0B5FD1] mb-4">Legal</p>
      <h1 className="text-3xl font-bold text-slate-900 mb-2">Prequalification Consent</h1>
      <p className="text-sm text-slate-400 mb-10">Last updated: January 1, 2026</p>

      {/* ── Exact FCRA consent text — displayed prominently at the top ───── */}
      <section
        className="mb-12 rounded-[12px] border border-[#0B5FD1]/20 p-6"
        style={{ backgroundColor: "#EFF6FF" }}
        data-testid="legal-prequal-consent-fcra-text"
      >
        <h2 className="text-base font-semibold text-slate-900 mb-3">
          FCRA Authorization (Verbatim Text)
        </h2>
        <p className="text-sm leading-relaxed text-slate-800 whitespace-pre-line">
          {FCRA_CONSENT_TEXT}
        </p>
      </section>

      <div className="prose prose-slate max-w-none space-y-6 text-slate-700 leading-relaxed text-sm">
        <p>
          By initiating the prequalification process on the AutoLenis platform, you agree to the
          following terms governing the collection, use, and handling of your credit and financial
          information.
        </p>
        <h2 className="text-lg font-semibold text-slate-900 mt-8">What is a Soft Pull?</h2>
        <p>
          A soft-pull inquiry <strong>does not affect your credit score</strong> and is not visible
          to lenders reviewing your credit report. It is used solely to estimate your buying power
          on the AutoLenis platform.
        </p>
        <h2 className="text-lg font-semibold text-slate-900 mt-8">Purpose of the Credit Check</h2>
        <p>
          The prequalification inquiry is conducted solely for the purpose of establishing your
          approved vehicle purchase budget band on the AutoLenis platform. This information is used
          only to facilitate vehicle search filtering and to communicate your pre-approved
          parameters to participating dealers in anonymous form.
        </p>
        <h2 className="text-lg font-semibold text-slate-900 mt-8">
          Identity Verification Billing (IBV)
        </h2>
        <p>
          As part of the prequalification process, AutoLenis may initiate an Identity Verification
          Billing check to confirm your identity. This check is also conducted as a soft inquiry
          and does not affect your credit score.
        </p>
        <h2 className="text-lg font-semibold text-slate-900 mt-8">Data Retention</h2>
        <p>
          Prequalification data and raw credit report responses are encrypted at rest using
          AES-256-GCM and retained for a period of 24 months or as required by applicable law,
          whichever is longer.
        </p>
        <h2 className="text-lg font-semibold text-slate-900 mt-8">OFAC Screening</h2>
        <p>
          AutoLenis performs OFAC (Office of Foreign Assets Control) screening as part of the
          prequalification process in compliance with applicable federal regulations.
        </p>
        <h2 className="text-lg font-semibold text-slate-900 mt-8">Adverse Action</h2>
        <p>
          If your prequalification is not approved, you will receive an adverse action notice as
          required by the FCRA. This notice will include the reasons for the decision and contact
          information for MicroBilt Corporation, the consumer reporting agency used.
        </p>
        <h2 className="text-lg font-semibold text-slate-900 mt-8">Questions</h2>
        <p>
          MicroBilt Corporation: 1-888-217-5866 &bull;{" "}
          <a
            href="https://www.microbilt.com"
            className="text-[#0B5FD1] hover:underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            www.microbilt.com
          </a>
        </p>
        <p>AutoLenis Privacy: privacy@autolenis.com</p>
      </div>
    </article>
  );
}
