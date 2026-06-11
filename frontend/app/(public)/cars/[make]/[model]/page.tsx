import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { JsonLd, breadcrumbSchema, itemListSchema, aggregateOfferSchema } from "@/lib/seo/jsonld";
import { buildPageMetadata } from "@/lib/seo/metadata";

export const dynamic = "force-dynamic";
export const revalidate = 3600;

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "https://autolenis.com").trim();

function slugify(value: string): string {
  return value.toLowerCase().trim().replace(/\s+/g, "-");
}

function toTitle(slug: string): string {
  return slug.replace(/-/g, " ").replace(/\b\w/g, l => l.toUpperCase());
}

export async function generateStaticParams() {
  try {
    const combos = await prisma.inventoryItem.findMany({
      where: { isActive: true },
      select: { make: true, model: true },
      distinct: ["make", "model"],
      take: 200,
    });
    return combos.map(c => ({ make: slugify(c.make), model: slugify(c.model) }));
  } catch {
    return [];
  }
}

interface Props {
  params: Promise<{ make: string; model: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { make, model } = await params;
  const makeName = toTitle(make);
  const modelName = toTitle(model);

  return buildPageMetadata({
    title: `Used ${makeName} ${modelName} for Sale | No-Haggle`,
    description: `Browse ${makeName} ${modelName} listings on AutoLenis. Let dealers compete for your business in a private 48-hour auction. Soft-pull prequalification. Your $99 Auction Access Fee is refundable if no valuable offer is received.`,
    path: `/cars/${make}/${model}`,
    keywords: [
      `used ${makeName} ${modelName}`,
      `${makeName} ${modelName} for sale`,
      `${makeName} ${modelName} best price`,
      `buy ${makeName} ${modelName} online`,
      `no haggle ${makeName} ${modelName}`,
    ],
  });
}

export default async function MakeModelPage({ params }: Props) {
  const { make, model } = await params;
  const makeName = toTitle(make);
  const modelName = toTitle(model);

  const vehicles = await prisma.inventoryItem.findMany({
    where: {
      isActive: true,
      make: { equals: makeName, mode: "insensitive" },
      model: { equals: modelName, mode: "insensitive" },
    },
    select: {
      id: true, year: true, make: true, model: true, trim: true,
      priceCents: true, mileage: true, city: true, state: true,
      images: true, condition: true,
    },
    orderBy: { priceCents: "asc" },
    take: 24,
  });

  if (vehicles.length === 0) notFound();

  const totalPrice = vehicles.reduce((s, v) => s + v.priceCents, 0);
  const avgPrice = Math.round(totalPrice / vehicles.length);
  const minPrice = Math.min(...vehicles.map(v => v.priceCents));
  const maxPrice = Math.max(...vehicles.map(v => v.priceCents));

  const breadcrumbs = breadcrumbSchema([
    { name: "Inventory", path: "/inventory" },
    { name: makeName, path: `/cars/${make}` },
    { name: `${makeName} ${modelName}` },
  ]);

  const itemList = itemListSchema({
    name: `Used ${makeName} ${modelName} for Sale`,
    items: vehicles.map(v => ({
      url: `${APP_URL}/inventory/${v.id}`,
      name: `${v.year} ${v.make} ${v.model}${v.trim ? ` ${v.trim}` : ""}`,
    })),
  });

  const aggregate = aggregateOfferSchema({
    name: `${makeName} ${modelName} listings on AutoLenis`,
    offerCount: vehicles.length,
    lowPriceCents: minPrice,
    highPriceCents: maxPrice,
  });

  return (
    <div className="min-h-screen bg-[#F8F9FB]">
      <JsonLd id="ld-breadcrumb" data={breadcrumbs} />
      <JsonLd id="ld-itemlist" data={itemList} />
      <JsonLd id="ld-aggregate-offer" data={aggregate} />

      <section className="bg-white border-b border-[#E5E7EB] py-12 px-6">
        <div className="max-w-5xl mx-auto">
          <nav className="text-xs text-[#94A3B8] mb-4 flex items-center gap-1.5">
            <Link href="/inventory" className="hover:text-[#0B5FD1]">Inventory</Link>
            <span>›</span>
            <Link href={`/cars/${make}`} className="hover:text-[#0B5FD1]">{makeName}</Link>
            <span>›</span>
            <span className="text-[#111827] font-medium">{modelName}</span>
          </nav>

          <h1 className="text-3xl md:text-4xl font-bold text-[#111827] tracking-tight mb-3">
            Used {makeName} {modelName} for Sale
          </h1>
          <p className="text-[#4B5563] text-lg mb-6 max-w-2xl">
            {vehicles.length} {makeName} {modelName} {vehicles.length === 1 ? "listing" : "listings"} available.
            Starting from ${(minPrice / 100).toLocaleString("en-US")}.
            Dealers compete for your business — no negotiation needed.
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

        <div className="mt-10 bg-[#0B5FD1] rounded-2xl p-8 text-center text-white">
          <h2 className="text-2xl font-bold mb-2">
            Get the Best Price on a {makeName} {modelName}
          </h2>
          <p className="text-white/80 mb-6">
            Get prequalified in 3 minutes. Let dealers compete. No negotiation.
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
