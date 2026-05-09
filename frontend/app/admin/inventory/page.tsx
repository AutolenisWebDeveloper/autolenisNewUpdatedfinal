import Link from "next/link";
import { requireAdmin } from "@/lib/auth/admin-session";
import { prisma } from "@/lib/prisma";
import InventoryListClient from "./InventoryListClient";
import {
  Map,
  Search,
  TrendingDown,
  Globe,
  PlusCircle,
} from "lucide-react";

export const dynamic = "force-dynamic";

const DISCOVERY_CARDS = [
  {
    href: "/admin/inventory/coverage-map",
    icon: Map,
    title: "Coverage Map",
    body: "Geographic view of where AutoLenis has dealer coverage and where buyers are demanding vehicles.",
    testId: "admin-inventory-nav-coverage-map",
  },
  {
    href: "/admin/inventory/dealer-discovery",
    icon: Search,
    title: "Dealer Discovery",
    body: "Find new dealer partners by market, vehicle mix, and historical performance signals.",
    testId: "admin-inventory-nav-dealer-discovery",
  },
  {
    href: "/admin/inventory/demand-gap",
    icon: TrendingDown,
    title: "Demand Gap",
    body: "Vehicles buyers are searching for that AutoLenis cannot currently source.",
    testId: "admin-inventory-nav-demand-gap",
  },
  {
    href: "/admin/inventory/markets",
    icon: Globe,
    title: "Markets",
    body: "Per-market inventory health, dealer density, and active demand metrics.",
    testId: "admin-inventory-nav-markets",
  },
  {
    href: "/admin/inventory/contributions",
    icon: PlusCircle,
    title: "Contributions",
    body: "Crowd-sourced inventory leads from buyers, affiliates, and external scrapes.",
    testId: "admin-inventory-nav-contributions",
  },
];

export default async function AdminInventoryPage() {
  await requireAdmin();
  const items = await prisma.inventoryItem.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { dealer: { select: { dealershipName: true } } },
  });
  const serialized = items.map((item) => ({
    id: item.id,
    year: item.year,
    make: item.make,
    model: item.model,
    trim: item.trim,
    vin: item.vin,
    priceCents: item.priceCents,
    mileage: item.mileage,
    lane: item.lane,
    isActive: item.isActive,
    sourceAdapter: item.sourceAdapter,
    images: item.images,
    dealerName: item.dealer?.dealershipName ?? null,
    createdAt: item.createdAt.toISOString(),
  }));

  return (
    <>
      {/* Discovery Tools section — surfaces 5 inventory analytics sub-pages
          that previously had no entry from this page. Same card-grid pattern
          used on /admin/refinance for consistency. */}
      <section className="px-6 md:px-8 pt-6 md:pt-8" data-testid="admin-inventory-discovery-section">
        <div className="mb-4">
          <h2 className="text-lg font-bold text-[#111827] tracking-tight">Discovery Tools</h2>
          <p className="text-xs text-[#4B5563] mt-1">
            Insights and outreach tools for managing inventory coverage and demand signals.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          {DISCOVERY_CARDS.map((c) => (
            <Link
              key={c.href}
              href={c.href}
              data-testid={c.testId}
              className="block bg-white border border-[#E5E7EB] rounded-xl p-5 hover:border-[#93C5FD] hover:shadow-sm transition-all"
            >
              <div className="w-10 h-10 rounded-lg bg-[#0B5FD1]/10 flex items-center justify-center mb-4">
                <c.icon size={18} className="text-[#0B5FD1]" />
              </div>
              <h3 className="text-sm font-bold text-[#111827] mb-1.5">{c.title}</h3>
              <p className="text-xs text-[#4B5563] leading-relaxed">{c.body}</p>
            </Link>
          ))}
        </div>
      </section>

      <InventoryListClient initialItems={serialized} />
    </>
  );
}
