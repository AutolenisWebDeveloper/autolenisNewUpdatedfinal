import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, MessageSquare, Car } from "lucide-react";
import RefinanceComplianceDisclosure from "@/components/public/RefinanceComplianceDisclosure";
import { buildPageMetadata, PAGE_METADATA } from "@/lib/seo/metadata";

export const metadata: Metadata = buildPageMetadata(PAGE_METADATA.refinanceIneligible);

export default function RefinanceIneligiblePage() {
  return (
    <div className="bg-white" data-testid="refinance-ineligible-page">
      <section className="pt-16 py-24 bg-gradient-to-b from-[#F8F9FB] to-white">
        <div className="mx-auto max-w-2xl px-6 text-center">
          <span className="text-xs font-bold uppercase tracking-[0.15em] text-[#0B5FD1]">
            Thanks for Checking
          </span>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-[#111827] mt-4 mb-4">
            We weren&rsquo;t able to connect you with our refinance partner based on the information provided.
          </h1>
          <p className="text-[#4B5563] text-base leading-relaxed">
            <strong className="text-[#111827]">This is not a credit decision and does not affect your credit score.</strong>
          </p>
        </div>
      </section>

      <section className="py-12">
        <div className="mx-auto max-w-3xl px-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Link
              href="/for-buyers"
              data-testid="ineligible-buyer-cta"
              className="group block bg-white border border-[#E5E7EB] rounded-xl p-6 hover:border-[#93C5FD] hover:shadow-sm transition-all"
            >
              <div className="w-10 h-10 rounded-lg bg-[#0B5FD1]/10 flex items-center justify-center mb-4">
                <Car size={18} className="text-[#0B5FD1]" />
              </div>
              <h3 className="text-sm font-bold text-[#111827] mb-1.5">Start Your Car-Buying Journey</h3>
              <p className="text-xs text-[#4B5563] leading-relaxed mb-4">
                Skip the dealership. Let verified dealers compete for your business in a private 48-hour reverse auction.
              </p>
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#0B5FD1] group-hover:text-[#0A4DB8]">
                Explore buyer flow <ArrowRight size={13} />
              </span>
            </Link>

            <Link
              href="/contact"
              data-testid="ineligible-contact-cta"
              className="group block bg-white border border-[#E5E7EB] rounded-xl p-6 hover:border-[#93C5FD] hover:shadow-sm transition-all"
            >
              <div className="w-10 h-10 rounded-lg bg-[#53C8E7]/15 flex items-center justify-center mb-4">
                <MessageSquare size={18} className="text-[#0A6A8A]" />
              </div>
              <h3 className="text-sm font-bold text-[#111827] mb-1.5">Contact Us</h3>
              <p className="text-xs text-[#4B5563] leading-relaxed mb-4">
                Have questions about AutoLenis or how we work with partners like OpenRoad Lending? We&rsquo;re here to help.
              </p>
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#0B5FD1] group-hover:text-[#0A4DB8]">
                Send a message <ArrowRight size={13} />
              </span>
            </Link>
          </div>

          <div className="mt-8">
            <RefinanceComplianceDisclosure />
          </div>
        </div>
      </section>
    </div>
  );
}
