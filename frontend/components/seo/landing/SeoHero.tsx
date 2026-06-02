// Server Component. Above-the-fold conversion focus: H1, subhead, trust strip,
// and the (client) vehicle-request form. The hero image is the single LCP
// element on the page and is the ONLY image marked `priority`.

import Image from "next/image";
import { CheckCircle2 } from "lucide-react";
import type { FormSource } from "@/lib/seo/locations";
import VehicleRequestForm from "./VehicleRequestForm";

interface SeoHeroProps {
  h1: string;
  subhead: string;
  source: FormSource;
  heroImage: string;
  heroImageAlt: string;
  trustItems?: string[];
  /** Optional definition sentence that establishes the AutoLenis entity. */
  entityDefinition?: string;
}

const DEFAULT_TRUST = [
  "We represent you — not the dealer",
  "Dealers compete in a private reverse auction",
  "Zero dealer kickbacks · we never sell your data",
];

export default function SeoHero({
  h1,
  subhead,
  source,
  heroImage,
  heroImageAlt,
  trustItems = DEFAULT_TRUST,
  entityDefinition,
}: SeoHeroProps) {
  return (
    <section id="top" className="relative overflow-hidden bg-slate-900 text-white">
      {/* Background hero image — single LCP element, priority-loaded. */}
      <div className="absolute inset-0">
        <Image
          src={heroImage}
          alt={heroImageAlt}
          fill
          priority
          sizes="100vw"
          className="object-cover opacity-25"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-slate-900/80 via-slate-900/70 to-slate-900" />
      </div>

      <div className="relative mx-auto grid max-w-7xl grid-cols-1 gap-10 px-6 py-14 md:px-12 md:py-20 lg:grid-cols-2 lg:items-center">
        {/* Copy column */}
        <div>
          <h1 className="text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl md:text-5xl">
            {h1}
          </h1>
          <p className="mt-5 max-w-xl text-lg text-slate-200">{subhead}</p>

          {entityDefinition && (
            <p className="mt-4 max-w-xl text-sm leading-relaxed text-slate-300">
              {entityDefinition}
            </p>
          )}

          <ul className="mt-7 space-y-2.5">
            {trustItems.map((item) => (
              <li key={item} className="flex items-start gap-2.5 text-slate-100">
                <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-[#4DA3FF]" />
                <span className="text-sm sm:text-base">{item}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Conversion column — the form card, above the fold. #request anchor
            is the jump target for repeated CTAs lower on the page. */}
        <div id="request" className="scroll-mt-20 rounded-2xl bg-white p-6 shadow-2xl sm:p-8">
          <h2 className="text-xl font-bold text-slate-900">Start your free car request</h2>
          <p className="mt-1 text-sm text-slate-500">
            Tell us the vehicle you want. Dealers compete. You choose from home.
          </p>
          <div className="mt-5">
            <VehicleRequestForm source={source} />
          </div>
        </div>
      </div>
    </section>
  );
}
