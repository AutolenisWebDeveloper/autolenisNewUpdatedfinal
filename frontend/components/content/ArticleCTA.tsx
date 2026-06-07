"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { trackArticleCTA } from "@/lib/analytics/events";
import {
  buildBuyerUrl,
  buildCtaHeadline,
  buildCtaSubcopy,
  locationLabel,
} from "@/lib/seo/buyer-cta";

// Phase C4 — the single conversion element for programmatic articles. It is
// state- and vehicle-aware (headline + deep link adapt to the page's context)
// and fires an attributed GA4 click event so we can measure CTA performance by
// position, cluster, and locale. Rendered above the fold AND at the bottom of
// every buying-guide article.

type CtaPosition = "above_fold" | "mid_page" | "bottom";

interface ArticleCTAProps {
  articleSlug: string;
  cluster: string;
  city: string;
  state: string;
  make?: string | null;
  model?: string | null;
  position: CtaPosition;
}

export default function ArticleCTA({
  articleSlug,
  cluster,
  city,
  state,
  make,
  model,
  position,
}: ArticleCTAProps) {
  const ctx = { city, state, make, model };
  const href = buildBuyerUrl(ctx);
  const headline = buildCtaHeadline(ctx);

  const onClick = () =>
    trackArticleCTA({ articleSlug, cluster, city, state, position });

  // Compact, inline banner — sits above the fold without pushing the article down.
  if (position === "above_fold") {
    return (
      <div
        className="mb-12 rounded-2xl border border-[#DBEAFE] bg-[#F0F7FF] px-6 py-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
        data-testid="article-cta-above-fold"
      >
        <p className="text-sm font-medium text-[#1E3A8A]">{headline}</p>
        <Link
          href={href}
          onClick={onClick}
          data-testid="article-cta-link"
          className="inline-flex shrink-0 items-center gap-2 px-6 py-3 bg-[#0B5FD1] text-white font-semibold text-sm rounded-xl hover:bg-[#0A4DB8] transition-colors"
        >
          Start your auction
          <ArrowRight size={16} />
        </Link>
      </div>
    );
  }

  // Mid-page seam — a filled, single-row bar that interrupts the body content
  // and stands apart from both the light above-fold banner and the large
  // bottom block, so the reader meets a fresh conversion prompt mid-scroll.
  if (position === "mid_page") {
    return (
      <div
        className="my-12 rounded-2xl bg-[#0B5FD1] px-6 py-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
        data-testid="article-cta-mid"
      >
        <p className="text-sm font-semibold text-white">{headline}</p>
        <Link
          href={href}
          onClick={onClick}
          data-testid="article-cta-link"
          className="inline-flex shrink-0 items-center gap-2 px-6 py-3 bg-white text-[#0B5FD1] font-semibold text-sm rounded-xl hover:bg-[#F3F4F6] transition-colors"
        >
          Compare offers
          <ArrowRight size={16} />
        </Link>
      </div>
    );
  }

  // Full-width emphasis block — bottom of article.
  const location = locationLabel(ctx);
  return (
    <div
      className="mt-12 rounded-2xl bg-[#0B5FD1] px-8 py-10 text-center"
      data-testid="article-cta-bottom"
    >
      <p className="text-xl font-bold text-white mb-3">{headline}</p>
      <p className="text-white/80 mb-6 max-w-lg mx-auto">{buildCtaSubcopy(ctx)}</p>
      <Link
        href={href}
        onClick={onClick}
        data-testid="article-cta-link"
        className="inline-flex items-center gap-2 px-8 py-4 bg-white text-[#0B5FD1] font-semibold text-sm rounded-xl hover:bg-[#F3F4F6] transition-colors"
      >
        {location ? `See offers in ${location}` : "See how it works"}
        <ArrowRight size={16} />
      </Link>
    </div>
  );
}
