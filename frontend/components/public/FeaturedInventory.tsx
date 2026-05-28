import Link from "next/link";
import { ArrowRight, Car } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { formatCents } from "@/lib/utils";
import { VehicleRequestStatus } from "@prisma/client";

type FeaturedRequest = {
  id: string;
  makePreference: string | null;
  modelPreference: string | null;
  yearMin: number | null;
  yearMax: number | null;
  maxBudgetCents: number | null;
  status: VehicleRequestStatus;
  createdAt: Date;
  _count: { offers: number };
};

async function getFeaturedVehicleRequests(): Promise<FeaturedRequest[]> {
  try {
    return await prisma.vehicleRequest.findMany({
      orderBy: { createdAt: "desc" },
      take: 6,
      select: {
        id: true,
        makePreference: true,
        modelPreference: true,
        yearMin: true,
        yearMax: true,
        maxBudgetCents: true,
        status: true,
        createdAt: true,
        _count: { select: { offers: true } },
      },
    });
  } catch (err) {
    console.error("[FeaturedInventory] failed to load vehicle requests:", err);
    return [];
  }
}

const ACTIVE_AUCTION_STATUSES: VehicleRequestStatus[] = [
  "ACTIVE_SOURCING",
  "OFFER_READY",
  "OFFER_SENT",
];
const SOLD_STATUSES: VehicleRequestStatus[] = [
  "OFFER_ACCEPTED",
  "DEAL_CREATED",
];

function badgeFor(status: VehicleRequestStatus): { label: string; classes: string } {
  if (ACTIVE_AUCTION_STATUSES.includes(status)) {
    return {
      label: "ACTIVE AUCTION",
      classes: "bg-emerald-50 text-emerald-700 border-emerald-200",
    };
  }
  if (SOLD_STATUSES.includes(status)) {
    return {
      label: "SOLD",
      classes: "bg-blue-50 text-blue-700 border-blue-200",
    };
  }
  return {
    label: "VERIFIED",
    classes: "bg-slate-100 text-slate-600 border-slate-200",
  };
}

function formatYear(yearMin: number | null, yearMax: number | null): string {
  if (yearMin && yearMax && yearMin !== yearMax) return `${yearMin}–${yearMax}`;
  if (yearMin) return String(yearMin);
  if (yearMax) return String(yearMax);
  return "";
}

export default async function FeaturedInventory() {
  const requests = await getFeaturedVehicleRequests();

  return (
    <section className="py-24 bg-[#F8F9FB]" data-testid="featured-inventory-section">
      <div className="mx-auto max-w-7xl px-6 md:px-12">
        <div className="mb-12 flex items-end justify-between flex-wrap gap-4">
          <div>
            <span className="text-xs font-bold uppercase tracking-[0.15em] text-[#0B5FD1]">
              Featured Opportunities
            </span>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-[#111827] mt-3">
              Vehicles Worth Competing For
            </h2>
            <p className="mt-3 text-sm text-slate-500 max-w-2xl">
              Real buyer requests where verified dealers are competing right now.
            </p>
          </div>
          <Link
            href="/inventory"
            data-testid="featured-inventory-browse-all"
            className="inline-flex items-center gap-2 text-sm font-semibold text-[#0B5FD1] hover:text-[#0A4DB8] transition-colors"
          >
            Browse All Vehicles <ArrowRight size={14} />
          </Link>
        </div>

        {requests.length === 0 ? (
          <div className="text-center py-16" data-testid="featured-inventory-empty">
            <p className="text-slate-500 text-sm mb-4">
              Be the first to submit a vehicle request and let verified dealers
              compete for you.
            </p>
            <Link
              href="/lp/default"
              className="inline-block bg-[#0B5FD1] text-white rounded-full px-6 py-3 text-sm font-semibold hover:bg-[#1A6FE0] transition-colors"
            >
              Start Your Request — Free
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {requests.map((r) => (
              <RequestCard key={r.id} request={r} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function RequestCard({ request: r }: { request: FeaturedRequest }) {
  const badge = badgeFor(r.status);
  const year = formatYear(r.yearMin, r.yearMax);
  const make = r.makePreference?.trim() || "";
  const model = r.modelPreference?.trim() || "";
  const titleParts = [year, make, model].filter(Boolean);
  const title = titleParts.length > 0 ? titleParts.join(" ") : "Buyer Request";

  return (
    <div
      data-testid={`featured-request-${r.id}`}
      className="bg-white border border-slate-200 rounded-2xl overflow-hidden hover:border-[#93C5FD] hover:shadow-md transition-all flex flex-col"
    >
      <div className="relative bg-slate-100 rounded-t-2xl flex items-center justify-center h-48 overflow-hidden">
        <Car size={48} className="text-slate-300" aria-hidden />
        <span
          className={`absolute top-3 left-3 text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border ${badge.classes}`}
        >
          {badge.label}
        </span>
      </div>

      <div className="p-5 flex flex-col flex-1">
        <h3 className="font-semibold text-slate-900 text-base leading-tight">
          {title}
        </h3>

        {r.maxBudgetCents != null && r.maxBudgetCents > 0 && (
          <p className="mt-3 text-[#0B5FD1] font-semibold text-sm">
            Budget: up to {formatCents(r.maxBudgetCents)}
          </p>
        )}

        {r._count.offers > 0 && (
          <p className="mt-2 text-xs text-slate-500">
            {r._count.offers} dealer offer{r._count.offers === 1 ? "" : "s"}
          </p>
        )}

        <div className="mt-auto pt-4">
          <Link
            href="/auth/signup"
            className="text-[#0B5FD1] text-sm font-medium hover:text-[#1A6FE0] transition-colors"
          >
            View Opportunity →
          </Link>
        </div>
      </div>
    </div>
  );
}
