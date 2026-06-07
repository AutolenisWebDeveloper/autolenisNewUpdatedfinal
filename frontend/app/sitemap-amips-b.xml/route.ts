// AMIPS Phase 2 — Tier B sitemap. ACTIVE pages only; max 50,000 URLs.
import { tierSitemapResponse } from "@/lib/amips/sitemap";

export const revalidate = 3600;

export function GET() {
  return tierSitemapResponse("B");
}
