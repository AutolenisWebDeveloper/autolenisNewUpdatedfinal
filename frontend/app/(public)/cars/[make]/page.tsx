import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import {
  JsonLd,
  breadcrumbSchema,
  itemListSchema,
  aggregateOfferSchema,
  localBusinessSchema,
} from "@/lib/seo/jsonld";
import { buildPageMetadata } from "@/lib/seo/metadata";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";
export const revalidate = 3600;

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "https://autolenis.com").trim();

// --- Slug helpers ----------------------------------------------------------

function slugify(value: string): string {
  return value.toLowerCase().trim().replace(/\s+/g, "-");
}

function toTitle(slug: string): string {
  return slug.replace(/-/g, " ").replace(/\b\w/g, l => l.toUpperCase());
}

// --- Category catalog ------------------------------------------------------

interface CategoryDefinition {
  title: string;
  description: string;
  filter: { bodyType?: string; maxPriceCents?: number };
  keywords: string[];
}

const CATEGORIES: Record<string, CategoryDefinition> = {
  "suv": {
    title: "Used SUVs for Sale",
    description: "Browse SUV inventory and let dealers compete for your business. Soft-pull prequalification. Your $99 service fee is refundable if no dealer offers are received within 72 hours.",
    filter: { bodyType: "SUV" },
    keywords: ["used SUVs", "SUVs for sale", "SUV best price", "buy SUV online"],
  },
  "trucks": {
    title: "Used Trucks for Sale",
    description: "Browse truck inventory and let dealers compete for your business. Soft-pull prequalification. Your $99 service fee is refundable if no dealer offers are received within 72 hours.",
    filter: { bodyType: "Truck" },
    keywords: ["used trucks", "trucks for sale", "truck best price", "buy truck online"],
  },
  "sedans": {
    title: "Used Sedans for Sale",
    description: "Browse sedan inventory and let dealers compete for your business. Soft-pull prequalification. Your $99 service fee is refundable if no dealer offers are received within 72 hours.",
    filter: { bodyType: "Sedan" },
    keywords: ["used sedans", "sedans for sale", "sedan best price", "buy sedan online"],
  },
  "under-25000": {
    title: "Used Cars Under $25,000",
    description: "Browse vehicles under $25,000 and let dealers compete for your business. No haggle. Soft-pull prequalification. Your $99 service fee is refundable if no dealer offers are received within 72 hours.",
    filter: { maxPriceCents: 2500000 },
    keywords: ["used cars under 25000", "cars under $25k", "affordable used cars"],
  },
  "under-30000": {
    title: "Used Cars Under $30,000",
    description: "Browse vehicles under $30,000 and let dealers compete for your business. No haggle. Soft-pull prequalification. Your $99 service fee is refundable if no dealer offers are received within 72 hours.",
    filter: { maxPriceCents: 3000000 },
    keywords: ["used cars under 30000", "cars under $30k"],
  },
  "under-40000": {
    title: "Used Cars Under $40,000",
    description: "Browse vehicles under $40,000 and let dealers compete for your business. No haggle. Soft-pull prequalification. Your $99 service fee is refundable if no dealer offers are received within 72 hours.",
    filter: { maxPriceCents: 4000000 },
    keywords: ["used cars under 40000", "cars under $40k"],
  },
};

// --- US state slug map -----------------------------------------------------

const STATE_SLUG_TO_NAME: Record<string, { name: string; abbr: string }> = {
  "alabama": { name: "Alabama", abbr: "AL" }, "alaska": { name: "Alaska", abbr: "AK" },
  "arizona": { name: "Arizona", abbr: "AZ" }, "arkansas": { name: "Arkansas", abbr: "AR" },
  "california": { name: "California", abbr: "CA" }, "colorado": { name: "Colorado", abbr: "CO" },
  "connecticut": { name: "Connecticut", abbr: "CT" }, "delaware": { name: "Delaware", abbr: "DE" },
  "florida": { name: "Florida", abbr: "FL" }, "georgia": { name: "Georgia", abbr: "GA" },
  "hawaii": { name: "Hawaii", abbr: "HI" }, "idaho": { name: "Idaho", abbr: "ID" },
  "illinois": { name: "Illinois", abbr: "IL" }, "indiana": { name: "Indiana", abbr: "IN" },
  "iowa": { name: "Iowa", abbr: "IA" }, "kansas": { name: "Kansas", abbr: "KS" },
  "kentucky": { name: "Kentucky", abbr: "KY" }, "louisiana": { name: "Louisiana", abbr: "LA" },
  "maine": { name: "Maine", abbr: "ME" }, "maryland": { name: "Maryland", abbr: "MD" },
  "massachusetts": { name: "Massachusetts", abbr: "MA" }, "michigan": { name: "Michigan", abbr: "MI" },
  "minnesota": { name: "Minnesota", abbr: "MN" }, "mississippi": { name: "Mississippi", abbr: "MS" },
  "missouri": { name: "Missouri", abbr: "MO" }, "montana": { name: "Montana", abbr: "MT" },
  "nebraska": { name: "Nebraska", abbr: "NE" }, "nevada": { name: "Nevada", abbr: "NV" },
  "new-hampshire": { name: "New Hampshire", abbr: "NH" }, "new-jersey": { name: "New Jersey", abbr: "NJ" },
  "new-mexico": { name: "New Mexico", abbr: "NM" }, "new-york": { name: "New York", abbr: "NY" },
  "north-carolina": { name: "North Carolina", abbr: "NC" }, "north-dakota": { name: "North Dakota", abbr: "ND" },
  "ohio": { name: "Ohio", abbr: "OH" }, "oklahoma": { name: "Oklahoma", abbr: "OK" },
  "oregon": { name: "Oregon", abbr: "OR" }, "pennsylvania": { name: "Pennsylvania", abbr: "PA" },
  "rhode-island": { name: "Rhode Island", abbr: "RI" }, "south-carolina": { name: "South Carolina", abbr: "SC" },
  "south-dakota": { name: "South Dakota", abbr: "SD" }, "tennessee": { name: "Tennessee", abbr: "TN" },
  "texas": { name: "Texas", abbr: "TX" }, "utah": { name: "Utah", abbr: "UT" },
  "vermont": { name: "Vermont", abbr: "VT" }, "virginia": { name: "Virginia", abbr: "VA" },
  "washington": { name: "Washington", abbr: "WA" }, "west-virginia": { name: "West Virginia", abbr: "WV" },
  "wisconsin": { name: "Wisconsin", abbr: "WI" }, "wyoming": { name: "Wyoming", abbr: "WY" },
};

const STATE_ABBR_SET = new Set(Object.values(STATE_SLUG_TO_NAME).map(s => s.abbr.toLowerCase()));

// City slug looks like "dallas-tx" — last two chars are a state abbr
function parseCitySlug(slug: string): { city: string; stateAbbr: string } | null {
  const idx = slug.lastIndexOf("-");
  if (idx <= 0) return null;
  const tail = slug.slice(idx + 1).toLowerCase();
  if (tail.length !== 2 || !STATE_ABBR_SET.has(tail)) return null;
  const cityPart = slug.slice(0, idx);
  return { city: toTitle(cityPart), stateAbbr: tail.toUpperCase() };
}

// --- Static params ---------------------------------------------------------

export async function generateStaticParams() {
  // If the DB is reachable at build time, prerender categories + known
  // makes/states. Otherwise return [] and let pages render on-demand under
  // the `revalidate = 3600` ISR contract.
  try {
    const rows = await prisma.inventoryItem.findMany({
      where: { isActive: true },
      select: { make: true, state: true },
      take: 5000,
    });

    const params: Array<{ make: string }> = [];
    for (const k of Object.keys(CATEGORIES)) params.push({ make: k });

    const makes = new Set<string>();
    const states = new Set<string>();
    for (const r of rows) {
      if (r.make) makes.add(slugify(r.make));
      if (r.state) {
        const abbr = r.state.toLowerCase();
        for (const [slug, info] of Object.entries(STATE_SLUG_TO_NAME)) {
          if (info.abbr.toLowerCase() === abbr || slug === abbr) {
            states.add(slug);
            break;
          }
        }
      }
    }
    for (const m of makes) if (!CATEGORIES[m]) params.push({ make: m });
    for (const s of states) params.push({ make: s });
    return params;
  } catch {
    return [];
  }
}

// --- Page ------------------------------------------------------------------

interface Props {
  params: Promise<{ make: string }>;
}

type ResolvedKind =
  | { kind: "category"; slug: string; def: CategoryDefinition }
  | { kind: "state"; slug: string; name: string; abbr: string }
  | { kind: "city"; slug: string; city: string; stateAbbr: string }
  | { kind: "make"; slug: string; name: string };

async function resolveSlug(slug: string): Promise<ResolvedKind | null> {
  const lower = slug.toLowerCase();

  // 1. Category
  if (CATEGORIES[lower]) {
    return { kind: "category", slug: lower, def: CATEGORIES[lower] };
  }

  // 2. State
  if (STATE_SLUG_TO_NAME[lower]) {
    const info = STATE_SLUG_TO_NAME[lower];
    return { kind: "state", slug: lower, name: info.name, abbr: info.abbr };
  }

  // 3. City (slug like "dallas-tx")
  const city = parseCitySlug(lower);
  if (city) {
    return { kind: "city", slug: lower, city: city.city, stateAbbr: city.stateAbbr };
  }

  // 4. Make
  try {
    const makeName = toTitle(lower);
    const found = await prisma.inventoryItem.findFirst({
      where: { isActive: true, make: { equals: makeName, mode: "insensitive" } },
      select: { make: true },
    });
    if (found) return { kind: "make", slug: lower, name: found.make };
  } catch {
    // ignore
  }

  return null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { make: slug } = await params;
  const resolved = await resolveSlug(slug);
  if (!resolved) return { title: "Page Not Found" };

  if (resolved.kind === "category") {
    return buildPageMetadata({
      title: `${resolved.def.title} — Let Dealers Compete`,
      description: resolved.def.description,
      path: `/cars/${slug}`,
      keywords: resolved.def.keywords,
    });
  }
  if (resolved.kind === "state") {
    return buildPageMetadata({
      title: `Used Cars in ${resolved.name} — Let Dealers Compete`,
      description: `Browse used vehicles in ${resolved.name}. Let dealers compete for your business in a private 48-hour auction. No haggle, no pressure.`,
      path: `/cars/${slug}`,
      keywords: [`used cars ${resolved.name}`, `cars for sale ${resolved.name}`, `no haggle car buying ${resolved.name}`],
    });
  }
  if (resolved.kind === "city") {
    return buildPageMetadata({
      title: `Used Cars in ${resolved.city}, ${resolved.stateAbbr} — Let Dealers Compete`,
      description: `Browse used vehicles in ${resolved.city}, ${resolved.stateAbbr}. Let dealers compete for your business. Soft-pull prequalification. Your $99 service fee is refundable if no dealer offers are received within 72 hours.`,
      path: `/cars/${slug}`,
      keywords: [
        `used cars ${resolved.city} ${resolved.stateAbbr}`,
        `cars for sale ${resolved.city}`,
        `no haggle car buying ${resolved.city} ${resolved.stateAbbr}`,
      ],
    });
  }
  // make
  return buildPageMetadata({
    title: `Used ${resolved.name} for Sale — All Models`,
    description: `Browse all ${resolved.name} models on AutoLenis. Let dealers compete for your business. Soft-pull prequalification. Your $99 service fee is refundable if no dealer offers are received within 72 hours.`,
    path: `/cars/${slug}`,
    keywords: [`used ${resolved.name}`, `${resolved.name} for sale`, `buy ${resolved.name} online`],
  });
}

interface VehicleRow {
  id: string;
  year: number;
  make: string;
  model: string;
  trim: string | null;
  priceCents: number;
  mileage: number | null;
  city: string | null;
  state: string | null;
  images: string[];
}

export default async function CarsSlugPage({ params }: Props) {
  const { make: slug } = await params;
  const resolved = await resolveSlug(slug);
  if (!resolved) notFound();

  // Build prisma where clause based on resolved kind
  const where: Prisma.InventoryItemWhereInput = { isActive: true };
  let pageTitle = "";
  let pageDescription = "";
  const breadcrumbCrumbs: Array<{ name: string; path?: string }> = [
    { name: "Inventory", path: "/inventory" },
  ];
  // Internal cross-links shown at the bottom of the page
  let crossLinks: Array<{ label: string; href: string }> = [];

  if (resolved.kind === "category") {
    if (resolved.def.filter.bodyType) {
      where.bodyType = { equals: resolved.def.filter.bodyType, mode: "insensitive" };
    }
    if (resolved.def.filter.maxPriceCents) {
      where.priceCents = { lte: resolved.def.filter.maxPriceCents };
    }
    pageTitle = resolved.def.title;
    pageDescription = resolved.def.description;
    breadcrumbCrumbs.push({ name: resolved.def.title });
  } else if (resolved.kind === "state") {
    where.state = { equals: resolved.abbr, mode: "insensitive" };
    pageTitle = `Used Cars in ${resolved.name}`;
    pageDescription = `Browse used vehicles available in ${resolved.name}. Let dealers compete for your business — no negotiation needed.`;
    breadcrumbCrumbs.push({ name: resolved.name });
  } else if (resolved.kind === "city") {
    where.city = { equals: resolved.city, mode: "insensitive" };
    where.state = { equals: resolved.stateAbbr, mode: "insensitive" };
    pageTitle = `Used Cars in ${resolved.city}, ${resolved.stateAbbr}`;
    pageDescription = `Browse used vehicles in ${resolved.city}, ${resolved.stateAbbr}. Let dealers compete for your business in a private 48-hour auction.`;
    breadcrumbCrumbs.push({ name: `${resolved.city}, ${resolved.stateAbbr}` });
  } else {
    where.make = { equals: resolved.name, mode: "insensitive" };
    pageTitle = `Used ${resolved.name} for Sale`;
    pageDescription = `Browse all ${resolved.name} models. Let dealers compete for your business — no negotiation needed.`;
    breadcrumbCrumbs.push({ name: resolved.name });
  }

  const vehicles: VehicleRow[] = await prisma.inventoryItem.findMany({
    where,
    select: {
      id: true, year: true, make: true, model: true, trim: true,
      priceCents: true, mileage: true, city: true, state: true, images: true,
    },
    orderBy: { priceCents: "asc" },
    take: 24,
  });

  if (vehicles.length === 0) notFound();

  // Build cross-links for internal SEO
  if (resolved.kind === "make") {
    // List models for this make
    const models = await prisma.inventoryItem.findMany({
      where: { isActive: true, make: { equals: resolved.name, mode: "insensitive" } },
      select: { model: true },
      distinct: ["model"],
      take: 24,
    });
    crossLinks = models.map(m => ({
      label: `${resolved.name} ${m.model}`,
      href: `/cars/${slug}/${slugify(m.model)}`,
    }));
  } else if (resolved.kind === "state" || resolved.kind === "city") {
    // Top makes within this region
    const makes = await prisma.inventoryItem.findMany({
      where,
      select: { make: true },
      distinct: ["make"],
      take: 12,
    });
    crossLinks = makes.map(m => ({
      label: `${m.make} listings`,
      href: `/cars/${slugify(m.make)}`,
    }));
  } else {
    // Categories: link to top makes within the filter
    const makes = await prisma.inventoryItem.findMany({
      where,
      select: { make: true },
      distinct: ["make"],
      take: 12,
    });
    crossLinks = makes.map(m => ({
      label: `${m.make}`,
      href: `/cars/${slugify(m.make)}`,
    }));
  }

  const totalPrice = vehicles.reduce((s, v) => s + v.priceCents, 0);
  const avgPrice = Math.round(totalPrice / vehicles.length);
  const minPrice = Math.min(...vehicles.map(v => v.priceCents));
  const maxPrice = Math.max(...vehicles.map(v => v.priceCents));

  const breadcrumbs = breadcrumbSchema(breadcrumbCrumbs);
  const itemList = itemListSchema({
    name: pageTitle,
    items: vehicles.map(v => ({
      url: `${APP_URL}/inventory/${v.id}`,
      name: `${v.year} ${v.make} ${v.model}${v.trim ? ` ${v.trim}` : ""}`,
    })),
  });
  const aggregate = aggregateOfferSchema({
    name: pageTitle,
    offerCount: vehicles.length,
    lowPriceCents: minPrice,
    highPriceCents: maxPrice,
  });

  return (
    <div className="min-h-screen bg-[#F8F9FB]">
      <JsonLd id="ld-breadcrumb" data={breadcrumbs} />
      <JsonLd id="ld-itemlist" data={itemList} />
      <JsonLd id="ld-aggregate-offer" data={aggregate} />
      {(resolved.kind === "state" || resolved.kind === "city") && (
        <JsonLd id="ld-localbusiness" data={localBusinessSchema()} />
      )}

      <section className="bg-white border-b border-[#E5E7EB] py-12 px-6">
        <div className="max-w-5xl mx-auto">
          <nav className="text-xs text-[#94A3B8] mb-4 flex items-center gap-1.5">
            <Link href="/inventory" className="hover:text-[#0B5FD1]">Inventory</Link>
            <span>›</span>
            <span className="text-[#111827] font-medium">{breadcrumbCrumbs[breadcrumbCrumbs.length - 1].name}</span>
          </nav>

          <h1 className="text-3xl md:text-4xl font-bold text-[#111827] tracking-tight mb-3">
            {pageTitle}
          </h1>
          <p className="text-[#4B5563] text-lg mb-6 max-w-2xl">
            {pageDescription} Starting from ${(minPrice / 100).toLocaleString("en-US")}.
          </p>

          <div className="flex flex-wrap gap-4 text-sm">
            <div className="bg-[#EFF6FF] border border-[#DBEAFE] rounded-xl px-4 py-2">
              <span className="text-[#6B7280]">Avg price:</span>{" "}
              <span className="font-bold text-[#0B5FD1]">
                ${(avgPrice / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}
              </span>
            </div>
            <div className="bg-[#EFF6FF] border border-[#DBEAFE] rounded-xl px-4 py-2">
              <span className="text-[#6B7280]">Available:</span>{" "}
              <span className="font-bold text-[#0B5FD1]">{vehicles.length} {vehicles.length === 1 ? "listing" : "listings"}</span>
            </div>
          </div>
        </div>
      </section>

      <section className="max-w-5xl mx-auto px-6 py-10">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {vehicles.map(v => {
            const firstImage = Array.isArray(v.images) && v.images.length > 0 ? v.images[0] : null;
            return (
              <Link
                key={v.id}
                href={`/inventory/${v.id}`}
                className="bg-white border border-[#E5E7EB] rounded-2xl overflow-hidden hover:border-[#BFDBFE] hover:shadow-md transition-all group"
              >
                <div className="aspect-video bg-[#F4F6FA] overflow-hidden">
                  {firstImage ? (
                    <img
                      src={firstImage}
                      alt={`${v.year} ${v.make} ${v.model}`}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      loading="lazy"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-[#D1D5DB]">
                      <svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                        <path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z" />
                      </svg>
                    </div>
                  )}
                </div>
                <div className="p-4">
                  <p className="font-bold text-[#111827] text-sm leading-tight">
                    {v.year} {v.make} {v.model}{v.trim ? ` ${v.trim}` : ""}
                  </p>
                  <p className="text-xs text-[#94A3B8] mt-0.5">
                    {v.mileage ? `${v.mileage.toLocaleString("en-US")} mi` : "Mileage N/A"}
                    {v.city && v.state ? ` · ${v.city}, ${v.state}` : ""}
                  </p>
                  <p className="text-[#0B5FD1] font-bold text-lg mt-2 font-mono">
                    ${(v.priceCents / 100).toLocaleString("en-US")}
                  </p>
                </div>
              </Link>
            );
          })}
        </div>

        {crossLinks.length > 0 && (
          <div className="mt-10 bg-white border border-[#E5E7EB] rounded-2xl p-6">
            <h2 className="text-sm font-bold uppercase tracking-wider text-[#94A3B8] mb-4">
              {resolved.kind === "make" ? `Browse ${resolved.name} models` : "Popular makes"}
            </h2>
            <div className="flex flex-wrap gap-2">
              {crossLinks.map(link => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="px-4 py-2 bg-[#F8F9FB] border border-[#E5E7EB] rounded-full text-sm text-[#374151] hover:border-[#BFDBFE] hover:bg-[#EFF6FF] hover:text-[#0B5FD1] transition-colors"
                >
                  {link.label}
                </Link>
              ))}
            </div>
          </div>
        )}

        <div className="mt-10 bg-[#0B5FD1] rounded-2xl p-8 text-center text-white">
          <h2 className="text-2xl font-bold mb-2">Get the Best Price — No Negotiation</h2>
          <p className="text-white/80 mb-6">
            Get prequalified in 3 minutes. Let dealers compete. No high-pressure sales.
          </p>
          <Link
            href="/auth/signup"
            className="inline-flex items-center gap-2 px-8 py-4 bg-white text-[#0B5FD1] font-bold rounded-xl hover:bg-[#EFF6FF] transition-colors"
          >
            Get Prequalified — It&apos;s Free
          </Link>
        </div>
      </section>
    </div>
  );
}
