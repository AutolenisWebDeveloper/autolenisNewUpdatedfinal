import type { Metadata } from "next";
import Link from "next/link";
import { buildPageMetadata, PAGE_METADATA } from "@/lib/seo/metadata";

export const metadata: Metadata = buildPageMetadata(PAGE_METADATA.dataDeletion);

export default function DataDeletionPage() {
  return (
    <div data-testid="legal-data-deletion-page">
      {/* Hero */}
      <div className="bg-gradient-to-b from-[#F8F9FB] to-white pt-20 pb-10 px-6">
        <div className="max-w-3xl mx-auto">
          <span className="text-xs font-semibold uppercase tracking-[0.15em] text-[#0B5FD1]">
            Data Deletion Policy
          </span>
          <h1 className="text-3xl sm:text-4xl font-bold text-[#111827] tracking-tight mt-3 mb-2">
            Data Deletion Policy
          </h1>
          <p className="text-[#4B5563] text-sm">Last updated: {"{{DATE}}"}</p>
        </div>
      </div>

      {/* Sections */}
      <div className="max-w-3xl mx-auto px-6 pb-20 space-y-4 mt-6">
        <div className="bg-white border border-[#E5E7EB] rounded-2xl p-7 shadow-sm">
          <p className="text-sm text-[#4B5563] leading-relaxed">
            AutoLenis respects your right to control your personal information,
            including the right to request deletion of the data we hold about
            you. This page explains what you can request and how.
          </p>
        </div>

        <div className="bg-white border border-[#E5E7EB] rounded-2xl p-7 shadow-sm">
          <h2 className="text-base font-bold text-[#111827] mb-3">
            What this covers
          </h2>
          <p className="text-sm text-[#4B5563] leading-relaxed">
            This policy applies to personal data associated with your AutoLenis
            account (buyer, dealer, or affiliate) and to data we obtain through
            services you connect to AutoLenis, including any Facebook Page or
            Instagram account you link.
          </p>
        </div>

        <div className="bg-white border border-[#E5E7EB] rounded-2xl p-7 shadow-sm">
          <h2 className="text-base font-bold text-[#111827] mb-3">
            How to request deletion
          </h2>
          <p className="text-sm text-[#4B5563] leading-relaxed mb-3">
            <strong>In your account:</strong> if account deletion is available in
            Settings, go to Settings → Account → Delete Account.{" "}
            {"{{CONFIRM: remove this bullet if in-app deletion is not yet built}}"}
          </p>
          <p className="text-sm text-[#4B5563] leading-relaxed">
            <strong>By email:</strong> send a request to privacy@autolenis.com
            from the email address on your account, with the subject &quot;Data
            Deletion Request,&quot; and include your full name and the email
            associated with your account. We may need to verify your identity
            before processing the request.
          </p>
        </div>

        <div className="bg-white border border-[#E5E7EB] rounded-2xl p-7 shadow-sm">
          <h2 className="text-base font-bold text-[#111827] mb-3">
            Data connected through Facebook or Instagram
          </h2>
          <p className="text-sm text-[#4B5563] leading-relaxed">
            If you connected a Facebook Page or Instagram account to AutoLenis,
            you can disconnect it at any time in your AutoLenis settings, and you
            can remove AutoLenis from your Facebook account under Settings →
            Business Integrations (or Apps and Websites). To request deletion of
            any data AutoLenis obtained through Meta, use the email process above.
          </p>
        </div>

        <div className="bg-white border border-[#E5E7EB] rounded-2xl p-7 shadow-sm">
          <h2 className="text-base font-bold text-[#111827] mb-3">Timing</h2>
          <p className="text-sm text-[#4B5563] leading-relaxed">
            We will acknowledge your request within {"{{5 business days}}"} and
            complete deletion within {"{{30 days}}"}, or within the period
            required by applicable law.
          </p>
        </div>

        <div className="bg-white border border-[#E5E7EB] rounded-2xl p-7 shadow-sm">
          <h2 className="text-base font-bold text-[#111827] mb-3">
            What we delete and what we may retain
          </h2>
          <p className="text-sm text-[#4B5563] leading-relaxed">
            We delete the personal data associated with your account. We may
            retain limited records where retention is required by law or
            necessary for legitimate business purposes — for example, transaction
            and payment records, executed contracts and electronic-signature
            audit logs, and fraud-prevention and compliance records — for the
            period required by applicable law or regulation. Retained records are
            limited to what is necessary and are protected accordingly.
          </p>
        </div>

        <div className="bg-white border border-[#E5E7EB] rounded-2xl p-7 shadow-sm">
          <h2 className="text-base font-bold text-[#111827] mb-3">
            Third-party processors
          </h2>
          <p className="text-sm text-[#4B5563] leading-relaxed">
            Where applicable, we instruct the service providers that process data
            on our behalf (such as payment, email, and hosting providers) to
            delete relevant data in accordance with our agreements, subject to
            their own legal retention obligations.
          </p>
        </div>

        <div className="bg-white border border-[#E5E7EB] rounded-2xl p-7 shadow-sm">
          <h2 className="text-base font-bold text-[#111827] mb-3">Contact</h2>
          <p className="text-sm text-[#4B5563] leading-relaxed">
            Questions about this policy or your request: privacy@autolenis.com.
            See also our{" "}
            <a href="/legal/privacy" className="text-[#0B5FD1] hover:underline">
              Privacy Policy
            </a>{" "}
            at /legal/privacy.
          </p>
        </div>
      </div>

      {/* CTA */}
      <div className="max-w-3xl mx-auto px-6 pb-12 text-center">
        <p className="text-sm text-[#4B5563]">
          Questions about data deletion?{" "}
          <Link
            href="/contact"
            className="text-[#0B5FD1] font-semibold hover:underline"
          >
            Contact AutoLenis →
          </Link>
        </p>
      </div>
    </div>
  );
}
