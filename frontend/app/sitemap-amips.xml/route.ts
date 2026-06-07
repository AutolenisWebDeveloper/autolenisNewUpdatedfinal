// AMIPS Phase 2 — sitemap index referencing every tier sitemap.
import { sitemapIndexResponse } from "@/lib/amips/sitemap";

export const revalidate = 3600;

export function GET() {
  return sitemapIndexResponse();
}
