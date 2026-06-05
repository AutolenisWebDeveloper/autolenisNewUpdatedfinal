// ───────────────────────────────────────────────────────────────────────────
//  /buying-guide — buying-guide index
//
//  Server Component. Lists all PUBLISHED articles grouped by cluster, then by
//  city. Intentionally simple in Phase C1 — the individual articles drive
//  traffic, not this index. Phase C4 enriches it with intro copy and city tabs.
// ───────────────────────────────────────────────────────────────────────────

import type { Metadata } from "next";
import Link from "next/link";
import type { ContentArticle } from "@prisma/client";

import { getPublishedArticles } from "@/lib/seo/content-article.service";
import { buildPageMetadata } from "@/lib/seo/metadata";
import { CLUSTER_LABELS, type ContentCluster } from "@/lib/seo/content-keywords";
import Breadcrumbs from "@/components/seo/landing/Breadcrumbs";

export const revalidate = 3600;

const CLUSTER_ORDER: ContentCluster[] = [
  "dealer_quotes",
  "otd_price",
  "dealer_fees",
  "trade_in",
  "leasing",
];

export function generateMetadata(): Metadata {
  return buildPageMetadata({
    title: "DFW Car Buying Guide — Real Dealer Pricing & Quotes | AutoLenis",
    description:
      "Honest, local car-buying guides for DFW: dealer quotes, out-the-door pricing, dealer fees, trade-ins, and leasing. Understand the numbers, then let dealers compete.",
    path: "/buying-guide",
  });
}

export default async function BuyingGuideIndexPage() {
  const articles = await getPublishedArticles();

  // Group PUBLISHED articles by cluster for a clean, scannable listing.
  const byCluster = new Map<string, ContentArticle[]>();
  for (const article of articles) {
    const list = byCluster.get(article.cluster) ?? [];
    list.push(article);
    byCluster.set(article.cluster, list);
  }

  return (
    <>
      <Breadcrumbs
        items={[
          { name: "Home", href: "/" },
          { name: "Buying Guide" },
        ]}
      />

      <div className="mx-auto max-w-5xl px-6 py-10 md:px-8 md:py-14">
        <header className="mb-10">
          <h1 className="text-3xl font-bold text-slate-900 md:text-4xl">
            DFW Car Buying Guide
          </h1>
          <p className="mt-3 max-w-2xl text-lg text-slate-600">
            Real dealer pricing, fees, trade-in, and leasing — explained for
            Dallas–Fort Worth buyers. No fluff. When you&apos;re ready, let
            verified dealers compete for your business.
          </p>
        </header>

        {articles.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-10 text-center text-slate-500">
            Buying guides are coming soon. Check back shortly.
          </div>
        ) : (
          <div className="space-y-12">
            {CLUSTER_ORDER.filter((c) => byCluster.has(c)).map((cluster) => {
              const list = byCluster.get(cluster)!;
              return (
                <section key={cluster}>
                  <h2 className="mb-4 text-2xl font-bold text-slate-900">
                    {CLUSTER_LABELS[cluster]}
                  </h2>
                  <ul className="grid gap-3 sm:grid-cols-2">
                    {list.map((article) => (
                      <li key={article.id}>
                        <Link
                          href={`/buying-guide/${article.slug}`}
                          className="block rounded-lg border border-slate-200 p-4 transition hover:border-[#0B5FD1] hover:bg-[#0B5FD1]/5"
                        >
                          <span className="font-medium text-slate-900">
                            {article.title}
                          </span>
                          <span className="mt-1 block text-sm text-slate-500">
                            {article.city}, {article.state}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
