import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";

import { buildPageMetadata } from "@/lib/seo/metadata";
import { JsonLd, breadcrumbSchema } from "@/lib/seo/jsonld";
import LeadMagnetForm from "@/components/leads/LeadMagnetForm";
import { getLeadMagnet } from "@/lib/leads/lead-magnets";

const magnet = getLeadMagnet("honest-guide");

export const metadata: Metadata = buildPageMetadata({
  title: "The Car Buyer's Honest Guide — Free Download | AutoLenis",
  description:
    "A no-spin guide to how car pricing really works, which dealer fees are real, and how to make dealers compete for your business. Free for buyers in every US market.",
  path: "/guide",
  keywords: [
    "car buying guide",
    "how to buy a car",
    "dealer fees explained",
    "how to negotiate car price",
    "free car buying guide",
  ],
});

export default function GuideLandingPage() {
  return (
    <>
      <JsonLd
        id="guide-breadcrumb"
        data={breadcrumbSchema([
          { name: "Home", path: "/" },
          { name: "The Car Buyer's Honest Guide", path: "/guide" },
        ])}
      />

      <section className="bg-[#F8F9FB] pt-28 pb-16 md:pt-32">
        <div className="mx-auto grid max-w-5xl items-start gap-10 px-6 md:grid-cols-2 md:gap-14">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-[#0B5FD1]">
              Free Guide · Every US Market
            </p>
            <h1 className="mt-3 text-3xl font-bold leading-tight tracking-tight text-slate-900 sm:text-4xl">
              {magnet.title}
            </h1>
            <p className="mt-4 text-base leading-relaxed text-slate-600">
              {magnet.subtitle}
            </p>
            <p className="mt-4 text-base leading-relaxed text-slate-600">
              {magnet.description}
            </p>

            <ul className="mt-6 space-y-3">
              {magnet.bullets.map((b) => (
                <li key={b} className="flex items-start gap-3">
                  <CheckCircle2
                    className="mt-0.5 shrink-0 text-[#0B5FD1]"
                    size={20}
                  />
                  <span className="text-sm leading-relaxed text-slate-700">
                    {b}
                  </span>
                </li>
              ))}
            </ul>

            <p className="mt-8 text-sm text-slate-500">
              Written by{" "}
              <Link
                href="/author/markist"
                className="font-semibold text-[#0B5FD1] hover:underline"
              >
                Markist, Founder of AutoLenis
              </Link>
              .
            </p>
          </div>

          <div className="md:pt-4">
            <LeadMagnetForm magnetSlug="honest-guide" />
          </div>
        </div>
      </section>

      <section className="bg-white py-16">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <h2 className="text-2xl font-bold text-slate-900">
            Why trust this guide?
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-base leading-relaxed text-slate-600">
            AutoLenis runs private 48-hour auctions where up to 8 local dealers
            compete for your business. We see how dealers actually price cars and
            fees every day — and this guide passes that knowledge straight to
            you, with no sales pitch.
          </p>
          <Link
            href="/request-a-car"
            className="mt-6 inline-flex items-center gap-2 rounded-xl bg-[#0B5FD1] px-7 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
          >
            See How the Auction Works
          </Link>
        </div>
      </section>
    </>
  );
}
