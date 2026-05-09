// PublicLogo — temporary SVG logo until transparent PNG/SVG asset is delivered.
// Triple-chevron icon inspired by Logo 1 (chrome/blue direction).
// TODO: Replace with <img src="/autolenis-logo-transparent.png" ...> once asset arrives.
// See: https://github.com/AutolenisWebDeveloper/AutoLenisUpdate/issues (logo asset delivery)

import Link from "next/link";

interface PublicLogoProps {
  href?: string;
  className?: string;
  testId?: string;
}

export default function PublicLogo({ href, className = "", testId = "public-logo" }: PublicLogoProps) {
  const content = (
    <div
      className={`inline-flex items-center gap-2.5 select-none ${className}`}
      data-testid={testId}
      aria-label="AutoLenis"
    >
      {/* Triple-chevron SVG icon */}
      <svg
        width="32"
        height="32"
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        {/* Chevron 1 — muted */}
        <path
          d="M6 10 L11 16 L6 22"
          stroke="#94A3B8"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.5"
        />
        {/* Chevron 2 — medium */}
        <path
          d="M12 10 L17 16 L12 22"
          stroke="#5B8FE0"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.75"
        />
        {/* Chevron 3 — full accent blue */}
        <path
          d="M18 10 L24 16 L18 22"
          stroke="#0B5FD1"
          strokeWidth="2.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>

      {/* Wordmark */}
      <span
        className="font-bold uppercase leading-none tracking-[0.12em] text-base"
        style={{ fontFamily: "'Inter', 'Geist', system-ui, sans-serif" }}
      >
        <span style={{ color: "#94A3B8" }}>AUTO</span>
        <span style={{ color: "#0B5FD1" }}>LENIS</span>
      </span>
    </div>
  );

  if (href) {
    return (
      <Link href={href} aria-label="AutoLenis home" className="inline-flex focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0B5FD1] rounded-sm">
        {content}
      </Link>
    );
  }
  return content;
}
