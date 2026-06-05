// ───────────────────────────────────────────────────────────────────────────
//  /buying-guide/[slug] — programmatic SEO buying-guide article
//
//  Server Component. Looks up a PUBLISHED ContentArticle by slug; 404s for
//  unknown slugs and for DRAFT/ARCHIVED articles. Renders the article body
//  (markdown), an FAQ section, a contextual auction CTA, and Article + FAQPage
//  JSON-LD. Phase C4 wires in <ArticleCTA> and <RelatedArticles>.
// ───────────────────────────────────────────────────────────────────────────

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight } from "lucide-react";

import { getArticle, parseFaqs } from "@/lib/seo/content-article.service";
import { buildPageMetadata } from "@/lib/seo/metadata";
import { breadcrumbSchema } from "@/lib/seo/jsonld";
import JsonLdScript from "@/components/seo/landing/JsonLdScript";
import Breadcrumbs from "@/components/seo/landing/Breadcrumbs";
import ArticleSchema from "@/components/seo/ArticleSchema";
import ArticleBody from "@/components/buying-guide/ArticleBody";

// Canonical buyer intake entry point. Kept as a single constant so the CTA
// destination is trivial to retarget (Phase C4 deep-links query params here).
const AUCTION_CTA_HREF = "/buyers";

// Articles are DB-backed; revalidate hourly so newly published/edited articles
// surface without a full redeploy.
export const revalidate = 3600;

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> },
): Promise<Metadata> {
  const { slug } = await params;
  const article = await getArticle(slug);
  if (!article) {
    return { title: "Not found", robots: { index: false, follow: false } };
  }
  return buildPageMetadata({
    title: article.title,
    description: article.metaDescription,
    path: `/buying-guide/${article.slug}`,
  });
}

export default async function BuyingGuideArticlePage(
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const article = await getArticle(slug);
  if (!article) notFound();

  const faqs = parseFaqs(article.faqJson);
  const vehicle = [article.make, article.model].filter(Boolean).join(" ");

  // Contextual CTA copy. Vehicle clusters name the make/model; the fee/trade/
  // leasing clusters fall back to a city-level prompt.
  const ctaHeadline = vehicle
    ? `Ready to get ${vehicle} dealers in ${article.city} to compete?`
    : `Ready to let ${article.city} dealers compete for your business?`;

  return (
    <>
      <ArticleSchema
        title={article.title}
        description={article.metaDescription}
        publishedAt={article.publishedAt}
        slug={article.slug}
        faqs={faqs}
      />
      <JsonLdScript
        id="buying-guide-breadcrumb"
        data={breadcrumbSchema([
          { name: "Home", path: "/" },
          { name: "Buying Guide", path: "/buying-guide" },
          { name: article.city, path: "/buying-guide" },
          { name: article.title, path: `/buying-guide/${article.slug}` },
        ])}
      />

      <Breadcrumbs
        items={[
          { name: "Home", href: "/" },
          { name: "Buying Guide", href: "/buying-guide" },
          { name: article.city, href: "/buying-guide" },
          { name: article.title },
        ]}
      />

      <article className="mx-auto max-w-3xl px-6 py-10 md:px-8 md:py-14">
        <header className="mb-8">
          <h1 className="text-3xl font-bold leading-tight text-slate-900 md:text-4xl">
            {article.h1}
          </h1>
        </header>

        <ArticleBody markdown={article.body} />

        {faqs.length > 0 && (
          <section className="mt-12">
            <h2 className="mb-4 text-2xl font-bold text-slate-900">
              Frequently Asked Questions
            </h2>
            <dl className="space-y-5">
              {faqs.map((faq, i) => (
                <div key={i} className="rounded-lg border border-slate-100 bg-slate-50/60 p-5">
                  <dt className="font-semibold text-slate-900">{faq.question}</dt>
                  <dd className="mt-1.5 leading-relaxed text-slate-700">{faq.answer}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}

        {/* Contextual auction CTA */}
        <section className="mt-12 rounded-2xl border border-[#0B5FD1]/15 bg-[#0B5FD1]/5 p-8 text-center">
          <h2 className="text-2xl font-bold text-slate-900">{ctaHeadline}</h2>
          <p className="mx-auto mt-2 max-w-xl text-slate-600">
            Verified dealers compete in a private 48-hour auction. Compare every
            offer side by side and pick the best — no dealership visits until you
            choose.
          </p>
          <Link
            href={AUCTION_CTA_HREF}
            className="mt-6 inline-flex items-center gap-2 rounded-lg bg-[#0B5FD1] px-6 py-3 font-semibold text-white transition hover:bg-[#0a4fb0]"
          >
            Start My Free Auction
            <ArrowRight size={18} />
          </Link>
        </section>
      </article>
    </>
  );
}
