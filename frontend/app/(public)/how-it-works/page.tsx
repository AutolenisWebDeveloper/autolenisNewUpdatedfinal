import type { Metadata } from "next";
import Link from "next/link";
import {
  ShieldCheck, Search, Gavel, Trophy,
  CheckCircle2, Clock, Lock, Eye, Heart,
  TrendingUp, Target, X,
} from "lucide-react";
import { buildPageMetadata, PAGE_METADATA } from "@/lib/seo/metadata";
import { JsonLd, faqSchema } from "@/lib/seo/jsonld";
import FaithVerseModule from "@/components/public/FaithVerseModule";
import CitationBlock from "@/components/seo/CitationBlock";
import DefinitionBlock from "@/components/seo/DefinitionBlock";
import LastUpdated from "@/components/seo/LastUpdated";

export const metadata: Metadata = buildPageMetadata(PAGE_METADATA.howItWorks);
export const dynamic = "force-dynamic";
export const revalidate = 86400;

const FAQS = [
  {
    q: "Does prequalification hurt my credit score?",
    a: "No. AutoLenis uses a soft credit pull only during prequalification — this never appears on your credit report and never impacts your score. A hard pull only happens much later, after you've selected your offer and are ready to finalize financing with a lender.",
  },
  {
    q: "What is the Auction Access Fee?",
    a: "The Auction Access Fee is a limited-time, refundable payment that activates your private 48-hour dealer competition. It signals serious intent to participating dealers and ensures everyone in the auction is committed to submitting their best offer.",
  },
  {
    q: "Is the Auction Access Fee refundable?",
    a: "Yes. If no valuable offer is received within your 48-hour auction window, every cent of your Auction Access Fee is returned automatically. No questions, no fees, no follow-up calls.",
  },
  {
    q: "How many dealers compete for my business?",
    a: "Up to 8 verified dealers participate in each private auction. AutoLenis vets and invites dealers based on your vehicle preferences and location, ensuring all participants are licensed and capable of completing your deal.",
  },
  {
    q: "Am I required to accept an offer?",
    a: "Never. You are under no obligation to accept any offer that arrives. If none of the offers meet your expectations, you can decline them all and receive a full refund of your Auction Access Fee.",
  },
  {
    q: "Is AutoLenis a dealership?",
    a: "No. AutoLenis is not a dealership, broker, or party to any vehicle transaction. We are a buyer-first platform that creates structure and competition around the car-buying process. The vehicle transaction happens directly between you and the dealer you choose.",
  },
  {
    q: "Can I complete the entire process remotely?",
    a: "Yes. Prequalification, vehicle selection, auction activation, offer comparison, financing coordination, e-signing, and delivery can all be handled digitally. Many AutoLenis buyers never visit a dealership in person until vehicle pickup — and delivery to your door is available through Premium.",
  },
];

const STEPS = [
  {
    n: "01",
    title: "Get Prequalified",
    icon: ShieldCheck,
    body: "Know your real buying power in under 3 minutes. Soft-pull only — no credit score impact. Your pre-qualified budget becomes the ceiling: no dealer can pitch you above it.",
    tag: "3 minutes · No credit impact",
  },
  {
    n: "02",
    title: "Choose Your Vehicles",
    icon: Search,
    body: "Browse verified inventory filtered to your exact budget. Add up to 5 vehicles to your private shortlist — these are what dealers compete to sell you.",
    tag: "Budget-filtered · Up to 5 vehicles",
  },
  {
    n: "03",
    title: "Activate Dealer Competition",
    icon: Gavel,
    body: "A refundable Auction Access Fee opens your private 48-hour dealer competition. Up to 8 verified dealers submit their best offers — you stay anonymous throughout.",
    tag: "48-hour window · Fully refundable",
  },
  {
    n: "04",
    title: "Buy With Confidence",
    icon: Trophy,
    body: "Compare total cost — not just monthly payment. Pick your offer, complete financing, e-sign the contract, and schedule delivery or pickup. No pressure. No surprise fees.",
    tag: "Total-cost comparison · E-sign included",
  },
];

const OLD_WAY = [
  "One dealership's leverage",
  "Monthly payment distraction tactics",
  "High-pressure closing techniques",
  "Hidden fees disclosed at signing",
  "Hours wasted at the lot",
  "You negotiate alone",
];

const NEW_WAY = [
  "Up to 8 dealers compete for your business",
  "Compare total cost, not just monthly payment",
  "Buyer controls the entire timeline",
  "Transparent fees before you commit",
  "Complete the process from your phone",
  "Concierge support from auction to pickup",
];

const PREQUAL_CARDS = [
  {
    icon: ShieldCheck,
    title: "Soft-Pull Only",
    body: "No credit score impact — ever. Your pre-qualification never appears on your credit report.",
  },
  {
    icon: Target,
    title: "Budget-Filtered Inventory",
    body: "Every vehicle you see is already within your approved budget. No false starts.",
  },
  {
    icon: Clock,
    title: "Under 3 Minutes",
    body: "Fill out your profile, get prequalified, and start browsing — all in less time than a coffee break.",
  },
  {
    icon: TrendingUp,
    title: "Stronger Offer Quality",
    body: "Dealers who know your prequalified budget submit more competitive offers from the start.",
  },
];

const DEPOSIT_STATS = [
  { label: "Refundable", desc: "Full refund if no valuable offer is received" },
  { label: "48 Hours", desc: "Dealers submit their best offers in 48 hours" },
  { label: "Private", desc: "You stay anonymous throughout the auction" },
  { label: "Up to 8", desc: "Verified dealers compete for your business" },
];

const TRUST_CARDS = [
  {
    icon: Lock,
    title: "Secure Platform",
    body: "End-to-end encrypted. Your data is never sold to third parties or shared with dealers until you choose.",
  },
  {
    icon: Eye,
    title: "Transparent Process",
    body: "Every step is visible. No hidden fees, no surprise charges, no dealer contact without your consent.",
  },
  {
    icon: ShieldCheck,
    title: "Buyer-First Incentives",
    body: "We succeed when you get a great deal. Our fee is only charged after you select an offer you love.",
  },
  {
    icon: Heart,
    title: "Values-Driven Company",
    body: "AutoLenis was built to fix a broken process. We believe buying a car should be intelligent, fair, and stress-free.",
  },
];

export default function HowItWorksPage() {
  return (
    <>
      <JsonLd id="ld-faq" data={faqSchema(FAQS.map(f => ({ question: f.q, answer: f.a })))} />

      {/* ── Section 1: Hero ── */}
      <section className="bg-white py-20 md:py-28" data-testid="hiw-hero">
        <div className="mx-auto max-w-7xl px-6 md:px-12">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center">
            {/* Left column */}
            <div>
              <p className="text-xs tracking-widest uppercase font-semibold text-[#0B5FD1] mb-4">
                HOW IT WORKS
              </p>
              <h1 className="text-4xl sm:text-5xl lg:text-[52px] font-bold text-[#111827] tracking-tight leading-[1.08] mb-5">
                A Smarter Way to Buy Your Next Car.
              </h1>
              <p className="text-base sm:text-lg text-[#4B5563] leading-relaxed mb-8 max-w-lg">
                AutoLenis replaces dealership pressure with a guided, buyer-first process — prequalification, dealer competition, transparent comparisons, and confident decisions.
              </p>
              <div className="flex flex-col sm:flex-row gap-3 mb-8">
                <Link
                  href="/auth/signup"
                  data-testid="hiw-hero-cta-primary"
                  className="inline-flex items-center justify-center rounded-xl bg-[#0B5FD1] hover:bg-[#0A4DB8] text-white font-semibold text-sm px-7 h-12 shadow-lg shadow-[#0B5FD1]/25 transition-colors"
                >
                  Get Prequalified
                </Link>
                <Link
                  href="/inventory"
                  data-testid="hiw-hero-cta-secondary"
                  className="inline-flex items-center justify-center rounded-xl border border-[#0B5FD1] text-[#0B5FD1] font-semibold text-sm px-7 h-12 hover:bg-[#EFF6FF] transition-colors"
                >
                  Browse Vehicles
                </Link>
              </div>
              {/* Trust strip */}
              <div className="flex flex-wrap gap-2">
                {["Soft-pull only", "48-hour auction", "Fully refundable", "Buyer-first"].map((badge) => (
                  <span
                    key={badge}
                    className="text-xs font-medium text-[#4B5563] bg-[#F8F9FB] border border-[#E5E7EB] rounded-full px-3 py-1"
                  >
                    {badge}
                  </span>
                ))}
              </div>
            </div>

            {/* Right column — floating card stack */}
            <div className="relative flex items-center justify-center">
              <div className="relative w-full max-w-sm mx-auto bg-[#F8F9FB] rounded-3xl p-6 min-h-[320px]"
                style={{
                  backgroundImage: "radial-gradient(circle, #E5E7EB 1px, transparent 1px)",
                  backgroundSize: "24px 24px",
                }}
              >
                {/* Card 3 — bottom */}
                <div className="absolute bottom-8 left-8 right-8 bg-white border border-[#E5E7EB] rounded-2xl shadow-lg shadow-[#0B5FD1]/10 p-4 translate-y-2 opacity-70">
                  <p className="text-xs text-[#94A3B8] mb-1">Auction Status</p>
                  <p className="text-sm font-bold text-[#111827]">Closes in <span className="text-[#0B5FD1]">4h 12m</span></p>
                </div>
                {/* Card 2 — mid */}
                <div className="absolute bottom-12 left-6 right-6 bg-white border border-[#E5E7EB] rounded-2xl shadow-lg shadow-[#0B5FD1]/10 p-4">
                  <p className="text-xs text-[#94A3B8] mb-1">Dealer Offers</p>
                  <p className="text-sm font-bold text-[#111827]">3 Offers Received</p>
                  <div className="flex gap-2 mt-2">
                    {["$41,200", "$42,400", "$43,100"].map((amt) => (
                      <span key={amt} className="text-[11px] font-semibold bg-[#EFF6FF] text-[#0B5FD1] rounded-full px-2 py-0.5">{amt}</span>
                    ))}
                  </div>
                </div>
                {/* Card 1 — top */}
                <div className="relative z-10 bg-white border border-[#E5E7EB] rounded-2xl shadow-lg shadow-[#0B5FD1]/10 p-5">
                  <div className="flex items-center gap-3 mb-3">
                    <span className="h-8 w-8 rounded-full bg-[#10B981]/15 flex items-center justify-center">
                      <CheckCircle2 size={16} className="text-[#10B981]" />
                    </span>
                    <div>
                      <p className="text-xs text-[#94A3B8]">Status</p>
                      <p className="text-sm font-bold text-[#111827]">Buyer Prequalified</p>
                    </div>
                  </div>
                  <div className="bg-[#EFF6FF] rounded-xl px-4 py-2 flex items-center justify-between">
                    <span className="text-xs text-[#4B5563]">Approved budget</span>
                    <span className="text-sm font-bold text-[#0B5FD1]">$58,400</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Section 1.5: AI-extractable citation + definition ── */}
      <section className="bg-white py-10" data-testid="hiw-ai-citation">
        <div className="mx-auto max-w-3xl px-6 md:px-12">
          <DefinitionBlock
            term="AutoLenis"
            category="Automotive Service"
            definition="AutoLenis is an automotive buying concierge platform that connects pre-qualified car buyers with verified dealers through a private 48-hour auction. AutoLenis is not a dealership, broker, or party to any vehicle transaction — the sale happens directly between the buyer and the dealer they choose. Buyers receive multiple competing offers and select the best price without visiting a dealership."
            relatedTerms={["Car Buying Concierge", "Dealer Auction", "Reverse Auction", "Vehicle Pre-Qualification"]}
          />
          <CitationBlock
            id="how-autolenis-works"
            question="How does AutoLenis work?"
            answer="AutoLenis works in 6 steps: (1) Get pre-qualified online with a soft credit pull. (2) Browse and shortlist vehicles. (3) Pay a $99 Limited-Time Auction Access Fee (refundable if no valuable offer is received). (4) AutoLenis launches a private 48-hour dealer auction. (5) Review competing dealer offers side-by-side. (6) Select the best offer and sign via DocuSign. Because dealers compete privately for your business, the auction is designed to surface their most competitive pricing — actual results vary by vehicle, market, and dealer participation."
            sourceLabel="AutoLenis Official"
            lastUpdated="2025-01-01"
          />
          <LastUpdated date="2025-01-01" />
        </div>
      </section>

      {/* ── Section 2: Process Steps ── */}
      <section className="py-20 md:py-24 bg-white" data-testid="hiw-process">
        <div className="mx-auto max-w-7xl px-6 md:px-12">
          <div className="text-center max-w-2xl mx-auto mb-14">
            <h2 className="text-3xl md:text-4xl font-bold text-[#111827] tracking-tight mb-3">
              Four Steps to Your Best Deal
            </h2>
            <p className="text-[#4B5563]">Structure, leverage, and clarity — from first click to final decision.</p>
          </div>

          {/* Desktop: 4 columns with connecting line */}
          <div className="hidden md:block relative" data-testid="hiw-step-grid">
            {/* Connecting line behind step number chips */}
            <div className="absolute top-[22px] left-[12.5%] right-[12.5%] h-0.5 bg-[#DBEAFE]" aria-hidden="true" />
            <div className="grid grid-cols-4 gap-5">
              {STEPS.map((s) => (
                <div
                  key={s.n}
                  data-testid={`hiw-step-${s.n}`}
                  className="relative bg-white border border-[#E5E7EB] rounded-2xl p-7 hover:border-[#93C5FD] hover:shadow-md hover:shadow-[#0B5FD1]/10 transition-all"
                >
                  {/* Step number chip */}
                  <div className="flex justify-center mb-5">
                    <span className="bg-[#EFF6FF] text-[#0B5FD1] font-mono font-bold text-sm px-3 py-1 rounded-full relative z-10">
                      {s.n}
                    </span>
                  </div>
                  <div className="h-10 w-10 rounded-xl bg-[#EFF6FF] flex items-center justify-center mb-4 mx-auto">
                    <s.icon size={20} className="text-[#0B5FD1]" />
                  </div>
                  <h3 className="text-base font-bold text-[#111827] mb-2 text-center">{s.title}</h3>
                  <p className="text-sm text-[#4B5563] leading-relaxed mb-4 text-center">{s.body}</p>
                  <div className="flex justify-center">
                    <span className="inline-flex items-center text-[11px] font-semibold uppercase tracking-wider text-[#0B5FD1] bg-[#EFF6FF] rounded-full px-3 py-1 text-center">
                      {s.tag}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Mobile: vertical stack */}
          <div className="md:hidden space-y-4">
            {STEPS.map((s) => (
              <div
                key={s.n}
                data-testid={`hiw-step-${s.n}`}
                className="bg-white border border-[#E5E7EB] rounded-2xl p-7 hover:border-[#93C5FD] hover:shadow-md hover:shadow-[#0B5FD1]/10 transition-all"
              >
                <div className="flex items-center gap-3 mb-3">
                  <span className="bg-[#EFF6FF] text-[#0B5FD1] font-mono font-bold text-sm px-3 py-1 rounded-full shrink-0">
                    {s.n}
                  </span>
                  <div className="h-9 w-9 rounded-xl bg-[#EFF6FF] flex items-center justify-center shrink-0">
                    <s.icon size={18} className="text-[#0B5FD1]" />
                  </div>
                  <h3 className="text-base font-bold text-[#111827]">{s.title}</h3>
                </div>
                <p className="text-sm text-[#4B5563] leading-relaxed mb-3">{s.body}</p>
                <span className="inline-flex items-center text-[11px] font-semibold uppercase tracking-wider text-[#0B5FD1] bg-[#EFF6FF] rounded-full px-3 py-1">
                  {s.tag}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Section 3: Old Way vs AutoLenis ── */}
      <section className="py-20 md:py-24 bg-[#EFF6FF]" data-testid="hiw-comparison">
        <div className="mx-auto max-w-7xl px-6 md:px-12">
          <div className="text-center max-w-2xl mx-auto mb-12">
            <h2 className="text-3xl md:text-4xl font-bold text-[#111827] tracking-tight mb-3">
              Traditional Dealerships Put Buyers at a Disadvantage.
            </h2>
            <p className="text-[#4B5563]">Here's what changes with AutoLenis.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Left — Traditional */}
            <div className="bg-white border border-[#FCA5A5]/50 rounded-2xl p-8">
              <div className="flex items-center gap-3 mb-6">
                <h3 className="text-lg font-bold text-[#111827]">The Old Way</h3>
                <span className="text-xs font-semibold text-[#6B7280] bg-[#F3F4F6] rounded-full px-3 py-1">Traditional</span>
              </div>
              <ul className="space-y-3">
                {OLD_WAY.map((item) => (
                  <li key={item} className="flex items-start gap-3 text-sm text-[#4B5563]">
                    <X size={16} className="text-red-400 shrink-0 mt-0.5" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
            {/* Right — AutoLenis */}
            <div className="bg-[#0B5FD1] rounded-2xl p-8">
              <div className="flex items-center gap-3 mb-6">
                <h3 className="text-lg font-bold text-white">The AutoLenis Way</h3>
                <span className="text-xs font-semibold text-[#0B5FD1] bg-[#10B981] rounded-full px-3 py-1">Smarter Choice</span>
              </div>
              <ul className="space-y-3">
                {NEW_WAY.map((item) => (
                  <li key={item} className="flex items-start gap-3 text-sm text-white">
                    <CheckCircle2 size={16} className="text-[#10B981] shrink-0 mt-0.5" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ── Section 4: Prequalification ── */}
      <section className="py-20 md:py-24 bg-white" data-testid="hiw-prequal">
        <div className="mx-auto max-w-7xl px-6 md:px-12">
          <div className="text-center max-w-2xl mx-auto mb-12">
            <h2 className="text-3xl md:text-4xl font-bold text-[#111827] tracking-tight mb-3">
              Start With Buying Power, Not Guesswork.
            </h2>
            <p className="text-[#4B5563]">
              AutoLenis gives you real budget clarity before you ever talk to a dealer. That clarity changes everything.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 mb-10">
            {PREQUAL_CARDS.map((card) => (
              <div
                key={card.title}
                className="bg-white border border-[#E5E7EB] rounded-2xl p-7 hover:border-[#93C5FD] hover:shadow-md hover:shadow-[#0B5FD1]/10 transition-all"
              >
                <div className="h-11 w-11 rounded-xl bg-[#EFF6FF] flex items-center justify-center mb-4">
                  <card.icon size={20} className="text-[#0B5FD1]" />
                </div>
                <h3 className="text-base font-bold text-[#111827] mb-2">{card.title}</h3>
                <p className="text-sm text-[#4B5563] leading-relaxed">{card.body}</p>
              </div>
            ))}
          </div>
          <div className="text-center">
            <Link
              href="/auth/signup"
              className="inline-flex items-center justify-center rounded-xl bg-[#0B5FD1] hover:bg-[#0A4DB8] text-white font-semibold text-sm px-8 h-12 shadow-lg shadow-[#0B5FD1]/25 transition-colors"
            >
              Get Prequalified — It's Free
            </Link>
          </div>
        </div>
      </section>

      {/* ── Section 5: Auction Access Fee ── */}
      <section className="py-20 md:py-24 bg-[#0A0F1A]" data-testid="hiw-deposit">
        <div className="mx-auto max-w-7xl px-6 md:px-12">
          <div className="text-center max-w-2xl mx-auto mb-12">
            <h2 className="text-3xl md:text-4xl font-bold text-white tracking-tight mb-3">
              The Auction Access Fee Keeps the Process Serious.
            </h2>
            <p className="text-white/70">
              A refundable Auction Access Fee activates your private 48-hour dealer competition and ensures every participant is committed to winning your business.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {DEPOSIT_STATS.map((stat) => (
              <div
                key={stat.label}
                className="bg-white/10 border border-white/20 rounded-2xl p-6 text-center"
              >
                <p className="text-xl font-bold text-white mb-2">{stat.label}</p>
                <p className="text-sm text-white/60 leading-relaxed">{stat.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Section 6: Dealer Competition ── */}
      <section className="py-20 md:py-24 bg-[#F8F9FB]" data-testid="hiw-competition">
        <div className="mx-auto max-w-7xl px-6 md:px-12">
          <div className="text-center max-w-2xl mx-auto mb-12">
            <h2 className="text-3xl md:text-4xl font-bold text-[#111827] tracking-tight mb-3">
              Make Dealers Compete Before You Commit.
            </h2>
            <p className="text-[#4B5563]">
              You see ranked offers before entering a dealership. This is the leverage traditional buyers never have.
            </p>
          </div>
          {/* Mock ranked offer UI */}
          <div className="max-w-2xl mx-auto space-y-3 mb-6">
            {/* Best Price */}
            <div className="bg-[#EFF6FF] border border-[#0B5FD1] rounded-xl px-6 py-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="text-[11px] font-bold uppercase tracking-wider bg-[#0B5FD1] text-white rounded-full px-2.5 py-1">
                    BEST PRICE
                  </span>
                  <span className="text-xs text-[#4B5563]">Dealer A</span>
                </div>
                <div className="flex flex-wrap items-center gap-4 text-sm">
                  <span className="font-bold text-[#111827]">$41,200 OTD</span>
                  <span className="text-[#4B5563]">3.9% APR</span>
                  <span className="text-[#4B5563]">60mo</span>
                  <span className="text-xs text-[#4B5563]">Total: $46,940</span>
                </div>
              </div>
            </div>
            {/* Best Monthly */}
            <div className="bg-white border border-[#E5E7EB] rounded-xl px-6 py-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="text-[11px] font-bold uppercase tracking-wider bg-[#EFF6FF] text-[#0B5FD1] rounded-full px-2.5 py-1">
                    BEST MONTHLY
                  </span>
                  <span className="text-xs text-[#4B5563]">Dealer B</span>
                </div>
                <div className="flex flex-wrap items-center gap-4 text-sm">
                  <span className="font-bold text-[#111827]">$42,400 OTD</span>
                  <span className="text-[#4B5563]">2.9% APR</span>
                  <span className="text-[#4B5563]">72mo</span>
                  <span className="text-xs text-[#4B5563]">Total: $47,100</span>
                </div>
              </div>
            </div>
            {/* Third */}
            <div className="bg-white border border-[#E5E7EB] rounded-xl px-6 py-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="text-[11px] font-bold uppercase tracking-wider bg-[#F3F4F6] text-[#6B7280] rounded-full px-2.5 py-1">
                    #3
                  </span>
                  <span className="text-xs text-[#4B5563]">Dealer C</span>
                </div>
                <div className="flex flex-wrap items-center gap-4 text-sm">
                  <span className="font-bold text-[#111827]">$43,100 OTD</span>
                  <span className="text-[#4B5563]">4.2% APR</span>
                  <span className="text-[#4B5563]">60mo</span>
                  <span className="text-xs text-[#4B5563]">Total: $48,800</span>
                </div>
              </div>
            </div>
          </div>
          <p className="text-xs text-[#94A3B8] text-center mb-8">
            Dealer identities are revealed only after you select your offer.
          </p>
          <div className="text-center">
            <Link
              href="/inventory"
              className="text-sm font-semibold text-[#0B5FD1] hover:underline"
            >
              See Available Vehicles →
            </Link>
          </div>
        </div>
      </section>

      {/* ── Section 7: Financing Clarity ── */}
      <section className="py-20 md:py-24 bg-white" data-testid="hiw-financing">
        <div className="mx-auto max-w-7xl px-6 md:px-12">
          <div className="text-center max-w-2xl mx-auto mb-12">
            <h2 className="text-3xl md:text-4xl font-bold text-[#111827] tracking-tight mb-3">
              Smart Buyers Look Beyond the Monthly Payment.
            </h2>
            <p className="text-[#4B5563]">
              The monthly payment is the least important number. Total cost of ownership is what actually matters.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-2xl mx-auto mb-10">
            {/* Left card — trap */}
            <div className="bg-white border border-[#E5E7EB] rounded-2xl p-7">
              <h3 className="text-base font-bold text-[#111827] mb-4">The Monthly Payment Trap</h3>
              <p className="text-3xl font-bold text-[#111827] mb-1">$599<span className="text-base font-normal text-[#4B5563]">/mo</span></p>
              <p className="text-xs text-[#10B981] font-medium mb-4">Sounds affordable</p>
              <div className="bg-[#FEF2F2] rounded-xl p-4 space-y-1">
                <p className="text-xs text-[#4B5563]">84-month term</p>
                <p className="text-xs text-[#4B5563]">7.9% APR</p>
                <p className="text-sm font-bold text-red-500">Total: $50,316</p>
              </div>
            </div>
            {/* Right card — smart */}
            <div className="bg-white border-2 border-[#10B981] rounded-2xl p-7 relative">
              <span className="absolute -top-3 left-6 text-[11px] font-bold uppercase tracking-wider bg-[#10B981] text-white rounded-full px-3 py-1">
                Smarter Choice
              </span>
              <h3 className="text-base font-bold text-[#111827] mb-4">The Total Cost Perspective</h3>
              <p className="text-3xl font-bold text-[#111827] mb-1">$641<span className="text-base font-normal text-[#4B5563]">/mo</span></p>
              <p className="text-xs text-[#94A3B8] font-medium mb-4">Slightly higher monthly</p>
              <div className="bg-[#F0FDF4] rounded-xl p-4 space-y-1">
                <p className="text-xs text-[#4B5563]">60-month term</p>
                <p className="text-xs text-[#4B5563]">2.9% APR</p>
                <p className="text-sm font-bold text-[#10B981]">Total: $38,460 — saves $11,856</p>
              </div>
            </div>
          </div>
          {/* Metric chips */}
          <div className="flex flex-wrap justify-center gap-2">
            {["Price", "Rate", "Fees", "Term", "Total Cost"].map((chip) => (
              <span
                key={chip}
                className="text-xs font-semibold text-[#0B5FD1] bg-[#EFF6FF] border border-[#DBEAFE] rounded-full px-4 py-1.5"
              >
                {chip}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ── Section 8: Trust & Safety ── */}
      <section className="py-20 md:py-24 bg-[#EFF6FF]" data-testid="hiw-trust">
        <div className="mx-auto max-w-7xl px-6 md:px-12">
          <div className="text-center max-w-2xl mx-auto mb-12">
            <h2 className="text-3xl md:text-4xl font-bold text-[#111827] tracking-tight">
              Designed Around Buyer Confidence.
            </h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            {TRUST_CARDS.map((card) => (
              <div
                key={card.title}
                className="bg-white border border-[#E5E7EB] rounded-2xl p-7 hover:border-[#93C5FD] hover:shadow-md hover:shadow-[#0B5FD1]/10 transition-all"
              >
                <div className="h-11 w-11 rounded-xl bg-[#EFF6FF] flex items-center justify-center mb-4">
                  <card.icon size={20} className="text-[#0B5FD1]" />
                </div>
                <h3 className="text-base font-bold text-[#111827] mb-2">{card.title}</h3>
                <p className="text-sm text-[#4B5563] leading-relaxed">{card.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Section 9: FAQ ── */}
      <section className="py-20 md:py-24 bg-[#F8F9FB]" data-testid="hiw-faq">
        <div className="mx-auto max-w-3xl px-6 md:px-12">
          <div className="text-center mb-10">
            <h2 className="text-3xl md:text-4xl font-bold text-[#111827] tracking-tight">Frequently Asked Questions</h2>
          </div>
          <div className="space-y-3" data-testid="hiw-faq-list">
            {FAQS.map((f, i) => (
              <details
                key={f.q}
                data-testid={`hiw-faq-item-${i + 1}`}
                className="group bg-white rounded-2xl border border-[#E5E7EB] open:border-[#DBEAFE] open:shadow-sm transition-all"
              >
                <summary className="cursor-pointer list-none flex items-start justify-between gap-4 px-6 py-5">
                  <h3 className="text-sm sm:text-base font-semibold text-[#111827] leading-tight">{f.q}</h3>
                  <span className="shrink-0 h-7 w-7 rounded-full bg-[#EFF6FF] text-[#0B5FD1] flex items-center justify-center text-lg font-bold transition-transform group-open:rotate-45">+</span>
                </summary>
                <div className="px-6 pb-5 text-sm text-[#4B5563] leading-relaxed">{f.a}</div>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ── Section 10: Final CTA ── */}
      <section className="py-20 md:py-28 bg-[#0A0F1A] relative overflow-hidden" data-testid="hiw-final-cta">
        <span className="absolute -top-24 -right-24 h-96 w-96 rounded-full bg-[#0B5FD1]/20 blur-3xl pointer-events-none" aria-hidden="true" />
        <span className="absolute -bottom-24 -left-24 h-96 w-96 rounded-full bg-[#0B5FD1]/15 blur-3xl pointer-events-none" aria-hidden="true" />
        <div className="relative mx-auto max-w-3xl px-6 text-center">
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-white tracking-tight mb-4 leading-tight">
            Your Next Car Should Start With Leverage.
          </h2>
          <p className="text-base sm:text-lg text-white/70 mb-8">
            Get prequalified, activate dealer competition, and buy on your terms.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center mb-6">
            <Link
              href="/auth/signup"
              data-testid="hiw-final-cta-btn"
              className="px-8 py-4 bg-[#0B5FD1] text-white font-semibold text-sm rounded-xl hover:bg-[#0A4DB8] transition-colors shadow-lg shadow-[#0B5FD1]/30"
            >
              Get Prequalified
            </Link>
            <Link
              href="/inventory"
              className="px-8 py-4 border border-white/20 text-white font-medium text-sm rounded-xl hover:bg-white/10 transition-colors"
            >
              Browse Vehicles
            </Link>
          </div>
          <p className="text-xs text-white/50">
            Soft-pull only · Fully refundable · 48-hour auction · No obligation
          </p>
        </div>
      </section>

      {/* ── Section 11: Faith Module ── */}
      <section className="py-16 bg-[#0A0F1A] text-center">
        <div className="mx-auto max-w-3xl px-6">
          <FaithVerseModule pageKey="how-it-works" />
        </div>
      </section>
    </>
  );
}
