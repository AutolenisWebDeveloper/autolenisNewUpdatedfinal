import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CheckCircle2, XCircle, AlertCircle } from "lucide-react";
import FaithVerseModule from "@/components/public/FaithVerseModule";
import { buildPageMetadata, PAGE_METADATA } from "@/lib/seo/metadata";
import { DEPOSIT_AMOUNT_CENTS } from "@/lib/constants";

export const metadata: Metadata = buildPageMetadata(PAGE_METADATA.compare);
export const dynamic = "force-dynamic";
export const revalidate = 86400;

const TRADITIONAL_POINTS = [
  "Buyer goes to one dealer at a time",
  "Dealer has all pricing information",
  "Buyer negotiates from a position of weakness",
  "Hidden fees discovered at signing",
  "Time pressure tactics common",
  "Must physically visit multiple lots",
];

const AUTOLENIS_POINTS = [
  "Multiple dealers compete simultaneously",
  "Buyer has verified budget range and leverage",
  "Dealers submit best offer to win the business",
  "Contract Shield reviews fees before signing",
  "Buyer reviews offers on their own timeline",
  "Entire process can happen remotely",
];

type Indicator = "check" | "warn" | "cross";

interface ComparisonRow {
  dimension: string;
  traditional: { icon: Indicator; label: string };
  listing: { icon: Indicator; label: string };
  online: { icon: Indicator; label: string };
  autolenis: { icon: Indicator; label: string };
}

const COMPARISON_ROWS: ComparisonRow[] = [
  {
    dimension: "Buyer leverage",
    traditional: { icon: "cross", label: "Low" },
    listing: { icon: "warn", label: "Limited" },
    online: { icon: "warn", label: "Fixed pricing" },
    autolenis: { icon: "check", label: "Dealer competition" },
  },
  {
    dimension: "Price transparency",
    traditional: { icon: "cross", label: "Hidden fees common" },
    listing: { icon: "warn", label: "List price only" },
    online: { icon: "warn", label: "Set price" },
    autolenis: { icon: "check", label: "Contract Shield review" },
  },
  {
    dimension: "Dealer competition",
    traditional: { icon: "cross", label: "None" },
    listing: { icon: "cross", label: "None" },
    online: { icon: "cross", label: "None" },
    autolenis: { icon: "check", label: "Up to 8 dealers" },
  },
  {
    dimension: "Remote process",
    traditional: { icon: "cross", label: "Visit required" },
    listing: { icon: "warn", label: "Partial" },
    online: { icon: "check", label: "Yes" },
    autolenis: { icon: "check", label: "Yes" },
  },
  {
    dimension: "Contract review",
    traditional: { icon: "cross", label: "You review alone" },
    listing: { icon: "cross", label: "None" },
    online: { icon: "warn", label: "Limited" },
    autolenis: { icon: "check", label: "Automated scan" },
  },
  {
    dimension: "Prequalification",
    traditional: { icon: "warn", label: "Hard pull often" },
    listing: { icon: "cross", label: "None" },
    online: { icon: "warn", label: "Varies" },
    autolenis: { icon: "check", label: "Soft pull only" },
  },
];

const DEEP_DIVE_CARDS = [
  {
    title: "Reverse Auction vs Forward Negotiation",
    body: "In traditional buying, you negotiate against a single dealer who controls all the information. In AutoLenis, multiple dealers submit offers simultaneously, knowing they're competing. The competitive dynamic produces better offers without you having to negotiate.",
  },
  {
    title: "Contract Shield vs Reviewing Alone",
    body: "Most buyers sign contracts they don't fully understand. Contract Shield automatically scans every deal document for junk fees, unusual add-ons, and compliance issues — and provides a plain-language report before you sign.",
  },
  {
    title: "Verified Budget vs Sticker Shock",
    body: "AutoLenis uses soft-pull prequalification to establish your verified budget range before you shop. Dealers know your budget band and submit offers within it — eliminating the back-and-forth over whether you can afford the vehicle.",
  },
];

const BUYER_PROFILES = [
  "Buyers who dislike high-pressure sales environments",
  "People who want to buy remotely without visiting multiple lots",
  "Buyers who want competing offers rather than negotiating one-on-one",
  "First-time buyers who want guided support (Premium Concierge)",
  "Buyers with specific vehicles in mind who want dealer sourcing",
  "Anyone who's been burned by hidden fees at signing",
];

function IndicatorIcon({ type }: { type: Indicator }) {
  if (type === "check") return <CheckCircle2 size={16} className="text-[#0B5FD1] shrink-0" />;
  if (type === "warn") return <AlertCircle size={16} className="text-[#D97706] shrink-0" />;
  return <XCircle size={16} className="text-[#94A3B8] shrink-0" />;
}

export default function ComparePage() {
  return (
    <div className="bg-[#F8F9FB]">
      {/* Hero */}
      <section className="pt-16 py-24 md:py-32 text-center bg-gradient-to-b from-[#F8F9FB] to-white">
        <div className="mx-auto max-w-7xl px-6 md:px-12">
          <span className="text-xs font-semibold uppercase tracking-[0.15em] text-[#0B5FD1]">
            HOW WE'RE DIFFERENT
          </span>
          <h1 className="text-5xl sm:text-6xl font-bold tracking-tight text-[#111827] mt-4 mb-5">
            Not Just a Better Interface. A Better System.
          </h1>
          <p className="text-[#4B5563] text-lg max-w-2xl mx-auto leading-relaxed">
            Most car-buying tools help you find a vehicle. AutoLenis changes the dynamic of who has
            leverage in the deal.
          </p>
        </div>
      </section>

      {/* The Core Difference */}
      <section className="py-20 bg-white">
        <div className="mx-auto max-w-7xl px-6 md:px-12">
          <h2 className="text-3xl font-bold tracking-tight text-[#111827] mb-12 text-center">
            The Fundamental Shift
          </h2>
          <div className="grid md:grid-cols-2 gap-6 max-w-5xl mx-auto">
            <div className="bg-white border border-[#E5E7EB] rounded-2xl shadow-sm p-8">
              <h3 className="font-bold text-[#94A3B8] mb-6 text-sm uppercase tracking-wider">
                Traditional Approach
              </h3>
              <ul className="space-y-4">
                {TRADITIONAL_POINTS.map((item) => (
                  <li key={item} className="flex items-start gap-3 text-sm text-[#4B5563]">
                    <XCircle size={15} className="mt-0.5 shrink-0 text-[#94A3B8]" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div className="bg-[#EFF6FF] border border-[#DBEAFE] rounded-2xl shadow-sm p-8">
              <h3 className="font-bold text-[#0B5FD1] mb-6 text-sm uppercase tracking-wider">
                AutoLenis Approach
              </h3>
              <ul className="space-y-4">
                {AUTOLENIS_POINTS.map((item) => (
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

      {/* Comparison Table */}
      <section className="py-20 bg-[#F8F9FB]">
        <div className="mx-auto max-w-7xl px-6 md:px-12">
          <h2 className="text-3xl font-bold tracking-tight text-[#111827] mb-12 text-center">
            AutoLenis vs Other Approaches
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse">
              <thead>
                <tr>
                  <th className="text-left text-xs font-semibold text-[#94A3B8] uppercase tracking-wider pb-4 pr-4 w-[22%]">
                    Feature
                  </th>
                  <th className="text-center text-xs font-semibold text-[#94A3B8] uppercase tracking-wider pb-4 px-3 w-[19%]">
                    Traditional Dealer
                  </th>
                  <th className="text-center text-xs font-semibold text-[#94A3B8] uppercase tracking-wider pb-4 px-3 w-[19%]">
                    Listing Sites
                  </th>
                  <th className="text-center text-xs font-semibold text-[#94A3B8] uppercase tracking-wider pb-4 px-3 w-[19%]">
                    Online Retailers
                  </th>
                  <th className="text-center text-xs font-semibold text-[#0B5FD1] uppercase tracking-wider pb-4 px-3 w-[19%] bg-[#EFF6FF] rounded-t-xl">
                    AutoLenis
                  </th>
                </tr>
              </thead>
              <tbody>
                {COMPARISON_ROWS.map((row, idx) => (
                  <tr
                    key={row.dimension}
                    className={idx % 2 === 0 ? "bg-white" : "bg-[#F8F9FB]"}
                  >
                    <td className="text-sm font-medium text-[#111827] py-4 pr-4 rounded-l-xl pl-4">
                      {row.dimension}
                    </td>
                    <td className="py-4 px-3 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <IndicatorIcon type={row.traditional.icon} />
                        <span className="text-xs text-[#4B5563]">{row.traditional.label}</span>
                      </div>
                    </td>
                    <td className="py-4 px-3 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <IndicatorIcon type={row.listing.icon} />
                        <span className="text-xs text-[#4B5563]">{row.listing.label}</span>
                      </div>
                    </td>
                    <td className="py-4 px-3 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <IndicatorIcon type={row.online.icon} />
                        <span className="text-xs text-[#4B5563]">{row.online.label}</span>
                      </div>
                    </td>
                    <td className="py-4 px-3 text-center bg-[#EFF6FF] rounded-r-xl">
                      <div className="flex items-center justify-center gap-1.5">
                        <IndicatorIcon type={row.autolenis.icon} />
                        <span className="text-xs font-medium text-[#0B5FD1]">
                          {row.autolenis.label}
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-[#94A3B8] mt-6 max-w-2xl">
            *Comparison reflects general industry approaches and may vary by provider. AutoLenis
            does not make specific claims about named third-party platforms. Features and
            availability subject to change.
          </p>
        </div>
      </section>

      {/* Deep Dive */}
      <section className="py-20 bg-white">
        <div className="mx-auto max-w-7xl px-6 md:px-12">
          <h2 className="text-3xl font-bold tracking-tight text-[#111827] mb-12 text-center">
            What Makes Dealer Competition Different
          </h2>
          <div className="grid sm:grid-cols-3 gap-6">
            {DEEP_DIVE_CARDS.map((card) => (
              <div
                key={card.title}
                className="bg-white border border-[#E5E7EB] rounded-2xl shadow-sm p-8"
              >
                <h3 className="font-bold text-[#111827] mb-4">{card.title}</h3>
                <p className="text-sm text-[#4B5563] leading-relaxed">{card.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Who It's For */}
      <section className="py-20 bg-[#F8F9FB]">
        <div className="mx-auto max-w-7xl px-6 md:px-12">
          <h2 className="text-3xl font-bold tracking-tight text-[#111827] mb-12 text-center">
            AutoLenis Works Best For…
          </h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 max-w-5xl mx-auto">
            {BUYER_PROFILES.map((profile) => (
              <div
                key={profile}
                className="bg-white border border-[#E5E7EB] rounded-xl shadow-sm p-6 flex items-start gap-3"
              >
                <CheckCircle2 size={16} className="text-[#0B5FD1] mt-0.5 shrink-0" />
                <p className="text-sm text-[#4B5563]">{profile}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Honest Limitations */}
      <section className="py-20 bg-white">
        <div className="mx-auto max-w-7xl px-6 md:px-12">
          <h2 className="text-3xl font-bold tracking-tight text-[#111827] mb-4 text-center">
            Where AutoLenis Fits (and Where It Doesn't)
          </h2>
          <p className="text-[#4B5563] text-center text-sm mb-12">
            We believe honest limitations build more trust than overpromising.
          </p>
          <div className="grid sm:grid-cols-2 gap-6 max-w-4xl mx-auto">
            <div className="bg-[#FFFBEB] border border-[#FDE68A] rounded-2xl shadow-sm p-8">
              <h3 className="font-bold text-[#92400E] mb-5 text-sm">
                AutoLenis may not be the right fit if:
              </h3>
              <ul className="space-y-3">
                {[
                  "You prefer to negotiate in person and enjoy the process",
                  "You're looking for same-day vehicle purchase without a waiting period",
                  "You're buying in a state or market with very limited dealer participation",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-3 text-sm text-[#78350F]">
                    <AlertCircle size={15} className="mt-0.5 shrink-0 text-[#D97706]" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div className="bg-[#FFFBEB] border border-[#FDE68A] rounded-2xl shadow-sm p-8">
              <h3 className="font-bold text-[#92400E] mb-5 text-sm">AutoLenis deposit note:</h3>
              <p className="text-sm text-[#78350F] leading-relaxed">
                The ${(DEPOSIT_AMOUNT_CENTS / 100).toFixed(0)} Auction Access Deposit is required
                to activate dealer competition. Refund is available on request if no competitive offer is
                received. This is not a hidden fee — it's how serious dealer engagement is
                guaranteed.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-24 bg-[#0B5FD1] text-center">
        <div className="mx-auto max-w-3xl px-6">
          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4 tracking-tight">
            See the Difference for Yourself.
          </h2>
          <p className="text-white/80 text-lg mb-8 leading-relaxed">
            Get prequalified in 3 minutes and experience what buyer-controlled car purchasing feels
            like.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="/auth/signup"
              className="inline-flex items-center gap-2 px-8 py-4 bg-white text-[#0B5FD1] font-semibold text-sm rounded-md hover:bg-[#EFF6FF] transition-colors shadow-md"
            >
              Get Prequalified <ArrowRight size={16} />
            </Link>
            <Link
              href="/how-it-works"
              className="inline-flex items-center gap-2 px-8 py-4 border border-white/40 text-white font-semibold text-sm rounded-md hover:bg-white/10 transition-colors"
            >
              How It Works
            </Link>
          </div>
        </div>
      </section>

      {/* Faith Module */}
      <section className="py-16 bg-[#0B5FD1] border-t border-white/10 text-center">
        <div className="mx-auto max-w-3xl px-6">
          <FaithVerseModule pageKey="compare" />
        </div>
      </section>
    </div>
  );
}
