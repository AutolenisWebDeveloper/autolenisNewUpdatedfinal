import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  ShieldAlert,
  Info,
  TrendingDown,
  Target,
  Wallet,
  Percent,
  Calendar,
  BarChart3,
  Shield,
  Eye,
  Users,
  Heart,
  DollarSign,
} from "lucide-react";
import { MARKETING_IMAGES } from "@/lib/constants/marketing-images";
import { buildPageMetadata, PAGE_METADATA } from "@/lib/seo/metadata";
import FaithVerseModule from "@/components/public/FaithVerseModule";

export const metadata: Metadata = buildPageMetadata(PAGE_METADATA.refinance);
export const dynamic = "force-dynamic";
export const revalidate = 86400;

const HOW_IT_WORKS = [
  {
    step: "01",
    title: "Check your eligibility in minutes",
    body: "Share a few basics about your vehicle and current loan. No credit pull happens during this eligibility screening.",
  },
  {
    step: "02",
    title: "We connect you with our partner",
    body: "If your information fits our partner's basic criteria, we hand you off with a unique referral ID.",
  },
  {
    step: "03",
    title: "Apply directly through their secure application",
    body: "OpenRoad Lending handles the application, underwriting, and any credit decisions — AutoLenis is not involved in that process.",
  },
];

const WHAT_WE_DO_NOT = [
  "Does not make lending decisions",
  "Does not guarantee rates, terms, or savings",
  "Does not access your credit for this screening",
  "Does not embed or frame the partner's application",
];

const EXCLUDED_STATE_NAMES = [
  "Alaska",
  "Hawaii",
  "Montana",
  "Nevada",
  "New Hampshire",
  "North Dakota",
  "Wisconsin",
];

export default function RefinanceLandingPage() {
  return (
    <div className="bg-[#F8F9FB]" data-testid="refinance-landing-page">

      {/* ── Section 1: Hero ── */}
      <section
        className="pt-16 py-20 md:py-28 bg-gradient-to-b from-[#F8F9FB] to-white"
        data-testid="refinance-hero"
      >
        <div className="mx-auto max-w-6xl px-6 grid lg:grid-cols-[1fr_480px] gap-12 items-center">
          <div className="text-center lg:text-left">
            <span className="text-xs font-semibold uppercase tracking-[0.15em] text-[#0B5FD1]">
              AUTO REFINANCE
            </span>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-[#111827] mt-4 mb-6 leading-[1.05]">
              Lower Your Payment. Improve Your Terms. Keep Driving.
            </h1>
            <p className="text-[#4B5563] text-lg max-w-2xl lg:mx-0 mx-auto leading-relaxed mb-8">
              AutoLenis helps drivers explore whether refinancing their current auto loan could reduce monthly payments, improve loan terms, or create more financial breathing room — through a guided process powered by OpenRoad Lending.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center lg:justify-start mb-8">
              <Link
                href="/refinance/eligibility"
                data-testid="refinance-hero-cta"
                className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-[#0B5FD1] text-white font-semibold text-sm rounded-md hover:bg-[#0A4DB8] transition-colors shadow-md shadow-[#0B5FD1]/25"
              >
                Check My Eligibility <ArrowRight size={16} />
              </Link>
              <a
                href="#how-it-works"
                className="inline-flex items-center justify-center gap-2 px-8 py-4 border border-[#0B5FD1] text-[#0B5FD1] font-semibold text-sm rounded-md hover:bg-[#EFF6FF] transition-colors"
              >
                See How It Works
              </a>
            </div>
            <p className="text-xs text-[#94A3B8] leading-relaxed">
              No credit pull to check eligibility · Secure process · Partner-supported · No dealership visit
            </p>
          </div>
          <div className="relative hidden lg:block">
            <div className="relative rounded-2xl overflow-hidden shadow-2xl shadow-[#0B5FD1]/15">
              <img
                src={MARKETING_IMAGES.trustMoment}
                alt="Customer reviewing auto loan refinance options with financial clarity"
                className="w-full aspect-[4/3] object-cover"
                data-testid="refinance-hero-image"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[#0B5FD1]/15 to-transparent" />
            </div>
          </div>
        </div>
      </section>

      {/* ── Section 2: Partner Strip ── */}
      <section className="py-8 bg-white border-y border-[#E5E7EB]" data-testid="refinance-partner-strip">
        <div className="mx-auto max-w-5xl px-6 text-center">
          <p className="text-xs font-semibold text-[#4B5563] uppercase tracking-wider mb-1">
            Powered by
          </p>
          <p className="text-base font-bold text-[#111827]">OpenRoad Lending</p>
          <p className="text-xs text-[#94A3B8] mt-1">
            An established auto refinance lender serving qualified customers nationwide.
          </p>
        </div>
      </section>

      {/* ── Section 3: Why Refinance ── */}
      <section className="py-20 md:py-24 bg-[#F8F9FB]">
        <div className="mx-auto max-w-5xl px-6">
          <div className="mb-12 text-center">
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-[#111827] mb-4">
              Your Auto Loan Should Still Make Sense Today.
            </h2>
            <p className="text-[#4B5563] text-lg max-w-2xl mx-auto leading-relaxed">
              The loan that made sense when you bought your vehicle may not be the best fit now. Your credit profile, income, market rates, or financial goals may have changed — and your monthly payment should reflect where you are today.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              {
                icon: <TrendingDown size={20} className="text-[#0B5FD1]" />,
                title: "Lower Monthly Payment",
                body: "Create more room in your monthly budget by potentially reducing what you pay each month.",
              },
              {
                icon: <Target size={20} className="text-[#0B5FD1]" />,
                title: "Better Loan Terms",
                body: "Explore a loan structure that may better align with your current financial goals.",
              },
              {
                icon: <Wallet size={20} className="text-[#0B5FD1]" />,
                title: "Improved Financial Flexibility",
                body: "Reduce payment pressure without replacing your vehicle.",
              },
            ].map((card) => (
              <div key={card.title} className="bg-white border border-[#E5E7EB] rounded-2xl p-7 shadow-sm">
                <div className="w-10 h-10 rounded-full bg-[#EFF6FF] flex items-center justify-center mb-4">
                  {card.icon}
                </div>
                <h3 className="text-base font-bold text-[#111827] mb-2">{card.title}</h3>
                <p className="text-sm text-[#4B5563] leading-relaxed">{card.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Section 4: Signs You Should Review ── */}
      <section className="py-20 md:py-24 bg-white">
        <div className="mx-auto max-w-3xl px-6">
          <div className="mb-10 text-center">
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-[#111827]">
              It May Be Time to Refinance If…
            </h2>
          </div>
          <div className="bg-white border border-[#E5E7EB] rounded-2xl p-8 shadow-sm">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[
                "Your credit score has improved since you got your loan",
                "Your current interest rate feels too high relative to current market rates",
                "Your monthly payment has become uncomfortable in your budget",
                "You want to explore removing or adding a co-borrower",
                "Your income or financial situation has changed",
                "You want to compare your current terms against available options",
              ].map((item) => (
                <div key={item} className="flex items-start gap-3">
                  <CheckCircle2 size={16} className="text-[#0B5FD1] mt-0.5 shrink-0" />
                  <span className="text-sm text-[#4B5563] leading-relaxed">{item}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Section 5: How It Works ── */}
      <section
        className="py-20 md:py-24 bg-[#F8F9FB]"
        id="how-it-works"
        data-testid="refinance-how-it-works"
      >
        <div className="mx-auto max-w-5xl px-6">
          <div className="mb-12 text-center">
            <span className="text-xs font-semibold uppercase tracking-[0.15em] text-[#0B5FD1]">
              HOW IT WORKS
            </span>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-[#111827] mt-3">
              Three Steps — Start to Finish
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {HOW_IT_WORKS.map((item) => (
              <div
                key={item.step}
                data-testid={`refinance-step-${item.step}`}
                className="bg-white border border-[#E5E7EB] rounded-2xl p-7 shadow-sm"
              >
                <p className="text-[56px] font-bold text-[#0B5FD1]/15 leading-none mb-5 font-[family-name:var(--font-mono)]">
                  {item.step}
                </p>
                <h3 className="text-sm font-bold text-[#111827] mb-2.5">{item.title}</h3>
                <p className="text-xs text-[#4B5563] leading-relaxed">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Section 6: Know the Numbers ── */}
      <section className="py-20 md:py-24 bg-white">
        <div className="mx-auto max-w-5xl px-6">
          <div className="mb-10 text-center">
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-[#111827] mb-4">
              Know the Numbers Before You Decide.
            </h2>
            <p className="text-[#4B5563] text-lg max-w-2xl mx-auto leading-relaxed">
              A lower payment is useful — but it is not the only thing that matters. Before moving forward, understand the full picture of your loan structure.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-8">
            {[
              {
                icon: <DollarSign size={20} className="text-[#0B5FD1]" />,
                title: "Monthly Payment",
                body: "Understand how a payment change might affect your monthly budget.",
              },
              {
                icon: <Percent size={20} className="text-[#0B5FD1]" />,
                title: "Interest Rate",
                body: "Compare your current rate to what refinance options may offer.",
              },
              {
                icon: <Calendar size={20} className="text-[#0B5FD1]" />,
                title: "Loan Term",
                body: "Know whether a different term length makes sense for your situation.",
              },
              {
                icon: <BarChart3 size={20} className="text-[#0B5FD1]" />,
                title: "Total Interest",
                body: "Look beyond the monthly payment — total cost matters.",
              },
            ].map((card) => (
              <div key={card.title} className="bg-white border border-[#E5E7EB] rounded-2xl p-6 shadow-sm">
                <div className="w-10 h-10 rounded-full bg-[#EFF6FF] flex items-center justify-center mb-4">
                  {card.icon}
                </div>
                <h3 className="text-base font-bold text-[#111827] mb-2">{card.title}</h3>
                <p className="text-sm text-[#4B5563] leading-relaxed">{card.body}</p>
              </div>
            ))}
          </div>
          <div className="bg-[#EFF6FF] border border-[#0B5FD1]/20 rounded-2xl p-8 text-center">
            <h3 className="text-xl font-bold text-[#111827] mb-2">Ready to See Your Options?</h3>
            <p className="text-sm text-[#4B5563] mb-6 leading-relaxed">
              Takes about 90 seconds. No credit pull to check eligibility.
            </p>
            <Link
              href="/refinance/eligibility"
              className="inline-flex items-center gap-2 px-8 py-4 bg-[#0B5FD1] text-white font-semibold text-sm rounded-md hover:bg-[#0A4DB8] transition-colors shadow-md shadow-[#0B5FD1]/25"
            >
              Check My Eligibility <ArrowRight size={16} />
            </Link>
          </div>
        </div>
      </section>

      {/* ── Section 7: What AutoLenis Does NOT Do ── */}
      <section className="py-16 bg-[#F8F9FB]" data-testid="refinance-disclosures">
        <div className="mx-auto max-w-3xl px-6">
          <div className="bg-white border border-[#E5E7EB] rounded-2xl p-8 shadow-sm">
            <div className="flex items-center gap-2.5 mb-4">
              <Info size={16} className="text-[#0B5FD1]" />
              <h3 className="text-sm font-bold uppercase tracking-wider text-[#111827]">
                What AutoLenis Does NOT Do
              </h3>
            </div>
            <ul className="space-y-3" data-testid="refinance-what-we-dont">
              {WHAT_WE_DO_NOT.map((item) => (
                <li
                  key={item}
                  className="flex items-start gap-2.5 text-sm text-[#4B5563]"
                  data-testid={`refinance-not-item-${item.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}`}
                >
                  <CheckCircle2 size={15} className="text-[#0B5FD1] mt-0.5 shrink-0" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ── Section 8: Excluded States Notice (legal — preserved exactly) ── */}
      <section className="py-12" data-testid="refinance-excluded-states-section">
        <div className="mx-auto max-w-3xl px-6">
          <div
            data-testid="refinance-excluded-states-notice"
            className="bg-amber-50 border border-amber-200 rounded-xl p-6"
          >
            <div className="flex items-start gap-3">
              <ShieldAlert size={18} className="text-amber-700 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-bold text-amber-900 mb-1">Program availability</p>
                <p className="text-xs text-amber-900/90 leading-relaxed">
                  This program is not available in{" "}
                  {EXCLUDED_STATE_NAMES.map((s, i) => (
                    <span key={s}>
                      <strong>{s}</strong>
                      {i < EXCLUDED_STATE_NAMES.length - 2
                        ? ", "
                        : i === EXCLUDED_STATE_NAMES.length - 2
                        ? ", or "
                        : ""}
                    </span>
                  ))}
                  . We apologize for the inconvenience.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Section 9: Comparison ── */}
      <section className="py-20 md:py-24 bg-white">
        <div className="mx-auto max-w-4xl px-6">
          <div className="mb-12 text-center">
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-[#111827]">
              Refinance With Clarity, Not Guesswork.
            </h2>
          </div>
          <div className="bg-white border border-[#E5E7EB] rounded-2xl overflow-hidden shadow-sm">
            <div className="grid grid-cols-3 bg-[#F8F9FB] border-b border-[#E5E7EB]">
              <div className="p-4" />
              <div className="p-4 text-center border-x border-[#E5E7EB]">
                <p className="text-xs font-semibold text-[#94A3B8] uppercase tracking-wider">
                  Traditional Refinance Search
                </p>
              </div>
              <div className="p-4 text-center bg-[#0B5FD1]">
                <p className="text-xs font-semibold text-white uppercase tracking-wider">
                  AutoLenis Refinance Path
                </p>
              </div>
            </div>
            {[
              {
                label: "Process",
                traditional: "Confusing lender shopping",
                autolenis: "Guided eligibility review",
              },
              {
                label: "Focus",
                traditional: "Payment only",
                autolenis: "Full loan structure awareness",
              },
              {
                label: "Clarity",
                traditional: "Hard to compare options",
                autolenis: "Clearer decision framework",
              },
              {
                label: "Next steps",
                traditional: "Unclear",
                autolenis: "Partner-supported path via OpenRoad Lending",
              },
            ].map((row, idx) => (
              <div
                key={row.label}
                className={`grid grid-cols-3 border-b border-[#E5E7EB] last:border-b-0 ${idx % 2 === 0 ? "bg-white" : "bg-[#F8F9FB]"}`}
              >
                <div className="p-4">
                  <p className="text-xs font-semibold text-[#111827] uppercase tracking-wider">
                    {row.label}
                  </p>
                </div>
                <div className="p-4 border-x border-[#E5E7EB]">
                  <p className="text-sm text-[#94A3B8]">{row.traditional}</p>
                </div>
                <div className="p-4 flex items-center gap-2">
                  <CheckCircle2 size={14} className="text-[#0B5FD1] shrink-0" />
                  <p className="text-sm text-[#111827] font-medium">{row.autolenis}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Section 10: Trust & Safety ── */}
      <section className="py-20 md:py-24 bg-[#F8F9FB]">
        <div className="mx-auto max-w-5xl px-6">
          <div className="mb-12 text-center">
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-[#111827]">
              Built Around Financial Confidence.
            </h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {[
              {
                icon: <Shield size={20} className="text-[#0B5FD1]" />,
                title: "Secure Process",
                body: "Your information is handled with care throughout the eligibility and referral process.",
              },
              {
                icon: <Eye size={20} className="text-[#0B5FD1]" />,
                title: "Clear Expectations",
                body: "Understand the process and what AutoLenis does — and does not do — before moving forward.",
              },
              {
                icon: <Users size={20} className="text-[#0B5FD1]" />,
                title: "Partner-Supported Options",
                body: "If eligible, continue with OpenRoad Lending for the refinance application and final terms.",
              },
              {
                icon: <Heart size={20} className="text-[#0B5FD1]" />,
                title: "Buyer-First Mindset",
                body: "AutoLenis helps users make smarter vehicle finance decisions — not pressure them into one.",
              },
            ].map((card) => (
              <div key={card.title} className="bg-white border border-[#E5E7EB] rounded-2xl p-7 shadow-sm">
                <div className="w-10 h-10 rounded-full bg-[#EFF6FF] flex items-center justify-center mb-4">
                  {card.icon}
                </div>
                <h3 className="text-base font-bold text-[#111827] mb-2">{card.title}</h3>
                <p className="text-sm text-[#4B5563] leading-relaxed">{card.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Section 11: FAQ ── */}
      <section className="py-20 md:py-24 bg-white">
        <div className="mx-auto max-w-3xl px-6">
          <div className="mb-12 text-center">
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-[#111827]">
              Common Questions
            </h2>
          </div>
          <div className="space-y-4">
            {[
              {
                q: "Will refinancing guarantee a lower payment?",
                a: "No. Refinancing may lower your payment depending on your current loan, credit profile, vehicle, loan term, and lender approval. Final terms are determined by OpenRoad Lending, not AutoLenis.",
              },
              {
                q: "Can refinancing increase my total cost?",
                a: "Yes. A lower monthly payment may come from extending the loan term, which can increase total interest paid over time. That is why it is important to compare the full loan structure, not just the monthly payment.",
              },
              {
                q: "Does checking eligibility hurt my credit?",
                a: "No credit pull occurs during the AutoLenis eligibility screening. Any hard credit inquiry would only happen during OpenRoad Lending's application process, with your explicit consent.",
              },
              {
                q: "What information do I need?",
                a: "You may need your current payoff amount, lender name, current APR, monthly payment, vehicle details, mileage, income, and basic personal information.",
              },
              {
                q: "Is AutoLenis the lender?",
                a: "No. AutoLenis is not the lender and does not make credit decisions. AutoLenis may help guide users toward OpenRoad Lending, which evaluates applications and determines final terms.",
              },
              {
                q: "Can I refinance without changing vehicles?",
                a: "Yes. Auto refinance is designed to help you review the loan on your current vehicle without buying a new one.",
              },
            ].map((faq) => (
              <div
                key={faq.q}
                className="bg-white border border-[#E5E7EB] rounded-2xl p-6 shadow-sm"
              >
                <h3 className="text-sm font-bold text-[#111827] mb-2">{faq.q}</h3>
                <p className="text-sm text-[#4B5563] leading-relaxed">{faq.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Section 12: Final CTA ── */}
      <section className="bg-[#0B5FD1] py-20" data-testid="refinance-final-cta">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <h2 className="text-3xl font-bold text-white mb-3 tracking-tight">
            Your Car Payment Deserves a Second Look.
          </h2>
          <p className="text-white/80 text-sm mb-8 leading-relaxed">
            Review your current loan and explore whether refinancing through OpenRoad Lending could create a smarter financial path.
          </p>
          <Link
            href="/refinance/eligibility"
            data-testid="refinance-final-cta-btn"
            className="inline-flex items-center gap-2 px-8 py-4 bg-white text-[#0B5FD1] font-semibold text-sm rounded-md hover:bg-[#EFF6FF] transition-colors shadow-md shadow-black/20"
          >
            Check My Eligibility <ArrowRight size={16} />
          </Link>
        </div>
      </section>

      {/* ── Section 13: Faith Module ── */}
      <section className="py-16 bg-[#0A0F1A] text-center">
        <div className="mx-auto max-w-2xl px-6">
          <FaithVerseModule pageKey="refinance" />
        </div>
      </section>

    </div>
  );
}
