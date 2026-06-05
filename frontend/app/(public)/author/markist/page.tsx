import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Shield, Users, Target } from "lucide-react";

import { buildPageMetadata } from "@/lib/seo/metadata";
import { JsonLd, personSchema } from "@/lib/seo/jsonld";

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "https://autolenis.com").trim();

export const metadata: Metadata = buildPageMetadata({
  title: "Markist — Founder of AutoLenis | Car Buying Expert",
  description:
    "Markist founded AutoLenis so car buyers everywhere could stop negotiating " +
    "alone and start winning. 8 dealers compete. You pick the best offer.",
  path: "/author/markist",
  keywords: ["Markist", "AutoLenis founder", "car buying expert", "car buying concierge"],
});

export const revalidate = 86400;

export default function MarkistAuthorPage() {
  return (
    <>
      <JsonLd
        id="author-markist-jsonld"
        data={personSchema({
          name: "Markist",
          jobTitle: "Founder",
          url: `${APP_URL}/author/markist`,
          worksFor: "AutoLenis",
        })}
      />

      <article
        className="mx-auto max-w-3xl px-6 md:px-8 pt-28 pb-20 md:pt-36"
        data-testid="author-markist"
      >
        {/* Header */}
        <header className="mb-12">
          <p className="text-xs tracking-widest uppercase font-semibold text-[#0B5FD1] mb-4">
            Author
          </p>
          <h1 className="text-4xl sm:text-5xl font-bold text-[#111827] tracking-tight mb-4">
            Markist
          </h1>
          <p className="text-lg text-[#4B5563]">Founder, AutoLenis</p>
        </header>

        {/* Bio */}
        <div className="prose prose-lg max-w-none text-[#374151] leading-relaxed space-y-6">
          <p>
            Markist built AutoLenis after watching too many car buyers get taken
            advantage of at dealerships. The pattern was always the same: a buyer
            walks in alone, sits across from a team of trained negotiators, and
            leaves having paid more than they should have — often without ever
            realizing it. The deck was stacked, and almost nobody noticed.
          </p>
          <p>
            AutoLenis gives buyers the same leverage dealers have always had. Instead
            of one buyer negotiating against one dealership, the platform makes 8 local
            dealers compete privately for every buyer&apos;s business. Dealers submit
            their best offers in a 48-hour auction, and the buyer picks the one that
            wins. No haggling, no pressure, no information asymmetry. The competition
            does the work that exhausting back-and-forth used to do.
          </p>
          <p>
            Markist&apos;s background spans technology and financial services — fields
            where transparency and incentives shape every outcome. That perspective is
            baked into how AutoLenis works: surface the real numbers, align the
            incentives in the buyer&apos;s favor, and let a fair process produce a fair
            price. The platform works in every US market because the dealer-discovery
            system finds local dealers near any zip code automatically.
          </p>
        </div>

        {/* Mission */}
        <section className="mt-14" data-testid="author-mission">
          <h2 className="text-2xl font-bold text-[#111827] mb-6">
            Why dealership negotiation is broken
          </h2>
          <p className="text-[#374151] leading-relaxed mb-8">
            Traditional car buying is built on one buyer facing a team that does this
            every day. The buyer has one shot; the dealership has thousands of reps.
            Pricing is opaque, fees appear at the last minute, and the person with the
            least information is expected to defend themselves against the people with
            the most. AutoLenis exists to flip that. When dealers know they&apos;re
            competing, the buyer no longer has to fight for a fair deal — the structure
            delivers it.
          </p>

          <div className="grid sm:grid-cols-3 gap-6">
            {[
              { icon: Shield, title: "Buyer-first", text: "Every decision favors the person buying the car." },
              { icon: Users, title: "8 dealers compete", text: "Private 48-hour auction near any US zip code." },
              { icon: Target, title: "Real leverage", text: "Competition replaces negotiation entirely." },
            ].map((b) => (
              <div key={b.title} className="rounded-2xl border border-[#E5E7EB] bg-white p-6">
                <div className="w-11 h-11 bg-[#EFF6FF] rounded-xl flex items-center justify-center mb-4">
                  <b.icon size={20} className="text-[#0B5FD1]" />
                </div>
                <p className="font-semibold text-[#111827] mb-1">{b.title}</p>
                <p className="text-sm text-[#6B7280] leading-relaxed">{b.text}</p>
              </div>
            ))}
          </div>
        </section>

        {/* CTA */}
        <div className="mt-14 rounded-2xl bg-[#0B5FD1] px-8 py-10 text-center">
          <p className="text-xl font-bold text-white mb-3">
            Let dealers compete for your business
          </p>
          <p className="text-white/80 mb-6 max-w-lg mx-auto">
            Start a private 48-hour auction and pick the best offer. AutoLenis works in
            every US market.
          </p>
          <Link
            href="/for-buyers"
            className="inline-flex items-center gap-2 px-8 py-4 bg-white text-[#0B5FD1] font-semibold text-sm rounded-xl hover:bg-[#F3F4F6] transition-colors"
          >
            See how it works
            <ArrowRight size={16} />
          </Link>
        </div>

        <p className="mt-10">
          <Link href="/buying-guide/how-to-get-best-car-price" className="text-[#0B5FD1] font-medium hover:underline">
            Read the AutoLenis car buying guides →
          </Link>
        </p>
      </article>
    </>
  );
}
