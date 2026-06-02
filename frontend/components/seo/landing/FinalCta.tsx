// Server Component. Repeated, benefit-led closing CTA. Jumps back to the hero
// form anchor (#request) rather than duplicating the form.

import Link from "next/link";
import { ArrowRight } from "lucide-react";

interface FinalCtaProps {
  headline?: string;
  sub?: string;
  ctaLabel?: string;
}

export default function FinalCta({
  headline = "Let dealers compete for your business",
  sub = "Submit one free request. Compare written offers from home. Choose the deal that's right for you — no showrooms, no pressure.",
  ctaLabel = "Start My Free Car Request",
}: FinalCtaProps) {
  return (
    <section className="bg-slate-900 py-16 text-white md:py-20">
      <div className="mx-auto max-w-3xl px-6 text-center md:px-12">
        <h2 className="text-2xl font-bold sm:text-3xl">{headline}</h2>
        <p className="mx-auto mt-4 max-w-2xl text-slate-300">{sub}</p>
        <Link
          href="#request"
          data-testid="final-cta"
          className="mt-8 inline-flex min-h-[52px] items-center justify-center gap-2 rounded-lg bg-[#0B5FD1] px-8 py-3.5 text-base font-bold text-white shadow-lg shadow-[#0B5FD1]/30 transition-colors hover:bg-[#0944a8]"
        >
          {ctaLabel} <ArrowRight size={18} />
        </Link>
      </div>
    </section>
  );
}
