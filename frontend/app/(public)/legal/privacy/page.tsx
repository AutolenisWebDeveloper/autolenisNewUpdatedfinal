import type { Metadata } from "next";
import Link from "next/link";
import { buildPageMetadata, PAGE_METADATA } from "@/lib/seo/metadata";

export const metadata: Metadata = buildPageMetadata(PAGE_METADATA.privacy);
export const revalidate = 86400;

export default function PrivacyPage() {
  return (
    <div data-testid="legal-privacy-page">
      {/* Hero */}
      <div className="bg-gradient-to-b from-[#F8F9FB] to-white pt-20 pb-10 px-6">
        <div className="max-w-3xl mx-auto">
          <span className="text-xs font-semibold uppercase tracking-[0.15em] text-[#0B5FD1]">
            Privacy Policy
          </span>
          <h1 className="text-3xl sm:text-4xl font-bold text-[#111827] tracking-tight mt-3 mb-2">
            Your Information Deserves Clear Protection.
          </h1>
          <p className="text-[#4B5563] text-sm">Last updated: January 1, 2026</p>
        </div>
      </div>

      {/* Sections */}
      <div className="max-w-3xl mx-auto px-6 pb-20 space-y-4 mt-6">
        <div className="bg-white border border-[#E5E7EB] rounded-2xl p-7 shadow-sm">
          <p className="text-sm text-[#4B5563] leading-relaxed">
            AutoLenis, Inc. (&quot;AutoLenis,&quot; &quot;we,&quot; &quot;our,&quot; &quot;us&quot;) is committed to
            protecting your privacy. This Privacy Policy explains how we collect,
            use, and disclose personal information when you use our platform.
          </p>
        </div>

        <div className="bg-white border border-[#E5E7EB] rounded-2xl p-7 shadow-sm">
          <h2 className="text-base font-bold text-[#111827] mb-3">
            1. Information We Collect
          </h2>
          <p className="text-sm text-[#4B5563] leading-relaxed">
            We collect information you provide directly (name, email, address,
            vehicle preferences, financial data), information from third-party
            services (prequalification data from MicroBilt), and usage data (page
            views, session data, interaction logs).
          </p>
        </div>

        <div className="bg-white border border-[#E5E7EB] rounded-2xl p-7 shadow-sm">
          <h2 className="text-base font-bold text-[#111827] mb-3">
            2. How We Use Your Information
          </h2>
          <p className="text-sm text-[#4B5563] leading-relaxed">
            We use your information to operate the platform, process transactions,
            communicate with you about your account and deals, match you with
            dealers, comply with legal obligations, and improve our services.
          </p>
        </div>

        <div className="bg-white border border-[#E5E7EB] rounded-2xl p-7 shadow-sm">
          <h2 className="text-base font-bold text-[#111827] mb-3">
            3. Data Security
          </h2>
          <p className="text-sm text-[#4B5563] leading-relaxed">
            Sensitive financial data including prequalification results are
            encrypted at rest using AES-256-GCM. We employ industry-standard
            security measures across all systems. Your identity is not revealed to
            dealers until you select a deal.
          </p>
        </div>

        <div className="bg-white border border-[#E5E7EB] rounded-2xl p-7 shadow-sm">
          <h2 className="text-base font-bold text-[#111827] mb-3">
            4. FCRA Compliance
          </h2>
          <p className="text-sm text-[#4B5563] leading-relaxed">
            Credit data accessed through MicroBilt for prequalification purposes
            is handled in strict accordance with the Fair Credit Reporting Act
            (FCRA). We use only soft-pull inquiries which do not affect your
            credit score.
          </p>
        </div>

        <div className="bg-white border border-[#E5E7EB] rounded-2xl p-7 shadow-sm">
          <h2 className="text-base font-bold text-[#111827] mb-3">
            5. Data Sharing
          </h2>
          <p className="text-sm text-[#4B5563] leading-relaxed">
            We do not sell your personal data. We share data only with dealers
            participating in your auction (after deal selection), service
            providers who assist our operations, and as required by law.
          </p>
        </div>

        <div className="bg-white border border-[#E5E7EB] rounded-2xl p-7 shadow-sm">
          <h2 className="text-base font-bold text-[#111827] mb-3">
            6. Your Rights
          </h2>
          <p className="text-sm text-[#4B5563] leading-relaxed">
            You have the right to access, correct, or delete your personal data.
            You may also request a copy of the data we hold about you. Contact us
            at privacy@autolenis.com.
          </p>
        </div>

        <div className="bg-white border border-[#E5E7EB] rounded-2xl p-7 shadow-sm">
          <h2 className="text-base font-bold text-[#111827] mb-3">7. Cookies</h2>
          <p className="text-sm text-[#4B5563] leading-relaxed">
            We use essential cookies for authentication and platform
            functionality, and optional analytics cookies. You may manage cookie
            preferences at any time. See our{" "}
            <a
              href="/legal/cookie-policy"
              className="text-[#0B5FD1] hover:underline"
            >
              Cookie Policy
            </a>
            .
          </p>
        </div>

        <div className="bg-white border border-[#E5E7EB] rounded-2xl p-7 shadow-sm">
          <h2 className="text-base font-bold text-[#111827] mb-3">8. Contact</h2>
          <p className="text-sm text-[#4B5563] leading-relaxed">
            Privacy inquiries: privacy@autolenis.com
          </p>
        </div>
      </div>

      {/* CTA */}
      <div className="max-w-3xl mx-auto px-6 pb-12 text-center">
        <p className="text-sm text-[#4B5563]">
          Questions about our privacy practices?{" "}
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

