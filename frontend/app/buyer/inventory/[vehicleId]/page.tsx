// /buyer/inventory/[vehicleId] — System 15 ENH vehicle detail page
// Full spec: image gallery, sticky action panel, budget fit indicator,
// price history sparkline, deal rating, freshness score, shortlist CTA
// VEHICLE_VIEWED event logged to event ledger on page load
// External dealer identity NEVER exposed to buyer-facing page (Lane 2/3)

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedBuyer } from "@/lib/auth/session";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import VehicleGallery from "@/components/buyer/VehicleGallery";
import VehicleDetailPanel from "@/components/buyer/VehicleDetailPanel";
import { bucketFeatures } from "@/lib/utils/feature-categories";

export const dynamic = "force-dynamic";

interface Props { params: Promise<{ vehicleId: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { vehicleId } = await params;
  const vehicle = await prisma.inventoryItem.findUnique({
    where: { id: vehicleId, isActive: true },
    select: { year: true, make: true, model: true },
  });
  if (!vehicle) return { title: "Vehicle Not Found — AutoLenis" };
  return { title: `${vehicle.year} ${vehicle.make} ${vehicle.model} — AutoLenis` };
}

const LANE_INFO: Record<string, { label: string; variant: "green" | "blue" | "gray"; trustLabel: string }> = {
  LANE_1: { label: "Dealer listed", variant: "green", trustLabel: "Listed by a dealer we source from — price and availability confirmed when they bid" },
  LANE_2: { label: "Partner",       variant: "blue",  trustLabel: "Partner-adjacent listing — price and availability confirmed when a dealer bids" },
  LANE_3: { label: "Market listed", variant: "gray",  trustLabel: "Third-party listing — price and availability confirmed when a dealer bids" },
};

export default async function VehicleDetailPage({ params }: Props) {
  const { vehicleId } = await params;

  const vehicle = await prisma.inventoryItem.findUnique({
    where: { id: vehicleId, isActive: true },
  });
  if (!vehicle) notFound();

  // Get buyer for budget fit check (optional auth)
  const buyer = await getAuthenticatedBuyer();
  const prequal = buyer?.preQualification;

  // maxOtdAmountCents is immutable from iPredict — read-only comparison only
  const budgetFit = prequal
    ? vehicle.priceCents <= prequal.maxOtdAmountCents
      ? "within"
      : vehicle.priceCents <= prequal.maxOtdAmountCents * 1.05
      ? "borderline"
      : "over"
    : null;

  // Log VEHICLE_VIEWED event to event ledger (System 15 ENH requirement)
  if (buyer) {
    prisma.buyerActivityEvent.create({
      data: {
        buyerId: buyer.id,
        eventType: "VEHICLE_VIEWED",
        title: `Viewed ${vehicle.year} ${vehicle.make} ${vehicle.model}`,
        metadata: { vehicleId: vehicle.id, priceCents: vehicle.priceCents, lane: vehicle.lane },
      },
    }).catch(() => {}); // Non-blocking
  }

  // Parse price history (JSON array of {price, date} objects)
  const priceHistory = Array.isArray(vehicle.priceHistory)
    ? (vehicle.priceHistory as Array<{ price: number; date: string }>)
    : [];

  const laneInfo = LANE_INFO[vehicle.lane] ?? LANE_INFO.LANE_3;

  // Freshness: derive from lastSeenAt (ENH-18 — no new stored field)
  const lastSeenHours = vehicle.lastSeenAt
    ? Math.floor((Date.now() - vehicle.lastSeenAt.getTime()) / 3600000)
    : null;
  const freshnessLabel =
    lastSeenHours === null ? null
    : lastSeenHours < 6  ? "Just updated"
    : lastSeenHours < 24 ? `Updated ${lastSeenHours}h ago`
    : lastSeenHours < 48 ? "Updated yesterday"
    : null; // STALE at 48h — no chip shown

  return (
    <div className="min-h-screen bg-[#F8F9FA]" data-testid="vehicle-detail-page">
      {/* Back to Search */}
      <div className="max-w-7xl mx-auto px-6 md:px-12 pt-6">
        <a
          href="/buyer/search"
          className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-al-primary transition-colors"
          data-testid="back-to-search"
        >
          ← Back to Search
        </a>
      </div>

      {/* Image Gallery */}
      <VehicleGallery
        images={vehicle.images}
        title={`${vehicle.year} ${vehicle.make} ${vehicle.model}`}
        has360={vehicle.features.some(f => f.toLowerCase().includes("360"))}
      />

      <div className="max-w-7xl mx-auto px-6 md:px-12 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

          {/* Left column — vehicle info */}
          <div className="lg:col-span-2 space-y-6">

            {/* Header */}
            <div>
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <Badge variant={laneInfo.variant} data-testid="vehicle-lane-badge">{laneInfo.label}</Badge>
                {freshnessLabel && (
                  <Badge variant="secondary" data-testid="freshness-chip" className="text-xs">{freshnessLabel}</Badge>
                )}
                {vehicle.vin && (
                  <span className="text-xs text-slate-400 font-mono" data-testid="vehicle-vin">VIN: …{vehicle.vin.slice(-6)}</span>
                )}
              </div>
              <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight" data-testid="vehicle-title">
                {vehicle.year} {vehicle.make} {vehicle.model}
                {vehicle.trim && <span className="text-slate-500 font-normal"> {vehicle.trim}</span>}
              </h1>
              <p className="text-slate-500 text-sm mt-1">{laneInfo.trustLabel}</p>
            </div>

            {/* Specs grid */}
            <div className="bg-white border border-slate-200 rounded-xl p-6" data-testid="vehicle-specs">
              <h2 className="font-semibold text-slate-900 mb-4 text-sm uppercase tracking-wider">Specifications</h2>
              <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-4">
                {[
                  { label: "Year",         value: vehicle.year.toString() },
                  { label: "Make",         value: vehicle.make },
                  { label: "Model",        value: vehicle.model },
                  { label: "Trim",         value: vehicle.trim ?? null },
                  { label: "Mileage",      value: vehicle.mileage ? `${vehicle.mileage.toLocaleString()} mi` : null },
                  { label: "Condition",    value: vehicle.condition ?? null },
                  { label: "Body Type",    value: vehicle.bodyType ?? null },
                  { label: "Engine",       value: vehicle.engine ?? null },
                  { label: "Transmission", value: vehicle.transmission ?? null },
                  { label: "Drivetrain",   value: vehicle.drivetrain ?? null },
                  { label: "Fuel Type",    value: vehicle.fuelType ?? null },
                  { label: "Exterior",     value: vehicle.exteriorColor ?? null },
                  { label: "Interior",     value: vehicle.interiorColor ?? null },
                  { label: "VIN",          value: vehicle.vin ? `…${vehicle.vin.slice(-6)}` : null },
                  {
                    label: "Location",
                    value: [
                      vehicle.city ?? vehicle.externalDealerCity,
                      vehicle.state ?? vehicle.externalDealerState,
                      vehicle.zip,
                    ].filter(Boolean).join(", ") || null,
                  },
                ]
                  .filter(row => row.value !== null)
                  .map(({ label, value }) => (
                    <div key={label}>
                      <dt className="text-xs text-slate-400 font-medium uppercase tracking-wider mb-0.5">{label}</dt>
                      <dd className="text-sm font-semibold text-slate-800">{value}</dd>
                    </div>
                  ))}
              </dl>
            </div>

            {/* Description */}
            {vehicle.description && (
              <div className="bg-white border border-slate-200 rounded-xl p-6" data-testid="vehicle-description">
                <h2 className="font-semibold text-slate-900 mb-3 text-sm uppercase tracking-wider">About This Vehicle</h2>
                <p className="text-sm text-slate-600 leading-relaxed">{vehicle.description}</p>
              </div>
            )}

            {/* Features & Options */}
            {Array.isArray(vehicle.features) && vehicle.features.length > 0 && (
              <div className="bg-white border border-slate-200 rounded-xl p-6" data-testid="vehicle-features">
                <div className="flex items-baseline gap-2 mb-4">
                  <h2 className="font-semibold text-slate-900 text-sm uppercase tracking-wider">
                    Features &amp; Options
                  </h2>
                  <span className="text-xs font-semibold text-al-primary">
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

            {/* Price history sparkline (System 15 ENH) */}
            {priceHistory.length > 1 && (
              <div className="bg-white border border-slate-200 rounded-xl p-6" data-testid="price-history">
                <h2 className="font-semibold text-slate-900 mb-4 text-sm uppercase tracking-wider">Price History</h2>
                <div className="flex items-end gap-1 h-16 mb-3">
                  {priceHistory.slice(-10).map((point, i) => {
                    const prices = priceHistory.slice(-10).map(p => p.price);
                    const min = Math.min(...prices);
                    const max = Math.max(...prices);
                    const range = max - min || 1;
                    const height = Math.max(8, Math.round(((point.price - min) / range) * 52));
                    const isLatest = i === priceHistory.slice(-10).length - 1;
                    return (
                      <div
                        key={i}
                        data-testid={`price-bar-${i}`}
                        className={`flex-1 rounded-t transition-all ${isLatest ? "bg-al-primary" : "bg-slate-200"}`}
                        style={{ height: `${height}px` }}
                        title={`$${(point.price / 100).toLocaleString()} — ${new Date(point.date).toLocaleDateString()}`}
                      />
                    );
                  })}
                </div>
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>{new Date(priceHistory[Math.max(0, priceHistory.length - 10)].date).toLocaleDateString()}</span>
                  <span className="text-al-primary font-semibold">
                    Current: ${(vehicle.priceCents / 100).toLocaleString()}
                  </span>
                  <span>{new Date(priceHistory[priceHistory.length - 1].date).toLocaleDateString()}</span>
                </div>
              </div>
            )}

            {/* Dealer identity — NEVER expose Lane 2/3 external dealer info to buyer */}
            {vehicle.lane === "LANE_1" && (
              <div className="bg-green-50 border border-green-200 rounded-xl p-5" data-testid="dealer-listed-notice">
                <p className="text-sm font-semibold text-green-800">Listed by a dealer we source from</p>
                <p className="text-xs text-green-600 mt-0.5">
                  AutoLenis has not inspected this vehicle or confirmed it is still available. What
                  gets verified is the dealer&apos;s offer, at the point they make it. Dealer details are
                  revealed after you select a deal.
                </p>
              </div>
            )}
          </div>

          {/* Right column — sticky action panel */}
          <div className="lg:sticky lg:top-24 lg:self-start">
            <VehicleDetailPanel
              vehicleId={vehicle.id}
              priceCents={vehicle.priceCents}
              lane={vehicle.lane}
              budgetFit={budgetFit}
              maxOtdAmountCents={prequal?.maxOtdAmountCents}
              isAuthenticated={!!buyer}
            />
          </div>

        </div>
      </div>
    </div>
  );
}
