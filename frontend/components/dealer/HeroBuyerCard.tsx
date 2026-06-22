import Image from "next/image";
import { Users, Star, Wallet, MapPin, Repeat, ShieldCheck, ArrowRight } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * HeroBuyerCard — the wide "New Buyer Opportunity" card shown overlapping the
 * hero photo (per the approved mockup). Purely presentational / sample data.
 *
 * Header row, then a two-column body (vehicle summary | qualification rows +
 * CTA) split by a divider. Collapses to a single column on mobile so it never
 * overflows narrow viewports.
 */
const ROWS = [
  { icon: Wallet, label: "Budget Range", value: "$28,000 - $32,000" },
  { icon: MapPin, label: "Location", value: "Dallas, TX" },
  { icon: Repeat, label: "Trade-In", value: "Yes" },
  { icon: ShieldCheck, label: "Financing", value: "Pre-Qualified" },
];

export default function HeroBuyerCard({ className = "" }: { className?: string }) {
  return (
    <div
      className={cn(
        "rounded-2xl bg-white p-[22px] shadow-[0_20px_50px_rgba(10,35,80,0.18)] ring-1 ring-slate-200/70",
        className
      )}
    >
      {/* Header */}
      <div className="mb-4 flex items-center gap-2.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#0B5FD1]">
          <Users className="h-[18px] w-[18px] text-white" aria-hidden="true" />
        </span>
        <span className="text-base font-bold text-[#0A1A2F]">New Buyer Opportunity</span>
      </div>

      {/* Body */}
      <div className="flex flex-col gap-5 sm:flex-row">
        {/* Left — vehicle */}
        <div className="flex flex-col gap-2.5 sm:w-[44%]">
          <div className="overflow-hidden rounded-lg bg-slate-50">
            <Image
              src="/images/dealers/rav4-thumb.webp"
              alt=""
              width={368}
              height={160}
              sizes="(max-width: 640px) 88vw, 240px"
              className="h-auto w-full object-cover"
            />
          </div>
          <div>
            <p className="text-base font-bold leading-tight text-[#0A1A2F]">2024 Toyota RAV4 XLE</p>
            <p className="text-[13px] font-medium text-[#64748B]">AWD • SUV</p>
          </div>
          <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-[#EAF1FE] px-3 py-1.5 text-xs font-bold text-[#0B5FD1]">
            <Star className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
            High Intent Buyer
          </span>
        </div>

        {/* Right — qualification rows + CTA */}
        <div className="flex flex-1 flex-col gap-3.5 border-t border-slate-100 pt-4 sm:border-l sm:border-t-0 sm:pl-5 sm:pt-0">
          <dl className="flex flex-col gap-2.5">
            {ROWS.map((r) => (
              <div key={r.label} className="flex items-center justify-between gap-3">
                <dt className="flex items-center gap-2 text-[13px] text-[#64748B]">
                  <r.icon className="h-4 w-4 shrink-0 text-[#0B5FD1]" aria-hidden="true" />
                  {r.label}
                </dt>
                <dd className="text-right text-[13px] font-semibold text-[#0A1A2F]">{r.value}</dd>
              </div>
            ))}
          </dl>

          <span className={cn(buttonVariants({ variant: "default", size: "lg" }), "w-full rounded-xl hover:bg-[#0A4DB8]")}>
            Submit Your Best Offer
            <ArrowRight className="h-[18px] w-[18px]" aria-hidden="true" />
          </span>
        </div>
      </div>
    </div>
  );
}
