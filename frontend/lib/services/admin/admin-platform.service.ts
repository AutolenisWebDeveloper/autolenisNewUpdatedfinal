// lib/services/admin/admin-platform.service.ts
import { prisma } from "@/lib/prisma";

export async function getSystemConfig(key: string) {
  const config = await prisma.systemConfiguration.findUnique({ where: { key } });
  return config?.value;
}

export async function setSystemConfig(key: string, value: unknown, updatedBy: string, description?: string) {
  const old = await prisma.systemConfiguration.findUnique({ where: { key } });
  const config = await prisma.systemConfiguration.upsert({
    where: { key },
    create: { key, value: value as object, description, updatedBy },
    update: { value: value as object, updatedBy },
  });
  await prisma.systemConfigHistory.create({ data: { configKey: key, oldValue: old?.value as object ?? null, newValue: value as object, changedBy: updatedBy } }).catch(() => {});
  return config;
}

export async function getAllConfigs() {
  return prisma.systemConfiguration.findMany({ orderBy: { key: "asc" } });
}

export async function getFeatureFlag(key: string): Promise<boolean> {
  const flag = await prisma.featureFlag.findUnique({ where: { key } });
  return flag?.enabled ?? false;
}

export async function setFeatureFlag(key: string, enabled: boolean, updatedBy: string, description?: string) {
  return prisma.featureFlag.upsert({ where: { key }, create: { key, enabled, description, updatedBy }, update: { enabled, updatedBy } });
}
