import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import {
  ArrowRight,
  Check,
  X,
  Users,
  TrendingUp,
  PiggyBank,
  MapPin,
  DollarSign,
  RefreshCw,
  Workflow,
  UserPlus,
  Bell,
  Send,
  CheckCircle2,
  ShieldCheck,
  Star,
  LayoutGrid,
  Boxes,
  FileText,
  Truck,
  Settings,
} from "lucide-react";
import FaithVerseModule from "@/components/public/FaithVerseModule";
import BuyerOpportunityCard from "@/components/dealer/BuyerOpportunityCard";
import DealerFAQ, { type DealerFaqItem } from "@/components/dealer/DealerFAQ";
import { buildPageMetadata, PAGE_METADATA } from "@/lib/seo/metadata";

export const metadata: Metadata = buildPageMetadata(PAGE_METADATA.forDealers);
export const revalidate = 86400;

const APPLY_HREF = "/dealer-application";

const TRUST_CHECKS = [
  "No Dealer Fees",
  "No Monthly Subscription",
  "No Setup Costs",
  "Qualified Buyers",
  "Nationwide Growth Opportunity",
];

const BENEFITS = [
  {
    icon: Users,
    title: "Purchase-Ready Buyers",
    body: "Connect with verified buyers ready to make a purchase.",
  },
  {
    icon: TrendingUp,
    title: "Increase Sales",
    body: "Win more deals and close more business.",
  },
  {
    icon: PiggyBank,
    title: "Lower Costs",
    body: "Reduce your customer acquisition expenses.",
  },
  {
    icon: MapPin,
    title: "Nationwide Opportunities",
    body: "Reach buyers in more markets across the U.S.",
  },
];

const LEAD_SOURCES = [
  "AutoTrader",
  "Cars.com",
  "Google Ads",
  "Facebook Ads",
  "Third-Party Lead Providers",
];

const WHY_CARDS = [
  {
    icon: Users,
    title: "More Qualified Buyers",
    body: "Connect with customers actively looking to purchase a vehicle.",
  },
  {
    icon: DollarSign,
    title: "No Dealer Fees",
    body: "Join and participate at no cost. Ever.",
    highlight: true,
  },
  {
    icon: TrendingUp,
    title: "Higher Closing Potential",
    body: "Engage buyers already comparing real offers, not browsing.",
  },
  {
    icon: MapPin,
    title: "Expand Market Reach",
    body: "Access ready buyers beyond your local market.",
  },
  {
    icon: RefreshCw,
    title: "Faster Inventory Turnover",
    body: "Move vehicles more efficiently with high-intent demand.",
  },
  {
    icon: Workflow,
    title: "Simple Digital Workflow",
    body: "Submit structured offers directly through AutoLenis.",
  },
];

const STEPS = [
  {
    num: "01",
    icon: UserPlus,
    title: "Join the Dealer Network",
    body: "Apply in minutes. No setup fee, no contract, no subscription.",
  },
  {
    num: "02",
    icon: Bell,
    title: "Receive Buyer Opportunities",
    body: "Get matched to verified, purchase-ready buyers in your market.",
  },
  {
    num: "03",
    icon: Send,
    title: "Submit Your Best Offer",
    body: "Send a clean, structured out-the-door offer in the portal.",
  },
  {
    num: "04",
    icon: CheckCircle2,
    title: "Win More Business",
    body: "Close the buyer, prep the vehicle, complete a fast digital handoff.",
    highlight: true,
  },
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

const FINAL_CHIPS = [
  "Independent dealers welcome",
  "Franchise dealers eligible",
  "Nationwide",
  "Free to join",
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

const SECTION_X = "mx-auto max-w-7xl px-5 sm:px-8 lg:px-12";

export default function ForDealersPage() {
  return (
    <div className="bg-white font-body text-[#0A1A2F]">
      {/* ── COST RIBBON ─────────────────────────────────────────────── */}
      <div className="bg-gradient-to-r from-[#0A1E3F] to-[#143b8f] text-white">
        <div className={`${SECTION_X} flex items-center justify-center gap-x-2 gap-y-1 py-2.5 text-center text-[13px] font-semibold sm:text-sm`}>
          <span className="font-extrabold text-[#7FB0FF]">No Dealer Fees.</span>
          <span className="text-white/90">
            No Monthly Costs. No Subscription. Just Qualified Buyers Ready to Purchase.
          </span>
        </div>
      </div>

      {/* ── HERO ────────────────────────────────────────────────────── */}
      <section
        id="top"
        data-testid="for-dealers-hero"
        className="relative overflow-hidden bg-[radial-gradient(120%_100%_at_0%_0%,#F4F8FF_0%,#ffffff_55%)]"
      >
        <div className={`${SECTION_X} grid grid-cols-1 items-center gap-12 py-16 lg:grid-cols-[1.05fr_0.95fr] lg:py-20`}>
          <div>
            <p className="mb-5 inline-flex items-center gap-2 text-xs font-extrabold uppercase tracking-[0.16em] text-[#0B5FD1]">
              <span className="inline-block h-0.5 w-6 bg-[#0B5FD1]" aria-hidden="true" />
              For Dealers
            </p>
            <h1 className="font-display text-4xl font-extrabold leading-[1.04] tracking-tight sm:text-5xl lg:text-6xl">
              Get Qualified Car Buyers{" "}
              <span className="text-[#0B5FD1]">Delivered Directly To Your Dealership</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-[#56657C]">
              AutoLenis connects verified, purchase-ready buyers with participating dealers
              through a private marketplace designed to increase sales and reduce customer
              acquisition costs.
            </p>

            <ul className="mt-8 grid max-w-xl grid-cols-1 gap-x-7 gap-y-3 sm:grid-cols-2">
              {TRUST_CHECKS.map((label) => (
                <li key={label} className="flex items-center gap-2.5 text-[15px] font-semibold">
                  <CheckCircle2 className="h-5 w-5 shrink-0 text-[#0B5FD1]" aria-hidden="true" />
                  {label}
                </li>
              ))}
            </ul>

            <div className="mt-9 flex flex-wrap items-center gap-3.5">
              <Link
                href={APPLY_HREF}
                data-testid="for-dealers-apply-cta"
                className="inline-flex items-center gap-2.5 rounded-xl bg-[#0B5FD1] px-7 py-4 font-display text-base font-bold text-white shadow-[0_10px_26px_rgba(11,95,209,0.32)] transition-colors hover:bg-[#0A55BC] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0B5FD1] focus-visible:ring-offset-2"
              >
                Become a Dealer Partner
                <ArrowRight className="h-[18px] w-[18px]" aria-hidden="true" />
              </Link>
              <Link
                href="#how"
                className="inline-flex items-center gap-2 rounded-xl border-2 border-[#CBD9F2] bg-white px-6 py-3.5 font-display text-base font-bold text-[#0B5FD1] transition-colors hover:border-[#0B5FD1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0B5FD1] focus-visible:ring-offset-2"
              >
                Learn More
              </Link>
            </div>
          </div>

          {/* Photo + floating card */}
          <div className="relative">
            <div className="relative overflow-hidden rounded-[18px] shadow-[0_30px_70px_rgba(10,35,80,0.22)]">
              <Image
                src="/images/dealers/dealer-hero.jpg"
                alt="Smiling dealership manager standing in front of a dealership with vehicles on the lot"
                width={1335}
                height={1178}
                priority
                sizes="(max-width: 1024px) 100vw, 560px"
                className="h-full w-full object-cover"
              />
            </div>
            <div className="pointer-events-none mt-6 sm:absolute sm:-bottom-10 sm:-left-6 sm:mt-0 sm:w-[290px] lg:-left-10">
              <BuyerOpportunityCard
                className="animate-dealer-float"
                opportunity={{
                  year: "2024",
                  makeModel: "Toyota RAV4 XLE",
                  trim: "AWD • SUV",
                  budgetRange: "$28,000 – $32,000",
                  location: "Dallas, TX",
                  tradeIn: "Yes",
                }}
              />
            </div>
          </div>
        </div>
      </section>

      {/* ── DARK BENEFITS STRIP ─────────────────────────────────────── */}
      <section className="bg-gradient-to-r from-[#0A1E3F] to-[#0E2C63] text-white">
        <div className={`${SECTION_X} grid grid-cols-1 gap-8 py-10 sm:grid-cols-2 lg:grid-cols-4 lg:gap-0`}>
          {BENEFITS.map((b, i) => (
            <div
              key={b.title}
              className={`flex items-start gap-3.5 lg:px-7 ${
                i === 0 ? "lg:pl-0" : ""
              } ${i !== BENEFITS.length - 1 ? "lg:border-r lg:border-white/15" : "lg:pr-0"}`}
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#0B5FD1]">
                <b.icon className="h-[22px] w-[22px] text-white" aria-hidden="true" />
              </span>
              <div>
                <h2 className="font-display text-base font-extrabold">{b.title}</h2>
                <p className="mt-1 text-sm leading-snug text-[#B7C5E0]">{b.body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── SECTION 2: STOP PAYING FOR LEADS ────────────────────────── */}
      <section className="bg-white">
        <div className={`${SECTION_X} grid grid-cols-1 items-center gap-12 py-20 lg:grid-cols-2 lg:gap-16 lg:py-24`}>
          <div>
            <p className="mb-4 text-xs font-extrabold uppercase tracking-[0.16em] text-[#0B5FD1]">
              The Lead-Gen Problem
            </p>
            <h2 className="font-display text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl">
              Stop Paying For Leads That Never Buy
            </h2>
            <p className="mt-5 max-w-md text-lg leading-relaxed text-[#56657C]">
              Most dealerships spend thousands every month on platforms that sell the same
              leads to everyone — and many of those leads never purchase.
            </p>
          </div>

          <div className="rounded-[18px] border border-[#E7ECF5] bg-[#F6F8FC] p-6 sm:p-8">
            <p className="mb-4 text-xs font-extrabold uppercase tracking-[0.1em] text-[#8693A8]">
              Where the budget goes today
            </p>
            <div className="flex flex-col gap-2.5">
              {LEAD_SOURCES.map((src) => (
                <div
                  key={src}
                  className="flex items-center justify-between gap-3 rounded-xl border border-[#ECEFF5] bg-white px-4 py-3.5"
                >
                  <span className="text-[15px] font-bold text-[#3C485C]">{src}</span>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-[#FBEDED] px-3 py-1 text-xs font-bold text-[#B23B3B]">
                    <X className="h-3 w-3" strokeWidth={3} aria-hidden="true" />
                    Often never buy
                  </span>
                </div>
              ))}
            </div>

            {/* Resolution panel */}
            <div className="mt-5 rounded-2xl bg-[#0A1E3F] p-6 text-white">
              <p className="text-[15px] font-semibold leading-relaxed">
                AutoLenis delivers buyers actively shopping for a vehicle —{" "}
                <span className="text-[#7FB0FF]">not cold lists, not shared leads.</span>
              </p>
              <div className="mt-5 grid grid-cols-3 gap-3 border-t border-white/15 pt-5">
                {[
                  { stat: "0", label: "Lead fees" },
                  { stat: "1:1", label: "Direct opportunities" },
                  { stat: "High", label: "Buyer intent" },
                ].map((s) => (
                  <div key={s.label}>
                    <p className="font-display text-2xl font-extrabold text-[#7FB0FF]">{s.stat}</p>
                    <p className="mt-1 text-xs font-medium text-[#B7C5E0]">{s.label}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── SECTION 3: WHY DEALERS JOIN ─────────────────────────────── */}
      <section id="why" className="scroll-mt-24 bg-[#F4F7FC]">
        <div className={`${SECTION_X} py-20 lg:py-24`}>
          <div className="mx-auto mb-14 max-w-2xl text-center">
            <p className="mb-4 text-xs font-extrabold uppercase tracking-[0.16em] text-[#0B5FD1]">
              Why Dealers Join
            </p>
            <h2 className="font-display text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl">
              Built To Help You Sell More Cars
            </h2>
          </div>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {WHY_CARDS.map((card) => (
              <div
                key={card.title}
                className={
                  card.highlight
                    ? "relative rounded-2xl bg-[#0A1E3F] p-8 shadow-[0_14px_34px_rgba(10,35,80,0.22)]"
                    : "rounded-2xl border border-[#E7ECF5] bg-white p-8 shadow-[0_2px_10px_rgba(10,35,80,0.04)]"
                }
              >
                {card.highlight && (
                  <span className="absolute right-5 top-5 rounded-full bg-[#0B5FD1] px-2.5 py-1 text-[11px] font-extrabold tracking-wide text-white">
                    $0
                  </span>
                )}
                <span
                  className={`mb-5 flex h-[52px] w-[52px] items-center justify-center rounded-[13px] ${
                    card.highlight ? "bg-white/10" : "bg-[#EAF2FE]"
                  }`}
                >
                  <card.icon
                    className={`h-6 w-6 ${card.highlight ? "text-[#7FB0FF]" : "text-[#0B5FD1]"}`}
                    aria-hidden="true"
                  />
                </span>
                <h3
                  className={`font-display text-xl font-extrabold ${
                    card.highlight ? "text-white" : "text-[#0A1A2F]"
                  }`}
                >
                  {card.title}
                </h3>
                <p
                  className={`mt-2.5 text-[15px] leading-relaxed ${
                    card.highlight ? "text-[#B7C5E0]" : "text-[#56657C]"
                  }`}
                >
                  {card.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── SECTION 4: HOW IT WORKS ─────────────────────────────────── */}
      <section id="how" className="scroll-mt-24 bg-white">
        <div className={`${SECTION_X} py-20 lg:py-24`}>
          <div className="mx-auto mb-14 max-w-2xl text-center">
            <p className="mb-4 text-xs font-extrabold uppercase tracking-[0.16em] text-[#0B5FD1]">
              How Dealer Participation Works
            </p>
            <h2 className="font-display text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl">
              Four Steps To More Sales
            </h2>
          </div>
          <ol className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((step) => (
              <li
                key={step.num}
                className={
                  step.highlight
                    ? "rounded-2xl bg-[#0A1E3F] p-7 shadow-[0_14px_34px_rgba(10,35,80,0.22)]"
                    : "rounded-2xl border border-[#E7ECF5] bg-[#F4F7FC] p-7"
                }
              >
                <div className="mb-5 flex items-center justify-between">
                  <span
                    className={`font-display text-[54px] font-extrabold leading-none tracking-tight ${
                      step.highlight ? "text-[#7FB0FF]/30" : "text-[#D7E2F6]"
                    }`}
                  >
                    {step.num}
                  </span>
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#0B5FD1]">
                    <step.icon className="h-[22px] w-[22px] text-white" aria-hidden="true" />
                  </span>
                </div>
                <h3
                  className={`font-display text-lg font-extrabold ${
                    step.highlight ? "text-white" : "text-[#0A1A2F]"
                  }`}
                >
                  {step.title}
                </h3>
                <p
                  className={`mt-2 text-sm leading-relaxed ${
                    step.highlight ? "text-[#B7C5E0]" : "text-[#56657C]"
                  }`}
                >
                  {step.body}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── SECTION 5: MARKETPLACE DASHBOARD ────────────────────────── */}
      <section className="bg-gradient-to-b from-[#0A1E3F] to-[#0B294F] text-white">
        <div className={`${SECTION_X} py-20 lg:py-24`}>
          <div className="mx-auto mb-12 max-w-3xl text-center">
            <p className="mb-4 text-xs font-extrabold uppercase tracking-[0.16em] text-[#7FB0FF]">
              The AutoLenis Dealer Marketplace
            </p>
            <h2 className="font-display text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl">
              Exclusive Buyer Opportunities, In One Place
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-[#B7C5E0]">
              Every opportunity comes pre-loaded with the details you need to make your best
              offer — fast.
            </p>
          </div>

          <div className="mx-auto max-w-5xl overflow-hidden rounded-[18px] bg-white text-[#0A1A2F] shadow-[0_40px_90px_rgba(0,0,0,0.4)]">
            {/* window bar */}
            <div className="flex items-center gap-2 border-b border-[#E7ECF5] bg-[#F3F5F9] px-4 py-3.5">
              <span className="h-3 w-3 rounded-full bg-[#FF5F57]" aria-hidden="true" />
              <span className="h-3 w-3 rounded-full bg-[#FEBC2E]" aria-hidden="true" />
              <span className="h-3 w-3 rounded-full bg-[#28C840]" aria-hidden="true" />
              <span className="ml-3 truncate text-[13px] font-bold text-[#8693A8]">
                app.autolenis.com / dealer / opportunities
              </span>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-[200px_1fr_360px]">
              {/* left nav */}
              <nav
                aria-label="Dealer portal"
                className="hidden flex-col gap-1 border-r border-[#ECEFF5] bg-[#FAFBFD] p-4 lg:flex"
              >
                {PORTAL_NAV.map((item) => (
                  <span
                    key={item.label}
                    className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold ${
                      item.active ? "bg-[#EAF2FE] text-[#0B5FD1]" : "text-[#56657C]"
                    }`}
                  >
                    <item.icon className="h-[18px] w-[18px]" aria-hidden="true" />
                    {item.label}
                  </span>
                ))}
              </nav>

              {/* opportunity list */}
              <div className="border-b border-[#ECEFF5] p-5 lg:border-b-0 lg:border-r">
                <div className="mb-4 flex items-center justify-between">
                  <span className="font-display text-[15px] font-extrabold">Incoming Opportunities</span>
                  <span className="rounded-full bg-[#0B5FD1] px-2.5 py-0.5 text-[11px] font-extrabold text-white">
                    4 new
                  </span>
                </div>
                <div className="flex flex-col gap-2.5">
                  {PORTAL_LIST.map((row) => (
                    <div
                      key={row.vehicle}
                      className={`rounded-xl p-3.5 ${
                        row.active
                          ? "border-2 border-[#0B5FD1] bg-white shadow-[0_6px_16px_rgba(11,95,209,0.16)]"
                          : "border border-[#ECEFF5] bg-white"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span
                          className={`font-display text-[15px] font-extrabold ${
                            row.active ? "text-[#0A1A2F]" : "text-[#3C485C]"
                          }`}
                        >
                          {row.vehicle}
                        </span>
                        {row.active && (
                          <span className="h-2 w-2 rounded-full bg-[#0B5FD1]" aria-hidden="true" />
                        )}
                      </div>
                      <p className="mt-1 text-[12.5px] font-semibold text-[#7A879B]">
                        {row.location} · {row.budget}
                      </p>
                      {row.active && (
                        <span className="mt-2 inline-block rounded-full bg-[#EAF2FE] px-2.5 py-1 text-[11px] font-extrabold text-[#0B5FD1]">
                          High Intent
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* detail panel — reusable card */}
              <div className="bg-[#F6F8FC] p-5">
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
        <div className={`${SECTION_X} py-20 lg:py-24`}>
          <div className="mx-auto mb-14 max-w-2xl text-center">
            <p className="mb-4 text-xs font-extrabold uppercase tracking-[0.16em] text-[#0B5FD1]">
              The Economics
            </p>
            <h2 className="font-display text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl">
              A Smarter Way To Spend Your Acquisition Budget
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-[#56657C]">
              See how AutoLenis compares to the traditional lead model dealers pay for every month.
            </p>
          </div>

          <div className="mx-auto grid max-w-4xl grid-cols-1 items-stretch gap-6 lg:grid-cols-2">
            {/* Traditional */}
            <div className="rounded-[18px] border border-[#E7ECF5] bg-[#F7F8FA] p-8">
              <h3 className="mb-6 font-display text-xl font-extrabold text-[#3C485C]">
                Traditional Lead Sources
              </h3>
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

            {/* AutoLenis */}
            <div className="relative overflow-hidden rounded-[18px] bg-[linear-gradient(160deg,#0B5FD1,#0A1E3F)] p-8 shadow-[0_24px_54px_rgba(10,35,80,0.32)]">
              <span className="absolute right-6 top-6 rounded-full bg-[#7FE3A8] px-3 py-1 text-xs font-extrabold text-[#0A1E3F]">
                RECOMMENDED
              </span>
              <h3 className="mb-6 font-display text-xl font-extrabold text-white">AutoLenis</h3>
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
              <Link
                href={APPLY_HREF}
                className="mt-8 inline-flex items-center gap-2 rounded-xl bg-white px-6 py-3.5 font-display text-[15px] font-bold text-[#0B5FD1] shadow-[0_10px_24px_rgba(0,0,0,0.2)] transition-colors hover:bg-[#EAF2FE] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#0A1E3F]"
              >
                Become a Dealer Partner
                <ArrowRight className="h-[18px] w-[18px]" aria-hidden="true" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── SECTION 7: TESTIMONIALS (COMING SOON) ───────────────────── */}
      <section className="bg-[#F4F7FC]">
        <div className={`${SECTION_X} py-20 lg:py-24`}>
          <div className="mx-auto mb-12 max-w-2xl text-center">
            <p className="mb-4 text-xs font-extrabold uppercase tracking-[0.16em] text-[#0B5FD1]">
              Dealer Success Stories
            </p>
            <h2 className="font-display text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl">
              Coming Soon
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-[#56657C]">
              We&apos;re onboarding our founding dealer partners now. Real results from real
              dealerships will appear here as the network grows.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="rounded-2xl border border-dashed border-[#C9D6EC] bg-white p-8 text-center"
                aria-hidden="true"
              >
                <div className="mb-5 flex justify-center gap-1 text-[#D7E2F6]">
                  {[0, 1, 2, 3, 4].map((s) => (
                    <Star key={s} className="h-4 w-4 fill-current" />
                  ))}
                </div>
                <div className="mx-auto mb-2.5 h-2.5 rounded bg-[#EDF1F8]" />
                <div className="mx-auto mb-2.5 h-2.5 rounded bg-[#EDF1F8]" />
                <div className="mx-auto mb-6 h-2.5 w-[70%] rounded bg-[#EDF1F8]" />
                <div className="flex items-center justify-center gap-3">
                  <span className="h-10 w-10 rounded-full bg-[#E3EAF5]" />
                  <div className="text-left">
                    <p className="font-display text-sm font-extrabold text-[#0B5FD1]">
                      Your Story Here
                    </p>
                    <p className="text-xs text-[#8693A8]">Founding Dealer Partner</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-12 text-center">
            <Link
              href={APPLY_HREF}
              className="inline-flex items-center gap-2 rounded-xl bg-[#0B5FD1] px-7 py-4 font-display text-base font-bold text-white shadow-[0_10px_26px_rgba(11,95,209,0.28)] transition-colors hover:bg-[#0A55BC] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0B5FD1] focus-visible:ring-offset-2"
            >
              Be one of our first partners
              <ArrowRight className="h-[18px] w-[18px]" aria-hidden="true" />
            </Link>
          </div>
        </div>
      </section>

      {/* ── SECTION 8: FAQ ──────────────────────────────────────────── */}
      <section id="faq" className="scroll-mt-24 bg-white">
        <div className="mx-auto max-w-3xl px-5 py-20 sm:px-8 lg:py-24">
          <div className="mx-auto mb-12 text-center">
            <p className="mb-4 text-xs font-extrabold uppercase tracking-[0.16em] text-[#0B5FD1]">
              Frequently Asked Questions
            </p>
            <h2 className="font-display text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl">
              Everything Dealers Ask
            </h2>
          </div>
          <DealerFAQ items={FAQS} />
        </div>
      </section>

      {/* ── FINAL CTA BAND ──────────────────────────────────────────── */}
      <section id="apply" className="scroll-mt-24 bg-[linear-gradient(160deg,#0B5FD1,#0A1E3F)] text-white">
        <div className="mx-auto max-w-4xl px-5 py-20 text-center sm:px-8 lg:py-24">
          <h2 className="font-display text-3xl font-extrabold leading-[1.08] tracking-tight sm:text-4xl lg:text-[44px]">
            No Dealer Fees. No Monthly Costs. No Subscription.
            <br className="hidden sm:block" /> Just Qualified Buyers Ready To Purchase.
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-lg font-medium text-[#CFDBF2]">
            Join the AutoLenis dealer network and start receiving verified, purchase-ready
            buyers in your market.
          </p>
          <div className="mt-9 flex justify-center">
            <Link
              href={APPLY_HREF}
              data-testid="dealer-apply-footer-cta"
              className="inline-flex items-center gap-2.5 rounded-xl bg-white px-8 py-4 font-display text-base font-bold text-[#0B5FD1] shadow-[0_14px_30px_rgba(0,0,0,0.25)] transition-colors hover:bg-[#EAF2FE] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#0A1E3F]"
            >
              Become a Dealer Partner
              <ArrowRight className="h-[18px] w-[18px]" aria-hidden="true" />
            </Link>
          </div>
          <ul className="mt-9 flex flex-wrap justify-center gap-x-7 gap-y-3 text-[15px] font-semibold text-[#CFDBF2]">
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
      <section className="bg-[#0A1E3F] pb-16">
        <div className="mx-auto max-w-2xl px-6 text-center">
          <FaithVerseModule pageKey="dealers" />
        </div>
      </section>
    </div>
  );
}
