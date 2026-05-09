// lib/services/seo/seo-schema.service.ts — JSON-LD schema generation
import { prisma } from "@/lib/prisma";

export function generateOrganizationSchema(): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "name": "AutoLenis",
    "url": process.env.NEXT_PUBLIC_APP_URL ?? "https://autolenis.com",
    "description": "Premium automotive concierge and reverse-auction platform",
    "sameAs": [],
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
