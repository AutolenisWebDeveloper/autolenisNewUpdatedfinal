import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { JsonLd, articleSchema, faqSchema } from "@/lib/seo/jsonld";
import { getRelatedPillars, getPrimaryClusterForPillar } from "@/lib/seo/pillar-links";
import ContentTracker from "@/components/analytics/ContentTracker";
import ProgrammaticGuideLinks from "@/components/content/ProgrammaticGuideLinks";

// Heading for the down-link block, by cluster.
const CLUSTER_DOWNLINK_HEADING: Record<string, string> = {
  dealer_quotes: "Dealer quote guides by city",
  otd_price: "Out-the-door price guides by city",
  dealer_fees: "Dealer fee guides by city",
  trade_in: "Trade-in guides by city",
  leasing: "Lease deal guides by city",
};

export interface PillarFaq {
  question: string;
  answer: string;
}

interface PillarArticleProps {
  slug: string;
  title: string;
  description: string;
  /** Short label above the H1, e.g. "Buying Guide". */
  eyebrow?: string;
  /** Intro paragraph(s) — rendered directly under the H1. */
  intro: ReactNode;
  /** The H2 sections of the article. */
  children: ReactNode;
  faqs: PillarFaq[];
  /** ISO date the page was published. */
  datePublished?: string;
}

/**
 * Phase C0 — shared layout for the six cornerstone pillar pages. Handles the
 * Article + FAQPage JSON-LD, the named-author byline, the above-fold and
 * mid/bottom CTAs, the FAQ block, the related-pillar internal links, and the
 * ContentTracker analytics mount. National scope — no city-specific framing.
 */
export default function PillarArticle({
  slug,
  title,
  description,
  eyebrow = "Buying Guide",
  intro,
  children,
  faqs,
  datePublished = "2024-01-01",
}: PillarArticleProps) {
  const related = getRelatedPillars(slug);
  const downlinkCluster = getPrimaryClusterForPillar(slug);

  return (
    <>
      <JsonLd
        id={`pillar-article-${slug}`}
        data={articleSchema({
          headline: title,
          description,
          slug,
          datePublished,
        })}
      />
      <JsonLd id={`pillar-faq-${slug}`} data={faqSchema(faqs)} />
      <ContentTracker articleSlug={slug} cluster="pillar" city="" state="" />

      <article
        className="mx-auto max-w-3xl px-6 md:px-8 pt-28 pb-20 md:pt-36"
        data-testid={`pillar-page-${slug}`}
      >
        {/* Header + byline */}
        <header className="mb-10">
          <p className="text-xs tracking-widest uppercase font-semibold text-[#0B5FD1] mb-4">
            {eyebrow}
          </p>
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-[#111827] tracking-tight leading-[1.1] mb-6">
            {title}
          </h1>
          <div className="text-sm text-[#6B7280]">
            Written by{" "}
            <Link href="/author/markist" className="text-[#0B5FD1] font-medium hover:underline">
              Markist, Founder of AutoLenis
            </Link>
          </div>
        </header>

        {/* Intro */}
        <div className="text-lg text-[#374151] leading-relaxed space-y-5 mb-8">
          {intro}
        </div>

        {/* Above-fold CTA */}
        <div className="mb-12 rounded-2xl border border-[#DBEAFE] bg-[#F0F7FF] px-6 py-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <p className="text-sm font-medium text-[#1E3A8A]">
            Skip the negotiation — let 8 local dealers compete for your business.
          </p>
          <Link
            href="/for-buyers"
            data-testid="pillar-cta-above-fold"
            className="inline-flex shrink-0 items-center gap-2 px-6 py-3 bg-[#0B5FD1] text-white font-semibold text-sm rounded-xl hover:bg-[#0A4DB8] transition-colors"
          >
            Start your auction
            <ArrowRight size={16} />
          </Link>
        </div>

        {/* Body sections */}
        <div className="pillar-body space-y-10 text-[#374151] leading-relaxed [&_h2]:text-2xl [&_h2]:font-bold [&_h2]:text-[#111827] [&_h2]:tracking-tight [&_h2]:mb-4 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:text-[#111827] [&_h3]:mb-2 [&_h3]:mt-6 [&_p]:mb-4 [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:space-y-2 [&_ul]:mb-4 [&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:space-y-2 [&_ol]:mb-4 [&_a]:text-[#0B5FD1] [&_a]:font-medium hover:[&_a]:underline [&_strong]:text-[#111827]">
          {children}
        </div>

        {/* Mid/bottom CTA */}
        <div className="mt-14 rounded-2xl bg-[#0B5FD1] px-8 py-10 text-center">
          <p className="text-xl font-bold text-white mb-3">
            Get competing offers without the hassle
          </p>
          <p className="text-white/80 mb-6 max-w-lg mx-auto">
            AutoLenis runs a private 48-hour auction where 8 local dealers compete for
            your business. You compare every offer and pick the winner. Works in every
            US market.
          </p>
          <Link
            href="/for-buyers"
            data-testid="pillar-cta-bottom"
            className="inline-flex items-center gap-2 px-8 py-4 bg-white text-[#0B5FD1] font-semibold text-sm rounded-xl hover:bg-[#F3F4F6] transition-colors"
          >
            See how it works
            <ArrowRight size={16} />
          </Link>
        </div>

        {/* FAQ */}
        <section className="mt-16" data-testid="pillar-faq">
          <h2 className="text-2xl font-bold text-[#111827] tracking-tight mb-6">
            Frequently Asked Questions
          </h2>
          <div className="divide-y divide-[#E5E7EB] border-t border-[#E5E7EB]">
            {faqs.map((f) => (
              <div key={f.question} className="py-5">
                <h3 className="text-base font-semibold text-[#111827] mb-2">
                  {f.question}
                </h3>
                <p className="text-[#4B5563] leading-relaxed">{f.answer}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Related pillars — internal linking */}
        <section className="mt-16" data-testid="pillar-related">
          <h2 className="text-xl font-bold text-[#111827] tracking-tight mb-5">
            Keep reading
          </h2>
          <ul className="grid sm:grid-cols-2 gap-4">
            {related.map((p) => (
              <li key={p.slug}>
                <Link
                  href={p.url}
                  className="block rounded-xl border border-[#E5E7EB] bg-white p-5 hover:border-[#0B5FD1] hover:shadow-sm transition-all"
                >
                  <span className="text-sm font-semibold text-[#111827]">{p.title}</span>
                  <span className="mt-1 flex items-center gap-1 text-xs text-[#0B5FD1]">
                    Read guide <ArrowRight size={12} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        {/* Down-links to programmatic, city-level guides for this topic */}
        {downlinkCluster && (
          <ProgrammaticGuideLinks
            heading={CLUSTER_DOWNLINK_HEADING[downlinkCluster] ?? "Guides by city"}
            cluster={downlinkCluster}
            limit={6}
            testId="pillar-programmatic-links"
          />
        )}
      </article>
    </>
  );
}
