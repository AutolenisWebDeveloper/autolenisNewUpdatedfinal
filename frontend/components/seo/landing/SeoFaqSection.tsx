// Server Component. Visible FAQ (maps to FAQPage JSON-LD built from the SAME
// items on the page — only render schema where the Q&A is visible).
// Uses native <details> so it is interactive with zero client JS.

import type { SeoFaqItem } from "./content";

interface SeoFaqSectionProps {
  faqs: SeoFaqItem[];
  heading?: string;
}

export default function SeoFaqSection({ faqs, heading = "Frequently asked questions" }: SeoFaqSectionProps) {
  return (
    <section id="faq" className="scroll-mt-20 bg-slate-50 py-16 md:py-20">
      <div className="mx-auto max-w-3xl px-6 md:px-12">
        <h2 className="text-2xl font-bold text-slate-900 sm:text-3xl">{heading}</h2>
        <div className="mt-8 divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
          {faqs.map((faq) => (
            <details key={faq.q} className="group px-6 py-5">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-base font-semibold text-slate-900">
                {faq.q}
                <span className="shrink-0 text-[#0B5FD1] transition-transform group-open:rotate-45" aria-hidden>+</span>
              </summary>
              <p className="mt-3 text-sm leading-relaxed text-slate-600">{faq.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
