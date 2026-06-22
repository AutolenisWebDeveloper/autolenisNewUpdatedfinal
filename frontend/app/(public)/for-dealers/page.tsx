import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import {
  ArrowRight,
  Check,
  X,
  Users,
  TrendingUp,
  BarChart3,
  MapPin,
  DollarSign,
  RefreshCw,
  Workflow,
  UserPlus,
  Bell,
  Send,
  CheckCircle2,
  ShieldCheck,
  Tag,
  BadgeDollarSign,
  LayoutGrid,
  Boxes,
  FileText,
  Truck,
  Settings,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import FaithVerseModule from "@/components/public/FaithVerseModule";
import BuyerOpportunityCard from "@/components/dealer/BuyerOpportunityCard";
import HeroBuyerCard from "@/components/dealer/HeroBuyerCard";
import DealerFAQ, { type DealerFaqItem } from "@/components/dealer/DealerFAQ";
import { buildPageMetadata, PAGE_METADATA } from "@/lib/seo/metadata";

export const metadata: Metadata = buildPageMetadata(PAGE_METADATA.forDealers);
export const revalidate = 86400;

const APPLY_HREF = "/dealer-application";

// Shared site container + section rhythm (matches how-it-works / pricing).
const CONTAINER = "mx-auto max-w-7xl px-6 md:px-12";

// Brand-blue surfaces. NAVY = canonical dark surface for bands/panels.
const NAVY = "#0A0F1A";

// className overrides on the shared <Button> to match the homepage CTAs
// (rounded-md, brand-blue with #1A6FE0 hover, soft shadow).
const CTA_PRIMARY = "rounded-md shadow-md shadow-[#0B5FD1]/25 hover:bg-[#1A6FE0]";
const CTA_OUTLINE = "rounded-md";
const CTA_ON_BLUE =
  "rounded-md bg-white text-[#0B5FD1] shadow-md hover:bg-[#EEF4FF] focus-visible:ring-white focus-visible:ring-offset-[#0B5FD1]";

const TRUST_CHECKS = [
  "No Dealer Fees",
  "No Monthly Subscription",
  "No Setup Costs",
  "Qualified Buyers",
  "Nationwide Growth Opportunity",
];

const BENEFITS = [
  { icon: Users, title: "Purchase-Ready Buyers", body: "Connect with verified buyers ready to make a purchase." },
  { icon: DollarSign, title: "Increase Sales", body: "Win more deals and close more business." },
  { icon: BarChart3, title: "Lower Costs", body: "Reduce your customer acquisition expenses." },
  { icon: MapPin, title: "Nationwide Opportunities", body: "Reach buyers in more markets across the U.S." },
];

const LEAD_SOURCES = ["AutoTrader", "Cars.com", "Google Ads", "Facebook Ads", "Third-Party Lead Providers"];

const WHY_CARDS = [
  { icon: Users, title: "More Qualified Buyers", body: "Connect with customers actively looking to purchase a vehicle." },
  { icon: DollarSign, title: "No Dealer Fees", body: "Join and participate at no cost. Ever.", highlight: true },
  { icon: TrendingUp, title: "Higher Closing Potential", body: "Engage buyers already comparing real offers, not browsing." },
  { icon: MapPin, title: "Expand Market Reach", body: "Access ready buyers beyond your local market." },
  { icon: RefreshCw, title: "Faster Inventory Turnover", body: "Move vehicles more efficiently with high-intent demand." },
  { icon: Workflow, title: "Simple Digital Workflow", body: "Submit structured offers directly through AutoLenis." },
];

const STEPS = [
  { num: "01", icon: UserPlus, title: "Join the Dealer Network", body: "Apply in minutes. No setup fee, no contract, no subscription." },
  { num: "02", icon: Bell, title: "Receive Buyer Opportunities", body: "Get matched to verified, purchase-ready buyers in your market." },
  { num: "03", icon: Send, title: "Submit Your Best Offer", body: "Send a clean, structured out-the-door offer in the portal." },
  { num: "04", icon: CheckCircle2, title: "Win More Business", body: "Close the buyer, prep the vehicle, complete a fast digital handoff.", highlight: true },
];

const PORTAL_NAV = [
  { icon: LayoutGrid, label: "Opportunities", active: true },
  { icon: Boxes, label: "Inventory" },
  { icon: FileText, label: "Offers" },
  { icon: Truck, label: "Pickups" },
  { icon: Settings, label: "Settings" },
];

const PORTAL_LIST = [
  { vehicle: "2024 BMW X5", location: "Houston, TX", budget: "$55,000 – $65,000", active: true },
  { vehicle: "2025 Toyota RAV4", location: "Dallas, TX", budget: "$32,000 – $38,000" },
  { vehicle: "2024 Ford F-150", location: "Phoenix, AZ", budget: "$48,000 – $56,000" },
  { vehicle: "2025 Honda CR-V", location: "Atlanta, GA", budget: "$34,000 – $39,000" },
];

const ECON_TRADITIONAL = [
  "Monthly platform fees",
  "Cost per lead",
  "Shared leads sold to many dealers",
  "Low-intent, unverified buyers",
];

const ECON_AUTOLENIS = [
  "No dealer fees — ever",
  "Direct buyer opportunities",
  "High-intent, verified shoppers",
  "Transparent, structured process",
];

const FINAL_CHIPS = ["Independent dealers welcome", "Franchise dealers eligible", "Nationwide", "Free to join"];

const CREDIBILITY = [
  {
    icon: ShieldCheck,
    title: "Verified Buyers, Not Cold Leads",
    body: "Every opportunity comes from a buyer who's completed soft-pull prequalification and signaled real intent. No tire-kickers, no leads resold to ten dealers.",
  },
  {
    icon: Tag,
    title: "You Control Your Pricing",
    body: "Submit one clean, structured out-the-door offer. No haggling, no pressure, no platform dictating your margin.",
  },
  {
    icon: BadgeDollarSign,
    title: "Zero Fees, Ever",
    body: "No lead fees, no subscription, no setup, no success fees. Your only investment is time — and only when a real buyer is on the table.",
  },
];

const FAQS: DealerFaqItem[] = [
  {
    q: "What does AutoLenis cost dealers?",
    a: "Nothing. There are no lead fees, no monthly subscription, no setup costs, and no success fees. Participation is completely free for dealers.",
  },
  {
    q: "How are buyers qualified?",
    a: "Every buyer completes a soft prequalification (no impact to their credit), confirms an affordability band and budget, verifies their identity, and is actively shopping. You only see purchase-ready demand.",
  },
  {
    q: "How do dealers submit offers?",
    a: "Inside the dealer portal, you submit a structured out-the-door offer — vehicle price, taxes and fees itemized, and financing options — during the buyer's auction window. No back-and-forth negotiation required to get started.",
  },
  {
    q: "How quickly do opportunities arrive?",
    a: "Opportunities arrive in real time as verified buyers in your market submit requests for vehicles you can supply. You're invited to relevant auctions as they open.",
  },
  {
    q: "Can independent dealers participate?",
    a: "Yes. Independent dealerships are welcome and compete on equal footing.",
  },
  {
    q: "Are franchise dealers eligible?",
    a: "Yes. Franchise dealerships are eligible to join the network and receive buyer opportunities.",
  },
  {
    q: "How does AutoLenis make money?",
    a: "AutoLenis is free for dealers. We earn a concierge fee from the buyer side of the transaction — so dealers compete for ready-to-purchase buyers without paying lead fees, subscriptions, or commissions.",
  },
];

const H2 = "text-3xl font-bold tracking-tight sm:text-4xl";
const EYEBROW = "text-xs font-bold uppercase tracking-[0.15em] text-[#0B5FD1]";

export default function ForDealersPage() {
  return (
    <div className="bg-white text-[#111827]">
      {/* ── COST RIBBON ─────────────────────────────────────────────── */}
      <div className="bg-[#0A0F1A] text-white">
        <div className={`${CONTAINER} flex items-center justify-center gap-x-2 py-2.5 text-center text-[13px] font-semibold sm:text-sm`}>
          <span className="font-bold text-[#4DA3FF]">No Dealer Fees.</span>
          <span className="text-white/90">
            No Monthly Costs. No Subscription. Just Qualified Buyers Ready to Purchase.
          </span>
        </div>
      </div>

      {/* ── HERO (full-bleed photo + wide buyer card) ───────────────── */}
      <section
        id="top"
        data-testid="for-dealers-hero"
        className="relative z-10 overflow-x-clip bg-white"
      >
        {/* Desktop full-bleed photo bleeding off the right, melting into white */}
        <div className="absolute inset-y-0 right-0 hidden w-[58vw] lg:block">
          <Image
            src="/images/dealers/dealer-hero.webp"
            alt="Smiling dealership manager standing with arms crossed in front of their dealership, with a blue SUV and a YOUR DEALERSHIP sign behind them"
            fill
            priority
            sizes="58vw"
            className="object-cover"
            style={{ objectPosition: "62% center" }}
          />
          {/* White fade so the photo's left edge melts into the copy column */}
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(to right,#ffffff 0%, rgba(255,255,255,0.85) 7%, rgba(255,255,255,0) 26%)",
            }}
            aria-hidden="true"
          />
        </div>

        <div className={`${CONTAINER} relative`}>
          {/* COPY */}
          <div className="relative z-[2] py-14 md:py-20 lg:flex lg:min-h-[680px] lg:max-w-[54%] lg:flex-col lg:justify-center lg:py-28">
            <div>
              <p className={`mb-5 inline-flex items-center gap-2 ${EYEBROW}`}>
                <span className="inline-block h-0.5 w-6 bg-[#0B5FD1]" aria-hidden="true" />
                For Dealers
              </p>
              <h1 className="text-[32px] font-bold leading-[1.08] tracking-tight text-[#111827] sm:text-5xl lg:text-[60px] lg:leading-[1.04]">
                Get Qualified Car Buyers{" "}
                <span className="text-[#0B5FD1]">Delivered Directly To Your Dealership</span>
              </h1>
              <p className="mt-6 max-w-xl text-base leading-relaxed text-[#4B5563] sm:text-lg">
                AutoLenis connects verified, purchase-ready buyers with participating dealers
                through a private marketplace designed to increase sales and reduce customer
                acquisition costs.
              </p>

              <ul className="mt-8 grid max-w-xl grid-cols-1 gap-x-7 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
                {TRUST_CHECKS.map((label) => (
                  <li key={label} className="flex items-center gap-2.5 text-[15px] font-semibold">
                    <CheckCircle2 className="h-5 w-5 shrink-0 text-[#0B5FD1]" aria-hidden="true" />
                    {label}
                  </li>
                ))}
              </ul>

              <div className="mt-9 flex flex-col gap-3.5 sm:flex-row sm:flex-wrap sm:items-center">
                <Button asChild size="lg" className={`${CTA_PRIMARY} w-full sm:w-auto`}>
                  <Link href={APPLY_HREF} data-testid="for-dealers-apply-cta">
                    Become a Dealer Partner
                    <ArrowRight className="h-[18px] w-[18px]" aria-hidden="true" />
                  </Link>
                </Button>
                <Button asChild variant="secondary" size="lg" className={`${CTA_OUTLINE} w-full sm:w-auto`}>
                  <Link href="#how">
                    Learn More
                    <ArrowRight className="h-[18px] w-[18px]" aria-hidden="true" />
                  </Link>
                </Button>
              </div>
            </div>
          </div>

          {/* Mobile / tablet: banner photo + card in normal flow (no desktop bleed) */}
          <div className="pb-6 lg:hidden">
            <div className="overflow-hidden rounded-2xl shadow-[0_24px_50px_rgba(10,35,80,0.18)]">
              <Image
                src="/images/dealers/dealer-hero.webp"
                alt="Smiling dealership manager standing with arms crossed in front of their dealership, with a blue SUV and a YOUR DEALERSHIP sign behind them"
                width={1200}
                height={1059}
                sizes="100vw"
                className="h-[300px] w-full object-cover sm:h-[420px]"
                style={{ objectPosition: "62% center" }}
              />
            </div>
            <div className="relative z-[2] mx-auto -mt-8 w-[min(420px,92%)] sm:w-[min(580px,92%)]">
              <HeroBuyerCard />
            </div>
          </div>

          {/* Desktop: wide card overlay, bottom-right, overlapping the navy band */}
          <div className="absolute bottom-[-24px] right-0 z-[3] hidden w-[440px] lg:block xl:w-[560px]">
            <HeroBuyerCard className="motion-safe:animate-dealer-float" />
          </div>
        </div>
      </section>

      {/* ── NAVY VALUE BAND ─────────────────────────────────────────── */}
      <section className="relative z-0 text-white" style={{ backgroundColor: NAVY }}>
        <div className={`${CONTAINER} grid grid-cols-1 gap-8 py-12 sm:grid-cols-2 lg:grid-cols-4 lg:gap-0 lg:pt-12`}>
          {BENEFITS.map((b, i) => (
            <div
              key={b.title}
              className={`flex items-start gap-3.5 lg:px-7 ${i === 0 ? "lg:pl-0" : ""} ${
                i !== BENEFITS.length - 1 ? "lg:border-r lg:border-white/15" : "lg:pr-0"
              }`}
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#0B5FD1]">
                <b.icon className="h-[22px] w-[22px] text-white" aria-hidden="true" />
              </span>
              <div>
                <h2 className="text-base font-bold">{b.title}</h2>
                <p className="mt-1 text-sm leading-snug text-white/70">{b.body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── SECTION 2: STOP PAYING FOR LEADS ────────────────────────── */}
      <section className="bg-white">
        <div className={`${CONTAINER} grid grid-cols-1 items-center gap-10 py-20 md:py-28 lg:grid-cols-2 lg:gap-16`}>
          <div>
            <p className={`mb-4 ${EYEBROW}`}>The Lead-Gen Problem</p>
            <h2 className={H2}>Stop Paying For Leads That Never Buy</h2>
            <p className="mt-5 max-w-md text-base leading-relaxed text-[#4B5563] sm:text-lg">
              Most dealerships spend thousands every month on platforms that sell the same
              leads to everyone — and many of those leads never purchase.
            </p>
          </div>

          <div className="rounded-2xl border border-[#E5E7EB] bg-[#F8F9FB] p-5 sm:p-8">
            <p className="mb-4 text-xs font-bold uppercase tracking-[0.1em] text-[#8693A8]">
              Where the budget goes today
            </p>
            <div className="flex flex-col gap-2.5">
              {LEAD_SOURCES.map((src) => (
                <div
                  key={src}
                  className="flex items-center justify-between gap-3 rounded-xl border border-[#ECEFF5] bg-white px-4 py-3.5"
                >
                  <span className="text-sm font-bold text-[#3C485C] sm:text-[15px]">{src}</span>
                  <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[#FBEDED] px-3 py-1 text-xs font-bold text-[#B23B3B]">
                    <X className="h-3 w-3" strokeWidth={3} aria-hidden="true" />
                    Often never buy
                  </span>
                </div>
              ))}
            </div>

            <div className="mt-5 rounded-2xl bg-[#0A0F1A] p-6 text-white">
              <p className="text-[15px] font-semibold leading-relaxed">
                AutoLenis delivers buyers actively shopping for a vehicle —{" "}
                <span className="text-[#4DA3FF]">not cold lists, not shared leads.</span>
              </p>
              <div className="mt-5 grid grid-cols-3 gap-3 border-t border-white/15 pt-5">
                {[
                  { stat: "0", label: "Lead fees" },
                  { stat: "1:1", label: "Direct opportunities" },
                  { stat: "High", label: "Buyer intent" },
                ].map((s) => (
                  <div key={s.label}>
                    <p className="text-2xl font-bold text-[#4DA3FF]">{s.stat}</p>
                    <p className="mt-1 text-xs font-medium text-white/70">{s.label}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── SECTION 3: WHY DEALERS JOIN ─────────────────────────────── */}
      <section id="why" className="scroll-mt-24 bg-[#F8F9FB]">
        <div className={`${CONTAINER} py-20 md:py-28`}>
          <div className="mx-auto mb-14 max-w-2xl text-center">
            <p className={`mb-4 ${EYEBROW}`}>Why Dealers Join</p>
            <h2 className={H2}>Built To Help You Sell More Cars</h2>
          </div>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {WHY_CARDS.map((card) => (
              <div
                key={card.title}
                className={
                  card.highlight
                    ? "relative rounded-2xl bg-[#0A0F1A] p-8 shadow-[0_14px_34px_rgba(10,35,80,0.22)]"
                    : "rounded-2xl border border-[#E5E7EB] bg-white p-8 shadow-[0_2px_10px_rgba(10,35,80,0.04)]"
                }
              >
                {card.highlight && (
                  <span className="absolute right-5 top-5 rounded-full bg-[#0B5FD1] px-2.5 py-1 text-[11px] font-bold tracking-wide text-white">
                    $0
                  </span>
                )}
                <span
                  className={`mb-5 flex h-[52px] w-[52px] items-center justify-center rounded-[13px] ${
                    card.highlight ? "bg-white/10" : "bg-[#EEF4FF]"
                  }`}
                >
                  <card.icon className={`h-6 w-6 ${card.highlight ? "text-[#4DA3FF]" : "text-[#0B5FD1]"}`} aria-hidden="true" />
                </span>
                <h3 className={`text-xl font-bold ${card.highlight ? "text-white" : "text-[#111827]"}`}>{card.title}</h3>
                <p className={`mt-2.5 text-[15px] leading-relaxed ${card.highlight ? "text-white/70" : "text-[#4B5563]"}`}>
                  {card.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── SECTION 4: HOW IT WORKS ─────────────────────────────────── */}
      <section id="how" className="scroll-mt-24 bg-white">
        <div className={`${CONTAINER} py-20 md:py-28`}>
          <div className="mx-auto mb-14 max-w-2xl text-center">
            <p className={`mb-4 ${EYEBROW}`}>How Dealer Participation Works</p>
            <h2 className={H2}>Four Steps To More Sales</h2>
          </div>
          <ol className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((step) => (
              <li
                key={step.num}
                className={
                  step.highlight
                    ? "rounded-2xl bg-[#0A0F1A] p-7 shadow-[0_14px_34px_rgba(10,35,80,0.22)]"
                    : "rounded-2xl border border-[#E5E7EB] bg-[#F8F9FB] p-7"
                }
              >
                <div className="mb-5 flex items-center justify-between">
                  <span className={`text-[54px] font-bold leading-none tracking-tight ${step.highlight ? "text-[#4DA3FF]/30" : "text-[#D7E2F6]"}`}>
                    {step.num}
                  </span>
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#0B5FD1]">
                    <step.icon className="h-[22px] w-[22px] text-white" aria-hidden="true" />
                  </span>
                </div>
                <h3 className={`text-lg font-bold ${step.highlight ? "text-white" : "text-[#111827]"}`}>{step.title}</h3>
                <p className={`mt-2 text-sm leading-relaxed ${step.highlight ? "text-white/70" : "text-[#4B5563]"}`}>{step.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── SECTION 5: MARKETPLACE DASHBOARD ────────────────────────── */}
      <section className="bg-[#0A0F1A] text-white">
        <div className={`${CONTAINER} py-20 md:py-28`}>
          <div className="mx-auto mb-12 max-w-3xl text-center">
            <p className="mb-4 text-xs font-bold uppercase tracking-[0.15em] text-[#4DA3FF]">The AutoLenis Dealer Marketplace</p>
            <h2 className={H2}>Exclusive Buyer Opportunities, In One Place</h2>
            <p className="mt-4 text-base leading-relaxed text-white/70 sm:text-lg">
              Every opportunity comes pre-loaded with the details you need to make your best offer — fast.
            </p>
          </div>

          <div className="mx-auto max-w-5xl overflow-hidden rounded-2xl bg-white text-[#111827] shadow-[0_40px_90px_rgba(0,0,0,0.4)]">
            <div className="flex items-center gap-2 border-b border-[#E5E7EB] bg-[#F3F5F9] px-4 py-3.5">
              <span className="h-3 w-3 rounded-full bg-[#FF5F57]" aria-hidden="true" />
              <span className="h-3 w-3 rounded-full bg-[#FEBC2E]" aria-hidden="true" />
              <span className="h-3 w-3 rounded-full bg-[#28C840]" aria-hidden="true" />
              <span className="ml-3 truncate text-xs font-bold text-[#8693A8] sm:text-[13px]">
                app.autolenis.com / dealer / opportunities
              </span>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-[200px_1fr_360px]">
              <nav aria-label="Dealer portal" className="hidden flex-col gap-1 border-r border-[#ECEFF5] bg-[#FAFBFD] p-4 lg:flex">
                {PORTAL_NAV.map((item) => (
                  <span
                    key={item.label}
                    className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold ${
                      item.active ? "bg-[#EEF4FF] text-[#0B5FD1]" : "text-[#4B5563]"
                    }`}
                  >
                    <item.icon className="h-[18px] w-[18px]" aria-hidden="true" />
                    {item.label}
                  </span>
                ))}
              </nav>

              <div className="border-b border-[#ECEFF5] p-5 lg:border-b-0 lg:border-r">
                <div className="mb-4 flex items-center justify-between">
                  <span className="text-[15px] font-bold">Incoming Opportunities</span>
                  <span className="rounded-full bg-[#0B5FD1] px-2.5 py-0.5 text-[11px] font-bold text-white">4 new</span>
                </div>
                <div className="flex flex-col gap-2.5">
                  {PORTAL_LIST.map((row) => (
                    <div
                      key={row.vehicle}
                      className={`rounded-xl p-3.5 ${
                        row.active ? "border-2 border-[#0B5FD1] bg-white shadow-[0_6px_16px_rgba(11,95,209,0.16)]" : "border border-[#ECEFF5] bg-white"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className={`text-[15px] font-bold ${row.active ? "text-[#111827]" : "text-[#3C485C]"}`}>{row.vehicle}</span>
                        {row.active && <span className="h-2 w-2 rounded-full bg-[#0B5FD1]" aria-hidden="true" />}
                      </div>
                      <p className="mt-1 text-[12.5px] font-semibold text-[#7A879B]">
                        {row.location} · {row.budget}
                      </p>
                      {row.active && (
                        <span className="mt-2 inline-block rounded-full bg-[#EEF4FF] px-2.5 py-1 text-[11px] font-bold text-[#0B5FD1]">High Intent</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-[#F8F9FB] p-5">
                <BuyerOpportunityCard
                  opportunity={{
                    year: "2024",
                    makeModel: "BMW X5",
                    trim: "xDrive40i • SUV",
                    budgetRange: "$55,000 – $65,000",
                    location: "Houston, TX",
                    tradeIn: "Yes — 2019 Audi Q5",
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── SECTION 6: THE ECONOMICS ────────────────────────────────── */}
      <section id="economics" className="scroll-mt-24 bg-white">
        <div className={`${CONTAINER} py-20 md:py-28`}>
          <div className="mx-auto mb-14 max-w-2xl text-center">
            <p className={`mb-4 ${EYEBROW}`}>The Economics</p>
            <h2 className={H2}>A Smarter Way To Spend Your Acquisition Budget</h2>
            <p className="mt-4 text-base leading-relaxed text-[#4B5563] sm:text-lg">
              See how AutoLenis compares to the traditional lead model dealers pay for every month.
            </p>
          </div>

          <div className="mx-auto grid max-w-4xl grid-cols-1 items-stretch gap-6 lg:grid-cols-2">
            <div className="rounded-2xl border border-[#E5E7EB] bg-[#F7F8FA] p-7 sm:p-8">
              <h3 className="mb-6 text-xl font-bold text-[#3C485C]">Traditional Lead Sources</h3>
              <ul className="flex flex-col gap-4">
                {ECON_TRADITIONAL.map((item) => (
                  <li key={item} className="flex items-center gap-3">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#FBEDED]">
                      <X className="h-3.5 w-3.5 text-[#B23B3B]" strokeWidth={3} aria-hidden="true" />
                    </span>
                    <span className="text-[15px] font-semibold text-[#3C485C]">{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="relative overflow-hidden rounded-2xl bg-[#0B5FD1] p-7 shadow-[0_24px_54px_rgba(10,35,80,0.32)] sm:p-8">
              <span className="absolute right-6 top-6 rounded-full bg-[#7FE3A8] px-3 py-1 text-xs font-bold text-[#0A0F1A]">RECOMMENDED</span>
              <h3 className="mb-6 text-xl font-bold text-white">AutoLenis</h3>
              <ul className="flex flex-col gap-4">
                {ECON_AUTOLENIS.map((item) => (
                  <li key={item} className="flex items-center gap-3">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#7FE3A8]/25">
                      <Check className="h-3.5 w-3.5 text-[#7FE3A8]" strokeWidth={3} aria-hidden="true" />
                    </span>
                    <span className="text-[15px] font-semibold text-white">{item}</span>
                  </li>
                ))}
              </ul>
              <Button asChild size="lg" className={`mt-8 ${CTA_ON_BLUE} w-full sm:w-auto`}>
                <Link href={APPLY_HREF}>
                  Become a Dealer Partner
                  <ArrowRight className="h-[18px] w-[18px]" aria-hidden="true" />
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* ── SECTION 7: WHY DEALERS PARTNER (CREDIBILITY BAND) ────────── */}
      <section className="bg-[#F8F9FB]">
        <div className={`${CONTAINER} py-20 md:py-28`}>
          <div className="mx-auto mb-14 max-w-2xl text-center">
            <p className={`mb-4 ${EYEBROW}`}>Why Dealers Partner With AutoLenis</p>
            <h2 className={H2}>Built Around Serious Buyers — And Dealers Who Want Them</h2>
            <p className="mt-4 text-base leading-relaxed text-[#4B5563] sm:text-lg">
              AutoLenis is actively onboarding dealer partners and matching them to verified,
              pre-qualified buyers in their markets. Every opportunity is structured, transparent,
              and fee-free — so you compete on your terms, never in a race to the bottom.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {CREDIBILITY.map((card) => (
              <div
                key={card.title}
                className="rounded-2xl border border-[#E5E7EB] bg-white p-8 transition-all hover:border-[#0B5FD1]/40 hover:shadow-md"
              >
                <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-[#EEF4FF]">
                  <card.icon className="h-6 w-6 text-[#0B5FD1]" aria-hidden="true" />
                </div>
                <h3 className="text-lg font-bold text-[#111827]">{card.title}</h3>
                <p className="mt-2.5 text-[15px] leading-relaxed text-[#4B5563]">{card.body}</p>
              </div>
            ))}
          </div>

          <div className="mx-auto mt-12 max-w-2xl text-center">
            <p className="text-[15px] font-medium leading-relaxed text-[#4B5563]">
              Founding dealer partners get priority access to buyer opportunities in their market
              as the network expands.
            </p>
            <Button asChild size="lg" className={`mt-6 ${CTA_PRIMARY} w-full sm:w-auto`}>
              <Link href={APPLY_HREF}>
                Become a Dealer Partner
                <ArrowRight className="h-[18px] w-[18px]" aria-hidden="true" />
              </Link>
            </Button>
          </div>
        </div>
      </section>

      {/* ── SECTION 8: FAQ ──────────────────────────────────────────── */}
      <section id="faq" className="scroll-mt-24 bg-white">
        <div className="mx-auto max-w-3xl px-6 py-20 md:px-12 md:py-28">
          <div className="mx-auto mb-12 text-center">
            <p className={`mb-4 ${EYEBROW}`}>Frequently Asked Questions</p>
            <h2 className={H2}>Everything Dealers Ask</h2>
          </div>
          <DealerFAQ items={FAQS} />
        </div>
      </section>

      {/* ── FINAL CTA BAND ──────────────────────────────────────────── */}
      <section id="apply" className="scroll-mt-24 bg-[#111111] text-white">
        <div className="mx-auto max-w-4xl px-6 py-20 text-center md:px-12 md:py-28">
          <h2 className="text-[28px] font-bold leading-[1.12] tracking-tight sm:text-4xl lg:text-[44px]">
            No Dealer Fees. No Monthly Costs. No Subscription.
            <br className="hidden sm:block" /> Just Qualified Buyers Ready To Purchase.
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-base font-medium text-white/70 sm:text-lg">
            Join the AutoLenis dealer network and start receiving verified, purchase-ready buyers in your market.
          </p>
          <div className="mt-9 flex justify-center">
            <Button asChild size="lg" className={`${CTA_PRIMARY} w-full sm:w-auto`}>
              <Link href={APPLY_HREF} data-testid="dealer-apply-footer-cta">
                Become a Dealer Partner
                <ArrowRight className="h-[18px] w-[18px]" aria-hidden="true" />
              </Link>
            </Button>
          </div>
          <ul className="mt-9 flex flex-wrap justify-center gap-x-7 gap-y-3 text-sm font-semibold text-white/70 sm:text-[15px]">
            {FINAL_CHIPS.map((chip) => (
              <li key={chip} className="flex items-center gap-2">
                <Check className="h-[18px] w-[18px] text-[#7FE3A8]" strokeWidth={2.5} aria-hidden="true" />
                {chip}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── FAITH MODULE (site-wide convention) ─────────────────────── */}
      <section className="bg-[#0A0F1A] pb-16">
        <div className="mx-auto max-w-2xl px-6 text-center">
          <FaithVerseModule pageKey="dealers" />
        </div>
      </section>
    </div>
  );
}
