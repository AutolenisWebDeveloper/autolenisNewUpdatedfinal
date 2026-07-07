import Link from "next/link";
import { ChevronRight, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { CARD, CARD_HOVER, FIGURE, TONE_STYLES, type Tone } from "./tokens";

/**
 * KPI stat card shared by all four dashboards. Linkable, icon-toned, with a
 * mono/tabular figure per the platform's fintech number convention.
 */
export default function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  tone = "brand",
  href,
  live = false,
  testId,
}: {
  label: string;
  /** Pre-formatted display value (e.g. "$12,400", "38%", "5"). */
  value: string;
  /** Supporting line under the label (e.g. "all-time", "of 24 offers"). */
  sub?: string;
  icon: LucideIcon;
  tone?: Tone;
  href?: string;
  /** Adds a pulsing dot next to the value for live/real-time metrics. */
  live?: boolean;
  testId?: string;
}) {
  const t = TONE_STYLES[tone];

  const body = (
    <>
      <div className="flex items-start justify-between mb-4">
        <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center", t.iconBg)}>
          <Icon size={16} className={t.iconText} />
        </div>
        {href && (
          <ChevronRight
            size={14}
            className="text-slate-300 group-hover:text-[#0B5FD1] group-hover:translate-x-0.5 transition-all mt-0.5"
          />
        )}
      </div>
      <div className="flex items-baseline gap-2">
        <p className={cn("text-[1.65rem] leading-none", FIGURE)}>{value}</p>
        {live && (
          <span className="relative flex h-2 w-2 self-center">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
          </span>
        )}
      </div>
      <p className="text-xs font-medium text-slate-500 mt-2">{label}</p>
      {sub && <p className="text-[11px] text-slate-400 mt-0.5 truncate">{sub}</p>}
    </>
  );

  if (href) {
    return (
      <Link href={href} data-testid={testId} className={cn(CARD, CARD_HOVER, "p-5 group block")}>
        {body}
      </Link>
    );
  }
  return (
    <div data-testid={testId} className={cn(CARD, "p-5")}>
      {body}
    </div>
  );
}
