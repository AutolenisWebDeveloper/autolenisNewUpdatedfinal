import type { Metadata } from "next";
import Link from "next/link";

import { buildPageMetadata } from "@/lib/seo/metadata";
import { getGuideContent } from "@/lib/leads/honest-guide-content";
import { getLeadMagnet } from "@/lib/leads/lead-magnets";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

// Gated deliverable — never indexed. Reached only via the capture form or the
// delivery email link.
export const metadata: Metadata = buildPageMetadata({
  title: "Your Free Guide — AutoLenis",
  description: "Your AutoLenis car buying guide is ready to read.",
  path: "/guide/thank-you",
  noindex: true,
});

function pickSlug(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "honest-guide";
  return value ?? "honest-guide";
}

export default async function GuideThankYouPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const slug = pickSlug(params.m);
  const magnet = getLeadMagnet(slug);
  const guide = getGuideContent(magnet.slug);

  return (
    <article className="bg-white">
      <section className="bg-[#F8F9FB] pt-28 pb-12 md:pt-32">
        <div className="mx-auto max-w-3xl px-6">
          <p className="text-xs font-semibold uppercase tracking-widest text-[#0B5FD1]">
            Your free guide
          </p>
          <h1 className="mt-3 text-3xl font-bold leading-tight tracking-tight text-slate-900 sm:text-4xl">
            {guide.title}
          </h1>
          <p className="mt-4 text-base leading-relaxed text-slate-600">
            {guide.intro}
          </p>
          <p className="mt-4 text-sm text-slate-500">
            A copy is also on its way to your inbox. By{" "}
            <Link
              href="/author/markist"
              className="font-semibold text-[#0B5FD1] hover:underline"
            >
              Markist, Founder of AutoLenis
            </Link>
            .
          </p>
        </div>
      </section>

      <section className="bg-white py-12">
        <div className="mx-auto max-w-3xl space-y-10 px-6">
          {guide.sections.map((section) => (
            <div key={section.heading}>
              <h2 className="text-2xl font-bold text-slate-900">
                {section.heading}
              </h2>
              {section.body.map((p, i) => (
                <p
                  key={i}
                  className="mt-3 text-base leading-relaxed text-slate-600"
                >
                  {p}
                </p>
              ))}
              {section.points && (
                <ul className="mt-4 space-y-2">
                  {section.points.map((pt) => (
                    <li
                      key={pt}
                      className="flex items-start gap-3 text-base leading-relaxed text-slate-700"
                    >
                      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#0B5FD1]" />
                      <span>{pt}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}

          <div className="rounded-2xl bg-[#0B5FD1] p-8 text-center">
            <h2 className="text-xl font-bold text-white">
              Ready to put this into practice?
            </h2>
            <p className="mx-auto mt-2 max-w-lg text-sm text-blue-100">
              Let up to 8 local dealers compete for your business in a private
              48-hour auction. Compare real out-the-door prices and pick the
              best one.
            </p>
            <Link
              href="/request-a-car"
              className="mt-5 inline-flex items-center gap-2 rounded-xl bg-white px-7 py-3 text-sm font-semibold text-[#0B5FD1] transition-colors hover:bg-blue-50"
            >
              Get Dealers to Compete
            </Link>
          </div>

          <div className="text-center">
            <Link
              href="/buying-guide"
              className="text-sm font-semibold text-[#0B5FD1] hover:underline"
            >
              Explore more buying guides →
            </Link>
          </div>
        </div>
      </section>
    </article>
  );
}
