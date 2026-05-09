// lib/services/identity/ofac.service.ts
import { prisma } from "@/lib/prisma";

export async function handleOfacEscalation(buyerId: string): Promise<void> {
  // CRITICAL: OFAC flag = immediate manual review, NEVER auto-approve
  await prisma.preQualification.updateMany({ where: { buyerId }, data: { decision: "OFAC_ESCALATED" } });
  await prisma.platformAlert.create({
    data: { level: "P0", title: "OFAC Escalation — Immediate Review Required", body: `Buyer ${buyerId} pre-qual flagged for OFAC review. DO NOT auto-approve.`, source: "prequal" },
  }).catch(() => {});
  await prisma.notification.create({ data: { title: "OFAC Alert", body: `Buyer ${buyerId} flagged for manual OFAC review`, type: "SYSTEM_ALERT" } }).catch(() => {});
}

export function isOfacCleared(checkOfacAlert: boolean): boolean {
  return !checkOfacAlert; // Must be false to proceed
}
