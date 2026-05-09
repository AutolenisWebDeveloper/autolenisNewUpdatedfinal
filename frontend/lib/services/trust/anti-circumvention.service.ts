// lib/services/trust/anti-circumvention.service.ts
import { prisma } from "@/lib/prisma";
import { AntiCircumventionFlag } from "@prisma/client";

export async function recordCircumventionAttempt(threadId: string, messageId: string, userId: string, flag: AntiCircumventionFlag, pattern: string): Promise<void> {
  await prisma.circumventionAttempt.create({ data: { threadId, messageId, userId, flag, pattern } });
  await prisma.platformAlert.create({
    data: { level: "P1", title: "Anti-Circumvention Flag", body: `Flag: ${flag} in thread ${threadId.slice(-8)}`, source: "messaging" },
  }).catch(() => {});
}

export async function checkCircumventionRisk(userId: string): Promise<{ riskLevel: "LOW" | "MEDIUM" | "HIGH"; attempts: number }> {
  const attempts = await prisma.circumventionAttempt.count({ where: { userId } });
  const riskLevel = attempts >= 3 ? "HIGH" : attempts >= 1 ? "MEDIUM" : "LOW";
  return { riskLevel, attempts };
}
