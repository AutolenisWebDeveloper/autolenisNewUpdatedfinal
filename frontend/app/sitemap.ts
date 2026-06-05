import type { MetadataRoute } from "next";
import { prisma } from "@/lib/prisma";
import { SEO_LOCATIONS } from "@/lib/seo/locations";

const BASE = (process.env.NEXT_PUBLIC_APP_URL ?? "https://autolenis.com").trim();

// 1-hour ISR — sitemap is built from DB and should not be regenerated on every
// request, but should refresh frequently enough to reflect new inventory.
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const staticEntries: MetadataRoute.Sitemap = [
    { url: `${BASE}/`,                priority: 1.0, changeFrequency: "daily",   lastModified: now },
    { url: `${BASE}/inventory`,        priority: 0.9, changeFrequency: "hourly",  lastModified: now },
    { url: `${BASE}/pricing`,          priority: 0.8, changeFrequency: "monthly", lastModified: now },
    { url: `${BASE}/how-it-works`,     priority: 0.8, changeFrequency: "monthly", lastModified: now },
    { url: `${BASE}/for-buyers`,       priority: 0.7, changeFrequency: "monthly", lastModified: now },
    { url: `${BASE}/for-dealers`,      priority: 0.7, changeFrequency: "monthly", lastModified: now },
    { url: `${BASE}/for-affiliates`,   priority: 0.7, changeFrequency: "monthly", lastModified: now },
    { url: `${BASE}/refinance`,        priority: 0.7, changeFrequency: "weekly",  lastModified: now },
    { url: `${BASE}/trust`,            priority: 0.6, changeFrequency: "monthly", lastModified: now },
    { url: `${BASE}/contract-shield`,  priority: 0.6, changeFrequency: "monthly", lastModified: now },
    { url: `${BASE}/faq`,              priority: 0.6, changeFrequency: "monthly", lastModified: now },
    { url: `${BASE}/about`,            priority: 0.5, changeFrequency: "monthly", lastModified: now },
    { url: `${BASE}/contact`,          priority: 0.5, changeFrequency: "monthly", lastModified: now },
    // High/medium-impact pages
    { url: `${BASE}/insurance`,         priority: 0.7, changeFrequency: "monthly", lastModified: now },
    { url: `${BASE}/request-vehicle`,    priority: 0.7, changeFrequency: "monthly", lastModified: now },
    { url: `${BASE}/dealer-application`, priority: 0.6, changeFrequency: "monthly", lastModified: now },
    // Free buyer tools (Phase C-Tools)
    { url: `${BASE}/tools`,                       priority: 0.7, changeFrequency: "monthly", lastModified: now },
    { url: `${BASE}/tools/dealer-fee-calculator`, priority: 0.8, changeFrequency: "monthly", lastModified: now },
    // Hope — System 25 brand differentiation page (intentionally indexed)
    { url: `${BASE}/hope`,              priority: 0.3, changeFrequency: "monthly", lastModified: now },
    // Legal pages (low priority but indexable)
    { url: `${BASE}/legal/terms`,           priority: 0.3, changeFrequency: "yearly",  lastModified: now },
    { url: `${BASE}/legal/privacy`,         priority: 0.3, changeFrequency: "yearly",  lastModified: now },
    { url: `${BASE}/legal/affiliate-terms`, priority: 0.2, changeFrequency: "yearly",  lastModified: now },
    { url: `${BASE}/legal/cookie-policy`,   priority: 0.2, changeFrequency: "yearly",  lastModified: now },
    { url: `${BASE}/legal/dealer-terms`,    priority: 0.2, changeFrequency: "yearly",  lastModified: now },
    { url: `${BASE}/legal/prequal-consent`, priority: 0.2, changeFrequency: "yearly",  lastModified: now },
    // Programmatic SEO category pages
    { url: `${BASE}/cars/suv`,          priority: 0.8, changeFrequency: "daily",   lastModified: now },
    { url: `${BASE}/cars/trucks`,       priority: 0.8, changeFrequency: "daily",   lastModified: now },
    { url: `${BASE}/cars/sedans`,       priority: 0.8, changeFrequency: "daily",   lastModified: now },
    { url: `${BASE}/cars/under-25000`,  priority: 0.8, changeFrequency: "daily",   lastModified: now },
    { url: `${BASE}/cars/under-30000`,  priority: 0.8, changeFrequency: "daily",   lastModified: now },
    { url: `${BASE}/cars/under-40000`,  priority: 0.8, changeFrequency: "daily",   lastModified: now },
    // Anchor state landing page
    { url: `${BASE}/cars/texas`,        priority: 0.7, changeFrequency: "weekly",  lastModified: now },
    // Hybrid SEO landing system — organic state hub (/lp/* is intentionally
    // excluded: paid funnel, noindex).
    { url: `${BASE}/car-buying-service/texas`, priority: 0.9, changeFrequency: "weekly", lastModified: now },
  ];

  // Programmatic car-buying-service city pages — driven by SEO_LOCATIONS.
  const carBuyingServiceEntries: MetadataRoute.Sitemap = SEO_LOCATIONS.map((loc) => ({
    url: `${BASE}/car-buying-service/${loc.slug}`,
    priority: 0.8,
    changeFrequency: "weekly" as const,
    lastModified: now,
  }));

  // Vehicle detail pages — pulled live from DB
  let vehicleEntries: MetadataRoute.Sitemap = [];
  try {
    const vehicles = await prisma.inventoryItem.findMany({
      where: { isActive: true },
      select: { id: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
      take: 5000,
    });
    vehicleEntries = vehicles.map(v => ({
      url: `${BASE}/inventory/${v.id}`,
      lastModified: v.updatedAt,
      changeFrequency: "weekly" as const,
      priority: 0.6,
    }));
  } catch {
    // DB unavailable at build — return static only
  }

  // Programmatic make/model pages from DB
  let makeModelEntries: MetadataRoute.Sitemap = [];
  let makeEntries: MetadataRoute.Sitemap = [];
  try {
    const combos = await prisma.inventoryItem.findMany({
      where: { isActive: true },
      select: { make: true, model: true },
      distinct: ["make", "model"],
      take: 200,
    });
    const slugify = (v: string) => v.toLowerCase().replace(/\s+/g, "-");
    makeModelEntries = combos.map(c => ({
      url: `${BASE}/cars/${slugify(c.make)}/${slugify(c.model)}`,
      priority: 0.7,
      changeFrequency: "daily" as const,
      lastModified: now,
    }));
    const makes = Array.from(new Set(combos.map(c => slugify(c.make))));
    makeEntries = makes.map(m => ({
      url: `${BASE}/cars/${m}`,
      priority: 0.7,
      changeFrequency: "daily" as const,
      lastModified: now,
    }));
  } catch {
    // DB unavailable — skip programmatic entries
  }

  return [...staticEntries, ...carBuyingServiceEntries, ...makeEntries, ...makeModelEntries, ...vehicleEntries];
}
