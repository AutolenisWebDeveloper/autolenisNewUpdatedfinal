import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { ArrowLeft, CheckCircle2, Shield, MapPin } from "lucide-react";
import VehicleGalleryClient from "./VehicleGalleryClient";
import AddToShortlistButton from "./AddToShortlistButton";
import { shortlistGate, distanceMilesBetween, SHORTLIST_RADIUS_MILES } from "@/lib/services/shortlist/shortlist-radius";
import { buildSimilarRequestHref } from "@/lib/services/shortlist/shortlist-availability";
import { geocodeZip } from "@/lib/services/integrations/geocoding.service";
import { JsonLd, vehicleSchema, breadcrumbSchema } from "@/lib/seo/jsonld";
import { bucketFeatures } from "@/lib/utils/feature-categories";

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "https://autolenis.com").trim();

export const dynamic = "force-dynamic";

// Lane describes PROVENANCE — where the listing came from — never a guarantee about it. A swept
// listing is third-party sourced and unconfirmed: AutoLenis has not seen the car, spoken to the
// seller, or held it. What gets verified is a dealer's OFFER, at the moment it is made.
//
// LANE_1 used to render "Verified" with an "Identity-verified dealer" caption and a shield chip.
// Every LANE_1 row in production carries a null dealer_id, so all three were asserting a dealer
// relationship that did not exist on a single row.
const LANE_CONFIG = {
  LANE_1: { label: "Dealer listed", bg: "bg-[#50D14E]/15", text: "text-[#1A6B18]", border: "border-[#50D14E]/40", desc: "Listed by a dealer we source from" },
  LANE_2: { label: "Partner",       bg: "bg-[#2667BF]/10", text: "text-[#1A3C7A]", border: "border-[#2667BF]/30", desc: "Listed by a partner dealer" },
  LANE_3: { label: "Market listed", bg: "bg-[#F8F9FB]",    text: "text-[#4B5563]", border: "border-[#E5E7EB]",  desc: "Third-party listing, not yet confirmed" },
};

async function getVehicle(id: string) {
  const item = await prisma.inventoryItem.findUnique({
    where: { id, isActive: true },
    select: {
      id: true, lane: true, vin: true, year: true, make: true, model: true, trim: true,
      mileage: true, priceCents: true, description: true, images: true,
      features: true,
      priceHistory: true,
      condition: true, bodyType: true, exteriorColor: true, interiorColor: true,
      engine: true, transmission: true, drivetrain: true, fuelType: true,
      city: true, state: true,
      zip: true,
      latitude: true, longitude: true,
      externalDealerCity: true, externalDealerState: true,
      // Gate inputs — they decide the ACTION, never whether this page renders.
      isActive: true, lastSeenAt: true, dealerId: true, addedByAdminId: true,
    },
  });
  if (!item) return null;
  const avg = await prisma.inventoryItem.aggregate({
    where: { isActive: true, make: item.make, model: item.model },
    _avg: { priceCents: true },
    _count: true,
  });
  return { ...item, avgPriceCents: avg._avg.priceCents ?? null, avgSampleSize: avg._count };
}

/** Budget AND location from the one buyer read the page already performed. */
async function getBuyerContext(): Promise<{ budgetCents: number | null; zip: string | null }> {
  const none = { budgetCents: null, zip: null };
  try {
    const { createServerSupabaseClient } = await import("@/lib/supabase");
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return none;
    const buyer = await prisma.buyer.findFirst({
      where: { user: { supabaseId: user.id } },
      include: { preQualification: true },
    });
    return {
      budgetCents: buyer?.preQualification?.maxOtdAmountCents ?? null,
      zip: buyer?.zip ?? null,
    };
  } catch { return none; }
}

export async function generateMetadata({ params }: { params: Promise<{ vehicleId: string }> }): Promise<Metadata> {
  const { vehicleId } = await params;
  const v = await getVehicle(vehicleId);
  if (!v) return { title: "Vehicle Not Found — AutoLenis" };
  const trim = v.trim ? ` ${v.trim}` : "";
  const title = `${v.year} ${v.make} ${v.model}${trim} — AutoLenis`;
  const price = `$${(v.priceCents / 100).toLocaleString()}`;
  const mi = v.mileage ? `${v.mileage.toLocaleString()} mi · ` : "";
  const description = `${v.year} ${v.make} ${v.model}${trim} for ${price}. ${mi}Sourced listing on AutoLenis. Let dealers compete for your business.`;
  const url = `${APP_URL}/inventory/${vehicleId}`;
  const ogImage = `${APP_URL}/og/vehicle/${vehicleId}`;
  return {
    title, description,
    alternates: { canonical: url },
    robots: { index: true, follow: true },
    openGraph: { type: "website", url, siteName: "AutoLenis", title, description,
      images: [{ url: ogImage, width: 1200, height: 630, alt: `${v.year} ${v.make} ${v.model}` }] },
    twitter: { card: "summary_large_image", title, description, images: [ogImage] },
  };
}

export default async function VehicleDetailPage({ params, searchParams }: { params: Promise<{ vehicleId: string }>, searchParams: Promise<Record<string, string>> }) {
  const { vehicleId } = await params;
  const sp = await searchParams;
  const [vehicle, buyerCtx] = await Promise.all([getVehicle(vehicleId), getBuyerContext()]);
  if (!vehicle) notFound();
  const buyerBudget = buyerCtx.budgetCents;

  // Distance and the resulting action. A vehicle outside the provider's radius is fully
  // browsable — only the button changes, and it changes into a route forward rather than a
  // disabled control.
  const buyerCoords = buyerCtx.zip ? await geocodeZip(buyerCtx.zip) : null;
  const distanceMiles = distanceMilesBetween(buyerCoords, vehicle.latitude, vehicle.longitude);
  const gate = shortlistGate(
    {
      distanceMiles,
      isActive: vehicle.isActive,
      priceCents: vehicle.priceCents,
      lastSeenAt: vehicle.lastSeenAt,
      lane: vehicle.lane,
      dealerId: vehicle.dealerId,
      addedByAdminId: vehicle.addedByAdminId,
    },
    { hasZip: !!buyerCoords },
  );
  const similarHref = buildSimilarRequestHref({
    year: vehicle.year, make: vehicle.make, model: vehicle.model, trim: vehicle.trim,
    mileage: vehicle.mileage, priceCents: vehicle.priceCents, features: vehicle.features,
  });

  // Related vehicles for internal SEO linking
  const relatedVehicles = await prisma.inventoryItem.findMany({
    where: {
      isActive: true,
      id: { not: vehicle.id },
      make: vehicle.make,
    },
    select: {
      id: true, year: true, make: true, model: true, priceCents: true, images: true,
    },
    orderBy: { updatedAt: "desc" },
    take: 4,
  });

  const makeSlug = vehicle.make.toLowerCase().replace(/\s+/g, "-");

  const lc = LANE_CONFIG[vehicle.lane];
  const priceFormatted = `$${(vehicle.priceCents / 100).toLocaleString()}`;
  const withinBudget = buyerBudget !== null ? vehicle.priceCents <= buyerBudget : null;
  const city = vehicle.city ?? vehicle.externalDealerCity;
  const state = vehicle.state ?? vehicle.externalDealerState;

  // Price context
  const avgCents = vehicle.avgPriceCents ?? vehicle.priceCents;
  const diffPct = avgCents ? Math.round(((vehicle.priceCents - avgCents) / avgCents) * 100) : 0;
  const belowMarket = diffPct < 0;

  // Build "Back to Search" preserving filters
  const backHref = (() => {
    const q = new URLSearchParams();
    Object.entries(sp).forEach(([k, v]) => { if (k !== "vehicleId" && v) q.set(k, v); });
    return `/inventory${q.toString() ? `?${q.toString()}` : ""}`;
  })();

  // VIN last 6 digits for privacy
  const vinDisplay = vehicle.vin ? `…${vehicle.vin.slice(-6)}` : "—";

  // Specs grid
  const specs = [
    { label: "Year", value: String(vehicle.year) },
    { label: "Make", value: vehicle.make },
    { label: "Model", value: vehicle.model },
    ...(vehicle.trim ? [{ label: "Trim", value: vehicle.trim }] : []),
    ...(vehicle.mileage ? [{ label: "Mileage", value: `${vehicle.mileage.toLocaleString()} mi` }] : []),
    ...(vehicle.condition ? [{ label: "Condition", value: vehicle.condition }] : []),
    ...(vehicle.bodyType ? [{ label: "Body Type", value: vehicle.bodyType }] : []),
    ...(vehicle.engine ? [{ label: "Engine", value: vehicle.engine }] : []),
    ...(vehicle.transmission ? [{ label: "Transmission", value: vehicle.transmission }] : []),
    ...(vehicle.drivetrain ? [{ label: "Drivetrain", value: vehicle.drivetrain }] : []),
    ...(vehicle.fuelType ? [{ label: "Fuel Type", value: vehicle.fuelType }] : []),
    ...(vehicle.exteriorColor ? [{ label: "Exterior", value: vehicle.exteriorColor }] : []),
    ...(vehicle.interiorColor ? [{ label: "Interior", value: vehicle.interiorColor }] : []),
    ...(vehicle.vin ? [{ label: "VIN", value: vinDisplay }] : []),
    ...(city ? [{ label: "Location", value: [city, state, vehicle.zip].filter(Boolean).join(", ") }] : []),
  ];

  return (
    <div className="bg-white min-h-screen pt-24 pb-20">
      <JsonLd id="ld-vehicle" data={vehicleSchema({
        vehicleId: vehicle.id, year: vehicle.year, make: vehicle.make, model: vehicle.model,
        trim: vehicle.trim, mileage: vehicle.mileage, priceCents: vehicle.priceCents,
        vin: vehicle.vin, bodyType: vehicle.bodyType, fuelType: vehicle.fuelType,
        transmission: vehicle.transmission, drivetrain: vehicle.drivetrain,
        exteriorColor: vehicle.exteriorColor, images: vehicle.images,
      })} />
      <JsonLd id="ld-breadcrumb" data={breadcrumbSchema([
        { name: "Home", path: "/" },
        { name: "Inventory", path: "/inventory" },
        { name: `${vehicle.year} ${vehicle.make} ${vehicle.model}` },
      ])} />
      <div className="max-w-7xl mx-auto px-6 md:px-12">
        <Link href={backHref} data-testid="vehicle-back-link" className="inline-flex items-center gap-2 text-sm text-[#4B5563] hover:text-[#0B5FD1] transition-colors mb-8">
          <ArrowLeft size={14} /> Back to Search
        </Link>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-10">
          <div>
            <VehicleGalleryClient
              images={vehicle.images ?? []}
              alt={`${vehicle.year} ${vehicle.make} ${vehicle.model}`}
              laneLabel={lc.label}
              laneClasses={`${lc.bg} ${lc.text} ${lc.border}`}
              has360={vehicle.features.some((f: string) => f.toLowerCase().includes("360"))}
            />

            <h1 className="text-3xl font-bold tracking-tight text-[#111827] mb-1 mt-6" data-testid="vehicle-title">
              {vehicle.year} {vehicle.make} {vehicle.model}{vehicle.trim && <span className="text-[#94A3B8] font-normal"> {vehicle.trim}</span>}
            </h1>
            <div className="flex items-center gap-3 text-sm text-[#94A3B8] mb-8">
              <span>{lc.desc}</span>
              {city && (
                <span className="inline-flex items-center gap-1">
                  <MapPin size={12} /> {city}, {state}
                </span>
              )}
            </div>

            <h2 className="text-xs font-bold text-[#94A3B8] uppercase tracking-wider mb-4">Specifications</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-10" data-testid="vehicle-specs-grid">
              {specs.map((s) => (
                <div key={s.label} className="bg-[#F8F9FB] border border-[#E5E7EB] rounded-lg px-4 py-3" data-testid={`spec-${s.label.toLowerCase().replace(/\s+/g, "-")}`}>
                  <p className="text-[10px] text-[#94A3B8] uppercase tracking-wider mb-1">{s.label}</p>
                  <p className="text-sm font-bold text-[#111827] font-[family-name:var(--font-mono)]">{s.value}</p>
                </div>
              ))}
            </div>

            {Array.isArray(vehicle.features) && vehicle.features.length > 0 && (
              <div className="mb-10" data-testid="vehicle-features">
                <div className="flex items-baseline gap-2 mb-4">
                  <h2 className="text-xs font-bold text-[#94A3B8] uppercase tracking-wider">
                    Features &amp; Options
                  </h2>
                  <span className="text-xs font-semibold text-[#0B5FD1]">
                    {(vehicle.features as string[]).length} included
                  </span>
                </div>

                <div className="space-y-4">
                  {bucketFeatures(vehicle.features as string[]).map(([cat, items]) => (
                    <div key={cat}>
                      <p className="text-xs font-semibold text-[#6B7280] mb-2">{cat}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {items.map(f => (
                          <span
                            key={f}
                            className="inline-flex items-center px-3 py-1.5 bg-[#F8F9FB] border border-[#E5E7EB] rounded-full text-xs font-medium text-[#374151]"
                          >
                            {f}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>

                <p className="text-xs text-[#9CA3AF] mt-4">
                  Contract Shield verifies all listed features are included in your deal.
                </p>
              </div>
            )}

            {vehicle.description && (
              <div data-testid="vehicle-description" className="mb-8">
                <h2 className="text-xs font-bold text-[#94A3B8] uppercase tracking-wider mb-4">About This Vehicle</h2>
                <p className="text-sm text-[#4B5563] leading-relaxed bg-[#F8F9FB] border border-[#E5E7EB] rounded-lg p-5">{vehicle.description}</p>
              </div>
            )}

            {relatedVehicles.length > 0 && (
              <section className="mt-12 pt-8 border-t border-[#E5E7EB]" data-testid="related-vehicles">
                <h2 className="text-xl font-bold text-[#111827] mb-5">
                  More {vehicle.make} Vehicles
                </h2>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {relatedVehicles.map(rv => (
                    <Link
                      key={rv.id}
                      href={`/inventory/${rv.id}`}
                      className="bg-white border border-[#E5E7EB] rounded-xl p-3 hover:border-[#BFDBFE] transition-all"
                    >
                      <p className="text-xs font-semibold text-[#111827]">
                        {rv.year} {rv.make} {rv.model}
                      </p>
                      <p className="text-[#0B5FD1] font-bold text-sm mt-1">
                        ${(rv.priceCents / 100).toLocaleString("en-US")}
                      </p>
                    </Link>
                  ))}
                </div>
                <Link
                  href={`/cars/${makeSlug}`}
                  className="inline-flex items-center gap-1 mt-4 text-sm text-[#0B5FD1] hover:underline font-semibold"
                >
                  View all {vehicle.make} vehicles →
                </Link>
              </section>
            )}

          </div>

          <div className="lg:sticky lg:top-24 self-start">
            <div className="bg-white border-2 border-[#E5E7EB] rounded-2xl p-7 shadow-sm shadow-[#0B5FD1]/5" data-testid="vehicle-price-panel">
              <p className="text-xs font-bold uppercase tracking-wider text-[#94A3B8] mb-2">Asking Price</p>
              <p className="text-4xl font-bold text-[#0B5FD1] font-[family-name:var(--font-mono)] mb-1" data-testid="vehicle-price">{priceFormatted}</p>
              <p className="text-xs text-[#94A3B8] mb-5">Exc. tax, title &amp; reg.</p>

              {/* Price context */}
              {avgCents && vehicle.avgSampleSize > 1 && (
                <div data-testid="price-context" className={`text-xs px-3 py-2 rounded-lg mb-4 ${belowMarket ? "bg-[#F2FAF2] text-[#1A6B18] border border-[#C9E8C9]" : "bg-amber-50 text-amber-800 border border-amber-200"}`}>
                  Listed <strong>{Math.abs(diffPct)}% {belowMarket ? "below" : "above"}</strong> market average for similar {vehicle.make} {vehicle.model}.
                </div>
              )}

              {withinBudget !== null && (
                <div data-testid="budget-fit-indicator" className={`flex items-center gap-2 rounded-lg px-3 py-2 mb-4 text-xs ${withinBudget ? "bg-[#F2FAF2] border border-[#C9E8C9] text-[#1A6B18]" : "bg-red-50 border border-red-200 text-red-700"}`}>
                  <CheckCircle2 size={13} />
                  {withinBudget ? "Within your pre-qualified budget" : "Exceeds your approved budget"}
                </div>
              )}

              <div className="border-t border-[#E5E7EB] pt-4 mb-5 space-y-2" data-testid="trust-signals">
                {/* Sourcing, stated plainly. This used to read "Verified Dealer" behind a shield
                    on every LANE_1 row — none of which has a dealer_id. */}
                <div className="flex items-center gap-2 text-xs text-[#4B5563]" data-testid="listing-provenance">
                  <Shield size={12} /> {lc.desc} · price and availability confirmed when a dealer bids
                </div>
                {/* Distance on the detail page as well as the card. Shown whenever we can place
                    both ends — including when it is too far to shortlist, because that is
                    precisely when the buyer most needs to know. */}
                {distanceMiles !== null && (
                  <div className="flex items-center gap-2 text-xs text-[#4B5563]" data-testid="vehicle-distance">
                    <MapPin size={12} /> {distanceMiles} mi from {buyerCtx.zip}
                    {distanceMiles > SHORTLIST_RADIUS_MILES && " · outside our auction radius"}
                  </div>
                )}
                {gate.freshness !== "FRESH" && (
                  <div className="flex items-center gap-2 text-xs text-[#92400E]" data-testid="stale-flag">
                    <Shield size={12} />
                    {gate.freshness === "STALE"
                      ? "Not seen on the market this week — may already be sold"
                      : "Not seen for over 30 days — likely sold"}
                  </div>
                )}
                <div className="flex items-center gap-2 text-xs text-[#4B5563]">
                  <CheckCircle2 size={12} /> Contract Shield protected
                </div>
                <div className="flex items-center gap-2 text-xs text-[#4B5563]">
                  <CheckCircle2 size={12} /> $99 deposit · refund on request
                </div>
              </div>

              <div className="space-y-2.5" data-testid="vehicle-cta-group">
                {buyerBudget === null ? (
                  <Link href="/auth/signup" data-testid="vehicle-cta-primary" className="block w-full text-center px-5 py-3 bg-[#0B5FD1] text-white font-semibold text-sm rounded-md hover:bg-[#0A4DB8] transition-colors shadow-md shadow-[#0B5FD1]/15">
                    Check Your Buying Power
                    <span className="block text-[10px] font-normal opacity-80 mt-0.5">Free · No Credit Impact</span>
                  </Link>
                ) : gate.action === "REQUEST_SIMILAR" ? (
                  <Link href={similarHref} data-testid="find-similar-cta"
                    className="block w-full text-center px-5 py-3 bg-[#0B5FD1] text-white font-semibold text-sm rounded-md hover:bg-[#0A4DB8] transition-colors shadow-md shadow-[#0B5FD1]/15">
                    Find one like this near me
                    <span className="block text-[10px] font-normal opacity-80 mt-0.5">
                      {gate.reason === "OUT_OF_RADIUS"
                        ? `This one is ${distanceMiles} mi away — beyond our ${SHORTLIST_RADIUS_MILES} mi auction radius`
                        : gate.reason === "STALE_LISTING"
                          ? "This listing has not been seen for over 30 days"
                          : gate.reason === "UNAVAILABLE"
                            ? "This vehicle is no longer available"
                            : "We cannot confirm where this vehicle is located"}
                    </span>
                  </Link>
                ) : withinBudget ? (
                  <AddToShortlistButton vehicleId={vehicle.id} />
                ) : (
                  <button disabled data-testid="vehicle-cta-primary-disabled" className="block w-full text-center px-5 py-3 bg-[#E5E7EB] text-[#94A3B8] font-semibold text-sm rounded-md cursor-not-allowed">
                    Exceeds Your Pre-Qualified Budget
                    <span className="block text-[10px] font-normal mt-0.5">Approved up to ${(buyerBudget / 100).toLocaleString()}</span>
                  </button>
                )}

              </div>
              <p className="text-[10px] text-[#94A3B8] mt-5 text-center">AutoLenis does not sell vehicles directly.</p>
              <p className="text-xs text-[#9CA3AF] text-center mt-4 leading-relaxed" data-testid="dealer-anonymized-notice">
                Dealer identity is revealed after your offer is accepted —
                protecting you from outside pressure during the bidding process.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}