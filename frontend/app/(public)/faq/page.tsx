import type { Metadata } from "next";
import Link from "next/link";
import { buildPageMetadata, PAGE_METADATA } from "@/lib/seo/metadata";
import FaithVerseModule from "@/components/public/FaithVerseModule";
import FaqAccordionClient from "@/components/public/FaqAccordionClient";

export const metadata: Metadata = buildPageMetadata(PAGE_METADATA.faq);
export const dynamic = "force-dynamic";
export const revalidate = 86400;

export default function FAQPage() {
  return (
    <div data-testid="faq-page">
      {/* Hero */}
      <section className="bg-gradient-to-b from-[#F8F9FB] to-white pt-20 pb-10 px-6 text-center">
        <div className="mx-auto max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.15em] text-[#0B5FD1] mb-3">
            FAQ
          </p>
          <h1 className="text-3xl sm:text-4xl font-bold text-[#111827] tracking-tight mb-3">
            Answers Before You Start.
          </h1>
          <p className="text-[#4B5563] text-sm max-w-lg mx-auto">
            Clear answers about how AutoLenis works, what you pay, how dealer
            competition works, and what to expect.
          </p>
        </div>
      </section>

      {/* Accordion */}
      <section className="py-10 bg-white">
        <FaqAccordionClient />
      </section>

      {/* Faith Verse */}
      <div className="mx-auto max-w-2xl px-6 py-8">
        <FaithVerseModule pageKey="faq" />
      </div>

      {/* Final CTA */}
      <section className="bg-[#0B5FD1] py-16 mt-12">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <h2 className="text-2xl font-bold text-white mb-2">
            Still Have Questions?
          </h2>
          <p className="text-white/80 text-sm mb-6">
            Our team can help you understand the process and choose the right
            next step.
          </p>
          <div className="flex flex-wrap gap-3 justify-center">
            <Link
              href="/contact"
              className="inline-flex items-center gap-2 px-6 py-3 bg-white text-[#0B5FD1] font-semibold text-sm rounded-md hover:bg-[#EFF6FF] transition-colors"
            >
              Contact AutoLenis →
            </Link>
            <Link
              href="/auth/signup"
              className="inline-flex items-center gap-2 px-6 py-3 border border-white/30 text-white font-semibold text-sm rounded-md hover:bg-white/10 transition-colors"
            >
              Get Prequalified
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}

