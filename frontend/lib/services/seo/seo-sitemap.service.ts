// lib/services/seo/seo-sitemap.service.ts
import { SITE_ORIGIN } from "@/lib/seo/site";

const STATIC_PAGES = ["/", "/how-it-works", "/for-buyers", "/for-dealers", "/for-affiliates", "/pricing", "/about", "/contact", "/faq", "/trust", "/refinance", "/inventory", "/contract-shield", "/hope"];

/**
 * @deprecated Admin-advisory only — NOT the live sitemap. The canonical,
 * DB-driven, ISR sitemap is `app/sitemap.ts` (+ `lib/amips/sitemap.ts`).
 * This static generator drifts (e.g. it lists `/hope`) and has no importers.
 * Do not wire into any route handler; use `app/sitemap.ts` instead.
 */
export async function generateSitemap(): Promise<string> {
  const baseUrl = SITE_ORIGIN;
  const entries = STATIC_PAGES.map(path => ({ url: `${baseUrl}${path}`, lastmod: new Date().toISOString().split("T")[0], priority: path === "/" ? "1.0" : "0.8" }));
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.map(e => `<url><loc>${e.url}</loc><lastmod>${e.lastmod}</lastmod><priority>${e.priority}</priority></url>`).join("\n")}\n</urlset>`;
  return xml;
}
