import type { Metadata } from "next";
import Link from "next/link";
import { Calculator, ArrowRight } from "lucide-react";

import { buildPageMetadata } from "@/lib/seo/metadata";
import { JsonLd, breadcrumbSchema } from "@/lib/seo/jsonld";

export const metadata: Metadata = buildPageMetadata({
  title: "Free Car Buying Tools | AutoLenis",
  description:
    "Free tools to help you buy your next car with confidence. Check dealer fees against your state's rules, spot markup, and know what's negotiable — all 50 states.",
  path: "/tools",
  keywords: ["car buying tools", "dealer fee calculator", "car buying calculator"],
});

const TOOLS = [
  {
    href: "/tools/dealer-fee-calculator",
    icon: Calculator,
    title: "Dealer Fee Calculator",
    description:
      "Enter any dealer fee and find out if it's required by your state's law, negotiable, or pure markup. Works for all 50 states.",
    badge: "Most Popular",
  },
];

export default function ToolsIndexPage() {
  return (
    <>
      <JsonLd
        id="tools-breadcrumb"
        data={breadcrumbSchema([
          { name: "Home", path: "/" },
          { name: "Tools", path: "/tools" },
        ])}
      />

      <section className="bg-[#F8F9FB] pt-28 pb-16 md:pt-32">
        <div className="mx-auto max-w-4xl px-6">
          <p className="text-xs font-semibold uppercase tracking-widest text-[#0B5FD1]">
            Free Buyer Tools
          </p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            Tools to help you buy smarter
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-slate-600">
            Free, no-signup tools built to give car buyers the same leverage
            dealers have. Know what a fee really is, what&apos;s negotiable, and
            what to push back on — before you ever sit down at the table.
          </p>
        </div>
      </section>

      <section className="bg-white pb-20">
        <div className="mx-auto max-w-4xl px-6">
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            {TOOLS.map((tool) => {
              const Icon = tool.icon;
              return (
                <Link
                  key={tool.href}
                  href={tool.href}
                  className="group relative rounded-2xl border border-slate-200 bg-white p-6 transition-shadow hover:shadow-md"
                >
                  {tool.badge && (
                    <span className="absolute right-4 top-4 rounded-full bg-[#0B5FD1]/10 px-2.5 py-1 text-xs font-semibold text-[#0B5FD1]">
                      {tool.badge}
                    </span>
                  )}
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#0B5FD1]/10 text-[#0B5FD1]">
                    <Icon size={22} />
                  </div>
                  <h2 className="mt-4 text-lg font-bold text-slate-900">
                    {tool.title}
                  </h2>
                  <p className="mt-2 text-sm leading-relaxed text-slate-600">
                    {tool.description}
                  </p>
                  <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-[#0B5FD1]">
                    Open tool{" "}
                    <ArrowRight
                      size={15}
                      className="transition-transform group-hover:translate-x-0.5"
                    />
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      </section>
    </>
  );
}
