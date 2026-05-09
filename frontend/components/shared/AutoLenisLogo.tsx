// Shared AutoLenis logo component — Logo 1 rebrand (blue + silver, three-stripe mark).
// Variant "dark"  = on light backgrounds (sidebars, card pages).
// Variant "light" = on dark backgrounds (auth hero panels).
// The "purple" variant is retired; all former usages have been migrated to "dark".

import Link from "next/link";

type LogoVariant = "dark" | "light";
type LogoSize = "xs" | "sm" | "md" | "lg";

const SIZE_MAP: Record<LogoSize, { iconH: number; text: string; subtitleText: string }> = {
  xs: { iconH: 22, text: "text-xs",   subtitleText: "text-[9px]"  },
  sm: { iconH: 28, text: "text-sm",   subtitleText: "text-[10px]" },
  md: { iconH: 32, text: "text-base", subtitleText: "text-[11px]" },
  lg: { iconH: 40, text: "text-lg",   subtitleText: "text-xs"     },
};

interface AutoLenisLogoProps {
  size?: LogoSize;
  variant?: LogoVariant;
  showText?: boolean;
  href?: string;
  className?: string;
  subtitle?: string;
  testId?: string;
}

/**
 * Three-stripe icon mark: silver parallelogram + electric-blue + dark-charcoal.
 * ViewBox 58×50. Width is derived from height to maintain aspect ratio.
 */
function StripeMark({ height }: { height: number }) {
  const w = Math.round((height * 58) / 50);
  return (
    <svg
      width={w}
      height={height}
      viewBox="0 0 58 50"
      fill="none"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      <defs>
        {/* Silver / metallic — left stripe */}
        <linearGradient id="al-silver" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%"   stopColor="#8B95A5" />
          <stop offset="38%"  stopColor="#D6DAE0" />
          <stop offset="58%"  stopColor="#F0F2F5" />
          <stop offset="100%" stopColor="#8B95A5" />
        </linearGradient>
        {/* Electric blue — middle stripe */}
        <linearGradient id="al-blue" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%"   stopColor="#0A4DB8" />
          <stop offset="48%"  stopColor="#4DA3FF" />
          <stop offset="100%" stopColor="#0B5FD1" />
        </linearGradient>
        {/* Charcoal — right stripe */}
        <linearGradient id="al-dark" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%"   stopColor="#2D3748" />
          <stop offset="50%"  stopColor="#4B5563" />
          <stop offset="100%" stopColor="#1F2937" />
        </linearGradient>
      </defs>
      {/* Left stripe — silver/metallic (widest) */}
      <polygon points="1,48 14,48 32,2 19,2" fill="url(#al-silver)" />
      {/* Middle stripe — electric blue */}
      <polygon points="18,48 27,48 45,2 36,2" fill="url(#al-blue)" />
      {/* Right stripe — dark charcoal (narrowest) */}
      <polygon points="31,48 38,48 56,2 49,2" fill="url(#al-dark)" />
    </svg>
  );
}

/**
 * Single-source AutoLenis logo. Update StripeMark or colors here to propagate
 * everywhere (nav, sidebars, auth pages, footer, etc.).
 */
export function AutoLenisLogo({
  size = "md",
  variant = "dark",
  showText = true,
  href,
  className = "",
  subtitle,
  testId = "autolenis-logo",
}: AutoLenisLogoProps) {
  const s = SIZE_MAP[size];
  const isLight = variant === "light";

  const autoColor  = isLight ? "#CBD5E1" : "#374151";
  const lenisColor = isLight ? "#4DA3FF" : "#0B5FD1";
  const subtitleColor = isLight ? "text-white/60" : "text-slate-400";

  const content = (
    <div className={`flex items-center gap-2.5 ${className}`} data-testid={testId}>
      <StripeMark height={s.iconH} />
      {showText && (
        <div className="flex flex-col leading-none">
          <span className={`font-bold tracking-tight ${s.text}`}>
            <span style={{ color: autoColor }}>Auto</span>
            <span style={{ color: lenisColor }}>Lenis</span>
          </span>
          {subtitle && (
            <span className={`${s.subtitleText} mt-0.5 ${subtitleColor}`}>
              {subtitle}
            </span>
          )}
        </div>
      )}
    </div>
  );

  if (href) {
    return (
      <Link href={href} aria-label="AutoLenis home" className="inline-flex">
        {content}
      </Link>
    );
  }
  return content;
}

export default AutoLenisLogo;
