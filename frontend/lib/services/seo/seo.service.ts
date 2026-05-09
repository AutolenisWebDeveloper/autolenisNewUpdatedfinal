// lib/services/seo/seo.service.ts — System 22

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

export async function upsertPageConfig(pageSlug: string, data: {
  title?: string; description?: string; ogTitle?: string; ogDescription?: string;
  ogImage?: string; canonicalUrl?: string; schema?: Prisma.InputJsonValue;
}) {
  return prisma.seoPageConfig.upsert({
    where: { pageSlug },
    create: { pageSlug, ...data },
    update: data,
  });
}

export async function getPageConfig(pageSlug: string) {
  return prisma.seoPageConfig.findUnique({ where: { pageSlug } });
}

export async function getAllPageConfigs() {
  return prisma.seoPageConfig.findMany({ orderBy: { pageSlug: "asc" } });
}

export async function computeHealthScore(pageSlug: string): Promise<number> {
  const config = await prisma.seoPageConfig.findUnique({ where: { pageSlug } });
  if (!config) return 0;

  let score = 0;
  if (config.title) score += 25;
  if (config.description) score += 25;
  if (config.ogTitle && config.ogDescription) score += 25;
  if (config.schema) score += 25;

  await prisma.seoPageConfig.update({ where: { pageSlug }, data: { healthScore: score, lastAuditAt: new Date() } });
  return score;
}
