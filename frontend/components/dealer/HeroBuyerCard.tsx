import { Users, Star, Wallet, MapPin, RefreshCw, FileText, Car } from "lucide-react";

/**
 * HeroBuyerCard — the wide "New Buyer Opportunity" card shown overlapping the
 * hero photo (per the approved mockup). Purely presentational.
 *
 * Layout: two halves split by a divider — vehicle summary on the left,
 * qualification details + CTA on the right. Stacks to a single column on
 * mobile so it never overflows narrow viewports.
 *
 * Vehicle thumbnail: a styled placeholder by default. Drop a real photo at
 * /images/dealers/vehicle-rav4.webp and pass `vehicleImage` to show it.
 */
const ROWS = [
  { icon: Wallet, label: "Budget Range", value: "$28,000 - $32,000" },
  { icon: MapPin, label: "Location", value: "Dallas, TX" },
  { icon: RefreshCw, label: "Trade-In", value: "Yes" },
  { icon: FileText, label: "Financing", value: "Pre-Qualified" },
];

export default function HeroBuyerCard({ className = "" }: { className?: string }) {
  return (
    <div
      className={`overflow-hidden rounded-2xl bg-white shadow-[0_24px_60px_rgba(10,35,80,0.22)] ring-1 ring-slate-200/70 ${className}`}
    >
      <div className="flex flex-col sm:flex-row">
        {/* Left — vehicle summary */}
        <div className="flex flex-col gap-3 p-5 sm:w-[44%]">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#0B5FD1]">
              <Users className="h-[18px] w-[18px] text-white" aria-hidden="true" />
            </span>
            <span className="text-[15px] font-bold leading-tight text-[#0A1A2F]">New Buyer Opportunity</span>
          </div>

          <div className="flex aspect-[16/10] items-center justify-center rounded-xl bg-gradient-to-br from-slate-100 to-slate-200">
            <Car className="h-10 w-10 text-slate-400" aria-hidden="true" />
          </div>

          <div>
            <p className="text-[15px] font-bold text-[#0A1A2F]">2024 Toyota RAV4 XLE</p>
            <p className="text-xs font-medium text-[#56657C]">AWD · SUV</p>
          </div>

          <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-[#EAF2FE] px-3 py-1.5 text-xs font-bold text-[#0B5FD1]">
            <Star className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
            High Intent Buyer
          </span>
        </div>

        {/* Right — qualification details + CTA */}
        <div className="flex flex-col justify-center gap-3.5 border-t border-slate-100 p-5 sm:flex-1 sm:border-l sm:border-t-0">
          <dl className="flex flex-col gap-3">
            {ROWS.map((r) => (
              <div key={r.label} className="flex items-center justify-between gap-3">
                <dt className="flex items-center gap-2 text-[13px] text-[#56657C]">
                  <r.icon className="h-4 w-4 shrink-0 text-[#8693A8]" aria-hidden="true" />
                  {r.label}
                </dt>
                <dd className="text-right text-[13px] font-bold text-[#0A1A2F]">{r.value}</dd>
              </div>
            ))}
          </dl>

          <span className="flex w-full items-center justify-center rounded-xl bg-[#0B5FD1] px-4 py-3 text-sm font-bold text-white shadow-[0_10px_24px_rgba(11,95,209,0.28)]">
            Submit Your Best Offer
          </span>
        </div>
      </div>
    </div>
  );
}
