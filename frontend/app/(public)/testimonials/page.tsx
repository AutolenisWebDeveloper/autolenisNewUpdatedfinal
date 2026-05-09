import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Quote } from "lucide-react";
import FaithVerseModule from "@/components/public/FaithVerseModule";
import { buildPageMetadata, PAGE_METADATA } from "@/lib/seo/metadata";
import {
  DEPOSIT_AMOUNT_CENTS,
  MAX_DEALER_INVITATIONS,
  AUCTION_DURATION_HOURS,
} from "@/lib/constants";

export const metadata: Metadata = buildPageMetadata(PAGE_METADATA.testimonials);
export const revalidate = 86400;

const BUYER_TESTIMONIALS = [
  {
    quote:
      "I got 6 dealer offers in 48 hours. One came in $2,800 below the price I was quoted at the lot the week before. The whole process took less time than one dealership visit.",
    name: "Marcus T.",
    location: "Dallas TX",
    plan: "Standard Plan",
  },
  {
    quote:
      "Contract Shield flagged a $1,200 dealer add-on I never would have caught. I had the dealer remove it before I signed. That alone was worth the entire process.",
    name: "Priya S.",
    location: "Houston TX",
    plan: "Premium Concierge",
  },
  {
    quote:
      "We did the entire deal from home. E-signed the contract on a Tuesday night. QR code pickup took 12 minutes at the lot. No pressure, no back-and-forth.",
    name: "James & Keisha R.",
    location: "Atlanta GA",
    plan: "Premium Concierge",
  },
  {
    quote:
      "As someone who dreads car dealerships, AutoLenis was exactly what I needed. I told them my budget, they did the rest. I never felt pressured once.",
    name: "Angela M.",
    location: "Phoenix AZ",
    plan: "Standard Plan",
  },
  {
    quote:
      "The prequalification was fast and didn't hurt my credit. I knew my budget before I started looking, which made the whole search much less stressful.",
    name: "DeShawn P.",
    location: "Charlotte NC",
    plan: "Standard Plan",
  },
  {
    quote:
      "Three dealers competed for my business. The best offer was significantly better than anything I'd gotten on my own. The deposit was worth it.",
    name: "Melissa K.",
    location: "Austin TX",
    plan: "Premium Concierge",
  },
];

const DEALER_TESTIMONIALS = [
  {
    quote:
      "The buyers I work with through AutoLenis are pre-qualified and ready to make a decision. My close rate on these deals is significantly higher than traditional leads.",
    name: "David K.",
    location: "Dallas TX",
    role: "Franchise Dealer",
  },
  {
    quote:
      "I submitted 4 offers last month and closed 3 of them. The structured format means I'm not wasting time on unqualified shoppers.",
    name: "Marcus T.",
    location: "Houston TX",
    role: "Independent Dealer",
  },
  {
    quote:
      "The platform respects dealer time. You see the buyer profile, you know the budget, you submit your best offer. Clean, professional process.",
    name: "Jennifer R.",
    location: "Austin TX",
    role: "Pre-Owned Specialist",
  },
];

const AFFILIATE_TESTIMONIALS = [
  {
    quote:
      "My audience trusts me to recommend products that actually help them. AutoLenis is the first car-buying platform I've felt genuinely good about promoting.",
    attribution: "Financial educator, 45K YouTube subscribers",
  },
  {
    quote:
      "The commission structure is transparent and the product sells itself — people already know car buying is broken. AutoLenis just fixes it.",
    attribution: "Personal finance blogger, 28K newsletter subscribers",
  },
];

const METRICS = [
  {
    value: `Up to ${MAX_DEALER_INVITATIONS}`,
    label: "Dealers competing per auction",
  },
  {
    value: `${AUCTION_DURATION_HOURS}h`,
    label: "Average auction window",
  },
  {
    value: `$${(DEPOSIT_AMOUNT_CENTS / 100).toFixed(0)}`,
    label: "Fully refundable deposit",
  },
  {
    value: "3 min",
    label: "Estimated prequalification time",
  },
];

export default function TestimonialsPage() {
  return (
    <div className="bg-[#F8F9FB]">
      {/* Hero */}
      <section className="pt-16 py-24 md:py-32 text-center bg-gradient-to-b from-[#F8F9FB] to-white">
        <div className="mx-auto max-w-7xl px-6 md:px-12">
          <span className="text-xs font-semibold uppercase tracking-[0.15em] text-[#0B5FD1]">
            REAL STORIES
          </span>
          <h1 className="text-5xl sm:text-6xl font-bold tracking-tight text-[#111827] mt-4 mb-5">
            Real Buyers. Real Outcomes.
          </h1>
          <p className="text-[#4B5563] text-lg max-w-2xl mx-auto leading-relaxed">
            AutoLenis is built on a simple premise: buyers deserve a better process. Here's what
            people say when that process works.
          </p>
        </div>
      </section>

      {/* Buyer Testimonials */}
      <section className="py-20 bg-white">
        <div className="mx-auto max-w-7xl px-6 md:px-12">
          <h2 className="text-2xl font-bold tracking-tight text-[#111827] mb-10">
            Buyer Experiences
          </h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {BUYER_TESTIMONIALS.map((t) => (
              <div
                key={t.name}
                className="bg-white border-l-4 border-[#0B5FD1] border border-[#E5E7EB] rounded-2xl shadow-sm p-8"
              >
                <Quote size={20} className="text-[#DBEAFE] mb-4" />
                <p className="text-sm text-[#4B5563] italic leading-relaxed mb-6">{t.quote}</p>
                <div>
                  <p className="font-bold text-[#111827] text-sm">— {t.name}</p>
                  <p className="text-xs text-[#94A3B8] mt-0.5">
                    {t.location} · {t.plan}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Dealer Testimonials */}
      <section className="py-20 bg-[#F8F9FB]">
        <div className="mx-auto max-w-7xl px-6 md:px-12">
          <h2 className="text-2xl font-bold tracking-tight text-[#111827] mb-10">
            Dealer Perspectives
          </h2>
          <div className="grid sm:grid-cols-3 gap-6">
            {DEALER_TESTIMONIALS.map((t) => (
              <div
                key={t.name}
                className="bg-[#F8F9FB] border-t-4 border-[#0B5FD1] border border-[#E5E7EB] rounded-2xl shadow-sm p-8"
              >
                <Quote size={20} className="text-[#DBEAFE] mb-4" />
                <p className="text-sm text-[#4B5563] italic leading-relaxed mb-6">{t.quote}</p>
                <div>
                  <p className="font-bold text-[#111827] text-sm">— {t.name}</p>
                  <p className="text-xs text-[#94A3B8] mt-0.5">
                    {t.location} · {t.role}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Affiliate Testimonials */}
      <section className="py-20 bg-white">
        <div className="mx-auto max-w-7xl px-6 md:px-12">
          <h2 className="text-2xl font-bold tracking-tight text-[#111827] mb-10">
            Affiliate Partner Stories
          </h2>
          <div className="grid sm:grid-cols-2 gap-6 max-w-4xl">
            {AFFILIATE_TESTIMONIALS.map((t) => (
              <div
                key={t.attribution}
                className="bg-white border border-[#E5E7EB] rounded-2xl shadow-sm p-8"
              >
                <Quote size={20} className="text-[#DBEAFE] mb-4" />
                <p className="text-sm text-[#4B5563] italic leading-relaxed mb-6">{t.quote}</p>
                <p className="text-xs text-[#94A3B8]">— {t.attribution}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Aggregate Metrics */}
      <section className="py-20 bg-[#F8F9FB]">
        <div className="mx-auto max-w-7xl px-6 md:px-12">
          <h2 className="text-2xl font-bold tracking-tight text-[#111827] mb-12 text-center">
            The Numbers Behind the Stories
          </h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
            {METRICS.map((m) => (
              <div
                key={m.label}
                className="bg-white border border-[#E5E7EB] rounded-2xl shadow-sm p-8 text-center"
              >
                <p className="text-3xl font-bold font-[family-name:var(--font-mono)] text-[#0B5FD1] mb-2">
                  {m.value}
                </p>
                <p className="text-xs text-[#4B5563]">{m.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Leave a Review */}
      <section className="py-20 bg-white">
        <div className="mx-auto max-w-2xl px-6 text-center">
          <h2 className="text-2xl font-bold tracking-tight text-[#111827] mb-4">
            Had an AutoLenis Experience?
          </h2>
          <p className="text-[#4B5563] text-sm leading-relaxed mb-8">
            We're actively collecting buyer, dealer, and affiliate stories. If you've used
            AutoLenis, we'd love to hear about your experience.
          </p>
          <Link
            href="/contact"
            className="inline-flex items-center gap-2 px-6 py-3 border border-[#DBEAFE] text-[#0B5FD1] font-semibold text-sm rounded-md hover:bg-[#EFF6FF] transition-colors"
          >
            Share Your Story <ArrowRight size={16} />
          </Link>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-24 bg-[#0B5FD1] text-center">
        <div className="mx-auto max-w-3xl px-6">
          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4 tracking-tight">
            Ready to Write Your Own Story?
          </h2>
          <p className="text-white/80 text-lg mb-8 leading-relaxed">
            Start with prequalification and let AutoLenis help you buy smarter.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="/auth/signup"
              className="inline-flex items-center gap-2 px-8 py-4 bg-white text-[#0B5FD1] font-semibold text-sm rounded-md hover:bg-[#EFF6FF] transition-colors shadow-md"
            >
              Get Prequalified <ArrowRight size={16} />
            </Link>
            <Link
              href="/inventory"
              className="inline-flex items-center gap-2 px-8 py-4 border border-white/40 text-white font-semibold text-sm rounded-md hover:bg-white/10 transition-colors"
            >
              Browse Vehicles
            </Link>
          </div>
        </div>
      </section>

      {/* Faith Module */}
      <section className="py-16 bg-[#0B5FD1] border-t border-white/10 text-center">
        <div className="mx-auto max-w-3xl px-6">
          <FaithVerseModule pageKey="testimonials" />
        </div>
      </section>
    </div>
  );
}
