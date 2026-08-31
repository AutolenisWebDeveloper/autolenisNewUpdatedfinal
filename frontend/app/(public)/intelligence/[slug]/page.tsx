import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { prisma } from "@/lib/prisma";
import {
  SERVABLE_LIFECYCLE_STATUSES,
  isPastWithholdBound,
  oldestApplicableDataAsOf,
} from "@/lib/amips/tiers";
import { buildPageMetadata } from "@/lib/seo/metadata";
import { JsonLd, faqSchema, breadcrumbSchema } from "@/lib/seo/jsonld";
import ContentTracker from "@/components/analytics/ContentTracker";
import MarketScoreTable from "@/components/amips/MarketScoreTable";
import type { MarketScoreResult } from "@/lib/amips/market-score.service";

// AMIPS Phase 2 — public intelligence article route. Serves any ACTIVE
// AmipsPage produced by the AMIPS data-narration generator. Runs in parallel to
// the Phase C2 /buying-guide route — both systems coexist and neither touches
// the other's data.
//
// ISR keeps DB reads off the hot path while still picking up freshly generated
// pages within the revalidation window.
export const revalidate = 3600;

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "https://autolenis.com").trim();
const METRO_TIERS = new Set(["C", "D", "E"]);

interface PageProps {
  params: Promise<{ slug: string }>;
}

interface AmipsFaq {
  question: string;
  answer: string;
}

type AmipsPage = NonNullable<Awaited<ReturnType<typeof loadPage>>>;

async function loadPage(slug: string) {
  try {
    const page = await prisma.amipsPage.findFirst({
      // ACTIVE + REFRESH_REQUIRED. REFRESH_REQUIRED means "the underlying data
      // is aging", not "unfit to serve" — 404ing it destroyed ranking equity for
      // a page that is still substantially correct. See lib/amips/tiers.ts.
      where: { slug, lifecycleStatus: { in: [...SERVABLE_LIFECYCLE_STATUSES] } },
    });
    if (!page) return null;
    // Outer staleness backstop. Dropping staleness as a withholding condition
    // removed the upper bound entirely, and these are pricing pages: past
    // STALE_WITHHOLD_DAYS the numbers are wrong, not merely aged. The bound is
    // the publication gate reused as the serving floor — we serve only what we
    // would still be willing to publish.
    if (isPastWithholdBound(page, Date.now())) return null;
    return page;
  } catch {
    // DB unavailable (e.g. at build time) — treat as not found.
    return null;
  }
}

function parseFaqs(faqJson: string | null): AmipsFaq[] {
  if (!faqJson) return [];
  try {
    const parsed = JSON.parse(faqJson);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (f): f is AmipsFaq =>
          typeof f?.question === "string" && typeof f?.answer === "string",
      )
      .map((f) => ({ question: f.question, answer: f.answer }));
  } catch {
    return [];
  }
}

function parseScore(json: string | null): MarketScoreResult | null {
  if (!json) return null;
  try {
    const s = JSON.parse(json) as MarketScoreResult;
    return typeof s?.overallBuyerAdvantage === "number" ? s : null;
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const page = await loadPage(slug);
  if (!page) {
    return {
      title: "Page not found | AutoLenis",
      robots: { index: false, follow: false },
    };
  }
  return buildPageMetadata({
    title: page.title,
    description: page.metaDescription,
    path: `/intelligence/${slug}`,
  });
}

export default async function IntelligenceArticlePage({ params }: PageProps) {
  const { slug } = await params;
  const page = await loadPage(slug);
  if (!page) notFound();

  const faqs = parseFaqs(page.faqJson);
  const score = METRO_TIERS.has(page.contentTier)
    ? parseScore(page.marketScoreJson)
    : null;
  const vehicleLabel =
    page.make && page.model ? `${page.make} ${page.model}` : page.title;
  const locationLabel = page.metro
    ? page.state
      ? `${page.metro}, ${page.state}`
      : page.metro
    : null;
  // Disclose the OLDEST applicable timestamp, not the first non-null one.
  // `marketDataAsOf ?? vehicleDataAsOf` reported whichever existed first by
  // priority, which understated staleness whenever vehicle data was older than
  // market data — against owner-verified production (market 66d, vehicle 85d)
  // it advertised 66 days for a page whose oldest load-bearing figure was 85.
  const asOf = (oldestApplicableDataAsOf(page) ?? page.publishedAt)
    ?.toISOString()
    .slice(0, 10);
  const lastUpdated = (page.lastRefreshedAt ?? page.updatedAt)
    .toISOString()
    .slice(0, 10);

  return (
    <>
      <ArticleSchemas page={page} faqs={faqs} slug={slug} />
      <ContentTracker
        articleSlug={slug}
        cluster={`amips-${page.contentTier.toLowerCase()}`}
        city={page.metro ?? undefined}
        state={page.state ?? undefined}
        metro={page.metro ?? undefined}
      />

      <article
        className="mx-auto max-w-3xl px-6 md:px-8 pt-28 pb-20 md:pt-36"
        data-testid="intelligence-article"
      >
        {/* Header + named-author byline (E-E-A-T) */}
        <header className="mb-10">
          <p className="text-xs tracking-widest uppercase font-semibold text-[#0B5FD1] mb-4">
            Market Intelligence{locationLabel ? ` · ${locationLabel}` : ""}
          </p>
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-[#111827] tracking-tight leading-[1.1] mb-6">
            {page.h1}
          </h1>
          <div className="text-sm text-[#6B7280]">
            By{" "}
            <Link
              href="/author/markist"
              className="text-[#0B5FD1] font-medium hover:underline"
            >
              Markist Athelus, Founder of AutoLenis
            </Link>
          </div>
        </header>

        {/* Generated body — sanitized HTML produced by the AMIPS generator. */}
        <div className="pillar-body space-y-6 text-[#374151] leading-relaxed [&_h2]:text-2xl [&_h2]:font-bold [&_h2]:text-[#111827] [&_h2]:tracking-tight [&_h2]:mb-4 [&_h2]:mt-10 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:text-[#111827] [&_h3]:mb-2 [&_h3]:mt-6 [&_p]:mb-4 [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:space-y-2 [&_ul]:mb-4 [&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:space-y-2 [&_ol]:mb-4 [&_a]:text-[#0B5FD1] [&_a]:font-medium hover:[&_a]:underline [&_strong]:text-[#111827] [&_table]:w-full [&_table]:text-sm [&_th]:text-left [&_th]:py-2 [&_td]:py-2 [&_td]:border-t [&_td]:border-[#E5E7EB]">
          <div dangerouslySetInnerHTML={{ __html: page.body }} />
        </div>

        {/* Market Score — Tier C/D/E only, rendered from stored score data. */}
        {score && locationLabel && (
          <MarketScoreTable
            result={score}
            vehicle={vehicleLabel}
            metro={page.metro as string}
            asOf={asOf}
          />
        )}

        {/* FAQ */}
        {faqs.length > 0 && (
          <section className="mt-16" data-testid="intelligence-faq">
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
        )}

        {/* Freshness footer */}
        {/* Freshness disclosure. Both dates are machine-readable <time> elements
            so the as-of date is extractable, not just human-visible prose. */}
        <p className="mt-12 text-xs text-[#9CA3AF]" data-testid="intelligence-freshness">
          Last Updated:{" "}
          <time dateTime={lastUpdated} data-testid="intelligence-last-updated">
            {lastUpdated}
          </time>
          {asOf ? (
            <>
              {" · Data as of: "}
              <time dateTime={asOf} data-testid="intelligence-data-as-of">
                {asOf}
              </time>
            </>
          ) : null}
        </p>
      </article>
    </>
  );
}

// AMIPS Article schema points at the /intelligence URL (the shared
// articleSchema builder hardcodes /buying-guide, so we build it inline here).
function ArticleSchemas({
  page,
  faqs,
  slug,
}: {
  page: AmipsPage;
  faqs: AmipsFaq[];
  slug: string;
}) {
  const url = `${APP_URL}/intelligence/${slug}`;
  const articleData = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: page.title,
    description: page.metaDescription,
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    url,
    author: {
      "@type": "Person",
      name: "Markist Athelus",
      url: `${APP_URL}/author/markist`,
    },
    publisher: {
      "@type": "Organization",
      name: "AutoLenis, Inc.",
      logo: { "@type": "ImageObject", url: `${APP_URL}/logo.png` },
    },
    ...(page.publishedAt ? { datePublished: page.publishedAt.toISOString() } : {}),
    dateModified: (page.lastRefreshedAt ?? page.updatedAt).toISOString(),
  } as const;

  return (
    <>
      <JsonLd id={`amips-article-${slug}`} data={articleData} />
      {faqs.length > 0 && (
        <JsonLd id={`amips-faq-${slug}`} data={faqSchema(faqs)} />
      )}
      <JsonLd
        id={`amips-breadcrumb-${slug}`}
        data={breadcrumbSchema([
          { name: "Market Intelligence", path: "/intelligence" },
          { name: page.h1, path: `/intelligence/${slug}` },
        ])}
      />
    </>
  );
}
