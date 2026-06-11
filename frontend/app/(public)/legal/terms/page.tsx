import type { Metadata } from "next";
import Link from "next/link";
import { buildPageMetadata, PAGE_METADATA } from "@/lib/seo/metadata";
import { PRICING_COPY } from "@/lib/seo/pricing-copy";

export const metadata: Metadata = buildPageMetadata(PAGE_METADATA.terms);
export const dynamic = "force-dynamic";
export const revalidate = 86400;

export default function TermsPage() {
  return (
    <div data-testid="legal-terms-page">
      {/* Hero */}
      <div className="bg-gradient-to-b from-[#F8F9FB] to-white pt-20 pb-10 px-6">
        <div className="max-w-3xl mx-auto">
          <span className="text-xs font-semibold uppercase tracking-[0.15em] text-[#0B5FD1]">
            Terms of Service
          </span>
          <h1 className="text-3xl sm:text-4xl font-bold text-[#111827] tracking-tight mt-3 mb-2">
            Clear Terms for a Smarter Buying Platform.
          </h1>
          <p className="text-[#4B5563] text-sm">
            These terms explain the rules, responsibilities, and limitations that
            apply when using AutoLenis.
          </p>
          <p className="text-[#94A3B8] text-sm mt-1">
            Last updated: January 1, 2026
          </p>
        </div>
      </div>

      {/* Sections */}
      <div className="max-w-3xl mx-auto px-6 pb-20 space-y-4 mt-6">
        <div className="bg-white border border-[#E5E7EB] rounded-2xl p-7 shadow-sm">
          <p className="text-sm text-[#4B5563] leading-relaxed">
            These Terms of Service (&quot;Terms&quot;) govern your use of the AutoLenis
            platform, website, and services (collectively, &quot;Services&quot;). By
            creating an account or using any part of the Services, you agree to be
            bound by these Terms.
          </p>
        </div>

        <div className="bg-white border border-[#E5E7EB] rounded-2xl p-7 shadow-sm">
          <h2 className="text-base font-bold text-[#111827] mb-3">
            1. Platform Description
          </h2>
          <p className="text-sm text-[#4B5563] leading-relaxed">
            AutoLenis is a technology platform that facilitates reverse-auction
            vehicle purchasing. AutoLenis is not a dealer, broker, lender,
            insurer, or party to any vehicle sale transaction. All vehicle
            transactions occur between buyers and licensed dealers.
          </p>
        </div>

        <div className="bg-white border border-[#E5E7EB] rounded-2xl p-7 shadow-sm">
          <h2 className="text-base font-bold text-[#111827] mb-3">
            2. Eligibility
          </h2>
          <p className="text-sm text-[#4B5563] leading-relaxed">
            You must be at least 18 years of age and legally capable of entering
            binding contracts under applicable law. By using the Services you
            represent and warrant that you meet these requirements.
          </p>
        </div>

        <div className="bg-white border border-[#E5E7EB] rounded-2xl p-7 shadow-sm">
          <h2 className="text-base font-bold text-[#111827] mb-3">
            3. Auction Access Fee and Premium Fee Policy
          </h2>
          <p className="text-sm text-[#4B5563] leading-relaxed">
            {PRICING_COPY.whatItIs} {PRICING_COPY.refundLong} {PRICING_COPY.depositConditional} All
            payments are processed via Stripe.
          </p>
        </div>

        <div className="bg-white border border-[#E5E7EB] rounded-2xl p-7 shadow-sm">
          <h2 className="text-base font-bold text-[#111827] mb-3">
            4. Dealer Independence
          </h2>
          <p className="text-sm text-[#4B5563] leading-relaxed">
            Dealers on the AutoLenis platform are independent third parties.
            AutoLenis does not guarantee dealer performance, vehicle condition, or
            deal completion. AutoLenis facilitates the auction process only.
          </p>
        </div>

        <div className="bg-white border border-[#E5E7EB] rounded-2xl p-7 shadow-sm">
          <h2 className="text-base font-bold text-[#111827] mb-3">
            5. Intellectual Property
          </h2>
          <p className="text-sm text-[#4B5563] leading-relaxed">
            All content, design, software, and materials on the AutoLenis
            platform are the property of AutoLenis, Inc. and protected by
            applicable intellectual property laws.
          </p>
        </div>

        <div className="bg-white border border-[#E5E7EB] rounded-2xl p-7 shadow-sm">
          <h2 className="text-base font-bold text-[#111827] mb-3">
            6. Limitation of Liability
          </h2>
          <p className="text-sm text-[#4B5563] leading-relaxed">
            AutoLenis&apos;s liability to any user for any cause is limited to the
            fees paid by that user in the 12 months preceding the claim. AutoLenis
            is not liable for indirect, incidental, special, or consequential
            damages.
          </p>
        </div>

        <div className="bg-white border border-[#E5E7EB] rounded-2xl p-7 shadow-sm">
          <h2 className="text-base font-bold text-[#111827] mb-3">
            7. Governing Law
          </h2>
          <p className="text-sm text-[#4B5563] leading-relaxed">
            These Terms are governed by the laws of the State of Delaware. Any
            disputes shall be resolved through binding arbitration.
          </p>
        </div>

        <div className="bg-white border border-[#E5E7EB] rounded-2xl p-7 shadow-sm">
          <h2 className="text-base font-bold text-[#111827] mb-3">
            8. Changes to Terms
          </h2>
          <p className="text-sm text-[#4B5563] leading-relaxed">
            AutoLenis may update these Terms at any time. Continued use of the
            Services after changes constitutes acceptance of the updated Terms.
          </p>
        </div>

        <div className="bg-white border border-[#E5E7EB] rounded-2xl p-7 shadow-sm">
          <h2 className="text-base font-bold text-[#111827] mb-3">
            9. SMS Terms and Conditions
          </h2>
          <p className="text-sm text-[#4B5563] leading-relaxed mb-3">
            By providing your mobile phone number and opting in to receive text
            messages from AutoLenis, you consent to receive conversational,
            transactional, and informational SMS communications related to your use
            of AutoLenis services.
          </p>
          <p className="text-sm text-[#4B5563] leading-relaxed mb-3">
            Message types may include vehicle request updates, dealer offer
            notifications, financing updates, appointment reminders, customer support
            communications, account notifications, and verification messages.
          </p>
          <p className="text-sm text-[#4B5563] leading-relaxed mb-3">
            Message frequency varies. Message and data rates may apply.
          </p>
          <p className="text-sm text-[#4B5563] leading-relaxed mb-3">
            You may opt out at any time by replying <strong>STOP</strong> to any
            message. For assistance, reply <strong>HELP</strong> or contact support
            at{" "}
            <a
              href="mailto:support@autolenis.com"
              className="text-[#0B5FD1] hover:underline"
            >
              support@autolenis.com
            </a>.
          </p>
          <p className="text-sm text-[#4B5563] leading-relaxed">
            Consent to receive SMS messages is not a condition of purchasing any
            product or service.
          </p>
        </div>

        <div className="bg-white border border-[#E5E7EB] rounded-2xl p-7 shadow-sm">
          <h2 className="text-base font-bold text-[#111827] mb-3">10. Contact</h2>
          <p className="text-sm text-[#4B5563] leading-relaxed">
            Questions about these Terms should be directed to
            legal@autolenis.com.
          </p>
        </div>
      </div>

      {/* CTA */}
      <div className="max-w-3xl mx-auto px-6 pb-12 text-center">
        <p className="text-sm text-[#4B5563]">
          Questions about these terms?{" "}
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

