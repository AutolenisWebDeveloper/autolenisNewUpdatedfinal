import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { InventoryLane, Prisma } from "@prisma/client";
import { Suspense } from "react";
import InventorySearchClient from "@/components/public/InventorySearchClient";
import PublicFooter from "@/components/public/PublicFooter";
import { ChevronLeft, ChevronRight, Car, MapPin } from "lucide-react";
import { lookupZip } from "@/lib/utils/zip-coords";
import { gateCatalogue, SHORTLIST_RADIUS_MILES } from "@/lib/services/shortlist/shortlist-radius";
import { PROVIDER_PAGINATION_LIMIT } from "@/lib/services/inventory/inventory-source-config.service";
import { buildPageMetadata, PAGE_METADATA } from "@/lib/seo/metadata";
import { JsonLd, breadcrumbSchema } from "@/lib/seo/jsonld";

// SEO-safe faceted navigation: keep the canonical URL pinned to the clean
// /inventory path and emit `noindex, follow` when any filter is applied so
// Google doesn't waste crawl budget on duplicate filter combinations.
export async function generateMetadata(
  { searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> },
): Promise<Metadata> {
  const base = buildPageMetadata(PAGE_METADATA.inventory);
  const params = await searchParams;
  const hasFilters = Object.entries(params).some(
    ([k, v]) => k !== "page" && v !== undefined && v !== "",
  );
  return {
    ...base,
    robots: hasFilters
      ? { index: false, follow: true }
      : { index: true, follow: true },
  };
}

export const dynamic = "force-dynamic";

const PAGE_SIZE = 12;
const RECOGNIZED_BODY = ["SUV", "Sedan", "Truck", "Van", "Coupe", "Convertible", "Wagon", "Hatchback"];

// A swept listing is third-party sourced and UNCONFIRMED. These labels describe where a listing
// came from, never that anyone has stood behind it. "Verified" is reserved for a dealer's OFFER,
// at the point it is made — that is the only moment AutoLenis has a commitment from anyone.
//
// LANE_1 previously read "Verified" on the card. In production every LANE_1 row carries a null
// dealer_id: the badge was asserting a dealer relationship that did not exist on a single row.
const LANE_CONFIG = {
  LANE_1: { label: "Dealer listed", bg: "bg-[#ECFDF5]", text: "text-[#065F46]", border: "border-[#A7F3D0]" },
  LANE_2: { label: "Partner",       bg: "bg-[#EFF6FF]", text: "text-[#1D4ED8]", border: "border-[#BFDBFE]" },
  LANE_3: { label: "Market listed", bg: "bg-[#0B5FD1]/10", text: "text-[#0B5FD1]", border: "border-[#0B5FD1]/25" },
};

type SearchParams = {
  page?: string; pageSize?: string;
  q?: string; make?: string; model?: string; lane?: string;
  yearMin?: string; yearMax?: string;
  priceMin?: string; priceMax?: string;
  mileageMax?: string; condition?: string; bodyType?: string;
  transmission?: string; drivetrain?: string; fuelType?: string; color?: string;
  features?: string;
  zip?: string; sort?: string;
};

async function getMakeAndModelOptions() {
  const items = await prisma.inventoryItem.findMany({
    where: { isActive: true },
    select: { make: true, model: true },
    distinct: ["make", "model"],
    take: 1000,
  });
  const makes = Array.from(new Set(items.map(i => i.make))).sort();
  const modelsByMake: Record<string, string[]> = {};
  for (const i of items) {
    if (!modelsByMake[i.make]) modelsByMake[i.make] = [];
    if (!modelsByMake[i.make].includes(i.model)) modelsByMake[i.make].push(i.model);
  }
  for (const m of Object.keys(modelsByMake)) modelsByMake[m].sort();
  return { makes, modelsByMake };
}

async function getInventory(p: SearchParams) {
  const page = Math.max(1, parseInt(p.page ?? "1", 10));
  const make = p.make ?? "";
  const model = p.model ?? "";
  const lane = p.lane as InventoryLane | null;

  const where: Prisma.InventoryItemWhereInput = { isActive: true };
  if (make)        where.make  = { equals: make,  mode: "insensitive" };
  if (model)       where.model = { equals: model, mode: "insensitive" };
  if (lane)        where.lane = lane;
  if (p.condition) where.condition = { equals: p.condition, mode: "insensitive" };
  if (p.bodyType && RECOGNIZED_BODY.includes(p.bodyType))
                   where.bodyType = { equals: p.bodyType, mode: "insensitive" };
  if (p.transmission) where.transmission = { equals: p.transmission, mode: "insensitive" };
  if (p.drivetrain)   where.drivetrain   = { equals: p.drivetrain,   mode: "insensitive" };
  if (p.fuelType)     where.fuelType     = { equals: p.fuelType,     mode: "insensitive" };
  if (p.color)        where.exteriorColor = { contains: p.color,     mode: "insensitive" };
  if (p.features) {
    const feats = p.features.split(",").filter(Boolean);
    if (feats.length > 0) where.features = { hasEvery: feats };
  }

  if (p.priceMin || p.priceMax) {
    where.priceCents = {};
    if (p.priceMin) (where.priceCents as { gte?: number }).gte = parseInt(p.priceMin, 10) * 100;
    if (p.priceMax) (where.priceCents as { lte?: number }).lte = parseInt(p.priceMax, 10) * 100;
  }
  if (p.yearMin || p.yearMax) {
    where.year = {};
    if (p.yearMin) (where.year as { gte?: number }).gte = parseInt(p.yearMin, 10);
    if (p.yearMax) (where.year as { lte?: number }).lte = parseInt(p.yearMax, 10);
  }
  if (p.mileageMax) where.mileage = { lte: parseInt(p.mileageMax, 10) };

  if (p.q) {
    where.OR = [
      { make:  { contains: p.q, mode: "insensitive" } },
      { model: { contains: p.q, mode: "insensitive" } },
      { trim:  { contains: p.q, mode: "insensitive" } },
      { description: { contains: p.q, mode: "insensitive" } },
    ];
  }

  // A ZIP tells us where the buyer is. It does NOT narrow the catalogue.
  //
  // This used to push a bounding box into the WHERE and then filter again in memory, which
  // dropped every out-of-radius row and — because the box is a coordinate comparison — every
  // row with a null coordinate too. The adapter had never written a coordinate, so entering a
  // ZIP emptied a catalogue of 148 cars. Distance is now a label and a sort order; the action
  // on each card is what changes past the radius (see gateCatalogue).
  const center: { lat: number; lng: number } | null =
    p.zip && p.zip.length === 5 ? lookupZip(p.zip) : null;

  const sort = p.sort ?? "relevance";
  let orderBy: Prisma.InventoryItemOrderByWithRelationInput | Prisma.InventoryItemOrderByWithRelationInput[];
  switch (sort) {
    case "price-asc":  orderBy = { priceCents: "asc" }; break;
    case "price-desc": orderBy = { priceCents: "desc" }; break;
    case "newest":     orderBy = { createdAt: "desc" }; break;
    case "mileage":    orderBy = [{ mileage: "asc" }, { createdAt: "desc" }]; break;
    default:           orderBy = [{ lane: "asc" }, { createdAt: "desc" }];
  }

  // Pull 2x for dedupe; with a ZIP, distance ranking happens in memory so the window has to
  // cover the whole market. 500 is the provider's own deep-paging ceiling, which is therefore
  // the largest catalogue one market's sweep can produce — the previous 200 was set when every
  // row was NULL-coordinate and unrankable, and would silently truncate the DFW catalogue the
  // moment it fills.
  const fetchTake = center ? PROVIDER_PAGINATION_LIMIT : PAGE_SIZE * 4;
  const fetchSkip = center ? 0 : (page - 1) * PAGE_SIZE;

  const [totalRaw, itemsRaw] = await Promise.all([
    prisma.inventoryItem.count({ where }),
    prisma.inventoryItem.findMany({
      where, orderBy, skip: fetchSkip, take: fetchTake,
      select: {
        id: true, lane: true, vin: true, year: true, make: true, model: true, trim: true,
        mileage: true, priceCents: true, images: true, bodyType: true,
        latitude: true, longitude: true,
        city: true, state: true, externalDealerCity: true, externalDealerState: true,
        // Gate inputs. Freshness and availability decide the ACTION on the card, never whether
        // the card is rendered.
        isActive: true, lastSeenAt: true, dealerId: true, addedByAdminId: true,
      },
    }),
  ]);

  // Dedupe by VIN
  const seen = new Set<string>();
  const deduped = itemsRaw.filter(it => {
    if (!it.vin) return true;
    if (seen.has(it.vin)) return false;
    seen.add(it.vin);
    return true;
  });

  // Distance + per-card action. No filter: the row count out equals the row count in.
  const { gated, inRadiusCount, hasZip } = gateCatalogue(deduped, center);

  // An explicit sort other than relevance/distance is the buyer's choice and outranks proximity;
  // gateCatalogue has already ordered nearest-first, so only a re-sort is needed here.
  if (center && sort !== "distance" && sort !== "relevance") {
    // Preserve the DB order the query asked for.
    const rank = new Map(deduped.map((it, i) => [it.id, i]));
    gated.sort((a, b) => (rank.get(a.row.id) ?? 0) - (rank.get(b.row.id) ?? 0));
  }

  const items = gated
    .slice(center ? (page - 1) * PAGE_SIZE : 0, (center ? (page - 1) * PAGE_SIZE : 0) + PAGE_SIZE)
    .map(g => ({ ...g.row, distanceMiles: g.distanceMiles, gate: g.gate }));

  // With a ZIP the ranking is done over the fetched window rather than the whole table, so the
  // count reported is the size of that ranked set. Without one, the DB count is exact.
  const total = center ? gated.length : totalRaw;

  return {
    items, total, page, inRadiusCount, hasZip,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  };
}

export default async function InventoryPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const [{ items, total, page, totalPages, inRadiusCount, hasZip }, { makes, modelsByMake }] = await Promise.all([
    getInventory(params),
    getMakeAndModelOptions(),
  ]);

  function buildPageUrl(p: number) {
    const sp = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => { if (v && k !== "page") sp.set(k, String(v)); });
    if (p > 1) sp.set("page", String(p));
    const qs = sp.toString();
    return `/inventory${qs ? `?${qs}` : ""}`;
  }

  return (
    <div className="bg-white min-h-screen">
      <JsonLd id="ld-breadcrumb" data={breadcrumbSchema([
        { name: "Home", path: "/" },
        { name: "Inventory" },
      ])} />

      {/* HERO */}
      <div className="bg-gradient-to-b from-[#F8F9FB] to-white pt-28 pb-8 px-6 md:px-12 max-w-7xl mx-auto">
        <span className="text-xs font-semibold uppercase tracking-[0.15em] text-[#0B5FD1]">
          Premium Inventory
        </span>
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-[#111827] mt-3 mb-3">
          Vehicles Worth Competing For.
        </h1>
        <p className="text-[#4B5563] text-base max-w-2xl mb-4">
          Browse curated vehicles — then use AutoLenis to turn interest into
          structured dealer competition and smarter deal comparison.
        </p>
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <Link href="/auth/signup"
            className="inline-flex items-center gap-2 px-6 py-2.5 bg-[#0B5FD1] text-white
              text-sm font-semibold rounded-md hover:bg-[#0A4DB8] transition-colors
              shadow-md shadow-[#0B5FD1]/20">
            Get Prequalified →
          </Link>
        </div>
        <p className="text-xs text-[#94A3B8] font-medium">
          Sourced listings · Financing clarity · Dealer competition
        </p>
        <p className="text-sm text-[#94A3B8] mt-4" data-testid="results-count">
          Showing {items.length} of {total} vehicle{total !== 1 ? "s" : ""}
          {params.zip ? ` near ${params.zip}` : ""}
        </p>
      </div>

      {/* SEARCH BAR */}
      <div className="sticky top-16 z-30 bg-white/95 backdrop-blur-xl border-b border-[#E5E7EB] px-6 md:px-12 py-3 shadow-sm">
        <div className="max-w-7xl mx-auto">
          <Suspense fallback={null}>
            <InventorySearchClient availableMakes={makes} availableModelsByMake={modelsByMake} />
          </Suspense>
        </div>
      </div>

      {/* LOCATION + REACHABILITY. Never a filter — the grid below always renders. */}
      <div className="px-6 md:px-12 max-w-7xl mx-auto pt-6">
        {!hasZip ? (
          <div
            data-testid="zip-prompt"
            className="rounded-xl border border-[#BFDBFE] bg-[#EFF6FF] px-5 py-4 mb-6"
          >
            <p className="text-sm font-semibold text-[#1D4ED8] mb-1">
              Add your ZIP code to see distances
            </p>
            <p className="text-sm text-[#1E40AF]/80">
              We bring vehicles within {SHORTLIST_RADIUS_MILES} miles of you to auction. Enter a ZIP
              above and we will show how far each vehicle is and which ones dealers can compete on.
              Everything below stays browsable either way.
            </p>
          </div>
        ) : inRadiusCount === 0 ? (
          <div
            data-testid="no-vehicles-in-radius"
            className="rounded-xl border border-[#FDE68A] bg-[#FFFBEB] px-5 py-5 mb-6"
          >
            <p className="text-base font-bold text-[#92400E] mb-1">
              Nothing within {SHORTLIST_RADIUS_MILES} miles of {params.zip} yet
            </p>
            <p className="text-sm text-[#92400E]/85 mb-4">
              Tell us what you are looking for and dealers near you compete to find it — that is
              the faster route anyway. The vehicles below are outside your radius, shown as
              examples of what we source.
            </p>
            <Link
              href="/buyer/requests/new"
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#0B5FD1] text-white
                text-sm font-semibold rounded-md hover:bg-[#0A4DB8] transition-colors"
            >
              Tell us what you want →
            </Link>
          </div>
        ) : null}
      </div>

      {/* GRID */}
      <div className="max-w-7xl mx-auto px-6 md:px-12 py-10">
        {items.length === 0 ? (
          <div className="text-center py-24" data-testid="inventory-empty-state">
            <div className="w-16 h-16 rounded-2xl bg-[#EFF6FF] border border-[#DBEAFE]
              flex items-center justify-center mx-auto mb-6">
              <Car size={28} className="text-[#0B5FD1]" />
            </div>
            {total === 0 && !params.q && !params.make ? (
              <>
                <h3 className="text-lg font-bold text-[#111827] mb-2">New Vehicles Coming Soon</h3>
                <p className="text-[#4B5563] text-sm mb-1">
                  Browsing inventory from verified dealers.
                </p>
                <p className="text-[#94A3B8] text-sm mb-8">New vehicles added daily.</p>
                <Link href="/auth/signup"
                  className="inline-flex items-center gap-2 px-6 py-3 bg-[#0B5FD1] text-white
                    text-sm font-semibold rounded-xl hover:bg-[#0A4DB8] transition-colors">
                  Get Prequalified →
                </Link>
              </>
            ) : (
              <>
                <h3 className="text-lg font-bold text-[#111827] mb-2">No Matching Vehicles</h3>
                <p className="text-[#94A3B8] text-sm mb-6">
                  Try adjusting or clearing your filters to see more options.
                </p>
                <Link href="/inventory"
                  className="text-sm text-[#0B5FD1] hover:text-[#0A4DB8] font-semibold transition-colors">
                  Clear all filters
                </Link>
              </>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5" data-testid="inventory-grid">
            {items.map((vehicle) => {
              const lc = LANE_CONFIG[vehicle.lane];
              const img = vehicle.images?.[0] ?? null;
              const city = vehicle.city ?? vehicle.externalDealerCity;
              const state = vehicle.state ?? vehicle.externalDealerState;
              return (
                <Link key={vehicle.id} href={`/inventory/${vehicle.id}`}
                  data-testid={`vehicle-card-${vehicle.id}`}
                  className="group bg-white border border-[#E5E7EB] rounded-2xl overflow-hidden
                    hover:border-[#BFDBFE] hover:shadow-lg hover:shadow-[#0B5FD1]/8
                    transition-all duration-300 hover:-translate-y-0.5">
                  <div className="relative aspect-[16/9] bg-[#F8F9FB] overflow-hidden">
                    {img ? (
                      <img src={img} alt={`${vehicle.year} ${vehicle.make} ${vehicle.model}`}
                        className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-500"
                        loading="lazy" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Car size={36} className="text-[#E2E8F0]" />
                      </div>
                    )}
                    {lc && (
                      <span className={`absolute top-3 left-3 text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border ${lc.bg} ${lc.text} ${lc.border}`}>
                        {lc.label}
                      </span>
                    )}
                    {vehicle.bodyType && (
                      <span className="absolute top-3 right-3 text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full bg-white/90 text-[#4B5563]">{vehicle.bodyType}</span>
                    )}
                    <div className="absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-black/10 to-transparent" />
                  </div>
                  <div className="p-5">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <h3 className="font-bold text-[#111827] text-sm leading-tight">
                        {vehicle.year} {vehicle.make} {vehicle.model}
                      </h3>
                      <p className="text-base font-bold text-[#0B5FD1] font-mono shrink-0">
                        ${(vehicle.priceCents / 100).toLocaleString()}
                      </p>
                    </div>
                    {vehicle.trim && (
                      <p className="text-xs text-[#94A3B8] mb-3">{vehicle.trim}</p>
                    )}
                    <div className="flex items-center gap-3 text-[#94A3B8] text-xs flex-wrap mb-4">
                      {vehicle.mileage && (
                        <span>{vehicle.mileage.toLocaleString()} mi</span>
                      )}
                      {city && (
                        <span className="before:content-['·'] before:mr-3">{city}, {state}</span>
                      )}
                      {vehicle.distanceMiles !== null && (
                        <span className="inline-flex items-center gap-1 text-[#0B5FD1] font-semibold
                          before:content-['·'] before:mr-3 before:text-[#94A3B8] before:font-normal">
                          <MapPin size={10} /> {vehicle.distanceMiles} mi away
                        </span>
                      )}
                    </div>
                    {/* Stale flag: display only. Not seen for a week, still perfectly browsable. */}
                    {vehicle.gate.freshness !== "FRESH" && (
                      <p className="text-[11px] text-[#92400E] bg-[#FFFBEB] border border-[#FDE68A]
                        rounded px-2 py-1 mb-3 inline-block" data-testid="stale-flag">
                        {vehicle.gate.freshness === "STALE"
                          ? "Not seen on the market this week — may already be sold"
                          : "Not seen for over 30 days — likely sold"}
                      </p>
                    )}
                    {/* The ACTION is what the radius gates. The card itself is never withheld. */}
                    <div className="text-xs font-semibold group-hover:underline text-[#0B5FD1]">
                      {vehicle.gate.action === "ADD"
                        ? "View Opportunity →"
                        : vehicle.gate.action === "NEED_ZIP"
                          ? "View details →"
                          : "Find one like this near me →"}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}

        {totalPages > 1 && (
          <div className="mt-12 flex items-center justify-center gap-2 flex-wrap" data-testid="inventory-pagination">
            {page > 1 ? (
              <Link href={buildPageUrl(page - 1)} data-testid="pagination-prev" className="flex items-center gap-1.5 px-3 py-2 sm:px-4 text-sm font-medium text-[#4B5563] border border-[#E5E7EB] rounded-md hover:bg-[#F8F9FB] hover:text-[#0B5FD1] transition-colors">
                <ChevronLeft size={14} /> Previous
              </Link>
            ) : (
              <span className="flex items-center gap-1.5 px-3 py-2 sm:px-4 text-sm text-[#BFDBFE] border border-[#EFF6FF] rounded-md cursor-default"><ChevronLeft size={14} /> Previous</span>
            )}
            <div className="flex items-center gap-1.5">
              {Array.from({ length: totalPages }).map((_, i) => {
                const p = i + 1;
                if (totalPages > 8 && Math.abs(p - page) > 2 && p !== 1 && p !== totalPages) {
                  return (Math.abs(p - page) === 3) ? <span key={p} className="text-[#94A3B8] text-xs">…</span> : null;
                }
                return (
                  <Link key={p} href={buildPageUrl(p)} data-testid={`pagination-page-${p}`}
                    className={`w-9 h-9 flex items-center justify-center text-sm rounded-md transition-colors ${p === page ? "bg-[#0B5FD1] text-white font-semibold" : "text-[#4B5563] border border-[#E5E7EB] hover:bg-[#F8F9FB] hover:text-[#0B5FD1]"}`}>
                    {p}
                  </Link>
                );
              })}
            </div>
            {page < totalPages ? (
              <Link href={buildPageUrl(page + 1)} data-testid="pagination-next" className="flex items-center gap-1.5 px-3 py-2 sm:px-4 text-sm font-medium text-[#4B5563] border border-[#E5E7EB] rounded-md hover:bg-[#F8F9FB] hover:text-[#0B5FD1] transition-colors">
                Next <ChevronRight size={14} />
              </Link>
            ) : (
              <span className="flex items-center gap-1.5 px-3 py-2 sm:px-4 text-sm text-[#BFDBFE] border border-[#EFF6FF] rounded-md cursor-default">Next <ChevronRight size={14} /></span>
            )}
          </div>
        )}
      </div>

      {/* SECTION 5 — WHY INVENTORY WORKS DIFFERENTLY */}
      <section className="mt-20 py-16 bg-[#F8F9FB] border-t border-[#E5E7EB]">
        <div className="max-w-5xl mx-auto px-6 text-center">
          <span className="text-xs font-semibold uppercase tracking-[0.15em] text-[#0B5FD1]">
            More Than Browsing
          </span>
          <h2 className="text-2xl md:text-3xl font-bold text-[#111827] tracking-tight mt-3 mb-3">
            Inventory Is Only the Starting Point.
          </h2>
          <p className="text-[#4B5563] text-sm max-w-2xl mx-auto mb-10">
            With AutoLenis, browsing is not the end of the process. Once you find
            a vehicle that fits your goals, the platform helps turn that interest
            into structured dealer competition and smarter deal comparison.
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { step: "01", title: "Browse Opportunities" },
              { step: "02", title: "Know Your Buying Power" },
              { step: "03", title: "Activate Dealer Competition" },
              { step: "04", title: "Compare Total Value" },
            ].map(item => (
              <div key={item.step}
                className="bg-white border border-[#E5E7EB] rounded-2xl p-5 text-center">
                <p className="text-3xl font-bold text-[#0B5FD1]/15 font-mono mb-2">{item.step}</p>
                <p className="text-sm font-semibold text-[#111827]">{item.title}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* SECTION 6 — BUYING CONFIDENCE STRIP */}
      <section className="py-12 bg-white border-t border-[#E5E7EB]">
        <div className="max-w-5xl mx-auto px-6">
          <h2 className="text-center text-sm font-bold text-[#94A3B8] uppercase
            tracking-[0.15em] mb-8">
            Built for Smarter Vehicle Decisions
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {[
              "Transparent Pricing Context",
              "Soft-Credit Friendly Path",
              "Dealer Competition",
              "Contract Shield Review",
              "Remote Buying Support",
            ].map(label => (
              <div key={label}
                className="bg-[#F8F9FB] border border-[#E5E7EB] rounded-xl px-4 py-3
                  text-center text-xs font-semibold text-[#374151]">
                {label}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* SECTION 7 — FINAL CTA */}
      <section className="bg-[#0B5FD1] py-20">
        <div className="max-w-3xl mx-auto px-6 text-center">
          <h2 className="text-3xl font-bold text-white tracking-tight mb-3">
            Don&apos;t Just Browse. Buy With Leverage.
          </h2>
          <p className="text-white/80 text-sm mb-8 max-w-xl mx-auto leading-relaxed">
            Get prequalified and let AutoLenis help you turn vehicle interest into
            competitive dealer offers.
          </p>
          <Link href="/auth/signup"
            className="inline-flex items-center gap-2 px-8 py-4 bg-white text-[#0B5FD1]
              font-semibold text-sm rounded-xl hover:bg-[#EFF6FF] transition-colors
              shadow-md shadow-black/10">
            Get Prequalified →
          </Link>
        </div>
      </section>

      <PublicFooter />
    </div>
  );
}
