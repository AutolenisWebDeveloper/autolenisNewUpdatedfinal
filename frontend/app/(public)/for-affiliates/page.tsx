import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  Share2,
  Users,
  DollarSign,
  TrendingUp,
  Youtube,
  Instagram,
  GraduationCap,
  Car,
  Shield,
  Home,
  HeartHandshake,
  BookOpen,
  Building2,
  Gauge,
  Gavel,
  FileCheck,
  Sparkles,
  Quote,
  CheckCircle2,
  ShieldCheck,
  MessageSquare,
  Award,
} from "lucide-react";
import { COMMISSION_RATES, PREMIUM_FEE_CENTS, PREMIUM_FEE_REMAINING_CENTS } from "@/lib/constants";
import FaithVerseModule from "@/components/public/FaithVerseModule";

import { buildPageMetadata, PAGE_METADATA } from "@/lib/seo/metadata";
export const metadata: Metadata = buildPageMetadata(PAGE_METADATA.forAffiliates);
export const dynamic = "force-dynamic";
export const revalidate = 86400;

// P1-2 (review) — advertised per-deal figures compute from the $400 captured
// basis commissions are actually paid on, never the $499 sticker.
const L1 = ((PREMIUM_FEE_REMAINING_CENTS / 100) * COMMISSION_RATES.LEVEL_1).toFixed(2);
const L2 = ((PREMIUM_FEE_REMAINING_CENTS / 100) * COMMISSION_RATES.LEVEL_2).toFixed(2);
const L3 = ((PREMIUM_FEE_REMAINING_CENTS / 100) * COMMISSION_RATES.LEVEL_3).toFixed(2);

const HOW_TO_EARN = [
  { icon: Share2, title: "Share your referral link", body: "Get a unique link. Share it via blog, YouTube, email, or social. Every buyer who signs up through you becomes your L1 referral." },
  { icon: Users, title: "They complete a deal", body: "When your referred buyer pays the $499 AutoLenis concierge fee, your commission is triggered automatically." },
  { icon: DollarSign, title: `You earn ${Math.round(COMMISSION_RATES.LEVEL_1 * 100)}%`, body: `L1 pays $${L1} per completed deal. Your L1s also earn from their referrals — and you earn L2/L3 on those too.` },
  { icon: TrendingUp, title: "Build your network", body: "Earn a percentage of commissions up to 3 levels deep — automatic and compounding as your network grows." },
];


const TOTAL_PAYOUT_PCT = Math.round(
  (COMMISSION_RATES.LEVEL_1 + COMMISSION_RATES.LEVEL_2 + COMMISSION_RATES.LEVEL_3) * 100,
);

const PARTNER_TYPES = [
  { icon: Youtube, label: "YouTube & Video Creators" },
  { icon: Instagram, label: "TikTok / Instagram Creators" },
  { icon: GraduationCap, label: "Personal Finance Educators" },
  { icon: Car, label: "Auto Reviewers & Channels" },
  { icon: Shield, label: "Insurance Agents" },
  { icon: Home, label: "Real Estate Professionals" },
  { icon: HeartHandshake, label: "Community & Faith Leaders" },
  { icon: BookOpen, label: "Bloggers & Newsletter Owners" },
  { icon: Building2, label: "Organizations & Nonprofits" },
];

const PROMOTE_FEATURES = [
  { icon: Gauge, title: "Buyer Advantage Platform", body: "Help your audience buy smarter with leverage and financial clarity." },
  { icon: Gavel, title: "Reverse Auction System", body: "Dealers compete for the buyer's business — your audience gets a better deal." },
  { icon: FileCheck, title: "Contract Shield", body: "Buyers gain better visibility into deal structure before moving forward." },
  { icon: Sparkles, title: "Premium Concierge", body: "White-glove support for buyers who want guidance from search to delivery." },
];

const CONTENT_ANGLES = [
  "Why you should never negotiate from monthly payment alone",
  "How dealerships make money on car deals",
  "How to avoid hidden fees before signing",
  "Why getting prequalified before shopping matters",
  "How dealer competition can help buyers",
  "The smarter way to buy your next car",
];

const COMPLIANCE = [
  { icon: CheckCircle2, title: "Clear Disclosures", body: "Partners must disclose affiliate relationships where required by law." },
  { icon: ShieldCheck, title: "No Misleading Claims", body: "No guaranteed savings, approvals, or specific buyer outcomes." },
  { icon: MessageSquare, title: "Brand-Safe Messaging", body: "AutoLenis provides approved messaging guidelines to partners." },
  { icon: Award, title: "Professional Standards", body: "Partners are expected to represent the brand with integrity." },
];

const FAQS = [
  {
    q: "Who can become an AutoLenis affiliate?",
    a: "Creators, professionals, organizations, and community leaders may apply. AutoLenis reviews applicants for audience fit, brand alignment, and program eligibility.",
  },
  {
    q: "How do affiliates get paid?",
    a: "Eligible commissions are paid according to the affiliate agreement and program terms. Exact payout timing and eligibility are provided during onboarding.",
  },
  {
    q: "Can I promote AutoLenis on social media?",
    a: "Yes, approved affiliates may promote AutoLenis through approved channels as long as content follows brand, compliance, and disclosure guidelines.",
  },
  {
    q: "Can I make income or savings guarantees?",
    a: "No. Affiliates may not promise or imply guaranteed income, guaranteed buyer savings, guaranteed approvals, or guaranteed buyer outcomes.",
  },
  {
    q: "Do I get a tracking link?",
    a: "Yes. Approved affiliates receive unique tracking tools to help monitor referral activity and commission status.",
  },
  {
    q: "Is there an affiliate dashboard?",
    a: "Yes. Approved partners can access dashboard tools for tracking referral performance and commission history.",
  },
];

const TIERS = [
  {
    level: "Level 1 — Direct",
    testid: "commission-tier-level-1",
    pct: `${Math.round(COMMISSION_RATES.LEVEL_1 * 100)}%`,
    amount: `$${L1}`,
    desc: "Per completed deal from your direct referral",
    bg: "bg-[#ECFDF5]",
    border: "border-[#A7F3D0]",
    numColor: "text-[#065F46]",
    amtColor: "text-[#059669]",
    badge: "bg-[#059669] text-white",
  },
  {
    level: "Level 2 — Network",
    testid: "commission-tier-level-2",
    pct: `${Math.round(COMMISSION_RATES.LEVEL_2 * 100)}%`,
    amount: `$${L2}`,
    desc: "Per completed deal from people referred by your L1s",
    bg: "bg-[#EFF6FF]",
    border: "border-[#BFDBFE]",
    numColor: "text-[#1D4ED8]",
    amtColor: "text-[#2563EB]",
    badge: "bg-[#2563EB] text-white",
  },
  {
    level: "Level 3 — Extended",
    testid: "commission-tier-level-3",
    pct: `${Math.round(COMMISSION_RATES.LEVEL_3 * 100)}%`,
    amount: `$${L3}`,
    desc: "Per completed deal from people referred by your L2s",
    bg: "bg-[#F8F9FB]",
    border: "border-[#E5E7EB]",
    numColor: "text-[#111827]",
    amtColor: "text-[#0B5FD1]",
    badge: "bg-[#0B5FD1] text-white",
  },
];

export default function ForAffiliatesPage() {
  return (
    <div className="bg-white">
      {/* SECTION 1 — HERO */}
      <section
        className="relative overflow-hidden bg-gradient-to-br from-[#F8F9FB] via-white to-[#EFF6FF] pt-16"
        data-testid="for-affiliates-hero"
      >
        <div className="mx-auto max-w-7xl px-6 py-24 md:px-12 md:py-36">
          <span className="text-xs font-semibold uppercase tracking-[0.15em] text-[#0B5FD1]">
            Affiliate Partner Program
          </span>
          <h1 className="mt-4 mb-6 max-w-3xl text-5xl font-bold leading-[1.05] tracking-tighter text-[#111827] sm:text-6xl">
            Earn by Helping Buyers Make{" "}
            <span className="text-[#0B5FD1]">Smarter Car Decisions.</span>
          </h1>
          <p className="mb-10 max-w-2xl text-lg leading-relaxed text-[#4B5563]">
            Partner with AutoLenis and introduce your audience to a premium buyer-first
            platform built around dealer competition, pricing clarity, and a smarter
            vehicle purchase experience. Free to join. Commissions paid on deal
            completion.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Link
              href="/affiliate/register"
              data-testid="affiliate-cta-primary"
              className="inline-flex items-center justify-center gap-2 rounded-md bg-[#0B5FD1] px-8 py-4 text-sm font-semibold text-white shadow-md shadow-[#0B5FD1]/20 transition-colors hover:bg-[#0A4DB8]"
            >
              Apply to Join <ArrowRight size={16} />
            </Link>
            <Link
              href="/affiliate/signin"
              data-testid="affiliate-cta-signin"
              className="inline-flex items-center justify-center gap-2 rounded-md border border-[#0B5FD1] px-8 py-4 text-sm font-semibold text-[#0B5FD1] transition-colors hover:bg-[#0B5FD1]/5"
            >
              Already an Affiliate? Sign In
            </Link>
          </div>
          <p className="mt-8 text-sm text-[#94A3B8]">
            Buyer-first platform · Trackable referrals · 3-level commissions · Real
            consumer value
          </p>
        </div>
      </section>

      {/* SECTION 2 — COMMISSION STRUCTURE */}
      <section className="bg-white py-24" data-testid="commission-section">
        <div className="mx-auto max-w-7xl px-6 md:px-12">
          <div className="mb-14 max-w-2xl">
            <span className="text-xs font-semibold uppercase tracking-[0.15em] text-[#0B5FD1]">
              3-Level Commission Structure
            </span>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-[#111827] md:text-4xl">
              Earn on Every Deal in Your Network — Up to 3 Levels Deep.
            </h2>
            <p className="mt-3 text-sm text-[#4B5563]">
              Based on the ${(PREMIUM_FEE_REMAINING_CENTS / 100).toFixed(0)} concierge-fee
              balance (the ${(PREMIUM_FEE_CENTS / 100).toFixed(0)} Premium fee less the deposit
              credit) — the basis commissions are actually paid on. Commissions paid only on
              completed deals.
            </p>
          </div>
          <div className="grid max-w-5xl grid-cols-1 gap-5 md:grid-cols-3">
            {TIERS.map((tier) => (
              <div
                key={tier.level}
                data-testid={tier.testid}
                className={`rounded-2xl border p-8 ${tier.bg} ${tier.border}`}
              >
                <span
                  className={`mb-4 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${tier.badge}`}
                >
                  {tier.level}
                </span>
                <p
                  className={`mt-2 font-[family-name:var(--font-mono)] text-5xl font-bold tracking-tight ${tier.numColor}`}
                >
                  {tier.pct}
                </p>
                <p
                  className={`mb-4 font-[family-name:var(--font-mono)] text-2xl font-semibold ${tier.amtColor}`}
                >
                  {tier.amount} / deal
                </p>
                <p className="text-xs leading-relaxed text-[#4B5563]">{tier.desc}</p>
              </div>
            ))}
          </div>
          <p className="mt-6 text-xs text-[#94A3B8]">
            Maximum 3 levels. Total platform payout: up to {TOTAL_PAYOUT_PCT}% per deal.
          </p>
        </div>
      </section>

      {/* SECTION 3 — WHO THIS IS FOR */}
      <section className="bg-[#F8F9FB] py-24">
        <div className="mx-auto max-w-7xl px-6 md:px-12">
          <div className="mb-14 max-w-2xl">
            <span className="text-xs font-semibold uppercase tracking-[0.15em] text-[#0B5FD1]">
              Who It&apos;s For
            </span>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-[#111827] md:text-4xl">
              Built for Partners With Influence and Trust.
            </h2>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
            {PARTNER_TYPES.map((partner) => (
              <div
                key={partner.label}
                className="flex items-center gap-4 rounded-2xl border border-[#E5E7EB] bg-white p-5 transition-colors hover:border-[#BFDBFE]"
              >
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#EFF6FF]">
                  <partner.icon size={18} className="text-[#0B5FD1]" />
                </div>
                <p className="text-sm font-semibold text-[#111827]">{partner.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* SECTION 4 — HOW IT WORKS */}
      <section
        id="how-to-earn-section"
        className="bg-white py-24"
        data-testid="how-to-earn-section"
      >
        <div className="mx-auto max-w-7xl px-6 md:px-12">
          <div className="mb-14 max-w-2xl">
            <span className="text-xs font-semibold uppercase tracking-[0.15em] text-[#0B5FD1]">
              How It Works
            </span>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-[#111827] md:text-4xl">
              Four Steps to Earning With AutoLenis
            </h2>
          </div>
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-4">
            {HOW_TO_EARN.map((item, i) => (
              <div
                key={item.title}
                data-testid={`earn-step-${i + 1}`}
                className="rounded-2xl border border-[#E5E7EB] bg-white p-7 transition-all hover:border-[#BFDBFE] hover:shadow-sm"
              >
                <div className="mb-5 flex h-10 w-10 items-center justify-center rounded-lg bg-[#EFF6FF]">
                  <item.icon size={18} className="text-[#0B5FD1]" />
                </div>
                <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-[#94A3B8]">
                  Step {i + 1}
                </p>
                <h3 className="mb-2 text-sm font-bold text-[#111827]">{item.title}</h3>
                <p className="text-xs leading-relaxed text-[#4B5563]">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* SECTION 5 — WHAT YOU CAN PROMOTE */}
      <section className="bg-[#F8F9FB] py-24">
        <div className="mx-auto max-w-7xl px-6 md:px-12">
          <div className="mb-14 max-w-2xl">
            <span className="text-xs font-semibold uppercase tracking-[0.15em] text-[#0B5FD1]">
              What You Promote
            </span>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-[#111827] md:text-4xl">
              A Platform People Actually Need.
            </h2>
          </div>
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-4">
            {PROMOTE_FEATURES.map((feature) => (
              <div
                key={feature.title}
                className="rounded-2xl border border-[#E5E7EB] bg-white p-7"
              >
                <div className="mb-5 flex h-10 w-10 items-center justify-center rounded-lg bg-[#EFF6FF]">
                  <feature.icon size={18} className="text-[#0B5FD1]" />
                </div>
                <h3 className="mb-2 text-sm font-bold text-[#111827]">
                  {feature.title}
                </h3>
                <p className="text-xs leading-relaxed text-[#4B5563]">{feature.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* SECTION 6 — CONTENT ANGLES */}
      <section className="bg-white py-24">
        <div className="mx-auto max-w-7xl px-6 md:px-12">
          <div className="mb-14 max-w-2xl">
            <span className="text-xs font-semibold uppercase tracking-[0.15em] text-[#0B5FD1]">
              Content Ideas
            </span>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-[#111827] md:text-4xl">
              Easy Content Angles That Educate and Convert.
            </h2>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {CONTENT_ANGLES.map((angle) => (
              <div
                key={angle}
                className="flex items-start gap-3 rounded-xl border border-[#E5E7EB] bg-[#F8F9FB] p-6"
              >
                <Quote size={16} className="mt-1 shrink-0 text-[#0B5FD1]" />
                <p className="text-sm italic leading-relaxed text-[#4B5563]">
                  &ldquo;{angle}&rdquo;
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* SECTION 7 — COMPLIANCE */}
      <section className="bg-[#F8F9FB] py-24">
        <div className="mx-auto max-w-7xl px-6 md:px-12">
          <div className="mb-14 max-w-2xl">
            <span className="text-xs font-semibold uppercase tracking-[0.15em] text-[#0B5FD1]">
              Compliance & Trust
            </span>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-[#111827] md:text-4xl">
              Built for Responsible Promotion.
            </h2>
          </div>
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-4">
            {COMPLIANCE.map((item) => (
              <div
                key={item.title}
                className="rounded-2xl border border-[#E5E7EB] bg-white p-7"
              >
                <div className="mb-5 flex h-10 w-10 items-center justify-center rounded-lg bg-[#EFF6FF]">
                  <item.icon size={18} className="text-[#0B5FD1]" />
                </div>
                <h3 className="mb-2 text-sm font-bold text-[#111827]">{item.title}</h3>
                <p className="text-xs leading-relaxed text-[#4B5563]">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* SECTION 8 — FAQ */}
      <section className="bg-white py-24">
        <div className="mx-auto max-w-3xl px-6 md:px-12">
          <div className="mb-12">
            <span className="text-xs font-semibold uppercase tracking-[0.15em] text-[#0B5FD1]">
              FAQ
            </span>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-[#111827] md:text-4xl">
              Common Questions
            </h2>
          </div>
          <div className="space-y-4">
            {FAQS.map((item) => (
              <div
                key={item.q}
                className="rounded-2xl border border-[#E5E7EB] bg-white p-7"
              >
                <h3 className="mb-2 text-base font-semibold text-[#111827]">
                  {item.q}
                </h3>
                <p className="text-sm leading-relaxed text-[#4B5563]">{item.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* SECTION 10 — FAITH MODULE */}
      <div className="mx-auto max-w-2xl px-6 py-8">
        <FaithVerseModule pageKey="partner-program" />
      </div>

      {/* SECTION 9 — FINAL CTA */}
      <section className="bg-[#0B5FD1] py-20">
        <div className="mx-auto max-w-7xl px-6 md:px-12">
          <h2 className="mb-3 max-w-2xl text-3xl font-bold tracking-tight text-white md:text-4xl">
            Turn Trust Into Opportunity.
          </h2>
          <p className="mb-8 max-w-xl text-white/80">
            Join a partner program built around a real consumer problem and a premium
            buyer-first platform.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Link
              href="/affiliate/register"
              data-testid="affiliate-footer-cta"
              className="inline-flex items-center justify-center gap-2 rounded-md bg-white px-8 py-4 text-sm font-semibold text-[#0B5FD1] shadow-md shadow-black/20 transition-colors hover:bg-[#EFF6FF]"
            >
              Apply to Join <ArrowRight size={16} />
            </Link>
            <Link
              href="/affiliate/signin"
              data-testid="affiliate-footer-signin"
              className="inline-flex items-center justify-center gap-2 rounded-md border border-white/40 px-8 py-4 text-sm font-semibold text-white transition-colors hover:bg-white/10"
            >
              Already an Affiliate? Sign In
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
