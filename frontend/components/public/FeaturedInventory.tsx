import Link from "next/link";
import { ArrowRight } from "lucide-react";
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

type PlaceholderCard = {
  id: string;
  title: string;
  budgetLabel: string;
  subtitle: string;
};

const PLACEHOLDERS: PlaceholderCard[] = [
  {
    id: "sample-1",
    title: "2024 BMW M5 Competition",
    budgetLabel: "Budget: up to $120,000",
    subtitle: "Performance Sedan",
  },
  {
    id: "sample-2",
    title: "2024 Mercedes-Benz GLE 63 AMG",
    budgetLabel: "Budget: up to $140,000",
    subtitle: "Luxury SUV",
  },
  {
    id: "sample-3",
    title: "2024 Porsche Cayenne Turbo GT",
    budgetLabel: "Budget: up to $185,000",
    subtitle: "Performance SUV",
  },
  {
    id: "sample-4",
    title: "2024 Range Rover Sport SVR",
    budgetLabel: "Budget: up to $130,000",
    subtitle: "Luxury SUV",
  },
  {
    id: "sample-5",
    title: "2023 Mercedes-Benz S 580",
    budgetLabel: "Budget: up to $145,000",
    subtitle: "Luxury Sedan",
  },
  {
    id: "sample-6",
    title: "2024 Audi RS e-tron GT",
    budgetLabel: "Budget: up to $165,000",
    subtitle: "Electric Performance",
  },
];

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

const BADGE_BASE =
  "absolute top-3 left-3 text-[10px] font-bold uppercase tracking-wide px-2.5 py-1 rounded-full";

function badgeFor(status: VehicleRequestStatus): { label: string; classes: string } {
  if (ACTIVE_AUCTION_STATUSES.includes(status)) {
    return {
      label: "ACTIVE AUCTION",
      classes: "bg-green-500 text-white",
    };
  }
  if (SOLD_STATUSES.includes(status)) {
    return {
      label: "SOLD",
      classes: "bg-[#0B5FD1] text-white",
    };
  }
  return {
    label: "VERIFIED",
    classes: "bg-[#0B5FD1] text-white",
  };
}

function formatYear(yearMin: number | null, yearMax: number | null): string {
  if (yearMin && yearMax && yearMin !== yearMax) return `${yearMin}–${yearMax}`;
  if (yearMin) return String(yearMin);
  if (yearMax) return String(yearMax);
  return "";
}

function CardImage({ badge }: { badge: { label: string; classes: string } }) {
  return (
    <div className="relative h-52 overflow-hidden bg-gradient-to-br from-[#0F172A] via-[#1E293B] to-[#0F172A] flex items-center justify-center">
      <span
        aria-hidden
        className="text-white/10 font-black tracking-tighter text-5xl select-none"
      >
        //
      </span>
      <span className={`${BADGE_BASE} ${badge.classes}`}>{badge.label}</span>
    </div>
  );
}

export default async function FeaturedInventory() {
  const requests = await getFeaturedVehicleRequests();
  const placeholderCount = Math.max(0, 6 - requests.length);
  const placeholders = PLACEHOLDERS.slice(0, placeholderCount);

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

        {requests.length === 0 && placeholders.length === 0 ? (
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
            {placeholders.map((p) => (
              <PlaceholderRequestCard key={p.id} placeholder={p} />
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
  const title = titleParts.join(" ").trim() || "Vehicle Request";
  const showAnyVehicleSubtitle = !make && !model;

  return (
    <div
      data-testid={`featured-request-${r.id}`}
      className="bg-white border border-slate-100 rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-shadow duration-200 cursor-pointer flex flex-col"
    >
      <CardImage badge={badge} />

      <div className="px-5 py-4 flex flex-col flex-1">
        <h3 className="text-base font-semibold text-slate-900 mb-0.5 leading-tight">
          {title}
        </h3>

        {showAnyVehicleSubtitle && (
          <p className="text-xs text-slate-500 mb-3">Any Vehicle</p>
        )}

        {r.maxBudgetCents != null && r.maxBudgetCents > 0 && (
          <p className="text-[#0B5FD1] font-semibold text-sm mb-2">
            Budget: up to {formatCents(r.maxBudgetCents)}
          </p>
        )}

        {r._count.offers > 0 && (
          <p className="text-xs text-slate-500 mb-3">
            {r._count.offers} dealer offer{r._count.offers === 1 ? "" : "s"}
          </p>
        )}

        <div className="mt-auto pt-2">
          <Link
            href="/auth/signup"
            className="inline-flex items-center gap-1 text-[#0B5FD1] text-sm font-medium hover:gap-2 transition-all"
          >
            View Opportunity <ArrowRight size={14} />
          </Link>
        </div>
      </div>
    </div>
  );
}

function PlaceholderRequestCard({ placeholder: p }: { placeholder: PlaceholderCard }) {
  const badge = { label: "SAMPLE REQUEST", classes: "bg-slate-500 text-white" };

  return (
    <div
      data-testid={`featured-request-placeholder-${p.id}`}
      className="bg-white border border-slate-100 rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-shadow duration-200 cursor-pointer flex flex-col"
    >
      <CardImage badge={badge} />

      <div className="px-5 py-4 flex flex-col flex-1">
        <h3 className="text-base font-semibold text-slate-900 mb-0.5 leading-tight">
          {p.title}
        </h3>

        <p className="text-xs text-slate-500 mb-3">{p.subtitle}</p>

        <p className="text-[#0B5FD1] font-semibold text-sm mb-2">{p.budgetLabel}</p>

        <div className="mt-auto pt-2">
          <Link
            href="/lp/default"
            className="inline-flex items-center gap-1 text-[#0B5FD1] text-sm font-medium hover:gap-2 transition-all"
          >
            Submit a Similar Request <ArrowRight size={14} />
          </Link>
        </div>
      </div>
    </div>
  );
}
