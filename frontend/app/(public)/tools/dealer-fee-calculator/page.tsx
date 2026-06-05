import type { Metadata } from "next";
import Link from "next/link";

import { buildPageMetadata } from "@/lib/seo/metadata";
import { JsonLd, faqSchema, breadcrumbSchema } from "@/lib/seo/jsonld";
import DealerFeeCalculator from "@/components/tools/DealerFeeCalculator";

export const metadata: Metadata = buildPageMetadata({
  title: "Car Dealer Fee Calculator — Is That Fee Legit? | AutoLenis",
  description:
    "Enter any dealer fee and instantly find out if it's required by your state's law, negotiable, or pure markup. Works for all 50 states. Free tool.",
  path: "/tools/dealer-fee-calculator",
  keywords: [
    "dealer fee calculator",
    "car dealer fees",
    "doc fee by state",
    "are dealer fees negotiable",
    "market adjustment fee",
  ],
});

const FAQ_ITEMS = [
  {
    question: "What dealer fees are required by law?",
    answer:
      "Only government fees are truly required: the title fee and registration/license fee, both set by your state and paid to the DMV. Every other line — doc fees, dealer add-ons, market adjustments, GAP, paint protection — is either negotiable or pure markup. Required fees are the same no matter which dealer you use.",
  },
  {
    question: "Which dealer fees can you negotiate?",
    answer:
      "Almost all of them. Documentation fees are negotiable in most states (and capped by law in a few, like Texas at $150 and California at $85). GAP insurance and extended warranties are negotiable and usually far cheaper outside the dealer. Pure-markup items — nitrogen tires, VIN etching, paint protection, dealer add-ons, and 'market adjustments' — can and should be removed entirely.",
  },
  {
    question: "What is a market adjustment fee?",
    answer:
      "A market adjustment (also called ADM or additional dealer markup) is an arbitrary amount a dealer adds above MSRP during high demand. It reflects no added value and is completely negotiable. Many dealers will drop it if you push back or show you're willing to shop elsewhere.",
  },
  {
    question: "How does AutoLenis eliminate fee games?",
    answer:
      "Instead of negotiating fees one dealer at a time, AutoLenis has up to 8 local dealers compete privately for your business in a 48-hour auction. Each submits their best out-the-door price — fees included — so you compare real totals side by side and pick the winner. The fee games disappear when dealers know they're being compared.",
  },
];

export default function DealerFeeCalculatorPage() {
  return (
    <>
      <JsonLd id="dealer-fee-calculator-faq" data={faqSchema(FAQ_ITEMS)} />
      <JsonLd
        id="dealer-fee-calculator-breadcrumb"
        data={breadcrumbSchema([
          { name: "Home", path: "/" },
          { name: "Tools", path: "/tools" },
          {
            name: "Dealer Fee Calculator",
            path: "/tools/dealer-fee-calculator",
          },
        ])}
      />

      <section className="bg-[#F8F9FB] pt-28 pb-16 md:pt-32">
        <div className="mx-auto max-w-3xl px-6">
          <p className="text-xs font-semibold uppercase tracking-widest text-[#0B5FD1]">
            Free Tool · All 50 States
          </p>
          <h1 className="mt-3 text-3xl font-bold leading-tight tracking-tight text-slate-900 sm:text-4xl">
            Car Dealer Fee Calculator — Is That Fee Legit?
          </h1>
          <p className="mt-4 text-base leading-relaxed text-slate-600">
            Works for all 50 states. Enter any fee from your dealer worksheet to
            find out if it&apos;s required by law, negotiable, or pure markup.
            Covers documentation fees, market adjustments, add-ons, GAP, and
            more — with the exact rules and legal caps for your state.
          </p>
        </div>
      </section>

      <section className="bg-white pb-20">
        <div className="mx-auto -mt-8 max-w-3xl px-6">
          <DealerFeeCalculator />
        </div>

        {/* National FAQ */}
        <div className="mx-auto mt-16 max-w-3xl px-6">
          <h2 className="text-2xl font-bold text-slate-900">
            Dealer Fees — Frequently Asked Questions
          </h2>
          <div className="mt-6 space-y-6">
            {FAQ_ITEMS.map((f) => (
              <div key={f.question}>
                <h3 className="text-lg font-semibold text-slate-900">
                  {f.question}
                </h3>
                <p className="mt-2 text-base leading-relaxed text-slate-600">
                  {f.answer}
                </p>
              </div>
            ))}
          </div>

          <div className="mt-12 rounded-2xl bg-[#0B5FD1] p-8 text-center">
            <h2 className="text-xl font-bold text-white">
              Skip the fee games entirely
            </h2>
            <p className="mx-auto mt-2 max-w-lg text-sm text-blue-100">
              Let up to 8 local dealers compete for your business in a private
              48-hour auction. Compare real out-the-door prices and pick the
              best one.
            </p>
            <Link
              href="/request-a-car"
              className="mt-5 inline-flex items-center gap-2 rounded-xl bg-white px-7 py-3 text-sm font-semibold text-[#0B5FD1] transition-colors hover:bg-blue-50"
            >
              Get Dealers to Compete
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
