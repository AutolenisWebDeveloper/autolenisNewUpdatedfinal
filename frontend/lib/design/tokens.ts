// Centralized design tokens for landing-page v2 surfaces.
// New components import from here instead of declaring hex/spacing inline.
// Existing v1 surfaces migrate in a future pass.

export const COLORS = {
  primary:      "#0B5FD1",
  primaryDeep:  "#0944a8",
  brandPurple:  "#643293",
  surface:      "#F8F9FB",
  surfaceMuted: "#F1F4F8",
  border:       "#E5E7EB",
  borderStrong: "#CBD5E1",
  textPrimary:  "#0F172A",
  textBody:     "#334155",
  textMuted:    "#64748B",
  textFaint:    "#94A3B8",
  success:      "#16A34A",
  danger:       "#DC2626",
  warning:      "#D97706",
} as const;

export const RADIUS = {
  sm:   "0.5rem",
  md:   "0.75rem",
  lg:   "1rem",
  xl:   "1.25rem",
  "2xl":"1.5rem",
  "3xl":"1.75rem",
  pill: "9999px",
} as const;

export const SPACE = {
  xs:   "0.25rem",
  sm:   "0.5rem",
  md:   "1rem",
  lg:   "1.5rem",
  xl:   "2rem",
  "2xl":"3rem",
  "3xl":"4rem",
  "4xl":"6rem",
} as const;

export const SHADOWS = {
  sm:   "0 1px 2px rgba(15,23,42,0.06)",
  md:   "0 4px 12px rgba(15,23,42,0.08)",
  lg:   "0 12px 32px rgba(15,23,42,0.10)",
  cta:  "0 8px 24px rgba(11,95,209,0.28)",
  hero: "0 24px 64px rgba(9,68,168,0.22)",
} as const;

export const TYPOGRAPHY = {
  hero:    "text-4xl sm:text-5xl md:text-6xl font-black leading-[1.05] tracking-tight",
  h1:      "text-3xl sm:text-4xl font-black tracking-tight",
  h2:      "text-2xl sm:text-3xl font-bold tracking-tight",
  h3:      "text-xl font-bold",
  body:    "text-base text-slate-700 leading-relaxed",
  bodySm:  "text-sm text-slate-600",
  bodyXs:  "text-xs text-slate-500",
  eyebrow: "text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400",
  mono:    "font-mono",
} as const;

export const CTA = {
  primary:
    "bg-[#0B5FD1] hover:bg-[#0944a8] text-white font-bold px-6 py-3 rounded-2xl transition-colors shadow-[0_8px_24px_rgba(11,95,209,0.28)]",
  primaryLg:
    "bg-[#0B5FD1] hover:bg-[#0944a8] text-white font-black text-base px-7 py-4 rounded-2xl transition-colors shadow-[0_12px_32px_rgba(11,95,209,0.32)]",
  ghost:
    "bg-white border border-slate-200 hover:border-[#0B5FD1] text-slate-700 hover:text-[#0B5FD1] font-semibold px-5 py-2.5 rounded-xl transition-colors",
  inverse:
    "bg-white text-[#0B5FD1] hover:bg-blue-50 font-black px-7 py-4 rounded-2xl transition-colors shadow-lg",
} as const;
