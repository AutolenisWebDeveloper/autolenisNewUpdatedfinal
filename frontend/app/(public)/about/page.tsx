import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Shield, Eye, Star, Heart, CheckCircle2, TrendingUp, Lock, Headphones, Zap } from "lucide-react";

import { buildPageMetadata, PAGE_METADATA } from "@/lib/seo/metadata";
import { JsonLd, aboutPageSchema } from "@/lib/seo/jsonld";
import FaithVerseModule from "@/components/public/FaithVerseModule";

export const metadata: Metadata = buildPageMetadata(PAGE_METADATA.about);
export const revalidate = 86400;

export default function AboutPage() {
  return (
    <>
      <JsonLd id="about-page-jsonld" data={aboutPageSchema()} />

      {/* ── SECTION 1 — HERO ───────────────────────────────────────────── */}
      <section
        className="bg-[#F8F9FB] pt-28 pb-20 md:pt-36 md:pb-28"
        data-testid="about-hero"
      >
        <div className="mx-auto max-w-7xl px-6 md:px-12">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            {/* Left */}
            <div>
              <p className="text-xs tracking-widest uppercase font-semibold text-[#0B5FD1] mb-5">
                Who We Are
              </p>
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-[#111827] tracking-tight leading-[1.08] mb-6">
                Built to Protect Buyers.
              </h1>
              <p className="text-lg text-[#4B5563] leading-relaxed mb-4 max-w-xl">
                AutoLenis was created to give everyday buyers leverage, clarity,
                and confidence in one of life&apos;s biggest purchases.
              </p>
              <p className="text-base text-[#6B7280] leading-relaxed mb-10 max-w-xl">
                Most people enter the car-buying process at a disadvantage. We
                built a better way.
              </p>
              <div className="flex flex-wrap gap-4">
                <Link
                  href="/auth/signup"
                  className="inline-flex items-center gap-2 px-8 py-4 bg-[#0B5FD1] text-white font-semibold text-sm rounded-xl hover:bg-[#0A4DB8] transition-colors"
                >
                  Get Prequalified
                  <ArrowRight size={16} />
                </Link>
                <Link
                  href="/how-it-works"
                  className="inline-flex items-center gap-2 px-8 py-4 border border-[#D1D5DB] text-[#374151] font-medium text-sm rounded-xl hover:bg-[#F9FAFB] transition-colors"
                >
                  See How It Works
                </Link>
              </div>
            </div>

            {/* Right — visual card */}
            <div className="hidden lg:flex justify-center">
              <div className="relative w-full max-w-md">
                <div className="bg-white rounded-2xl shadow-xl border border-[#E5E7EB] p-10 flex flex-col items-center text-center gap-6">
                  <div className="w-16 h-16 bg-[#EFF6FF] rounded-2xl flex items-center justify-center">
                    <Shield size={32} className="text-[#0B5FD1]" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-[#111827] mb-1">Buyer-First Platform</p>
                    <p className="text-sm text-[#6B7280] leading-relaxed">
                      Competitive dealer offers · Transparent comparisons · Smarter
                      decisions
                    </p>
                  </div>
                  <div className="grid grid-cols-3 w-full gap-4 pt-4 border-t border-[#F3F4F6]">
                    {[
                      { v: "312+", l: "Verified Dealers" },
                      { v: "$2,300", l: "Avg Savings" },
                      { v: "1,847", l: "Deals Done" },
                    ].map((s) => (
                      <div key={s.l} className="flex flex-col items-center">
                        <p className="text-xl font-bold text-[#0B5FD1]">{s.v}</p>
                        <p className="text-xs text-[#9CA3AF] mt-0.5 leading-tight">{s.l}</p>
                      </div>
                    ))}
                  </div>
                </div>
                {/* decorative blobs */}
                <div className="absolute -top-6 -right-6 w-24 h-24 bg-[#DBEAFE] rounded-full opacity-60 -z-10" />
                <div className="absolute -bottom-4 -left-4 w-16 h-16 bg-[#E0F2FE] rounded-full opacity-40 -z-10" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── SECTION 2 — THE PROBLEM ────────────────────────────────────── */}
      <section className="bg-white py-20 md:py-28" data-testid="about-problem">
        <div className="mx-auto max-w-7xl px-6 md:px-12">
          <div className="max-w-xl mx-auto text-center mb-14">
            <h2 className="text-3xl sm:text-4xl font-bold text-[#111827] tracking-tight">
              Car Buying Is Broken for Buyers.
            </h2>
          </div>
          <div className="grid sm:grid-cols-3 gap-6">
            {[
              {
                icon: <Zap size={24} className="text-[#0B5FD1]" />,
                title: "Pressure",
                body: "Buyers face high-pressure tactics and rushed decisions that benefit the seller.",
              },
              {
                icon: <Eye size={24} className="text-[#0B5FD1]" />,
                title: "Complexity",
                body: "Pricing, financing, fees, and trade-ins are deliberately confusing.",
              },
              {
                icon: <TrendingUp size={24} className="text-[#0B5FD1]" />,
                title: "Misalignment",
                body: "Traditional systems often reward sellers — not the people actually buying.",
              },
            ].map((c) => (
              <div
                key={c.title}
                className="bg-[#F8F9FB] border border-[#E5E7EB] rounded-2xl p-8"
              >
                <div className="w-10 h-10 bg-[#EFF6FF] rounded-xl flex items-center justify-center mb-5">
                  {c.icon}
                </div>
                <h3 className="text-lg font-semibold text-[#111827] mb-2">{c.title}</h3>
                <p className="text-sm text-[#6B7280] leading-relaxed">{c.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── SECTION 3 — OUR SOLUTION ───────────────────────────────────── */}
      <section className="bg-[#F8F9FB] py-20 md:py-28" data-testid="about-solution">
        <div className="mx-auto max-w-7xl px-6 md:px-12">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <div>
              <p className="text-xs tracking-widest uppercase font-semibold text-[#0B5FD1] mb-4">
                Our Solution
              </p>
              <h2 className="text-3xl sm:text-4xl font-bold text-[#111827] tracking-tight mb-6">
                We Built the Buyer Advantage Platform.
              </h2>
              <p className="text-[#4B5563] leading-relaxed mb-8">
                AutoLenis helps buyers take control through tools once reserved
                for industry insiders.
              </p>
              <ul className="space-y-3">
                {[
                  "Competitive dealer offers — dealers bid for your business",
                  "Transparent comparisons — no hidden fees, no surprises",
                  "Smarter financing decisions — guided by your situation",
                  "Dedicated support — a real person in your corner",
                  "Remote convenience — complete the process from home",
                  "Reduced stress — no pressure tactics, no games",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-3">
                    <CheckCircle2 size={18} className="text-[#0B5FD1] mt-0.5 shrink-0" />
                    <span className="text-sm text-[#4B5563] leading-relaxed">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="bg-white border border-[#E5E7EB] rounded-2xl p-8 shadow-sm">
              <p className="text-xs tracking-widest uppercase font-semibold text-[#9CA3AF] mb-6">
                Buyer Advantage
              </p>
              <div className="space-y-4">
                {[
                  { label: "Dealer competition", pct: 92 },
                  { label: "Pricing transparency", pct: 96 },
                  { label: "Buyer satisfaction", pct: 94 },
                  { label: "Stress reduction", pct: 89 },
                ].map((bar) => (
                  <div key={bar.label}>
                    <div className="flex justify-between mb-1.5">
                      <span className="text-xs font-medium text-[#374151]">{bar.label}</span>
                      <span className="text-xs font-semibold text-[#0B5FD1]">{bar.pct}%</span>
                    </div>
                    <div className="h-1.5 bg-[#E5E7EB] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-[#0B5FD1] rounded-full"
                        style={{ width: `${bar.pct}%` }}
                        role="progressbar"
                        aria-valuenow={bar.pct}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label={bar.label}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── SECTION 4 — WHY WE EXIST ───────────────────────────────────── */}
      <section className="bg-white py-20 md:py-28" data-testid="about-why">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <p className="text-xs tracking-widest uppercase font-semibold text-[#0B5FD1] mb-4">
            Why We Exist
          </p>
          <h2 className="text-3xl sm:text-4xl font-bold text-[#111827] tracking-tight mb-6">
            Because Smart Buyers Deserve Better.
          </h2>
          <p className="text-lg text-[#4B5563] leading-relaxed mb-4">
            Buying a vehicle should feel strategic and empowering — not stressful
            and uncertain.
          </p>
          <p className="text-base text-[#6B7280] leading-relaxed">
            We believe buyers deserve the same tools, information, and leverage
            that were once reserved for insiders. AutoLenis levels the field.
          </p>
        </div>
      </section>

      {/* ── SECTION 5 — OUR VALUES ─────────────────────────────────────── */}
      <section className="bg-[#F8F9FB] py-20 md:py-28" data-testid="about-values">
        <div className="mx-auto max-w-7xl px-6 md:px-12">
          <div className="max-w-xl mx-auto text-center mb-14">
            <p className="text-xs tracking-widest uppercase font-semibold text-[#0B5FD1] mb-4">
              Our Values
            </p>
            <h2 className="text-3xl sm:text-4xl font-bold text-[#111827] tracking-tight">
              What Drives Every Decision.
            </h2>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              {
                icon: <Shield size={22} className="text-[#0B5FD1]" />,
                title: "Integrity",
                body: "Do right by people — in every interaction, every day.",
              },
              {
                icon: <Eye size={22} className="text-[#0B5FD1]" />,
                title: "Transparency",
                body: "Clear information. No games. No fine print ambushes.",
              },
              {
                icon: <Star size={22} className="text-[#0B5FD1]" />,
                title: "Excellence",
                body: "High standards in every step of the buyer experience.",
              },
              {
                icon: <Heart size={22} className="text-[#0B5FD1]" />,
                title: "Stewardship",
                body: "Help customers make wise financial decisions — not just fast ones.",
              },
            ].map((v) => (
              <div
                key={v.title}
                className="bg-white border border-[#E5E7EB] rounded-2xl p-8 shadow-sm"
              >
                <div className="w-10 h-10 bg-[#EFF6FF] rounded-xl flex items-center justify-center mb-5">
                  {v.icon}
                </div>
                <h3 className="text-base font-semibold text-[#111827] mb-2">{v.title}</h3>
                <p className="text-sm text-[#6B7280] leading-relaxed">{v.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── SECTION 6 — HOW WE MAKE MONEY ─────────────────────────────── */}
      <section className="bg-white py-20 md:py-28" data-testid="about-business-model">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <p className="text-xs tracking-widest uppercase font-semibold text-[#0B5FD1] mb-4">
            Business Model
          </p>
          <h2 className="text-3xl sm:text-4xl font-bold text-[#111827] tracking-tight mb-6">
            Aligned Incentives Matter.
          </h2>
          <p className="text-lg text-[#4B5563] leading-relaxed mb-4">
            AutoLenis is built to serve buyers first.
          </p>
          <p className="text-base text-[#6B7280] leading-relaxed">
            We focus on transparent customer-paid plans and premium services
            designed to help buyers make smarter decisions — not confusion-based
            tactics. When you win, we succeed. That alignment is intentional.
          </p>
        </div>
      </section>

      {/* ── SECTION 7 — WHY PEOPLE TRUST US ───────────────────────────── */}
      <section className="bg-[#F8F9FB] py-20 md:py-28" data-testid="about-trust">
        <div className="mx-auto max-w-7xl px-6 md:px-12">
          <div className="max-w-xl mx-auto text-center mb-14">
            <p className="text-xs tracking-widest uppercase font-semibold text-[#0B5FD1] mb-4">
              Trust
            </p>
            <h2 className="text-3xl sm:text-4xl font-bold text-[#111827] tracking-tight">
              Built for Confidence.
            </h2>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              {
                icon: <Shield size={20} className="text-[#0B5FD1]" />,
                title: "Buyer-First Process",
                body: "Every step is designed around the buyer — not the dealer margin.",
              },
              {
                icon: <Eye size={20} className="text-[#0B5FD1]" />,
                title: "Transparent Pricing Approach",
                body: "Fees are visible upfront. No surprises at signing.",
              },
              {
                icon: <Lock size={20} className="text-[#0B5FD1]" />,
                title: "Secure Digital Experience",
                body: "Encrypted data, verified dealers, and protected transactions.",
              },
              {
                icon: <Heart size={20} className="text-[#0B5FD1]" />,
                title: "Values-Driven Company",
                body: "We operate with integrity — not just when it's convenient.",
              },
              {
                icon: <Headphones size={20} className="text-[#0B5FD1]" />,
                title: "Guided Support",
                body: "Real support from real people at every stage of your purchase.",
              },
              {
                icon: <Star size={20} className="text-[#0B5FD1]" />,
                title: "Premium Modern Platform",
                body: "A polished, professional experience that matches the stakes.",
              },
            ].map((t) => (
              <div
                key={t.title}
                className="bg-white border border-[#E5E7EB] rounded-2xl p-7 shadow-sm flex items-start gap-4"
              >
                <div className="w-9 h-9 bg-[#EFF6FF] rounded-lg flex items-center justify-center shrink-0">
                  {t.icon}
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-[#111827] mb-1">{t.title}</h3>
                  <p className="text-sm text-[#6B7280] leading-relaxed">{t.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── SECTION 8 — FAITH / VALUES MODULE ─────────────────────────── */}
      <section className="bg-[#0B5FD1] py-16 md:py-20" data-testid="about-faith">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <FaithVerseModule pageKey="about" />
        </div>
      </section>

      {/* ── SECTION 9 — FINAL CTA ──────────────────────────────────────── */}
      <section className="bg-[#111827] py-20 md:py-28" data-testid="about-cta">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-white tracking-tight mb-4">
            Ready for a Smarter Way to Buy?
          </h2>
          <p className="text-lg text-white/70 leading-relaxed mb-10">
            Join buyers choosing confidence over chaos.
          </p>
          <div className="flex flex-wrap justify-center gap-4">
            <Link
              href="/auth/signup"
              className="inline-flex items-center gap-2 px-8 py-4 bg-[#0B5FD1] text-white font-semibold text-sm rounded-xl hover:bg-[#0A4DB8] transition-colors"
              data-testid="about-cta-signup"
            >
              Get Prequalified
              <ArrowRight size={16} />
            </Link>
            <Link
              href="/inventory"
              className="inline-flex items-center gap-2 px-8 py-4 border border-white/20 text-white font-medium text-sm rounded-xl hover:bg-white/10 transition-colors"
              data-testid="about-cta-inventory"
            >
              Browse Vehicles
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
