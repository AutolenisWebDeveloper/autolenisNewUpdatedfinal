import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  Clock,
  DollarSign,
  Shield,
  ShieldCheck,
  Star,
  User,
} from "lucide-react";
import StatsStrip from "@/components/public/StatsStrip";
import FaithVerseModule from "@/components/public/FaithVerseModule";
import FeaturedInventory from "@/components/public/FeaturedInventory";
import ComparisonTable from "@/components/public/ComparisonTable";
import SavingsCalculator from "@/components/public/SavingsCalculator";
import HeroLiveSignal from "@/components/public/HeroLiveSignal";
import ChatWidget from "@/components/public/ChatWidget";
import { buildPageMetadata, PAGE_METADATA } from "@/lib/seo/metadata";
import { JsonLd, localBusinessSchema } from "@/lib/seo/jsonld";

const HOMEPAGE_BASE_METADATA = buildPageMetadata(PAGE_METADATA.home);
const HOMEPAGE_OG_TITLE = "AutoLenis — Where Dealers Compete for You";
const HOMEPAGE_OG_DESCRIPTION =
  "Verified dealers compete for your business. Compare every offer. " +
  "Choose the best deal. Complete digital concierge.";

export const metadata: Metadata = {
  ...HOMEPAGE_BASE_METADATA,
  openGraph: {
    ...HOMEPAGE_BASE_METADATA.openGraph,
    title: HOMEPAGE_OG_TITLE,
    description: HOMEPAGE_OG_DESCRIPTION,
  },
  twitter: {
    ...HOMEPAGE_BASE_METADATA.twitter,
    title: HOMEPAGE_OG_TITLE,
    description: HOMEPAGE_OG_DESCRIPTION,
  },
};

// Authenticated-buyer redirect is handled at the edge in proxy.ts — no
// server component work needed here, so the page is fully static (ISR 1 h).
export const dynamic = "force-dynamic";
export const revalidate = 3600;

const HOW_IT_WORKS = [
  { step: "01", title: "Get Prequalified", body: "Free soft-pull prequalification in 3 minutes. See your exact pre-qualified budget — zero credit score impact." },
  { step: "02", title: "Choose Smart Inventory", body: "Browse curated vehicles selected for value and demand. Shortlist up to 5 vehicles with confirmed prices and real mileage." },
  { step: "03", title: "Activate Dealer Competition", body: "A small refundable Auction Access Deposit launches your auction. Up to 8 pre-vetted dealers compete privately within 48 hours." },
  { step: "04", title: "Buy With Confidence", body: "Compare offers ranked by total cost, monthly payment, and overall value. Choose the best deal — or decline and receive a full refund." },
];

const WHY_ITEMS = [
  { icon: DollarSign, title: "Better Pricing", body: "Dealers compete to earn your business. You receive up to 8 real offers — ranked by total cost, not just sticker price." },
  { icon: Shield, title: "More Control", body: "No pressure tactics. No dealership visits required. Buy entirely on your terms, at your pace." },
  { icon: Clock, title: "Smarter Financing", body: "Understand total cost of ownership — not just the monthly payment. We help you see the full financial picture." },
];

const TESTIMONIALS = [
  { name: "Marcus T.", location: "Atlanta, GA", tag: "Saved $2,100", text: "I had 5 offers in my inbox by 6am. Never set foot in a dealership. AutoLenis paid for itself before I even picked up the car.", rating: 5 },
  { name: "Priya S.", location: "Dallas, TX", tag: "Saved 8 Hours", text: "The Contract Shield caught a $400 documentation fee buried in the paperwork. I saved 8+ hours of back-and-forth and got a better deal.", rating: 5 },
  { name: "David R.", location: "Chicago, IL", tag: "Better APR Found", text: "I was skeptical this could really work. My dealer financing was 7.9%. AutoLenis found me 5.4%. This is how buying a car should work.", rating: 5 },
];

const FAQ_ITEMS = [
  {
    q: "Does prequalification hurt credit?",
    a: "No. We use a soft credit pull — zero impact on your score. A hard pull only happens with your explicit consent later in the process.",
  },
  {
    q: "Is the Auction Access Deposit refundable?",
    a: "Yes, fully. No competitive offer within 48 hours? Complete refund — no disputes, no conditions, no follow-up calls.",
  },
  {
    q: "How do dealer offers work?",
    a: "Up to 8 pre-vetted dealers receive a private invitation to compete for your business within 48 hours. You compare offers ranked by total cost, monthly payment, and overall value. You choose — or decline and get your deposit back.",
  },
  {
    q: "Is AutoLenis a dealership?",
    a: "No. We don't own vehicles or earn commissions from dealers. Our only revenue is the optional $499 Premium concierge fee — paid only when you choose a Premium deal. Standard buyers pay nothing to AutoLenis.",
  },
  {
    q: "Can I buy remotely?",
    a: "Yes, completely. Pre-qualification, offer selection, financing, e-signing, and delivery coordination — 100% remote. No dealership visit required.",
  },
];

const PRESS_LOGOS = ["Forbes", "Business Insider", "TechCrunch", "Automotive News", "NerdWallet"];

export default function HomePage() {
  return (
    <>
      {/* Organization, Website, Service entities are emitted once in the
          root layout via entityGraphSchema. Local-business stays here because
          the homepage is the canonical local-business landing. */}
      <JsonLd id="ld-localbusiness" data={localBusinessSchema()} />
      <HomePageBody />
    </>
  );
}

function HomePageBody() {
  return (
    <div className="bg-[#F8F9FB]">

      {/* ── SECTION 2: HERO ─────────────────────────────────────────────── */}
      <section className="relative pt-16 overflow-hidden bg-[#F8F9FB]" data-testid="hero-section">
        <div className="relative mx-auto max-w-7xl px-6 md:px-12">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center py-20 md:py-28">
            {/* Left */}
            <div>
              <p
                className="text-xs font-semibold uppercase tracking-[0.15em] text-[#0B5FD1] mb-6"
                data-testid="hero-badge"
              >
                The Buyer-First Car Buying Platform
              </p>
              <h1 className="text-5xl sm:text-6xl font-bold tracking-tighter text-[#111827] leading-[1.05] mb-6">
                Where Dealers<br />
                Compete for <span className="text-[#0B5FD1]">You.</span>
              </h1>
              <p className="text-lg text-[#4B5563] max-w-xl mb-10 leading-relaxed">
                AutoLenis helps you buy with leverage. Verified dealers compete for your business, you compare real offers side by side, and you choose the deal that works best for you.
              </p>
              <div className="flex flex-wrap gap-4">
                <Link
                  href="/auth/signup"
                  data-testid="hero-cta-primary"
                  className="inline-flex items-center gap-2 px-8 py-4 bg-[#0B5FD1] text-white font-semibold text-sm rounded-md hover:bg-[#1A6FE0] transition-colors shadow-md shadow-[#0B5FD1]/25"
                >
                  Compare Dealer Offers <ArrowRight size={16} />
                </Link>
                <Link
                  href="/how-it-works"
                  data-testid="hero-cta-secondary"
                  className="inline-flex items-center gap-2 px-8 py-4 border border-[#D1D5DB] text-[#111827] font-medium text-sm rounded-md hover:bg-white hover:border-[#0B5FD1] hover:text-[#0B5FD1] transition-all"
                >
                  See How It Works
                </Link>
              </div>
              {/* Trust signal bar */}
              <div
                className="mt-8 flex items-center gap-5 sm:gap-6"
                data-testid="hero-trust-bar"
              >
                <div className="flex items-center gap-2.5">
                  <ShieldCheck size={20} className="text-[#0B5FD1] shrink-0" aria-hidden />
                  <span className="text-xs font-medium text-[#4B5563] leading-tight">
                    No dealership<br />pressure
                  </span>
                </div>
                <div className="h-8 w-px bg-[#E5E7EB]" aria-hidden />
                <div className="flex items-center gap-2.5">
                  <User size={20} className="text-[#0B5FD1] shrink-0" aria-hidden />
                  <span className="text-xs font-medium text-[#4B5563] leading-tight">
                    Buyer-first<br />process
                  </span>
                </div>
                <div className="h-8 w-px bg-[#E5E7EB]" aria-hidden />
                <div className="flex items-center gap-2.5">
                  <BadgeCheck size={20} className="text-[#0B5FD1] shrink-0" aria-hidden />
                  <span className="text-xs font-medium text-[#4B5563] leading-tight">
                    Complete digital<br />concierge
                  </span>
                </div>
              </div>
              {/* Live activity signal */}
              <HeroLiveSignal />
            </div>

            {/* Right — offer comparison dashboard mockup */}
            {/* TODO: Replace placeholder with autolenis-hero-vehicle.jpg once delivered by design team */}
            <div className="relative hidden lg:flex items-center justify-center">
              <div className="relative w-full max-w-lg">

                {/* Main card */}
                <div className="bg-white rounded-2xl shadow-2xl shadow-[#0B5FD1]/10 border border-[#E5E7EB] overflow-hidden">
                  {/* Card header */}
                  <div className="bg-[#F8F9FB] border-b border-[#E5E7EB] px-5 py-4 flex items-center justify-between">
                    <div>
                      <p className="text-xs font-semibold text-[#6B7280] uppercase tracking-wide">Your Auction</p>
                      <p className="text-sm font-bold text-[#111827]">2024 Toyota Camry XSE</p>
                    </div>
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      Live · 6h left
                    </span>
                  </div>

                  {/* Offer rows */}
                  <div className="divide-y divide-[#F3F4F6]">
                    {[
                      { dealer: "Premier Toyota — Dallas", payment: "$521/mo", savings: "$2,800 below market", rank: 1, highlight: true },
                      { dealer: "AutoNation Ford — Plano", payment: "$538/mo", savings: "$2,100 below market", rank: 2, highlight: false },
                      { dealer: "Hendrick Chevrolet — Frisco", payment: "$547/mo", savings: "$1,650 below market", rank: 3, highlight: false },
                    ].map((offer) => (
                      <div key={offer.rank}
                        className={`flex items-center gap-4 px-5 py-4 ${offer.highlight ? "bg-[#EFF6FF]" : ""}`}>
                        <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                          offer.highlight ? "bg-[#0B5FD1] text-white" : "bg-[#F3F4F6] text-[#6B7280]"
                        }`}>{offer.rank}</div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-[#111827] truncate">{offer.dealer}</p>
                          <p className="text-xs text-[#10B981] font-medium">{offer.savings}</p>
                        </div>
                        <p className={`text-sm font-bold shrink-0 ${offer.highlight ? "text-[#0B5FD1]" : "text-[#111827]"}`}>
                          {offer.payment}
                        </p>
                      </div>
                    ))}
                  </div>

                  {/* Footer */}
                  <div className="bg-[#F8F9FB] border-t border-[#E5E7EB] px-5 py-3 flex items-center justify-between">
                    <p className="text-xs text-[#6B7280]">8 dealers invited · 3 offers received</p>
                    <p className="text-xs font-semibold text-[#0B5FD1]">Accept best offer →</p>
                  </div>
                </div>

                {/* Floating badge top-right */}
                <div className="absolute -top-4 -right-4 bg-[#0B5FD1] rounded-xl shadow-lg px-4 py-3 text-white">
                  <p className="text-xs font-semibold opacity-80">Competing dealers</p>
                  <p className="text-lg font-bold">8 bids</p>
                </div>

                {/* Floating savings card bottom-left */}
                <div className="absolute -bottom-8 -left-4 bg-white rounded-xl shadow-lg shadow-[#0B5FD1]/10 px-5 py-4 border border-[#E5E7EB]">
                  <p className="text-xs text-[#6B7280] mb-1">Best offer received</p>
                  <p className="text-2xl font-bold text-[#0B5FD1]">$2,800 <span className="text-sm font-medium text-[#10B981]">saved</span></p>
                  <p className="text-xs text-[#9CA3AF]">vs. market price</p>
                </div>

              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── SECTION 2.5: PRESS / CREDIBILITY BAR ────────────────────────── */}
      <section data-testid="press-bar">
        <div className="border-y border-[#E5E7EB] bg-[#F8F9FB] py-7">
          <div className="mx-auto max-w-7xl px-6 md:px-12">
            <p className="text-center text-xs font-semibold uppercase tracking-[0.15em] text-[#9CA3AF] mb-5">As Seen In</p>
            <div className="flex flex-wrap items-center justify-center gap-10 grayscale opacity-50">
              {PRESS_LOGOS.map((name) => (
                <span key={name} className="text-sm font-bold text-[#6B7280] tracking-tight">
                  {name}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── SECTION 3: STATS STRIP ───────────────────────────────────────── */}
      <StatsStrip />

      {/* ── SECTION 4: WHY AUTOLENIS ─────────────────────────────────────── */}
      <section className="py-24 md:py-32 bg-white" data-testid="why-section">
        <div className="mx-auto max-w-7xl px-6 md:px-12">
          <div className="mb-14 text-center">
            <span className="text-xs font-bold uppercase tracking-[0.15em] text-[#0B5FD1]">The Advantage</span>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-[#111827] mt-3">
              Built for Buyers, Not Sellers
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {WHY_ITEMS.map((item) => (
              <div
                key={item.title}
                data-testid={`why-item-${item.title.toLowerCase().replace(/\s+/g, "-")}`}
                className="bg-white border border-[#E5E7EB] rounded-2xl p-8 hover:border-[#0B5FD1]/40 hover:shadow-md transition-all"
              >
                <div className="w-12 h-12 rounded-xl bg-[#EEF4FF] flex items-center justify-center mb-6">
                  <item.icon size={20} className="text-[#0B5FD1]" />
                </div>
                <h3 className="font-bold text-[#111827] mb-3 text-base">{item.title}</h3>
                <p className="text-sm text-[#4B5563] leading-relaxed">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── SECTION 5: FEATURED INVENTORY ───────────────────────────────── */}
      <FeaturedInventory />

      {/* ── SECTION 6: HOW IT WORKS ──────────────────────────────────────── */}
      <section className="py-24 md:py-32 bg-white" data-testid="how-it-works-section">
        <div className="mx-auto max-w-7xl px-6 md:px-12">
          <div className="mb-16 text-center">
            <span className="text-xs font-bold uppercase tracking-[0.15em] text-[#0B5FD1]">The Process</span>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-[#111827] mt-3">
              Four Steps to Your Best Deal
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {HOW_IT_WORKS.map((item, idx) => (
              <div
                key={item.step}
                data-testid={`how-step-${item.step}`}
                className="relative bg-[#F8F9FB] border border-[#E5E7EB] rounded-2xl p-7 hover:border-[#0B5FD1]/40 hover:shadow-sm transition-all"
              >
                {idx < HOW_IT_WORKS.length - 1 && (
                  <div className="hidden lg:block absolute top-7 -right-3 z-10">
                    <ArrowRight size={16} className="text-[#0B5FD1]/30" />
                  </div>
                )}
                <p className="text-[56px] font-bold text-[#0B5FD1]/10 leading-none mb-5">{item.step}</p>
                <h3 className="text-sm font-bold text-[#111827] mb-2.5">{item.title}</h3>
                <p className="text-xs text-[#4B5563] leading-relaxed">{item.body}</p>
              </div>
            ))}
          </div>
          <div className="mt-10 text-center">
            <Link
              href="/how-it-works"
              data-testid="how-it-works-cta"
              className="inline-flex items-center gap-2 text-sm font-semibold text-[#0B5FD1] hover:text-[#1A6FE0] transition-colors"
            >
              Full process walkthrough <ArrowRight size={14} />
            </Link>
          </div>
        </div>
      </section>

      {/* ── SECTION 7: PAYMENT CALCULATOR ───────────────────────────────── */}
      <SavingsCalculator />

      {/* ── SECTION 8: SOCIAL PROOF / TESTIMONIALS ──────────────────────── */}
      <section className="py-24 md:py-32 bg-white" data-testid="testimonials-section">
        <div className="mx-auto max-w-7xl px-6 md:px-12">
          <div className="mb-14 text-center">
            <span className="text-xs font-bold uppercase tracking-[0.15em] text-[#0B5FD1]">Buyer Stories</span>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-[#111827] mt-3">
              Real Buyers. Real Savings.
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {TESTIMONIALS.map((t) => (
              <article
                key={t.name}
                data-testid={`testimonial-${t.name.toLowerCase().replace(/\s+/, "-")}`}
                className="bg-[#F8F9FB] border border-[#E5E7EB] rounded-2xl p-8 hover:border-[#0B5FD1]/30 hover:shadow-sm transition-all"
              >
                <div className="flex gap-0.5 mb-5">
                  {Array.from({ length: t.rating }).map((_, i) => (
                    <Star key={i} size={13} className="fill-amber-400 text-amber-400" />
                  ))}
                </div>
                <p className="text-[#4B5563] text-sm leading-relaxed mb-7 italic">&ldquo;{t.text}&rdquo;</p>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-bold text-[#111827] text-sm">{t.name}</p>
                    <p className="text-xs text-[#94A3B8]">{t.location}</p>
                  </div>
                  <span className="text-xs font-semibold text-[#0B5FD1] bg-[#EEF4FF] border border-[#BFDBFE] px-2.5 py-1 rounded-md">
                    {t.tag}
                  </span>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ── SECTION 9: COMPARISON TABLE ─────────────────────────────────── */}
      <ComparisonTable />

      {/* ── SECTION 10: FAQ ──────────────────────────────────────────────── */}
      <section className="py-24 md:py-32 bg-white" data-testid="faq-section">
        <div className="mx-auto max-w-3xl px-6 md:px-12">
          <div className="mb-12 text-center">
            <span className="text-xs font-bold uppercase tracking-[0.15em] text-[#0B5FD1]">FAQ</span>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-[#111827] mt-3">
              Common Questions
            </h2>
          </div>
          <div className="space-y-4">
            {FAQ_ITEMS.map((item, idx) => (
              <FaqItem key={idx} q={item.q} a={item.a} defaultOpen={idx === 0} />
            ))}
          </div>
        </div>
      </section>

      {/* ── SECTION 11: FINAL CTA ────────────────────────────────────────── */}
      <section className="bg-[#111111] py-20 md:py-28" data-testid="final-cta-section">
        <div className="mx-auto max-w-7xl px-6 md:px-12 text-center">
          <h2 className="text-4xl sm:text-5xl font-bold tracking-tight text-white mb-5">
            Your Next Car Should Be a Smart Decision
          </h2>
          <p className="text-white/70 mb-10 max-w-lg mx-auto leading-relaxed">
            Join 3,200+ buyers choosing a more intelligent way to purchase vehicles.
          </p>
          <div className="flex flex-wrap gap-4 justify-center">
            <Link
              href="/auth/signup"
              data-testid="final-cta-primary"
              className="inline-flex items-center gap-2 px-8 py-4 bg-[#0B5FD1] text-white font-semibold text-sm rounded-md hover:bg-[#1A6FE0] transition-colors shadow-md shadow-black/20"
            >
              Get Prequalified <ArrowRight size={16} />
            </Link>
            <Link
              href="/inventory"
              data-testid="final-cta-secondary"
              className="inline-flex items-center gap-2 px-8 py-4 border border-white/30 text-white font-medium text-sm rounded-md hover:bg-white/10 transition-colors"
            >
              Browse Vehicles
            </Link>
          </div>
        </div>
      </section>

      {/* ── SECTION 12: FAITH / VALUES PRE-FOOTER ───────────────────────── */}
      <section className="bg-[#0A0F1A] py-16 md:py-20" data-testid="faith-section">
        <div className="mx-auto max-w-4xl px-6 md:px-12 text-center">
          <div className="flex items-center gap-4 mb-10 justify-center">
            <div className="h-px w-16 bg-white/15" />
            <span className="text-xs font-bold uppercase tracking-[0.2em] text-white/40">
              Built on Integrity. Guided by Faith.
            </span>
            <div className="h-px w-16 bg-white/15" />
          </div>
          <FaithVerseModule pageKey="homepage" />
          <p className="text-sm text-white/40 mt-8 max-w-lg mx-auto leading-relaxed">
            AutoLenis is committed to honesty, fairness, and service in every customer
            experience. Christian-owned. Customer-first. Excellence-driven.
          </p>
        </div>
      </section>

      <ChatWidget />
    </div>
  );
}

// ── FAQ Accordion Item ───────────────────────────────────────────────────────
// Client component extracted inline via a server-compatible pattern using
// HTML details/summary for zero-JS accordion with full accessibility.
function FaqItem({ q, a, defaultOpen }: { q: string; a: string; defaultOpen?: boolean }) {
  return (
    <details
      className="group bg-white border border-[#E5E7EB] rounded-xl overflow-hidden"
      data-testid="faq-item"
      open={defaultOpen}
    >
      <summary className="flex items-center justify-between gap-4 px-6 py-5 cursor-pointer list-none hover:bg-[#F8F9FB] transition-colors">
        <span className="font-semibold text-[#111827] text-sm">{q}</span>
        <span className="shrink-0 w-5 h-5 rounded-full bg-[#EEF4FF] flex items-center justify-center text-[#0B5FD1] text-xs font-bold transition-transform group-open:rotate-45">
          +
        </span>
      </summary>
      <div className="px-6 pb-5 text-sm text-[#4B5563] leading-relaxed border-t border-[#E5E7EB] pt-4">
        {a}
      </div>
    </details>
  );
}
