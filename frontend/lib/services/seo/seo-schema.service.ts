// lib/services/seo/seo-schema.service.ts — JSON-LD schema generation
import { prisma } from "@/lib/prisma";
import { SITE_ORIGIN } from "@/lib/seo/site";
import { AUTOLENIS_SAMEAS } from "@/lib/seo/entity-graph";

/**
 * @deprecated Admin-advisory only — NOT the live Organization node. The
 * canonical, @id-bearing Organization is defined in `entityGraphSchema`
 * (`lib/seo/entity-graph.ts`) and rendered once in the root layout. This
 * standalone node has no `@id` and no importers; do not mount it sitewide.
 * `sameAs` is sourced from `AUTOLENIS_SAMEAS` so it cannot drift.
 */
export function generateOrganizationSchema(): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "name": "AutoLenis",
    "url": SITE_ORIGIN,
    "description": "Premium automotive concierge and reverse-auction platform",
    "sameAs": [...AUTOLENIS_SAMEAS],
  };
}

export function generateFaqSchema(faqs: Array<{q: string; a: string}>): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": faqs.map(faq => ({ "@type": "Question", "name": faq.q, "acceptedAnswer": { "@type": "Answer", "text": faq.a } })),
  };
}

export async function savePageSchema(pageSlug: string, schema: Record<string, unknown>) {
  return prisma.seoPageConfig.upsert({ where: { pageSlug }, create: { pageSlug, schema: schema as object }, update: { schema: schema as object } });
}
