import { logger } from "@/lib/logger";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { prisma } from "@/lib/prisma";
import FeaturedInventoryCarousel from "@/components/public/FeaturedInventoryCarousel";

async function getFeaturedVehicles() {
  try {
    const vehicles = await prisma.inventoryItem.findMany({
      where: { isActive: true },
      orderBy: { createdAt: "desc" },
      take: 36,
      select: {
        id: true,
        year: true,
        make: true,
        model: true,
        trim: true,
        mileage: true,
        priceCents: true,
        images: true,
        externalDealerCity: true,
        externalDealerState: true,
        dealerId: true,
        sourceAdapter: true,
      },
    });

    const sorted = vehicles.sort((a, b) => {
      const pa = a.dealerId ? 0 : (!a.sourceAdapter ? 1 : 2);
      const pb = b.dealerId ? 0 : (!b.sourceAdapter ? 1 : 2);
      if (pa !== pb) return pa - pb;
      return Math.random() - 0.5;
    });

    return sorted.slice(0, 36);
  } catch (err) {
    logger.error("[FeaturedInventory] failed:", err);
    return [];
  }
}

export default async function FeaturedInventory() {
  const vehicles = await getFeaturedVehicles();
  if (vehicles.length === 0) return null;

  return (
    <section
      className="py-24 bg-[#F8F9FB]"
      data-testid="featured-inventory-section"
    >
      <div className="mx-auto max-w-7xl px-6 md:px-12">
        <div className="mb-12 flex items-end justify-between flex-wrap gap-4">
          <div>
            <span className="text-xs font-bold uppercase tracking-[0.15em] text-[#0B5FD1]">
              Featured Opportunities
            </span>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-[#111827] mt-3">
              Vehicles Worth Competing For
            </h2>
          </div>
          <Link
            href="/inventory"
            data-testid="featured-inventory-browse-all"
            className="inline-flex items-center gap-2 text-sm font-semibold text-[#0B5FD1] hover:text-[#0A4DB8] transition-colors"
          >
            Browse All Vehicles <ArrowRight size={14} />
          </Link>
        </div>
        <FeaturedInventoryCarousel vehicles={vehicles} />
      </div>
    </section>
  );
}
