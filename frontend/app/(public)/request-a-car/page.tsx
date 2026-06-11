import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CheckCircle2, XCircle } from "lucide-react";
import FaithVerseModule from "@/components/public/FaithVerseModule";
import ChatWidget from "@/components/public/ChatWidget";
import { buildPageMetadata, PAGE_METADATA } from "@/lib/seo/metadata";
import {
  DEPOSIT_AMOUNT_CENTS,
  MAX_DEALER_INVITATIONS,
  AUCTION_DURATION_HOURS,
} from "@/lib/constants";

export const metadata: Metadata = buildPageMetadata(PAGE_METADATA.requestACar);
export const dynamic = "force-dynamic";
export const revalidate = 86400;

const STEPS = [
  {
    n: "1",
    title: "Submit Your Request",
    body: "Provide your preferred make, model, year range, budget, and any specific requirements. Takes about 2 minutes.",
  },
  {
    n: "2",
    title: "AutoLenis Sources Dealers",
    body: "We route your request to vetted dealers who specialize in or have access to your requested vehicle type.",
  },
  {
    n: "3",
    title: "Dealers Compete With Offers",
    body: `Qualifying dealers submit competitive offers based on your specifications and budget — same ${AUCTION_DURATION_HOURS}-hour auction model.`,
  },
  {
    n: "4",
    title: "You Choose or Walk Away",
    body: "Review offers ranked by total value. Accept what works, decline what doesn't. No commitment required.",
  },
];

const USE_CASES = [
  {
    title: "Rare or Hard-to-Find Models",
    body: "If the specific vehicle you want isn't in the current inventory, submit a request so dealers can source it.",
  },
  {
    title: "Specific Trims or Features",
    body: "Looking for a specific color, package, or feature combination? Specify exactly what you need.",
  },
  {
    title: "New Vehicle Inquiries",
    body: "AutoLenis can route new vehicle requests to dealers with the right inventory access.",
  },
];

const SPECIFICATIONS = [
  "Preferred Make & Model",
  "Year Range",
  "Maximum Budget",
  "Condition (New / Used)",
  "Preferred Features",
  "Timeline",
];

const OLD_WAY = [
  "Call or visit multiple dealers",
  "Each dealer quotes independently",
  "No structure or comparison",
  "Pressure to decide on the spot",
];

const AUTOLENIS_WAY = [
  "One request reaches multiple dealers",
  "Dealers compete for your business",
  "Offers ranked by total value",
  "Review on your timeline",
];

const FAQS = [
  {
    q: "What if no dealer can fulfill my request?",
    a: `If no dealer submits a qualifying offer for your request, you'll be notified and can adjust your specifications or browse available inventory instead. The Auction Access Fee is only required when you're ready to activate a full auction.`,
  },
  {
    q: "Is this different from browsing inventory?",
    a: "Yes. The inventory page shows vehicles already listed by dealers or sourced from market data. The Request a Car system routes your specific requirements to dealers who may have — or can source — the exact vehicle you're looking for.",
  },
  {
    q: "Do I need to be prequalified first?",
    a: "Yes. Prequalification gives dealers your verified budget range, which makes your request more credible and improves the quality of offers you receive.",
  },
];

export default function RequestACarPage() {
  return (
    <div className="bg-[#F8F9FB]">
      {/* Hero */}
      <section className="pt-16 py-24 md:py-32 text-center bg-gradient-to-b from-[#F8F9FB] to-white">
        <div className="mx-auto max-w-7xl px-6 md:px-12">
          <span className="text-xs font-semibold uppercase tracking-[0.15em] text-[#0B5FD1]">
            REQUEST A VEHICLE
          </span>
          <h1 className="text-5xl sm:text-6xl font-bold tracking-tight text-[#111827] mt-4 mb-5">
            Can't Find Exactly What You Want?
          </h1>
          <p className="text-[#4B5563] text-lg max-w-2xl mx-auto leading-relaxed mb-8">
            Submit a vehicle request and AutoLenis will work to match you with dealers who can
            compete for your specific make, model, year, and budget — without you hunting across
            multiple lots.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="/auth/signup"
              className="inline-flex items-center gap-2 px-8 py-4 bg-[#0B5FD1] text-white font-semibold text-sm rounded-md hover:bg-[#0A4DB8] transition-colors shadow-md shadow-[#0B5FD1]/20"
            >
              Get Prequalified to Request <ArrowRight size={16} />
            </Link>
            <Link
              href="/inventory"
              className="inline-flex items-center gap-2 px-8 py-4 border border-[#DBEAFE] text-[#0B5FD1] font-semibold text-sm rounded-md hover:bg-[#EFF6FF] transition-colors"
            >
              Browse Available Inventory
            </Link>
          </div>
          <p className="text-xs text-[#94A3B8] mt-6">
            Specific make &amp; model &nbsp;·&nbsp; Budget-matched &nbsp;·&nbsp; Dealer competition
            &nbsp;·&nbsp; No pressure
          </p>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-20 bg-white">
        <div className="mx-auto max-w-7xl px-6 md:px-12">
          <h2 className="text-3xl font-bold tracking-tight text-[#111827] mb-12 text-center">
            How It Works
          </h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {STEPS.map((step) => (
              <div
                key={step.n}
                className="bg-white border border-[#E5E7EB] rounded-2xl shadow-sm p-8"
              >
                <span className="text-4xl font-bold font-[family-name:var(--font-mono)] text-[#0B5FD1] mb-4 block">
                  {step.n}
                </span>
                <h3 className="font-bold text-[#111827] mb-3">{step.title}</h3>
                <p className="text-sm text-[#4B5563] leading-relaxed">{step.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* When to Use */}
      <section className="py-20 bg-[#F8F9FB]">
        <div className="mx-auto max-w-7xl px-6 md:px-12">
          <h2 className="text-3xl font-bold tracking-tight text-[#111827] mb-12 text-center">
            When Request a Car Makes Sense
          </h2>
          <div className="grid sm:grid-cols-3 gap-6">
            {USE_CASES.map((item) => (
              <div
                key={item.title}
                className="bg-white border border-[#E5E7EB] rounded-2xl shadow-sm p-8"
              >
                <div className="w-10 h-10 rounded-full bg-[#EFF6FF] border border-[#DBEAFE] flex items-center justify-center mb-5">
                  <CheckCircle2 size={18} className="text-[#0B5FD1]" />
                </div>
                <h3 className="font-bold text-[#111827] mb-3">{item.title}</h3>
                <p className="text-sm text-[#4B5563] leading-relaxed">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* What You Specify */}
      <section className="py-20 bg-white">
        <div className="mx-auto max-w-7xl px-6 md:px-12">
          <h2 className="text-3xl font-bold tracking-tight text-[#111827] mb-12 text-center">
            Tell Us Exactly What You Want
          </h2>
          <div className="flex flex-wrap justify-center gap-3 max-w-3xl mx-auto">
            {SPECIFICATIONS.map((spec) => (
              <span
                key={spec}
                className="px-5 py-3 bg-[#F8F9FB] border border-[#E5E7EB] rounded-full text-sm font-medium text-[#111827]"
              >
                {spec}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Comparison */}
      <section className="py-20 bg-[#F8F9FB]">
        <div className="mx-auto max-w-7xl px-6 md:px-12">
          <div className="grid md:grid-cols-2 gap-6 max-w-4xl mx-auto">
            <div className="bg-white border border-[#E5E7EB] rounded-2xl shadow-sm p-8">
              <h3 className="font-bold text-[#4B5563] mb-6 text-sm uppercase tracking-wider">
                Hunting Yourself
              </h3>
              <ul className="space-y-4">
                {OLD_WAY.map((item) => (
                  <li key={item} className="flex items-start gap-3 text-sm text-[#4B5563]">
                    <XCircle size={15} className="mt-0.5 shrink-0 text-[#94A3B8]" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div className="bg-[#EFF6FF] border border-[#DBEAFE] rounded-2xl shadow-sm p-8">
              <h3 className="font-bold text-[#0B5FD1] mb-6 text-sm uppercase tracking-wider">
                AutoLenis Request
              </h3>
              <ul className="space-y-4">
                {AUTOLENIS_WAY.map((item) => (
                  <li key={item} className="flex items-start gap-3 text-sm text-[#111827]">
                    <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-[#0B5FD1]" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-20 bg-white">
        <div className="mx-auto max-w-3xl px-6">
          <h2 className="text-3xl font-bold tracking-tight text-[#111827] mb-12 text-center">
            Frequently Asked Questions
          </h2>
          <div className="space-y-6">
            {FAQS.map((item) => (
              <div
                key={item.q}
                className="bg-white border border-[#E5E7EB] rounded-2xl shadow-sm p-8"
              >
                <h3 className="font-bold text-[#111827] mb-3">{item.q}</h3>
                <p className="text-sm text-[#4B5563] leading-relaxed">{item.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-24 bg-[#0B5FD1] text-center">
        <div className="mx-auto max-w-3xl px-6">
          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4 tracking-tight">
            Ready to Find Your Specific Vehicle?
          </h2>
          <p className="text-white/80 text-lg mb-8 leading-relaxed">
            Get prequalified and submit your vehicle request. Let dealers compete to find exactly
            what you want.
          </p>
          <Link
            href="/auth/signup"
            className="inline-flex items-center gap-2 px-8 py-4 bg-white text-[#0B5FD1] font-semibold text-sm rounded-md hover:bg-[#EFF6FF] transition-colors shadow-md"
          >
            Get Started <ArrowRight size={16} />
          </Link>
          <p className="text-white/50 text-xs mt-4">
            Deposit: ${(DEPOSIT_AMOUNT_CENTS / 100).toFixed(0)} · Up to {MAX_DEALER_INVITATIONS}{" "}
            dealers compete · {AUCTION_DURATION_HOURS}-hour auction window
          </p>
        </div>
      </section>

      {/* Faith Module */}
      <section className="py-16 bg-[#0B5FD1] border-t border-white/10 text-center">
        <div className="mx-auto max-w-3xl px-6">
          <FaithVerseModule pageKey="request-a-car" />
        </div>
      </section>

      <ChatWidget />
    </div>
  );
}
