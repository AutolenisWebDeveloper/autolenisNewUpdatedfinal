// Server Component. "Also serving nearby" — 3–5 closest other cities computed
// via haversine distance. Internal-linking architecture for the city pages.

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { nearestLocations, haversineMiles, getLocationBySlug } from "@/lib/seo/locations";

interface NearbyCitiesGridProps {
  slug: string;
  count?: number;
}

export default function NearbyCitiesGrid({ slug, count = 4 }: NearbyCitiesGridProps) {
  const origin = getLocationBySlug(slug);
  const nearby = nearestLocations(slug, count);
  if (!origin || nearby.length === 0) return null;

  return (
    <section id="nearby" className="scroll-mt-20 bg-slate-50 py-14 md:py-16">
      <div className="mx-auto max-w-5xl px-6 md:px-12">
        <h2 className="text-xl font-bold text-slate-900 sm:text-2xl">Also serving nearby</h2>
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {nearby.map((loc) => {
            const miles = Math.round(haversineMiles(origin, loc));
            return (
              <Link
                key={loc.slug}
                href={`/car-buying-service/${loc.slug}`}
                data-testid={`nearby-city-${loc.slug}`}
                className="group flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3 transition-colors hover:border-[#0B5FD1]"
              >
                <span>
                  <span className="block text-sm font-semibold text-slate-900">{loc.city}</span>
                  <span className="block text-xs text-slate-400">~{miles} mi</span>
                </span>
                <ArrowRight size={16} className="text-slate-300 transition-colors group-hover:text-[#0B5FD1]" />
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}
