import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  XCircle,
  Trophy,
  Clock,
  DollarSign,
  TrendingUp,
  Users,
  Shield,
  Zap,
  BarChart3,
  Target,
} from "lucide-react";
import FaithVerseModule from "@/components/public/FaithVerseModule";
import { MARKETING_IMAGES } from "@/lib/constants/marketing-images";
import { MAX_DEALER_INVITATIONS, AUCTION_DURATION_HOURS } from "@/lib/constants";

import { buildPageMetadata, PAGE_METADATA } from "@/lib/seo/metadata";
export const metadata: Metadata = buildPageMetadata(PAGE_METADATA.forDealers);
export const revalidate = 86400;

const MODEL_PILLARS = [
  {
    icon: DollarSign,
    title: "No Upfront Lead Cost",
    body: "Every buyer invitation is free. You only pay after a deal closes successfully.",
  },
  {
    icon: BarChart3,
    title: "No Wasted Spend",
    body: "No pay-per-click. No CPL fees. No subscription. Only results generate a cost.",
  },
  {
    icon: Shield,
    title: "No Unqualified Traffic",
    body: "Every buyer passed soft-pull prequalification with a confirmed budget range before you see them.",
  },
  {
    icon: Trophy,
    title: "Pay Only for Results",
    body: "The fee structure is tied entirely to closed transactions — not impressions, not clicks, not leads.",
  },
];

const DEALER_BENEFITS = [
  {
    icon: Target,
    title: "Higher Intent Buyers",
    body: "Prequalified, deposit-committed buyers who are ready to make a decision.",
  },
  {
    icon: TrendingUp,
    title: "Pay-for-Performance",
    body: "Your only cost is a percentage of successfully closed transactions.",
  },
  {
    icon: Clock,
    title: "Faster Deal Cycles",
    body: "Structured auctions with defined windows mean quicker decisions and faster closes.",
  },
  {
    icon: BarChart3,
    title: "Scalable Pipeline",
    body: "Receive more invitations as you build your performance tier.",
  },
  {
    icon: Zap,
    title: "Structured Process",
    body: "A defined workflow from invitation to close reduces back-and-forth.",
  },
  {
    icon: Users,
    title: "Reduced Wasted Time",
    body: "No cold outreach. No unqualified walk-ins. Every buyer in the system has intent.",
  },
];

export default function ForDealersPage() {
  return (
    <div className="bg-[#F8F9FB]">

      {/* ── SECTION 1: HERO ────────────────────────────────────────────── */}
      <section
        data-testid="for-dealers-hero"
        className="relative bg-white overflow-hidden pt-16"
      >
        <div className="mx-auto max-w-7xl px-6 md:px-12">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center py-20">
            {/* Left copy */}
            <div>
              <span className="text-xs font-semibold uppercase tracking-[0.15em] text-[#0B5FD1]">
                For Dealers
              </span>
              <h1 className="mt-4 text-5xl sm:text-6xl font-bold tracking-tight text-[#111827] leading-[1.05]">
                High-Intent Buyers.<br />Zero Upfront Risk.
              </h1>
              <p className="mt-6 text-lg text-[#4B5563] leading-relaxed max-w-xl">
                AutoLenis connects dealers with serious, prequalified buyers through a
                competitive offer system — where you only pay after a successful sale.
              </p>
              <div className="mt-8 flex flex-wrap gap-4">
                <Link
                  href="/dealer/apply"
                  data-testid="for-dealers-apply-cta"
                  className="inline-flex items-center gap-2 px-8 py-4 bg-[#0B5FD1] text-white font-semibold text-sm rounded-md hover:bg-[#1A6FE0] transition-colors shadow-md shadow-[#0B5FD1]/20"
                >
                  Apply to Become a Partner Dealer <ArrowRight size={16} />
                </Link>
                <Link
                  href="/how-it-works"
                  className="inline-flex items-center gap-2 px-8 py-4 border border-[#E5E7EB] text-[#374151] font-medium text-sm rounded-md hover:border-[#0B5FD1] transition-colors"
                >
                  See How It Works
                </Link>
              </div>
              <p className="mt-4">
                <Link
                  href="/dealer/sign-in"
                  data-testid="for-dealers-signin-cta"
                  className="text-sm text-[#0B5FD1] hover:underline"
                >
                  Already a dealer? Sign in
                </Link>
              </p>
              <p className="mt-6 text-xs text-[#94A3B8]">
                Prequalified buyers · Pay after close · No upfront cost · Structured competition
              </p>
            </div>

            {/* Right hero image */}
            <div className="relative hidden lg:block">
              <div className="relative rounded-2xl overflow-hidden shadow-md shadow-[#0B5FD1]/10">
                <img
                  src={MARKETING_IMAGES.trustMoment}
                  alt="Dealer partnering with AutoLenis"
                  className="w-full aspect-[4/3] object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-r from-[#111827]/40 to-transparent rounded-2xl" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── SECTION 2: THE PROBLEM ─────────────────────────────────────── */}
      <section className="py-24 bg-[#F8F9FB]">
        <div className="mx-auto max-w-7xl px-6 md:px-12">
          <h2 className="text-3xl font-bold tracking-tight text-[#111827] mb-3">
            Traditional Lead Generation Is Broken.
          </h2>
          <p className="text-[#4B5563] mb-12 max-w-2xl">
            The old model of pay-per-lead was never designed around dealer outcomes.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              {
                title: "Low Intent",
                accent: "border-l-red-400",
                body: "Most leads are shoppers — not buyers. Dealers pay to chase people who aren't ready to commit.",
              },
              {
                title: "High Cost",
                accent: "border-l-amber-400",
                body: "Per-lead fees accumulate regardless of conversion. The cost of a closed deal is hidden.",
              },
              {
                title: "Low Conversion",
                accent: "border-l-red-400",
                body: "Without structure or qualification, closing rates on purchased leads remain consistently poor.",
              },
            ].map((card) => (
              <div
                key={card.title}
                className={`bg-white border border-[#E5E7EB] border-l-4 ${card.accent} rounded-2xl p-7`}
              >
                <XCircle className="text-red-400 mb-4" size={22} />
                <h3 className="font-bold text-[#111827] mb-2">{card.title}</h3>
                <p className="text-sm text-[#4B5563] leading-relaxed">{card.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── SECTION 3: AUTHORITY STRIP ─────────────────────────────────── */}
      <section className="py-16 bg-white border-y border-[#E5E7EB]" data-testid="dealer-stats-section">
        <div className="mx-auto max-w-7xl px-6 md:px-12">
          <p className="text-xs font-semibold uppercase tracking-[0.15em] text-[#94A3B8] mb-10 text-center">
            Trusted by Dealers Across Multiple Markets
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
            <div data-testid="dealer-stat-dealers-per-buyer-auction">
              <p className="text-4xl font-bold text-[#0B5FD1]">Up to {MAX_DEALER_INVITATIONS}</p>
              <p className="text-sm text-[#94A3B8] mt-1">Dealers per buyer auction</p>
            </div>
            <div data-testid="dealer-stat-competition-window">
              <p className="text-4xl font-bold text-[#0B5FD1]">{AUCTION_DURATION_HOURS}h</p>
              <p className="text-sm text-[#94A3B8] mt-1">Competition window</p>
            </div>
            <div data-testid="dealer-stat-upfront-cost-to-join">
              <p className="text-4xl font-bold text-[#0B5FD1]">$0</p>
              <p className="text-sm text-[#94A3B8] mt-1">Upfront cost to join</p>
            </div>
            <div data-testid="dealer-stat-pricing-model">
              <p className="text-4xl font-bold text-[#0B5FD1]">Performance</p>
              <p className="text-sm text-[#94A3B8] mt-1">Pricing model</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── SECTION 4: THE AUTOLENIS MODEL ─────────────────────────────── */}
      <section className="py-24 bg-[#F8F9FB]">
        <div className="mx-auto max-w-7xl px-6 md:px-12">
          <h2 className="text-3xl font-bold tracking-tight text-[#111827] mb-3">
            Only Pay When You Close.
          </h2>
          <p className="text-[#4B5563] mb-12">
            AutoLenis is built around performance — not speculation.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {MODEL_PILLARS.map((pillar) => (
              <div
                key={pillar.title}
                className="bg-white border border-[#E5E7EB] rounded-2xl p-7 shadow-sm shadow-[#0B5FD1]/10"
              >
                <div className="w-10 h-10 rounded-full bg-[#EFF6FF] flex items-center justify-center mb-4">
                  <pillar.icon size={18} className="text-[#0B5FD1]" />
                </div>
                <h3 className="font-bold text-[#111827] mb-2">{pillar.title}</h3>
                <p className="text-sm text-[#4B5563] leading-relaxed">{pillar.body}</p>
              </div>
            ))}
          </div>
          <p className="mt-10 text-center text-2xl font-bold text-[#111827]">
            You don&apos;t pay for leads. You pay for results.
          </p>
        </div>
      </section>

      {/* ── SECTION 5: HOW DEALERS WIN ─────────────────────────────────── */}
      <section className="py-24 bg-white">
        <div className="mx-auto max-w-7xl px-6 md:px-12">
          <h2 className="text-3xl font-bold tracking-tight text-[#111827] mb-12">
            Compete for Real Buyers — Not Cold Leads.
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
            {[
              {
                step: 1,
                title: "Receive Buyer Request",
                body: "Get a private invitation with full vehicle specs, buyer budget range, and ZIP location.",
              },
              {
                step: 2,
                title: "Review Buyer Profile",
                body: "Access the buyer's prequalification status and vehicle request before committing to an offer.",
              },
              {
                step: 3,
                title: "Submit Competitive Offer",
                body: `Submit your best price within the ${AUCTION_DURATION_HOURS}-hour window.`,
              },
              {
                step: 4,
                title: "Win the Deal",
                body: "If selected, proceed directly to contracting and close.",
              },
            ].map((s) => (
              <div key={s.step} className="flex flex-col items-start">
                <div className="w-10 h-10 rounded-full bg-[#EFF6FF] text-[#0B5FD1] font-bold text-sm flex items-center justify-center mb-4">
                  {s.step}
                </div>
                <h3 className="font-bold text-[#111827] mb-2">{s.title}</h3>
                <p className="text-sm text-[#4B5563] leading-relaxed">{s.body}</p>
              </div>
            ))}
          </div>
          <div className="mt-10">
            <Link
              href="/dealer/apply"
              className="inline-flex items-center gap-2 px-8 py-4 bg-[#0B5FD1] text-white font-semibold text-sm rounded-md hover:bg-[#1A6FE0] transition-colors shadow-md shadow-[#0B5FD1]/20"
            >
              Apply to Join <ArrowRight size={16} />
            </Link>
          </div>
        </div>
      </section>

      {/* ── SECTION 6: BUYER QUALITY ───────────────────────────────────── */}
      <section className="py-24 bg-[#F8F9FB]">
        <div className="mx-auto max-w-7xl px-6 md:px-12">
          <h2 className="text-3xl font-bold tracking-tight text-[#111827] mb-12">
            Serious Buyers Only.
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {[
              {
                title: "Prequalification Required",
                body: "Every buyer completed soft-pull credit prequalification before their auction is activated.",
              },
              {
                title: "Confirmed Budget Range",
                body: "Buyers have an approved spending ceiling. You know their budget before you submit.",
              },
              {
                title: "Auction Access Deposit",
                body: "Buyers pay a refundable deposit to activate their auction — filtering out window shoppers.",
              },
              {
                title: "Structured Buying Journey",
                body: "Buyers are guided step-by-step, reducing drop-off and increasing closing probability.",
              },
            ].map((q) => (
              <div
                key={q.title}
                className="bg-white border border-[#E5E7EB] border-l-4 border-l-[#0B5FD1] rounded-2xl p-7"
              >
                <h3 className="font-bold text-[#111827] mb-2">{q.title}</h3>
                <p className="text-sm text-[#4B5563] leading-relaxed">{q.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── SECTION 7: REVERSE AUCTION ADVANTAGE ──────────────────────── */}
      <section className="py-24 bg-white">
        <div className="mx-auto max-w-7xl px-6 md:px-12">
          <h2 className="text-3xl font-bold tracking-tight text-[#111827] mb-3">
            A Smarter Way to Compete.
          </h2>
          <p className="text-[#4B5563] mb-12 max-w-2xl">
            The AutoLenis reverse auction system creates structured competition — not a race to the bottom.
          </p>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-start">
            {/* Benefit cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              {[
                {
                  title: "Offers Ranked by Total Value",
                  body: "Buyers see offers ranked on total deal quality — not lowest price alone.",
                },
                {
                  title: "Faster Deal Cycles",
                  body: `A defined ${AUCTION_DURATION_HOURS}-hour window accelerates the decision from offer to close.`,
                },
                {
                  title: "Stronger Engagement",
                  body: "Buyers are committed participants — they posted a deposit and passed prequalification.",
                },
                {
                  title: "Higher Efficiency",
                  body: "You submit offers only to buyers whose budgets match your inventory. No blind pitching.",
                },
              ].map((b) => (
                <div
                  key={b.title}
                  className="bg-[#F8F9FB] border border-[#E5E7EB] rounded-2xl p-6"
                >
                  <h3 className="font-bold text-[#111827] mb-2">{b.title}</h3>
                  <p className="text-sm text-[#4B5563] leading-relaxed">{b.body}</p>
                </div>
              ))}
            </div>

            {/* Inline offer ranking visual */}
            <div className="bg-white border border-[#E5E7EB] rounded-2xl p-6 shadow-sm shadow-[#0B5FD1]/10">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#94A3B8] mb-4">
                Auction Results — 2024 Toyota Camry XSE
              </p>
              <div className="space-y-2">
                <div className="flex items-center justify-between bg-[#EFF6FF] border border-[#0B5FD1]/20 rounded-lg px-4 py-3">
                  <div className="flex items-center gap-3">
                    <Trophy size={16} className="text-[#0B5FD1]" />
                    <span className="text-sm font-semibold text-[#111827]">#1</span>
                    <span className="text-xs px-2 py-0.5 bg-white text-[#0B5FD1] font-semibold border border-[#0B5FD1]/20 rounded">
                      Best Overall
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-[#111827]">$31,200</span>
                    <span className="text-xs text-[#0B5FD1] font-semibold">← Selected</span>
                  </div>
                </div>
                <div className="flex items-center justify-between border border-[#E5E7EB] rounded-lg px-4 py-3">
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium text-[#4B5563]">#2</span>
                    <span className="text-xs text-[#4B5563]">Best Cash</span>
                  </div>
                  <span className="text-sm text-[#4B5563]">$31,800</span>
                </div>
                <div className="flex items-center justify-between border border-[#E5E7EB] rounded-lg px-4 py-3">
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium text-[#4B5563]">#3</span>
                    <span className="text-xs text-[#4B5563]">Best Monthly</span>
                  </div>
                  <span className="text-sm text-[#4B5563]">$498/mo</span>
                </div>
              </div>
              <p className="text-xs text-[#94A3B8] mt-4">
                Buyer selected within 4 hours of auction close
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── SECTION 8: OBJECTION HANDLING ─────────────────────────────── */}
      <section className="py-24 bg-[#F8F9FB]">
        <div className="mx-auto max-w-7xl px-6 md:px-12">
          <h2 className="text-3xl font-bold tracking-tight text-[#111827] mb-12">
            Built to Work for Dealers — Not Against You
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {[
              {
                title: "Not a Race to the Bottom",
                body: "Offers are evaluated on total deal quality — price is one factor, not the only one. Dealers who deliver clean, complete offers consistently win.",
              },
              {
                title: "You Control Your Offers",
                body: "You decide what to submit. There are no minimums, no forced pricing, and no obligation to bid on every auction.",
              },
              {
                title: "Only Pay When You Win",
                body: "No wasted marketing spend. If your offer isn't selected, you've paid nothing.",
              },
              {
                title: "Serious Buyers Only",
                body: "Every buyer paid an Auction Access Deposit and passed prequalification. Low-intent shoppers don't reach your offer form.",
              },
            ].map((obj) => (
              <div
                key={obj.title}
                className="bg-white border border-[#E5E7EB] border-l-4 border-l-[#0B5FD1] rounded-2xl p-7"
              >
                <h3 className="font-bold text-[#111827] mb-2">{obj.title}</h3>
                <p className="text-sm text-[#4B5563] leading-relaxed">{obj.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── SECTION 9: DEALER BENEFITS ────────────────────────────────── */}
      <section className="py-24 bg-white" data-testid="dealer-benefits-section">
        <div className="mx-auto max-w-7xl px-6 md:px-12">
          <h2 className="text-3xl font-bold tracking-tight text-[#111827] mb-12">
            Built to Increase Your ROI
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {DEALER_BENEFITS.map((b) => (
              <div
                key={b.title}
                data-testid={`dealer-benefit-${b.title.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "")}`}
                className="bg-[#F8F9FB] border border-[#E5E7EB] rounded-2xl p-7 hover:border-[#0B5FD1] transition-colors"
              >
                <div className="w-10 h-10 rounded-full bg-[#EFF6FF] flex items-center justify-center mb-4">
                  <b.icon size={18} className="text-[#0B5FD1]" />
                </div>
                <h3 className="font-bold text-[#111827] mb-2">{b.title}</h3>
                <p className="text-sm text-[#4B5563] leading-relaxed">{b.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── SECTION 10: PRICING MODEL ─────────────────────────────────── */}
      <section className="py-24 bg-[#F8F9FB]">
        <div className="mx-auto max-w-7xl px-6 md:px-12">
          <h2 className="text-3xl font-bold tracking-tight text-[#111827] mb-3">
            Simple, Performance-Based Pricing
          </h2>
          <p className="text-[#4B5563] mb-12 max-w-2xl">
            Dealers are charged only after successfully closing a transaction generated through AutoLenis.
            No upfront fees. No monthly subscriptions. No per-lead charges.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="bg-white border border-[#E5E7EB] rounded-2xl p-8">
              <h3 className="font-bold text-[#111827] mb-6">How It Works</h3>
              <ul className="space-y-3">
                {[
                  "Receive buyer invitations at no cost",
                  "Submit offers at no cost",
                  "Pay only when a deal closes successfully",
                  "Fee is tied to the closed transaction",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-3">
                    <CheckCircle2 size={16} className="text-[#0B5FD1] mt-0.5 shrink-0" />
                    <span className="text-sm text-[#4B5563]">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="bg-white border border-[#E5E7EB] rounded-2xl p-8">
              <h3 className="font-bold text-[#111827] mb-6">Why Dealers Still Win</h3>
              <ul className="space-y-3">
                {[
                  "Higher intent buyers than purchased leads",
                  "Reduced time-to-close versus traditional prospecting",
                  "Higher conversion efficiency per interaction",
                  "No risk on unselected offers",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-3">
                    <CheckCircle2 size={16} className="text-[#0B5FD1] mt-0.5 shrink-0" />
                    <span className="text-sm text-[#4B5563]">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ── SECTION 11: COMPETITIVE COMPARISON ────────────────────────── */}
      <section className="py-24 bg-white">
        <div className="mx-auto max-w-7xl px-6 md:px-12">
          <h2 className="text-3xl font-bold tracking-tight text-[#111827] mb-12">
            AutoLenis vs. Traditional Lead Generation
          </h2>
          <div className="bg-white border border-[#E5E7EB] rounded-2xl overflow-hidden shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#E5E7EB]">
                  <th className="text-left px-6 py-4 text-[#94A3B8] font-medium w-1/3"></th>
                  <th className="px-6 py-4 text-[#94A3B8] font-medium text-center">Traditional Leads</th>
                  <th className="px-6 py-4 text-[#0B5FD1] font-semibold text-center bg-[#EFF6FF]">AutoLenis</th>
                </tr>
              </thead>
              <tbody>
                {[
                  {
                    label: "When you pay",
                    traditional: "Upfront, per lead",
                    autolenis: "After close only",
                  },
                  {
                    label: "Buyer intent",
                    traditional: "Unknown",
                    autolenis: "Prequalified + deposit",
                  },
                  {
                    label: "Wasted spend",
                    traditional: "High",
                    autolenis: "Zero (no close = no cost)",
                  },
                  {
                    label: "Competition structure",
                    traditional: "None",
                    autolenis: "Ranked auction system",
                  },
                  {
                    label: "Buyer qualification",
                    traditional: "Self-reported",
                    autolenis: "Verified prequalification",
                  },
                ].map((row, i) => (
                  <tr key={row.label} className={i % 2 === 0 ? "bg-white" : "bg-[#F8F9FB]"}>
                    <td className="px-6 py-4 text-[#111827] font-medium">{row.label}</td>
                    <td className="px-6 py-4 text-center text-[#94A3B8]">{row.traditional}</td>
                    <td className="px-6 py-4 text-center text-[#0B5FD1] font-medium bg-[#EFF6FF]">{row.autolenis}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ── SECTION 12: TRUST ──────────────────────────────────────────── */}
      <section className="py-24 bg-[#F8F9FB]">
        <div className="mx-auto max-w-7xl px-6 md:px-12">
          <h2 className="text-3xl font-bold tracking-tight text-[#111827] mb-12">
            A Platform Built for Long-Term Dealer Partnerships
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {[
              {
                title: "Fair Competition",
                body: "All dealers compete on equal terms within the same structured window.",
              },
              {
                title: "Verified Buyers",
                body: "Every buyer is prequalified before their auction is created.",
              },
              {
                title: "Transparent System",
                body: "You see the buyer profile and vehicle request before submitting.",
              },
              {
                title: "Professional Experience",
                body: "A structured deal environment that respects dealer time and expertise.",
              },
            ].map((t) => (
              <div
                key={t.title}
                className="bg-white border border-[#E5E7EB] rounded-2xl p-7"
              >
                <div className="w-8 h-8 rounded-full bg-[#EFF6FF] flex items-center justify-center mb-4">
                  <CheckCircle2 size={16} className="text-[#0B5FD1]" />
                </div>
                <h3 className="font-bold text-[#111827] mb-2">{t.title}</h3>
                <p className="text-sm text-[#4B5563] leading-relaxed">{t.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── SECTION 13: SOCIAL PROOF ───────────────────────────────────── */}
      <section className="py-24 bg-white">
        <div className="mx-auto max-w-7xl px-6 md:px-12">
          <h2 className="text-3xl font-bold tracking-tight text-[#111827] mb-12">
            Dealers Are Seeing the Difference
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              {
                quote:
                  "The buyers I receive through AutoLenis have already made up their mind. I close a higher percentage and spend less time on back-and-forth.",
                name: "David K.",
                detail: "Dallas TX · Franchise Dealer",
              },
              {
                quote:
                  "I submitted 4 offers last month and closed 3 of them. My cost-per-close is lower than any lead source I've used.",
                name: "Marcus T.",
                detail: "Houston TX · Independent Dealer",
              },
              {
                quote:
                  "The structure is what sold me. A defined window, a committed buyer, and I only pay when I win. That's how I want to work.",
                name: "Jennifer R.",
                detail: "Austin TX · Pre-Owned Specialist",
              },
            ].map((t) => (
              <div
                key={t.name}
                className="bg-white border border-[#E5E7EB] border-l-4 border-l-[#0B5FD1] rounded-2xl p-7"
              >
                <p className="text-sm text-[#4B5563] leading-relaxed italic mb-4">
                  &ldquo;{t.quote}&rdquo;
                </p>
                <p className="font-bold text-[#111827] text-sm">{t.name}</p>
                <p className="text-xs text-[#94A3B8]">{t.detail}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── SECTION 14: ONBOARDING FLOW ───────────────────────────────── */}
      <section className="py-24 bg-[#F8F9FB]">
        <div className="mx-auto max-w-7xl px-6 md:px-12">
          <h2 className="text-3xl font-bold tracking-tight text-[#111827] mb-12">
            Simple Onboarding. Fast Activation.
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-10">
            {[
              {
                step: 1,
                title: "Apply",
                body: "Complete the dealer application at /dealer/apply",
              },
              {
                step: 2,
                title: "Get Approved",
                body: "Our team reviews your application within 2 business days",
              },
              {
                step: 3,
                title: "Receive Buyers",
                body: "Get invited to auctions that match your inventory profile",
              },
              {
                step: 4,
                title: "Start Closing Deals",
                body: "Submit offers, win deals, grow your pipeline",
              },
            ].map((s) => (
              <div key={s.step} className="flex flex-col items-start">
                <div className="w-10 h-10 rounded-full bg-[#EFF6FF] text-[#0B5FD1] font-bold text-sm flex items-center justify-center mb-4">
                  {s.step}
                </div>
                <h3 className="font-bold text-[#111827] mb-2">{s.title}</h3>
                <p className="text-sm text-[#4B5563] leading-relaxed">{s.body}</p>
              </div>
            ))}
          </div>
          <Link
            href="/dealer/apply"
            className="inline-flex items-center gap-2 px-8 py-4 bg-[#0B5FD1] text-white font-semibold text-sm rounded-md hover:bg-[#1A6FE0] transition-colors shadow-md shadow-[#0B5FD1]/20"
          >
            Apply Now <ArrowRight size={16} />
          </Link>
        </div>
      </section>

      {/* ── SECTION 15: FAQ ────────────────────────────────────────────── */}
      <section className="py-24 bg-white">
        <div className="mx-auto max-w-7xl px-6 md:px-12">
          <h2 className="text-3xl font-bold tracking-tight text-[#111827] mb-12">
            Common Questions from Dealers
          </h2>
          <div className="max-w-3xl space-y-6">
            {[
              {
                q: "When do I pay?",
                a: "Only after a deal closes successfully. There are no upfront fees, no per-lead charges, and no monthly subscription. Your cost is entirely performance-based.",
              },
              {
                q: "What kind of buyers will I receive?",
                a: "Every buyer on AutoLenis completed a soft-pull prequalification and paid an Auction Access Deposit to activate their auction. You see their budget range and vehicle request before submitting an offer.",
              },
              {
                q: "How many dealers compete for each buyer?",
                a: `Up to ${MAX_DEALER_INVITATIONS} vetted dealers are invited per auction. You're competing against a small, qualified field — not a marketplace with unlimited participants.`,
              },
              {
                q: "Is this just a race to the lowest price?",
                a: "No. Buyers evaluate offers on total deal quality — price, terms, and value are all factors. Dealers who submit clean, complete offers consistently win, even when they're not the absolute lowest price.",
              },
              {
                q: "How do I get started?",
                a: "Complete the dealer application at /dealer/apply. Our team will review your application and reach out within 2 business days.",
              },
            ].map((faq) => (
              <div
                key={faq.q}
                className="bg-[#F8F9FB] border border-[#E5E7EB] rounded-2xl p-7"
              >
                <h3 className="font-bold text-[#111827] mb-3">{faq.q}</h3>
                <p className="text-sm text-[#4B5563] leading-relaxed">{faq.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── SECTION 16: FINAL CTA ──────────────────────────────────────── */}
      <section className="py-24 bg-[#0B5FD1]">
        <div className="mx-auto max-w-7xl px-6 md:px-12 text-center">
          <h2 className="text-3xl font-bold text-white mb-4">
            Stop Paying for Leads That Don&apos;t Close.
          </h2>
          <p className="text-white/80 text-lg mb-10 max-w-xl mx-auto">
            Start working with real buyers — and only pay when you win.
          </p>
          <div className="flex flex-wrap gap-4 justify-center">
            <Link
              href="/dealer/apply"
              data-testid="dealer-apply-footer-cta"
              className="inline-flex items-center gap-2 px-8 py-4 bg-white text-[#0B5FD1] font-semibold text-sm rounded-md hover:bg-[#EFF6FF] transition-colors shadow-md"
            >
              Apply Now <ArrowRight size={16} />
            </Link>
            <Link
              href="/contact"
              className="inline-flex items-center gap-2 px-8 py-4 border border-white/40 text-white font-medium text-sm rounded-md hover:bg-white/10 transition-colors"
            >
              Contact Us
            </Link>
          </div>
        </div>
      </section>

      {/* ── SECTION 17: FAITH MODULE ───────────────────────────────────── */}
      <section className="bg-[#0B5FD1] pb-20">
        <div className="mx-auto max-w-2xl px-6 text-center">
          <FaithVerseModule pageKey="dealers" />
        </div>
      </section>
    </div>
  );
}
