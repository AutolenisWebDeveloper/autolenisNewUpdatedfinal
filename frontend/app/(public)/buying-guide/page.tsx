import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { buildPageMetadata } from "@/lib/seo/metadata";
import { PILLAR_PAGES } from "@/lib/seo/pillar-links";
import ProgrammaticGuideLinks from "@/components/content/ProgrammaticGuideLinks";

export const metadata: Metadata = buildPageMetadata({
  title: "Car Buying Guides — Get the Best Deal on Any Car",
  description:
    "Honest, national car buying guides from AutoLenis founder Markist. Learn " +
    "how to get the best price, negotiate with dealers, decode fees, and more.",
  path: "/buying-guide",
  keywords: ["car buying guide", "car buying tips", "how to buy a car"],
});

export const revalidate = 86400;

const BLURBS: Record<string, string> = {
  "how-to-get-best-car-price":
    "MSRP vs invoice, dealer markup, and how to know what to actually pay.",
  "how-to-negotiate-car-price":
    "Tactics that work, timing that helps, and what really moves a dealer's number.",
  "dealer-fees-complete-guide":
    "Every dealer fee explained — what's required, what's negotiable, what to reject.",
  "lease-vs-buy-car":
    "Money factor, residual value, and when leasing or buying actually makes sense.",
  "car-trade-in-value-guide":
    "How dealers use trade-ins, the right timing, and the one rule that protects you.",
  "car-buying-concierge-service":
    "What a buyer-side concierge does and how the AutoLenis auction works.",
};

export default function BuyingGuideIndex() {
  return (
    <div
      className="mx-auto max-w-4xl px-6 md:px-8 pt-28 pb-20 md:pt-36"
      data-testid="buying-guide-index"
    >
      <header className="mb-12">
        <p className="text-xs tracking-widest uppercase font-semibold text-[#0B5FD1] mb-4">
          Buying Guides
        </p>
        <h1 className="text-4xl sm:text-5xl font-bold text-[#111827] tracking-tight mb-5">
          Buy your next car like you have leverage.
        </h1>
        <p className="text-lg text-[#4B5563] max-w-2xl">
          Straight, no-spin guides to getting the best deal on any car — from{" "}
          <Link href="/author/markist" className="text-[#0B5FD1] font-medium hover:underline">
            Markist, founder of AutoLenis
          </Link>
          . Written for buyers in every US market.
        </p>
      </header>

      <ul className="grid sm:grid-cols-2 gap-5">
        {PILLAR_PAGES.map((p) => (
          <li key={p.slug}>
            <Link
              href={p.url}
              className="group block h-full rounded-2xl border border-[#E5E7EB] bg-white p-6 hover:border-[#0B5FD1] hover:shadow-sm transition-all"
            >
              <h2 className="text-lg font-semibold text-[#111827] mb-2">{p.title}</h2>
              <p className="text-sm text-[#6B7280] leading-relaxed mb-4">
                {BLURBS[p.slug]}
              </p>
              <span className="inline-flex items-center gap-1 text-sm font-medium text-[#0B5FD1]">
                Read guide
                <ArrowRight size={14} className="group-hover:translate-x-0.5 transition-transform" />
              </span>
            </Link>
          </li>
        ))}
      </ul>

      {/* City-level programmatic guides — hub → article internal links */}
      <ProgrammaticGuideLinks
        heading="Popular guides by city"
        limit={8}
        testId="hub-programmatic-links"
      />
    </div>
  );
}
