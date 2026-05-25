import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CheckCircle2, Sparkles, Shield } from "lucide-react";
import FaithVerseModule from "@/components/public/FaithVerseModule";
import { MARKETING_IMAGES } from "@/lib/constants/marketing-images";
import { DEPOSIT_AMOUNT_USD, PREMIUM_FEE_USD, PREMIUM_FEE_REMAINING_USD } from "@/lib/constants";
import { buildPageMetadata, PAGE_METADATA } from "@/lib/seo/metadata";
import { JsonLd, pricingSchema } from "@/lib/seo/jsonld";
import CitationBlock from "@/components/seo/CitationBlock";
import DefinitionBlock from "@/components/seo/DefinitionBlock";
import LastUpdated from "@/components/seo/LastUpdated";

export const metadata: Metadata = buildPageMetadata(PAGE_METADATA.pricing);
export const dynamic = "force-dynamic";
export const revalidate = 86400;

const STANDARD_FEATURES = [
  "Soft-pull pre-qualification (no credit score impact)",
  "Inventory browsing with verified vehicle data",
  "Shortlist up to 5 vehicles",
  "Private 48-hour reverse auction",
  "Up to 8 dealer invitations",
  "Best Price Engine (Cash, Monthly, Overall)",
  "Contract Shield document review",
  "DocuSign e-signing",
  "QR code vehicle pickup",
  "Standard support",
];

const PREMIUM_FEATURES = [
  "Everything in Standard",
  "Dedicated buying specialist",
  "Financing guidance and best-rate sourcing",
  "Smarter inquiry and offer coaching",
  "Priority dealer handling",
  "Contract review and closing coordination",
  "Free home delivery",
  "Priority concierge support",
];

export default function PricingPage() {
  return (
    <>
      <JsonLd id="ld-pricing" data={pricingSchema()} />
      <PricingPageBody />
    </>
  );
}

function PricingPageBody() {
  return (
    <div className="bg-white">
      {/* Hero — Fix 3: enhanced hero content */}
      <section
        className="pt-16 py-24 md:py-32 text-center bg-gradient-to-b from-[#F8F9FB] to-white"
        data-testid="pricing-hero"
      >
        <div className="mx-auto max-w-7xl px-6">
          <span className="text-xs font-bold uppercase tracking-[0.15em] text-[#0B5FD1]">
            Transparent Pricing
          </span>
          <h1 className="text-5xl sm:text-6xl font-bold tracking-tight text-[#111827] mt-4 mb-5">
            Simple Pricing. Serious Buying Power.
          </h1>
          <p className="text-[#4B5563] text-lg max-w-xl mx-auto leading-relaxed mb-8">
            AutoLenis gives buyers leverage through structured dealer competition,
            financial clarity, and a guided buying experience. Two plans. No subscriptions.
            No hidden fees.
          </p>
          <div className="flex flex-wrap gap-3 justify-center mb-6">
            <Link href="/auth/signup"
              className="inline-flex items-center gap-2 px-7 py-3.5 bg-[#0B5FD1] text-white
                font-semibold text-sm rounded-md hover:bg-[#0A4DB8] transition-colors
                shadow-md shadow-[#0B5FD1]/25">
              Get Prequalified <ArrowRight size={15} />
            </Link>
            <Link href="/how-it-works"
              className="inline-flex items-center gap-2 px-7 py-3.5 bg-white border
                border-[#E5E7EB] text-[#374151] font-semibold text-sm rounded-md
                hover:border-[#0B5FD1] hover:text-[#0B5FD1] transition-colors">
              See How It Works
            </Link>
          </div>
          <p className="text-xs text-[#94A3B8] font-medium">
            No subscriptions · No hidden fees · Buyer-first process · Clear next steps
          </p>
          <LastUpdated date="2025-01-01" />
        </div>
      </section>

      {/* AI-extractable pricing citation */}
      <section className="bg-white pb-6" data-testid="pricing-ai-citation">
        <div className="mx-auto max-w-3xl px-6 md:px-12">
          <CitationBlock
            id="autolenis-pricing"
            question="How much does AutoLenis cost?"
            answer={`AutoLenis charges two fees: a ${DEPOSIT_AMOUNT_USD} Limited-Time Auction Access Fee (refundable if no valuable offer is received) and a ${PREMIUM_FEE_USD} Service Fee only if you proceed with a purchase. The ${DEPOSIT_AMOUNT_USD} Auction Access Fee is credited toward the ${PREMIUM_FEE_USD} fee, making your balance ${PREMIUM_FEE_REMAINING_USD}. There are no monthly charges, subscriptions, or hidden fees.`}
            sourceLabel="AutoLenis Official Pricing"
            lastUpdated="2025-01-01"
          />
          <DefinitionBlock
            term="AutoLenis Auction Access Fee"
            category="Fee"
            definition={`A ${DEPOSIT_AMOUNT_USD} limited-time Auction Access Fee paid by the buyer to activate a private dealer auction. The fee is refundable if no valuable offer is received. If a purchase is made, the ${DEPOSIT_AMOUNT_USD} is credited toward the ${PREMIUM_FEE_USD} AutoLenis Service Fee.`}
            relatedTerms={["Refundable Fee", "Auction Activation", "Service Fee"]}
          />
        </div>
      </section>

      {/* Plan Cards */}
      <section className="pb-16" data-testid="pricing-plans-section">
        <div className="mx-auto max-w-6xl px-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Standard */}
            <div
              data-testid="pricing-plan-standard"
              className="relative bg-white border-2 border-[#DBEAFE] rounded-2xl p-8 md:p-10 flex flex-col"
            >
              <div className="mb-6">
                <h3 className="text-sm font-bold uppercase tracking-wider text-[#4B5563]">Standard</h3>
                <p className="text-[#94A3B8] text-sm mt-1.5">Start your car-buying journey at no cost</p>
              </div>

              <div className="mb-8">
                <p className="text-5xl font-bold text-[#111827] font-[family-name:var(--font-mono)] tracking-tight" data-testid="pricing-standard-price">
                  Free <span className="text-base font-normal text-[#94A3B8]">to start</span>
                </p>
                <div className="mt-4 bg-[#F8F9FB] border border-[#E5E7EB] rounded-lg px-4 py-3">
                  <p className="text-xs font-semibold text-[#0B5FD1] mb-0.5">{DEPOSIT_AMOUNT_USD} Limited-Time Auction Access Fee</p>
                  <p className="text-xs text-[#4B5563] leading-relaxed">
                    Required to activate your auction. <span className="font-semibold">Refundable if no valuable offer is received.</span>
                  </p>
                </div>
              </div>

              {/* Fix 1: text-[#50D14E] → text-[#0B5FD1] */}
              <ul className="space-y-3 mb-8 flex-1">
                {STANDARD_FEATURES.map((f) => (
                  <li key={f} className="flex gap-2.5 text-sm text-[#4B5563]" data-testid={`standard-feature-${f.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}`}>
                    <CheckCircle2 size={15} className="text-[#0B5FD1] mt-0.5 shrink-0" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>

              <Link
                href="/auth/signup?plan=standard"
                data-testid="pricing-standard-cta"
                className="inline-flex items-center justify-center gap-2 w-full py-3.5 bg-white border-2 border-[#0B5FD1] text-[#0B5FD1] font-semibold text-sm rounded-md hover:bg-[#EFF6FF] transition-colors"
              >
                Get Started Free <ArrowRight size={15} />
              </Link>
            </div>

            {/* Premium */}
            <div
              data-testid="pricing-plan-premium"
              className="relative bg-gradient-to-br from-[#F8F9FB] to-white border-2 border-[#0B5FD1] rounded-2xl p-8 md:p-10 flex flex-col shadow-xl shadow-[#0B5FD1]/10"
            >
              <span
                data-testid="pricing-premium-badge"
                className="absolute -top-3 left-1/2 -translate-x-1/2 text-[10px] font-bold uppercase tracking-[0.15em] text-white bg-[#0B5FD1] px-3 py-1.5 rounded-full shadow-md"
              >
                ★ Most Popular
              </span>

              <div className="mb-6">
                <h3 className="text-sm font-bold uppercase tracking-wider text-[#0B5FD1] flex items-center gap-2">
                  <Sparkles size={14} /> Premium
                </h3>
                <p className="text-[#4B5563] text-sm mt-1.5">Full white-glove concierge experience</p>
              </div>

              <div className="mb-8">
                <p className="text-5xl font-bold text-[#111827] font-[family-name:var(--font-mono)] tracking-tight" data-testid="pricing-premium-price">
                  {PREMIUM_FEE_USD} <span className="text-base font-normal text-[#94A3B8]">concierge fee</span>
                </p>
                <p className="text-xs text-[#0B5FD1] font-semibold mt-2">
                  {DEPOSIT_AMOUNT_USD} Auction Access Fee credited → {PREMIUM_FEE_REMAINING_USD} net at closing
                </p>
                <div className="mt-4 bg-white border border-[#DBEAFE] rounded-lg px-4 py-3">
                  <p className="text-xs font-semibold text-[#0B5FD1] mb-0.5">{DEPOSIT_AMOUNT_USD} Limited-Time Auction Access Fee</p>
                  <p className="text-xs text-[#4B5563] leading-relaxed">
                    Required to activate your auction. <span className="font-semibold">Credited toward your {PREMIUM_FEE_USD} concierge fee</span> — you pay {PREMIUM_FEE_REMAINING_USD} after selecting your deal.
                  </p>
                </div>
              </div>

              <ul className="space-y-3 mb-8 flex-1">
                {PREMIUM_FEATURES.map((f) => (
                  <li key={f} className="flex gap-2.5 text-sm text-[#4B5563]" data-testid={`premium-feature-${f.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}`}>
                    <CheckCircle2 size={15} className="text-[#0B5FD1] mt-0.5 shrink-0" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>

              <Link
                href="/auth/signup?plan=premium"
                data-testid="pricing-premium-cta"
                className="inline-flex items-center justify-center gap-2 w-full py-3.5 bg-[#0B5FD1] text-white font-semibold text-sm rounded-md hover:bg-[#0A4DB8] transition-colors shadow-md shadow-[#0B5FD1]/25"
              >
                Go Premium <ArrowRight size={15} />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* $99 Auction Access Fee Callout — Fix 1: replace non-brand green icon wrapper */}
      <section className="pb-24" data-testid="pricing-deposit-callout-section">
        <div className="mx-auto max-w-4xl px-6">
          <div
            data-testid="pricing-deposit-callout"
            className="bg-white border border-[#E5E7EB] rounded-2xl p-8 md:p-10 shadow-sm"
          >
            <div className="flex items-start gap-5">
              <div className="w-12 h-12 rounded-xl bg-[#EFF6FF] border border-[#DBEAFE] flex items-center justify-center shrink-0">
                <Shield size={20} className="text-[#0B5FD1]" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-[#111827] mb-2 tracking-tight">
                  Why the {DEPOSIT_AMOUNT_USD} Limited-Time Auction Access Fee?
                </h3>
                <p className="text-sm text-[#4B5563] leading-relaxed">
                  The {DEPOSIT_AMOUNT_USD} Auction Access Fee is required before your auction begins. It unlocks live dealer bidding and competitive offer access — ensuring dealers invest real effort in competing for your business.{" "}
                  <span className="font-semibold text-[#111827]">It is refundable if no valuable offer is received.</span>{" "}
                  On Premium, it is credited toward your {PREMIUM_FEE_USD} concierge fee.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Fix 4 — Section A: Value Comparison */}
      <section className="py-16 bg-[#F8F9FB] border-t border-[#E5E7EB]">
        <div className="mx-auto max-w-4xl px-6">
          <h2 className="text-2xl md:text-3xl font-bold text-[#111827] tracking-tight text-center mb-10">
            Less Waste. More Leverage.
          </h2>
          <div className="bg-white border border-[#E5E7EB] rounded-2xl overflow-hidden shadow-sm">
            <div className="grid grid-cols-3 text-xs font-bold uppercase tracking-wider">
              <div className="px-5 py-4 text-[#94A3B8] bg-[#F8F9FB]">Feature</div>
              <div className="px-5 py-4 text-[#4B5563] bg-[#F8F9FB] text-center">Traditional</div>
              <div className="px-5 py-4 text-[#0B5FD1] bg-[#EFF6FF] text-center">AutoLenis</div>
            </div>
            {[
              ["Dealer reach",        "One at a time",    "Up to 8 competing"],
              ["Pricing clarity",     "Confusing",        "Offers compared side-by-side"],
              ["Buying dynamic",      "High pressure",    "Buyer-controlled"],
              ["Contract visibility", "Hidden fees",      "Contract Shield review"],
              ["Time investment",     "Hours at the lot", "Structured remote process"],
            ].map(([label, trad, auto]) => (
              <div key={label} className="grid grid-cols-3 border-t border-[#F1F5F9]">
                <div className="px-5 py-4 text-sm font-medium text-[#374151]">{label}</div>
                <div className="px-5 py-4 text-sm text-[#94A3B8] text-center">{trad}</div>
                <div className="px-5 py-4 text-sm text-[#0B5FD1] font-semibold text-center bg-[#EFF6FF]/40">{auto}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Fix 4 — Section B: FAQ */}
      <section className="py-16">
        <div className="mx-auto max-w-3xl px-6">
          <h2 className="text-2xl font-bold text-[#111827] tracking-tight text-center mb-8">
            Common Questions
          </h2>
          <div className="space-y-4">
            {[
              {
                q: `Is the ${DEPOSIT_AMOUNT_USD} a plan or subscription?`,
                a: `No. The ${DEPOSIT_AMOUNT_USD} is a Limited-Time Auction Access Fee used to activate your private dealer auction. It is not a plan, not a subscription, and not a recurring charge.`,
              },
              {
                q: "Is the Auction Access Fee refundable?",
                a: "Yes. The Auction Access Fee is refundable if no valuable offer is received within your auction window.",
              },
              {
                q: "Are there any subscriptions?",
                a: "No. There are no monthly or recurring fees. The Auction Access Fee is a one-time auction activation, and Premium is a one-time concierge fee.",
              },
              {
                q: "Do I have to accept any offer?",
                a: "No. You can review all offers and accept, decline, or walk away. No commitment is required until you choose to move forward.",
              },
              {
                q: "Does AutoLenis guarantee savings?",
                a: "No. The platform improves competition and transparency but does not guarantee specific outcomes, savings, or financing terms.",
              },
            ].map((item, i) => (
              <div key={i}
                className="bg-white border border-[#E5E7EB] rounded-2xl p-6 shadow-sm">
                <p className="font-bold text-[#111827] text-sm mb-2">{item.q}</p>
                <p className="text-[#4B5563] text-sm leading-relaxed">{item.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Fix 4 — Section C: Trust strip */}
      <section className="py-12 bg-[#F8F9FB] border-t border-[#E5E7EB]">
        <div className="mx-auto max-w-5xl px-6">
          <h2 className="text-center text-sm font-bold text-[#94A3B8] uppercase tracking-[0.15em] mb-6">
            Designed for Clarity Before You Pay
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {[
              "No Hidden Pricing",
              "Clear Process",
              "Refund Visibility",
              "Secure Checkout",
              "Buyer-First Structure",
            ].map(label => (
              <div key={label}
                className="bg-white border border-[#E5E7EB] rounded-xl px-4 py-3 text-center text-xs font-semibold text-[#374151]">
                {label}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Faith verse */}
      <div className="mx-auto max-w-2xl px-6 pb-8"><FaithVerseModule pageKey="pricing" /></div>

      {/* Final CTA — Fix 2: standard CTA color + Fix 5: headline copy */}
      <section className="relative bg-[#0B5FD1] py-20 overflow-hidden">
        <img
          src={MARKETING_IMAGES.pricingCelebration}
          alt=""
          aria-hidden
          className="absolute inset-0 w-full h-full object-cover opacity-15"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#0A4DB8] via-[#0B5FD1]/90 to-[#0B5FD1]/70" />
        <div className="relative mx-auto max-w-7xl px-6 text-center">
          <h2 className="text-3xl font-bold text-white mb-3 tracking-tight">
            Start With Leverage Before You Buy.
          </h2>
          <p className="text-white/80 mb-8">
            Activate the process that helps dealers compete for your business.
          </p>
          <div className="flex flex-wrap gap-3 justify-center">
            <Link
              href="/auth/signup?plan=standard"
              data-testid="pricing-final-standard-cta"
              className="inline-flex items-center gap-2 px-7 py-3.5 bg-white text-[#0B5FD1] font-semibold text-sm rounded-md hover:bg-[#EFF6FF] transition-colors border border-white/30"
            >
              Start Free <ArrowRight size={15} />
            </Link>
            <Link
              href="/auth/signup?plan=premium"
              data-testid="pricing-final-premium-cta"
              className="inline-flex items-center gap-2 px-7 py-3.5 bg-white text-[#0B5FD1] font-semibold text-sm rounded-md hover:bg-[#EFF6FF] transition-colors"
            >
              Go Premium <ArrowRight size={15} />
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
