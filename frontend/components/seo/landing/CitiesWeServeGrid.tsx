// Server Component. Visible grid of every market we serve, used on the state
// hub. Each card links to a city page with a one-line USP — this is the
// internal-linking backbone that distributes authority to the city pages.

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { SEO_LOCATIONS } from "@/lib/seo/locations";

// One-line USP per city (kept short; the full unique copy lives on each page).
const CITY_USP: Record<string, string> = {
  allen: "Dealers across DFW compete — skip the US-75 lot crawl.",
  arlington: "Two-sided competition from Dallas and Fort Worth dealers.",
  dallas: "Turn the metro's huge dealer pool into real leverage.",
  denton: "Metro-wide competition without the drive south.",
  "fort-worth": "Competitive truck and SUV pricing, delivered to you.",
  frisco: "Premium picks sourced metro-wide — our home market.",
  "little-elm": "Skip the trip to Frisco; dealers come to the lake.",
  mckinney: "Make Frisco, Allen and Plano dealers bid for you.",
  plano: "Precise requests, competing offers, minutes of your time.",
  prosper: "Premium SUVs sourced without leaving Prosper.",
};

export default function CitiesWeServeGrid() {
  return (
    <section id="cities" className="scroll-mt-20 bg-white py-16 md:py-20">
      <div className="mx-auto max-w-6xl px-6 md:px-12">
        <h2 className="text-2xl font-bold text-slate-900 sm:text-3xl">Cities we serve in Texas</h2>
        <p className="mt-3 max-w-2xl text-slate-600">
          AutoLenis serves buyers across the Dallas-Fort Worth metro. Choose your city for local
          details, or start your free request from anywhere in Texas.
        </p>

        <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {SEO_LOCATIONS.map((loc) => (
            <Link
              key={loc.slug}
              href={`/car-buying-service/${loc.slug}`}
              data-testid={`serve-city-${loc.slug}`}
              className="group flex items-start justify-between gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-colors hover:border-[#0B5FD1]"
            >
              <span>
                <span className="block text-lg font-semibold text-slate-900">
                  {loc.city}, {loc.stateAbbr}
                </span>
                <span className="mt-1 block text-sm text-slate-500">
                  {CITY_USP[loc.slug] ?? ""}
                </span>
              </span>
              <ArrowRight size={18} className="mt-1 shrink-0 text-slate-300 transition-colors group-hover:text-[#0B5FD1]" />
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
