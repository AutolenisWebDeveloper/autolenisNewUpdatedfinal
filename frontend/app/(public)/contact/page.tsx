import type { Metadata } from "next";
import Link from "next/link";
import { buildPageMetadata, PAGE_METADATA } from "@/lib/seo/metadata";
import FaithVerseModule from "@/components/public/FaithVerseModule";
import ContactFormClient from "@/components/public/ContactFormClient";

export const metadata: Metadata = buildPageMetadata(PAGE_METADATA.contact);
export const revalidate = 86400;

const ROUTING_CARDS = [
  {
    title: "Buyer Support",
    desc: "For help with prequalification, auctions, vehicle requests, deposits, or account questions.",
    cta: "Contact Buyer Support",
  },
  {
    title: "Dealer Partnerships",
    desc: "For dealer applications, buyer requests, offer participation, or partnership questions.",
    cta: "Contact Dealer Team",
  },
  {
    title: "Affiliate Partnerships",
    desc: "For creators, professionals, and organizations interested in referral partnerships.",
    cta: "Contact Affiliate Team",
  },
  {
    title: "General Business",
    desc: "For media, business, compliance, or general inquiries.",
    cta: "Contact AutoLenis",
  },
];

const NEXT_STEPS = [
  {
    step: "01",
    title: "We Review Your Request",
    body: "Your message is routed to the appropriate AutoLenis team.",
  },
  {
    step: "02",
    title: "We Follow Up",
    body: "A team member responds based on inquiry type and urgency.",
  },
  {
    step: "03",
    title: "We Help You Move Forward",
    body: "We provide next steps, clarification, or support for your experience.",
  },
];

const QUICK_HELP = [
  { label: "How It Works", href: "/how-it-works" },
  { label: "Pricing", href: "/pricing" },
  { label: "For Buyers", href: "/for-buyers" },
  { label: "For Dealers", href: "/for-dealers" },
];

const TRUST_LABELS = [
  "Secure Inquiry Handling",
  "Buyer-First Support",
  "Professional Partner Routing",
  "Values-Driven Service",
];

export default function ContactPage() {
  return (
    <div className="bg-[#F8F9FB]">
      {/* SECTION 1 — HERO */}
      <section className="pt-16 py-20 md:py-28 bg-gradient-to-b from-[#F8F9FB] to-white">
        <div className="mx-auto max-w-5xl px-6 text-center">
          <span className="text-xs font-semibold uppercase tracking-[0.15em] text-[#0B5FD1]">
            Contact AutoLenis
          </span>
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-[#111827] mt-4 mb-5">
            We&apos;re Here to Help You Move Smarter.
          </h1>
          <p className="text-[#4B5563] text-lg max-w-2xl mx-auto leading-relaxed mb-8">
            Whether you&apos;re buying a vehicle, partnering as a dealer, joining as an
            affiliate, or need support with your account, AutoLenis is built to give
            you a clear path forward.
          </p>
          <p className="text-xs text-[#94A3B8] font-medium">
            Buyer support · Dealer partnerships · Affiliate inquiries · Secure communication
          </p>
        </div>
      </section>

      {/* SECTION 2 — CONTACT ROUTING CARDS */}
      <section className="pb-12">
        <div className="mx-auto max-w-5xl px-6">
          <h2 className="text-2xl font-bold text-[#111827] tracking-tight text-center mb-8">
            Choose the Right Path
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {ROUTING_CARDS.map((card) => (
              <a
                key={card.title}
                href="#contact-form"
                className="bg-white border border-[#E5E7EB] rounded-2xl p-6 hover:border-[#BFDBFE] hover:shadow-md transition-all group cursor-pointer"
              >
                <h3 className="font-bold text-[#111827] text-sm mb-2">{card.title}</h3>
                <p className="text-[#4B5563] text-xs leading-relaxed mb-4">{card.desc}</p>
                <span className="text-xs text-[#0B5FD1] font-semibold group-hover:underline">
                  {card.cta} →
                </span>
              </a>
            ))}
          </div>
        </div>
      </section>

      {/* SECTION 3 — CONTACT FORM */}
      <section id="contact-form" className="pb-16">
        <div className="mx-auto max-w-3xl px-6">
          <div
            className="bg-white border border-[#E5E7EB] rounded-2xl p-8 md:p-10 shadow-sm"
            data-testid="contact-page"
          >
            <h2 className="text-2xl font-bold text-[#111827] tracking-tight mb-6">
              Send Us a Message
            </h2>
            <ContactFormClient />
          </div>
        </div>
      </section>

      {/* SECTION 4 — WHAT HAPPENS NEXT */}
      <section className="py-12 bg-[#F8F9FB] border-t border-[#E5E7EB]">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <h2 className="text-xl font-bold text-[#111827] mb-8">What Happens Next</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {NEXT_STEPS.map((item) => (
              <div
                key={item.step}
                className="bg-white border border-[#E5E7EB] rounded-2xl p-6 shadow-sm text-left"
              >
                <p className="text-3xl font-bold text-[#0B5FD1]/15 font-mono mb-3">{item.step}</p>
                <p className="font-bold text-[#111827] text-sm mb-2">{item.title}</p>
                <p className="text-xs text-[#4B5563] leading-relaxed">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* SECTION 5 — QUICK HELP */}
      <section className="py-12">
        <div className="mx-auto max-w-3xl px-6">
          <h2 className="text-xl font-bold text-[#111827] text-center mb-6">
            Need a Faster Answer?
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {QUICK_HELP.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="bg-white border border-[#E5E7EB] rounded-xl px-4 py-3 text-center text-sm font-semibold text-[#374151] hover:border-[#BFDBFE] hover:text-[#0B5FD1] transition-all"
              >
                {item.label} →
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* SECTION 6 — TRUST STRIP */}
      <section className="py-10 bg-[#F8F9FB] border-t border-[#E5E7EB]">
        <div className="mx-auto max-w-3xl px-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {TRUST_LABELS.map((label) => (
              <div
                key={label}
                className="bg-white border border-[#E5E7EB] rounded-xl px-4 py-3 text-center text-xs font-semibold text-[#374151]"
              >
                {label}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* SECTION 7 — FINAL CTA */}
      <section className="bg-[#0B5FD1] py-20">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <h2 className="text-3xl font-bold text-white tracking-tight mb-3">
            Ready to Start With Leverage?
          </h2>
          <p className="text-white/80 text-sm mb-8 leading-relaxed">
            If you&apos;re ready to buy smarter, start with prequalification and let
            AutoLenis guide the process.
          </p>
          <div className="flex flex-wrap gap-3 justify-center">
            <Link
              href="/auth/signup"
              className="inline-flex items-center gap-2 px-7 py-3.5 bg-white text-[#0B5FD1] font-semibold text-sm rounded-md hover:bg-[#EFF6FF] transition-colors"
            >
              Get Prequalified →
            </Link>
            <Link
              href="/how-it-works"
              className="inline-flex items-center gap-2 px-7 py-3.5 border border-white/30 text-white font-semibold text-sm rounded-md hover:bg-white/10 transition-colors"
            >
              See How It Works
            </Link>
          </div>
        </div>
      </section>

      {/* SECTION 8 — FAITH MODULE */}
      <div className="mx-auto max-w-2xl px-6 py-8">
        <FaithVerseModule pageKey="contact" />
      </div>
    </div>
  );
}
