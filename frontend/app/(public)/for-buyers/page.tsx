import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  XCircle,
  Shield,
  Zap,
  Eye,
  FileText,
  BarChart3,
  Clock,
  Users,
  Lock,
  Award,
  Smartphone,
} from "lucide-react";
import FaithVerseModule from "@/components/public/FaithVerseModule";
import ChatWidget from "@/components/public/ChatWidget";
import { MARKETING_IMAGES } from "@/lib/constants/marketing-images";
import { buildPageMetadata, PAGE_METADATA } from "@/lib/seo/metadata";
import ScrollCTA from "@/components/seo/ScrollCTA";
import TrustBadges from "@/components/seo/TrustBadges";

export const metadata: Metadata = buildPageMetadata(PAGE_METADATA.forBuyers);
export const dynamic = "force-dynamic";
export const revalidate = 86400;

// ── Data ─────────────────────────────────────────────────────────────────────

const OLD_WAY = [
  "Hours wasted at the dealership — back-and-forth that drags on",
  "High-pressure sales tactics and manager games",
  "Hidden fees buried deep in the contract",
  "No way to compare competing offers side by side",
  '"Take it or leave it" pricing — you have zero leverage',
  "Your credit pulled without clear consent",
];

const NEW_WAY = [
  "Stay home — up to 8 verified dealers come to you",
  "Private 48-hour auction — you stay fully anonymous",
  "Contract Shield™ catches every junk fee before you sign",
  "Three ranked offers: Best Cash, Best Monthly, Best Overall",
  "Best Price Engine objectively scores every dealer offer",
  "Soft-pull prequalification — zero credit score impact",
];

const STEPS = [
  {
    number: "01",
    title: "Get Prequalified in 3 Minutes",
    description:
      "Tell us what you're looking for. Soft-pull prequalification — no credit impact, no commitment required.",
    Icon: Zap,
  },
  {
    number: "02",
    title: "Your Private Auction Begins",
    description:
      "Up to 8 verified dealers are invited to compete for your business in a private 48-hour auction.",
    Icon: Clock,
  },
  {
    number: "03",
    title: "Review Your Ranked Offers",
    description:
      "Best Price Engine ranks every offer: Best Cash Price, Best Monthly Payment, and Best Overall Deal.",
    Icon: BarChart3,
  },
  {
    number: "04",
    title: "Sign, Pay & Drive Away",
    description:
      "DocuSign from your phone. QR code pickup at the lot. No paperwork surprises.",
    Icon: Smartphone,
  },
];

const FEATURES = [
  {
    Icon: Shield,
    title: "Contract Shield™",
    description:
      "Every dealer contract is reviewed for junk fees, APR accuracy, and hidden charges before you sign anything.",
    tag: "Built-in on every deal",
  },
  {
    Icon: Eye,
    title: "Full Buyer Anonymity",
    description:
      "Dealers never know who you are. You stay anonymous through the entire auction until you choose to connect.",
    tag: "Identity protected",
  },
  {
    Icon: BarChart3,
    title: "Best Price Engine",
    description:
      "Objective scoring across all competing offers — ranked by cash price, monthly payment, and total deal value.",
    tag: "Data-driven rankings",
  },
  {
    Icon: FileText,
    title: "DocuSign E-Signing",
    description:
      "Review and sign your purchase documents from your phone, tablet, or laptop — no dealer office required.",
    tag: "Sign from anywhere",
  },
  {
    Icon: Users,
    title: "Up to 8 Competing Dealers",
    description:
      "More competition means better prices. Every dealer knows they're competing — that's your leverage.",
    tag: "Competition = savings",
  },
  {
    Icon: Lock,
    title: "$99 Fully Refundable Deposit",
    description:
      "Your auction access deposit is returned in full if no deal is reached. Zero financial risk to try.",
    tag: "Zero-risk commitment",
  },
];

const TRUST_PILLARS = [
  {
    Icon: Award,
    title: "Verified Dealers Only",
    description:
      "Every dealer on the platform is screened, licensed, and bound by our conduct standards before they can bid.",
  },
  {
    Icon: Shield,
    title: "Contract Review on Every Deal",
    description:
      "Contract Shield flags unfair terms, hidden fees, and APR discrepancies — before you sign a single document.",
  },
  {
    Icon: Lock,
    title: "100% Refundable Deposit",
    description:
      "If no deal is reached that you're happy with, your $99 auction deposit comes back. No questions, no hoops.",
  },
  {
    Icon: Eye,
    title: "Zero Pressure Environment",
    description:
      "You're anonymous through the entire auction. No dealer contact, no callbacks, until you choose to move forward.",
  },
];

const STATS = [
  { value: "100%", label: "Online & remote" },
  { value: "48 hrs", label: "Auction duration" },
  { value: "Up to 8", label: "Competing dealers" },
  { value: "$99", label: "Fully refundable deposit" },
];

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ForBuyersPage() {
  return (
    <div className="bg-white">

      {/* ── Hero ────────────────────────────────────────────────────────────── */}
      <section
        className="relative pt-16 overflow-hidden bg-gradient-to-br from-[#EEF5FF] via-white to-white"
        data-testid="for-buyers-hero"
      >
        <div className="mx-auto max-w-7xl px-6 md:px-12 py-20 md:py-28 grid lg:grid-cols-[1fr_520px] gap-14 items-center">
          <div>
            <span className="inline-block text-xs font-bold uppercase tracking-[0.18em] text-[#0B5FD1] bg-[#EEF5FF] border border-[#BFDBFE] rounded-full px-3 py-1 mb-5">
              For Car Buyers
            </span>
            <h1 className="text-5xl sm:text-6xl font-bold tracking-tighter text-[#111827] max-w-2xl mt-2 mb-6 leading-[1.05]">
              Stop negotiating.<br />
              <span className="text-[#0B5FD1]">Start winning.</span>
            </h1>
            <p className="text-[#4B5563] text-lg max-w-xl mb-8 leading-relaxed">
              AutoLenis flips the car buying process in your favor. Tell us what you want — up to 8 verified dealers compete for your business in a private 48-hour auction. You stay anonymous. You stay in control.
            </p>

            {/* Stat pills */}
            <div className="flex flex-wrap gap-3 mb-10">
              {[
                "48-hr private auction",
                "Up to 8 dealers compete",
                "$99 fully refundable",
              ].map((pill) => (
                <span
                  key={pill}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#0B5FD1] bg-[#EEF5FF] border border-[#BFDBFE] rounded-full px-3.5 py-1.5"
                >
                  <CheckCircle2 size={11} className="text-[#50D14E]" />
                  {pill}
                </span>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-4">
              <Link
                href="/auth/signup"
                data-testid="for-buyers-cta"
                data-funnel-stage="bofu"
                data-cta="check-buying-power"
                className="inline-flex items-center gap-2 px-8 py-4 bg-[#50D14E] text-white font-semibold text-sm rounded-md hover:bg-[#3DBF3B] transition-colors shadow-md shadow-[#50D14E]/30"
              >
                Check My Buying Power <ArrowRight size={16} />
              </Link>
              <Link
                href="/how-it-works"
                data-funnel-stage="tofu"
                data-cta="learn-how-it-works"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-[#0B5FD1] hover:underline"
              >
                See how it works <ArrowRight size={14} />
              </Link>
            </div>
            <p className="text-xs text-[#94A3B8] mt-4">
              No credit score impact &bull; Takes 3 minutes &bull; No commitment required
            </p>
            <div className="mt-6">
              <TrustBadges />
            </div>
          </div>

          {/* Hero image */}
          <div className="relative hidden lg:block">
            <div className="relative rounded-2xl overflow-hidden shadow-2xl shadow-[#0B5FD1]/15">
              <img
                src={MARKETING_IMAGES.buyersHero}
                alt="A family celebrating their new vehicle — daughter holding the steering wheel in the driver's seat"
                className="w-full aspect-[4/3] object-cover"
                data-testid="for-buyers-hero-image"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[#0B5FD1]/20 to-transparent" />
            </div>
            {/* Floating badge */}
            <div className="absolute -bottom-5 -left-6 bg-white rounded-xl shadow-xl shadow-[#0B5FD1]/10 px-5 py-4 border border-[#E5E7EB]">
              <p className="text-xs text-[#94A3B8] mb-0.5">Buy from home</p>
              <p className="text-2xl font-bold text-[#0B5FD1]">100% online</p>
            </div>
            <div className="absolute -top-4 -right-4 bg-[#0B5FD1] rounded-xl shadow-lg px-4 py-3 text-white">
              <p className="text-xs font-medium text-white/70 mb-0.5">Average auction</p>
              <p className="text-lg font-bold">48 hrs</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Problem Bar ─────────────────────────────────────────────────────── */}
      <section className="bg-[#111827] py-16" data-testid="problem-bar">
        <div className="mx-auto max-w-7xl px-6 md:px-12">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#60A5FA] mb-5">
            The problem
          </p>
          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4 max-w-2xl leading-tight">
            The traditional car buying experience is{" "}
            <span className="text-red-400">designed against you.</span>
          </h2>
          <p className="text-[#9CA3AF] text-base max-w-2xl leading-relaxed">
            Dealerships control the information, the pace, and the pressure. You walk in at a disadvantage and leave wondering if you overpaid. AutoLenis was built to end that.
          </p>
        </div>
      </section>

      {/* ── Old Way vs AutoLenis Way ─────────────────────────────────────────── */}
      <section className="py-20 bg-white" data-testid="comparison-section">
        <div className="mx-auto max-w-7xl px-6 md:px-12">
          <h2 className="text-3xl font-bold tracking-tight text-[#111827] mb-3">
            The old way vs. the AutoLenis way
          </h2>
          <p className="text-[#6B7280] mb-12 max-w-xl">
            Same goal — your best deal on a car. Completely different experience.
          </p>
          <div className="grid md:grid-cols-2 gap-6 max-w-4xl">
            <div className="border border-red-200 bg-red-50 rounded-2xl p-8">
              <div className="flex items-center gap-2 mb-7">
                <XCircle size={16} className="text-red-500" />
                <h3 className="font-bold text-red-600 text-sm uppercase tracking-wider">
                  Old way: at the dealership
                </h3>
              </div>
              <ul className="space-y-4">
                {OLD_WAY.map((item) => (
                  <li key={item} className="flex items-start gap-3 text-sm text-red-700/80">
                    <XCircle size={14} className="mt-0.5 shrink-0 text-red-400" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div className="border border-[#BFDBFE] bg-[#EEF5FF] rounded-2xl p-8">
              <div className="flex items-center gap-2 mb-7">
                <CheckCircle2 size={16} className="text-[#50D14E]" />
                <h3 className="font-bold text-[#0B5FD1] text-sm uppercase tracking-wider">
                  AutoLenis way
                </h3>
              </div>
              <ul className="space-y-4">
                {NEW_WAY.map((item) => (
                  <li key={item} className="flex items-start gap-3 text-sm text-[#1E40AF]/80">
                    <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-[#50D14E]" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ── How It Works ─────────────────────────────────────────────────────── */}
      <section className="py-20 bg-[#F8F9FB]" data-testid="how-it-works-section">
        <div className="mx-auto max-w-7xl px-6 md:px-12">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#0B5FD1] mb-4">
            How it works
          </p>
          <h2 className="text-3xl font-bold tracking-tight text-[#111827] mb-3 max-w-xl">
            From prequalification to keys in hand — four steps
          </h2>
          <p className="text-[#6B7280] mb-14 max-w-xl">
            AutoLenis handles the complexity so you can focus on choosing the right deal.
          </p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {STEPS.map(({ number, title, description, Icon }) => (
              <div
                key={number}
                className="bg-white border border-[#E5E7EB] rounded-2xl p-7 hover:border-[#93C5FD] hover:shadow-md hover:shadow-[#0B5FD1]/05 transition-all"
              >
                <div className="flex items-start justify-between mb-5">
                  <div className="w-11 h-11 rounded-xl bg-[#EEF5FF] flex items-center justify-center">
                    <Icon size={20} className="text-[#0B5FD1]" />
                  </div>
                  <span className="text-4xl font-black text-[#E5E7EB] leading-none select-none">
                    {number}
                  </span>
                </div>
                <h3 className="font-bold text-[#111827] mb-2 text-base leading-snug">{title}</h3>
                <p className="text-sm text-[#6B7280] leading-relaxed">{description}</p>
              </div>
            ))}
          </div>
          <div className="mt-10">
            <Link
              href="/auth/signup"
              className="inline-flex items-center gap-2 px-7 py-3.5 bg-[#0B5FD1] text-white font-semibold text-sm rounded-md hover:bg-[#1A6FE0] transition-colors shadow-sm"
            >
              Start Your Auction <ArrowRight size={15} />
            </Link>
          </div>
        </div>
      </section>

      {/* ── Platform Features ────────────────────────────────────────────────── */}
      <section className="py-20 bg-white" data-testid="buyer-benefits-section">
        <div className="mx-auto max-w-7xl px-6 md:px-12">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#0B5FD1] mb-4">
            What's included
          </p>
          <h2 className="text-3xl font-bold tracking-tight text-[#111827] mb-3 max-w-2xl">
            Everything you need to buy with confidence
          </h2>
          <p className="text-[#6B7280] mb-14 max-w-xl">
            Every feature is built to protect your interests and give you maximum leverage over the process.
          </p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {FEATURES.map(({ Icon, title, description, tag }) => (
              <div
                key={title}
                data-testid={`feature-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                className="border border-[#E5E7EB] rounded-2xl p-7 hover:border-[#93C5FD] hover:shadow-md hover:shadow-[#0B5FD1]/05 transition-all group"
              >
                <div className="w-11 h-11 rounded-xl bg-[#EEF5FF] flex items-center justify-center mb-5 group-hover:bg-[#DBEAFE] transition-colors">
                  <Icon size={20} className="text-[#0B5FD1]" />
                </div>
                <h3 className="font-bold text-[#111827] mb-2 text-base">{title}</h3>
                <p className="text-sm text-[#6B7280] leading-relaxed mb-4">{description}</p>
                <span className="inline-block text-xs font-semibold text-[#0B5FD1] bg-[#EEF5FF] border border-[#BFDBFE] rounded-full px-3 py-1">
                  {tag}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Leverage Section ─────────────────────────────────────────────────── */}
      <section className="py-20 bg-[#0B5FD1]" data-testid="leverage-section">
        <div className="mx-auto max-w-7xl px-6 md:px-12 grid lg:grid-cols-2 gap-14 items-center">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#93C5FD] mb-5">
              Your leverage
            </p>
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-6 leading-tight">
              You have more buying power<br />than you think.
            </h2>
            <p className="text-white/75 text-base leading-relaxed mb-8">
              When dealers know they're competing in a private auction, they bring their best offer from the start. There's no room for games when another dealer is one bid away from winning the deal.
            </p>
            <ul className="space-y-4 mb-10">
              {[
                "Dealers cannot see each other's offers — only that they're losing",
                "Your identity stays hidden until you choose the winner",
                "Best Price Engine ensures you see the true ranking, not dealer spin",
                "Contract Shield locks in your protection before any money moves",
              ].map((point) => (
                <li key={point} className="flex items-start gap-3 text-sm text-white/85">
                  <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-[#50D14E]" />
                  {point}
                </li>
              ))}
            </ul>
            <Link
              href="/auth/signup"
              className="inline-flex items-center gap-2 px-7 py-3.5 bg-[#50D14E] text-white font-semibold text-sm rounded-md hover:bg-[#3DBF3B] transition-colors shadow-md shadow-black/20"
            >
              Get My Best Deal <ArrowRight size={15} />
            </Link>
          </div>
          <div className="hidden lg:block">
            <div className="relative rounded-2xl overflow-hidden shadow-2xl shadow-black/30">
              <img
                src={MARKETING_IMAGES.trustMoment}
                alt="A buyer confidently signing a deal — knowing they got the best offer"
                className="w-full aspect-[4/3] object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[#0B5FD1]/40 to-transparent" />
            </div>
          </div>
        </div>
      </section>

      {/* ── Trust & Safety ───────────────────────────────────────────────────── */}
      <section className="py-20 bg-[#F8F9FB]" data-testid="trust-section">
        <div className="mx-auto max-w-7xl px-6 md:px-12">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#0B5FD1] mb-4">
            Buyer protection
          </p>
          <h2 className="text-3xl font-bold tracking-tight text-[#111827] mb-3 max-w-2xl">
            Safer and smarter than buying any other way
          </h2>
          <p className="text-[#6B7280] mb-14 max-w-xl">
            AutoLenis was built from the ground up to protect the buyer at every step of the process.
          </p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {TRUST_PILLARS.map(({ Icon, title, description }) => (
              <div
                key={title}
                className="bg-white border border-[#E5E7EB] rounded-2xl p-7 hover:border-[#93C5FD] hover:shadow-md hover:shadow-[#0B5FD1]/05 transition-all"
              >
                <div className="w-11 h-11 rounded-xl bg-[#EEF5FF] flex items-center justify-center mb-5">
                  <Icon size={20} className="text-[#0B5FD1]" />
                </div>
                <h3 className="font-bold text-[#111827] mb-2 text-base leading-snug">{title}</h3>
                <p className="text-sm text-[#6B7280] leading-relaxed">{description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── By The Numbers ───────────────────────────────────────────────────── */}
      <section className="py-16 bg-white border-y border-[#E5E7EB]" data-testid="stats-section">
        <div className="mx-auto max-w-7xl px-6 md:px-12">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-8">
            {STATS.map(({ value, label }) => (
              <div key={label} className="text-center">
                <p className="text-4xl font-black text-[#0B5FD1] mb-1 tracking-tight">{value}</p>
                <p className="text-sm text-[#6B7280]">{label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Objection Handling — common questions before getting started ─── */}
      <section
        className="py-20 bg-[#F8F9FB]"
        aria-label="Common questions before getting started"
        data-testid="objection-handling-section"
      >
        <div className="mx-auto max-w-3xl px-6 md:px-12">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#0B5FD1] mb-4">
            Before you start
          </p>
          <h2 className="text-3xl font-bold tracking-tight text-[#111827] mb-3">
            Questions Before You Start
          </h2>
          <p className="text-[#6B7280] mb-10 max-w-xl">
            Real answers to the doubts most buyers think about — but never ask out loud.
          </p>

          <div className="space-y-3">
            <details
              data-objection="cost"
              className="group bg-white border border-[#E5E7EB] rounded-2xl open:shadow-sm"
            >
              <summary className="cursor-pointer list-none flex items-start justify-between gap-4 px-6 py-5">
                <h3 className="text-base font-semibold text-[#111827]">
                  Is AutoLenis worth the $99?
                </h3>
                <span className="shrink-0 h-7 w-7 rounded-full bg-[#EEF5FF] text-[#0B5FD1] flex items-center justify-center text-lg font-bold transition-transform group-open:rotate-45">
                  +
                </span>
              </summary>
              <p className="px-6 pb-5 text-sm text-[#4B5563] leading-relaxed">
                The $99 deposit is refundable if you don&apos;t select any offer. If you do
                buy, the $99 is credited toward the $499 Service Fee. Instead of
                negotiating alone, you have verified dealers competing for your business
                and full visibility into every offer before you decide.
              </p>
            </details>

            <details
              data-objection="trust"
              className="group bg-white border border-[#E5E7EB] rounded-2xl open:shadow-sm"
            >
              <summary className="cursor-pointer list-none flex items-start justify-between gap-4 px-6 py-5">
                <h3 className="text-base font-semibold text-[#111827]">
                  How do I know the dealers are legitimate?
                </h3>
                <span className="shrink-0 h-7 w-7 rounded-full bg-[#EEF5FF] text-[#0B5FD1] flex items-center justify-center text-lg font-bold transition-transform group-open:rotate-45">
                  +
                </span>
              </summary>
              <p className="px-6 pb-5 text-sm text-[#4B5563] leading-relaxed">
                AutoLenis manually verifies every dealer before they join the network.
                We check dealer licenses, reviews, and business standing. Only approved
                dealers can submit offers. Your personal contact information is never
                shared until you choose to proceed.
              </p>
            </details>

            <details
              data-objection="alternative"
              className="group bg-white border border-[#E5E7EB] rounded-2xl open:shadow-sm"
            >
              <summary className="cursor-pointer list-none flex items-start justify-between gap-4 px-6 py-5">
                <h3 className="text-base font-semibold text-[#111827]">
                  Why not just go to a dealership directly?
                </h3>
                <span className="shrink-0 h-7 w-7 rounded-full bg-[#EEF5FF] text-[#0B5FD1] flex items-center justify-center text-lg font-bold transition-transform group-open:rotate-45">
                  +
                </span>
              </summary>
              <p className="px-6 pb-5 text-sm text-[#4B5563] leading-relaxed">
                You can — and sometimes that&apos;s the right choice. AutoLenis is for buyers
                who want multiple dealers competing simultaneously without visiting each
                one. Our buyers save time, avoid pressure tactics, and get transparent
                competing prices that would take weeks to collect manually.
              </p>
            </details>

            <details
              data-objection="commitment"
              className="group bg-white border border-[#E5E7EB] rounded-2xl open:shadow-sm"
            >
              <summary className="cursor-pointer list-none flex items-start justify-between gap-4 px-6 py-5">
                <h3 className="text-base font-semibold text-[#111827]">
                  Am I committed to buying if I start?
                </h3>
                <span className="shrink-0 h-7 w-7 rounded-full bg-[#EEF5FF] text-[#0B5FD1] flex items-center justify-center text-lg font-bold transition-transform group-open:rotate-45">
                  +
                </span>
              </summary>
              <p className="px-6 pb-5 text-sm text-[#4B5563] leading-relaxed">
                No. Creating an account and getting pre-qualified is completely free.
                Even after paying the $99 deposit, you can decline all offers and
                receive a full refund. You only pay the Service Fee if you select an
                offer and proceed with a purchase.
              </p>
            </details>
          </div>
        </div>
      </section>

      {/* ── Faith Verse ──────────────────────────────────────────────────────── */}
      <section className="bg-[#111827] py-16 text-center" data-testid="faith-verse-section">
        <div className="mx-auto max-w-2xl px-6">
          <FaithVerseModule pageKey="buyers" />
        </div>
      </section>

      {/* ── Final CTA ────────────────────────────────────────────────────────── */}
      <section className="py-24 bg-gradient-to-br from-[#EEF5FF] via-white to-white" data-testid="buyers-final-cta">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <span className="inline-block text-xs font-bold uppercase tracking-[0.18em] text-[#0B5FD1] bg-[#EEF5FF] border border-[#BFDBFE] rounded-full px-3.5 py-1.5 mb-6">
            Start today — free
          </span>
          <h2 className="text-4xl sm:text-5xl font-bold text-[#111827] mb-5 tracking-tight leading-tight">
            Ready to see what dealers will<br />
            <span className="text-[#0B5FD1]">actually offer you?</span>
          </h2>
          <p className="text-[#6B7280] text-lg mb-10 max-w-xl mx-auto leading-relaxed">
            Check your buying power in 3 minutes. No credit impact. No commitment. Your $99 auction deposit is fully refundable if no deal works for you.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="/auth/signup"
              data-testid="buyers-footer-cta"
              className="inline-flex items-center gap-2 px-9 py-4 bg-[#50D14E] text-white font-semibold text-base rounded-md hover:bg-[#3DBF3B] transition-colors shadow-lg shadow-[#50D14E]/30"
            >
              Get Started Free <ArrowRight size={16} />
            </Link>
            <Link
              href="/pricing"
              className="inline-flex items-center gap-2 px-9 py-4 bg-white text-[#0B5FD1] font-semibold text-base rounded-md border border-[#BFDBFE] hover:border-[#0B5FD1] hover:bg-[#EEF5FF] transition-colors"
            >
              View Pricing
            </Link>
          </div>
          <p className="text-xs text-[#94A3B8] mt-6">
            No credit score impact &bull; 3 minutes to start &bull; $99 deposit refunded if no deal
          </p>
        </div>
      </section>

      {/* ── Scroll-depth sticky CTA — catches mid-scroll buyers ─────────── */}
      <ScrollCTA
        headline="Ready to save on your next car?"
        cta="Get Prequalified →"
        href="/auth/signup"
        showAfterPx={800}
      />

      <ChatWidget />
    </div>
  );
}
