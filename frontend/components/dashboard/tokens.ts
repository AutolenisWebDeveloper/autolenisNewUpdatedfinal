// Shared dashboard design tokens — the single source of truth for the four
// portal dashboards (buyer, dealer, admin, affiliate). Every dashboard surface
// must consume these instead of ad-hoc hex values so the portals read as one
// product. Marketing pages keep their own (dark) language; this kit is the
// light "operations" language: white surfaces, slate text, #0B5FD1 brand.

export const BRAND_BLUE = "#0B5FD1";
export const BRAND_BLUE_HOVER = "#0A4DB8";

/** Semantic icon/accent tones used by StatCard, Panel headers, banners. */
export type Tone =
  | "brand"
  | "success"
  | "warning"
  | "danger"
  | "indigo"
  | "neutral";

export const TONE_STYLES: Record<Tone, { iconBg: string; iconText: string; dot: string }> = {
  brand:   { iconBg: "bg-[#EFF6FF]", iconText: "text-[#0B5FD1]", dot: "bg-[#0B5FD1]" },
  success: { iconBg: "bg-emerald-50", iconText: "text-emerald-600", dot: "bg-emerald-500" },
  warning: { iconBg: "bg-amber-50", iconText: "text-amber-600", dot: "bg-amber-500" },
  danger:  { iconBg: "bg-red-50", iconText: "text-red-600", dot: "bg-red-500" },
  indigo:  { iconBg: "bg-indigo-50", iconText: "text-indigo-600", dot: "bg-indigo-500" },
  neutral: { iconBg: "bg-slate-100", iconText: "text-slate-500", dot: "bg-slate-400" },
};

/** Card surface — every dashboard card shares this base. */
export const CARD =
  "bg-white border border-slate-200/80 rounded-2xl shadow-sm";

/** Interactive card hover affordance (for linked cards). */
export const CARD_HOVER =
  "transition-all duration-200 hover:border-[#0B5FD1]/30 hover:shadow-md hover:shadow-[#0B5FD1]/5";

/** Uppercase section eyebrow / column label. */
export const EYEBROW =
  "text-[11px] font-semibold text-slate-400 uppercase tracking-[0.14em]";

/** Large metric figure — tabular mono per platform design guidelines. */
export const FIGURE =
  "font-mono tabular-nums tracking-tight font-bold text-slate-900";
