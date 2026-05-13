"use client";

// Sticky CTA that appears after the user scrolls past the hero.
// Catches buyers who didn't click the primary hero CTA on first view.

import { useEffect, useState } from "react";
import Link from "next/link";

interface ScrollCTAProps {
  headline: string;
  cta: string;
  href: string;
  showAfterPx?: number;
}

export default function ScrollCTA({
  headline,
  cta,
  href,
  showAfterPx = 600,
}: ScrollCTAProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const handler = () => setVisible(window.scrollY > showAfterPx);
    window.addEventListener("scroll", handler, { passive: true });
    return () => window.removeEventListener("scroll", handler);
  }, [showAfterPx]);

  return (
    <div
      className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-40 transition-all duration-300 ${
        visible
          ? "opacity-100 translate-y-0"
          : "opacity-0 translate-y-4 pointer-events-none"
      }`}
    >
      <div className="bg-[#0B5FD1] text-white rounded-2xl px-5 py-3 shadow-2xl flex items-center gap-4">
        <span className="text-sm font-medium hidden sm:block">{headline}</span>
        <Link
          href={href}
          className="bg-white text-[#0B5FD1] font-bold text-sm px-4 py-2 rounded-xl hover:bg-blue-50 whitespace-nowrap"
          data-funnel-stage="bofu"
          data-cta="scroll-sticky"
        >
          {cta}
        </Link>
      </div>
    </div>
  );
}
