import { MapPin, RefreshCw, DollarSign, ShieldCheck, Users, ArrowRight } from "lucide-react";

/**
 * BuyerOpportunityCard — the signature "New Buyer Opportunity" card.
 *
 * This is the product promise to dealers, so it must read as premium. It is a
 * purely presentational server component reused in the Hero (floating overlay)
 * and the Marketplace section (detail panel).
 */
export type BuyerOpportunity = {
  year: string;
  makeModel: string;
  trim: string;
  budgetRange: string;
  location: string;
  tradeIn: string;
  financing?: string;
  buyerStatus?: string;
};

export default function BuyerOpportunityCard({
  opportunity,
  className = "",
}: {
  opportunity: BuyerOpportunity;
  className?: string;
}) {
  const {
    year,
    makeModel,
    trim,
    budgetRange,
    location,
    tradeIn,
    financing = "Pre-Qualified",
    buyerStatus = "Ready to Purchase",
  } = opportunity;

  return (
    <div
      className={`overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_24px_50px_rgba(10,35,80,0.18)] ${className}`}
    >
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-4">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#0B5FD1]">
          <Users className="h-5 w-5 text-white" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-display text-[15px] font-extrabold leading-tight text-[#0A1A2F]">
            New Buyer Opportunity
          </p>
          <p className="text-xs font-semibold text-[#0B5FD1]">Just received</p>
        </div>
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full bg-[#0B5FD1] motion-safe:animate-pulse"
          aria-hidden="true"
        />
      </div>

      {/* Vehicle + budget */}
      <div className="px-5 pt-4">
        <h3 className="font-display text-xl font-extrabold leading-tight text-[#0A1A2F]">
          {year} {makeModel}
        </h3>
        <p className="mt-0.5 text-sm font-medium text-[#56657C]">{trim}</p>
        <div className="mt-3 border-t border-slate-100 pt-3">
          <p className="text-sm font-medium text-[#56657C]">Budget Range</p>
          <p className="font-display text-xl font-extrabold text-[#0B5FD1]">{budgetRange}</p>
        </div>
      </div>

      {/* Detail rows */}
      <dl className="px-5 py-3 text-sm">
        <Row icon={<MapPin className="h-[18px] w-[18px]" aria-hidden="true" />} label="Location">
          <span className="font-semibold text-[#0A1A2F]">{location}</span>
        </Row>
        <Row icon={<RefreshCw className="h-[18px] w-[18px]" aria-hidden="true" />} label="Trade-In">
          <span className="font-semibold text-[#0A1A2F]">{tradeIn}</span>
        </Row>
        <Row icon={<DollarSign className="h-[18px] w-[18px]" aria-hidden="true" />} label="Financing">
          <span className="font-semibold text-[#0A1A2F]">{financing}</span>
        </Row>
        <Row
          icon={<ShieldCheck className="h-[18px] w-[18px]" aria-hidden="true" />}
          label="Buyer Status"
          last
        >
          <span className="font-bold text-[#15A34A]">{buyerStatus}</span>
        </Row>
      </dl>

      {/* Verify strip */}
      <div className="mx-5 mb-4 flex items-center gap-3 rounded-xl bg-[#EAF2FE] px-4 py-3">
        <ShieldCheck className="h-5 w-5 shrink-0 text-[#0B5FD1]" aria-hidden="true" />
        <p className="text-[13px] leading-tight">
          <span className="font-bold text-[#0B5FD1]">Pre-Qualified Buyer</span>
          <span className="text-[#0B5FD1]"> — Verified · Serious · Actively Shopping</span>
        </p>
      </div>

      {/* CTA */}
      <div className="px-5 pb-5">
        <span className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#0B5FD1] px-4 py-3.5 font-display text-[15px] font-bold text-white shadow-[0_10px_24px_rgba(11,95,209,0.28)]">
          Submit Your Best Offer
          <ArrowRight className="h-[18px] w-[18px]" aria-hidden="true" />
        </span>
      </div>
    </div>
  );
}

function Row({
  icon,
  label,
  children,
  last = false,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
  last?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between py-2.5 ${
        last ? "" : "border-b border-slate-100"
      }`}
    >
      <dt className="flex items-center gap-2.5 text-[#56657C]">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#EAF2FE] text-[#0B5FD1]">
          {icon}
        </span>
        {label}
      </dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}
