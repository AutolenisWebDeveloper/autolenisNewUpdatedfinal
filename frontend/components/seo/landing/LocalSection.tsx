// Server Component. City-specific local content — the heart of doorway-page
// safety. Renders the genuinely unique per-city copy from SEO_LOCATIONS:
// intro, local market context, named local areas, and testimonial slots.

import { MapPin } from "lucide-react";
import type { SeoLocation } from "@/lib/seo/locations";

interface LocalSectionProps {
  location: SeoLocation;
}

export default function LocalSection({ location }: LocalSectionProps) {
  return (
    <section id="local" className="scroll-mt-20 bg-white py-16 md:py-20">
      <div className="mx-auto max-w-4xl px-6 md:px-12">
        <h2 className="text-2xl font-bold text-slate-900 sm:text-3xl">
          Car buying in {location.city}, {location.stateAbbr}
        </h2>

        <div className="mt-6 space-y-5 text-slate-700">
          <p className="leading-relaxed">{location.uniqueIntro}</p>
          <p className="leading-relaxed">{location.localContext}</p>
        </div>

        {/* Named local areas */}
        <div className="mt-8 rounded-xl border border-slate-200 bg-slate-50 p-6">
          <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
            <MapPin size={16} /> Serving {location.city} &amp; nearby areas
          </h3>
          <div className="mt-3 flex flex-wrap gap-2">
            {location.nearbyAreas.map((area) => (
              <span key={area} className="rounded-full bg-white px-3 py-1 text-sm text-slate-700 ring-1 ring-slate-200">
                {area}
              </span>
            ))}
          </div>
          <p className="mt-4 text-sm text-slate-500">
            Part of our {location.state} service area in the {location.metro} metro.
          </p>
        </div>

        {/* City testimonial section hidden until real, owner-confirmed
            testimonial data exists — never render placeholder slots. */}
      </div>
    </section>
  );
}
