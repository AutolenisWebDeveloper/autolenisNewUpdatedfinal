// lib/services/seo/seo-sitemap.service.ts
import { prisma } from "@/lib/prisma";

const STATIC_PAGES = ["/", "/how-it-works", "/for-buyers", "/for-dealers", "/for-affiliates", "/pricing", "/about", "/contact", "/faq", "/trust", "/refinance", "/inventory", "/contract-shield", "/hope"];

export async function generateSitemap(): Promise<string> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://autolenis.com";
  const entries = STATIC_PAGES.map(path => ({ url: `${baseUrl}${path}`, lastmod: new Date().toISOString().split("T")[0], priority: path === "/" ? "1.0" : "0.8" }));
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.map(e => `<url><loc>${e.url}</loc><lastmod>${e.lastmod}</lastmod><priority>${e.priority}</priority></url>`).join("\n")}\n</urlset>`;
  return xml;
}
