// lib/services/vehicle-request/vehicle-request-analytics.service.ts
import { prisma } from "@/lib/prisma";

export async function getRequestAnalytics(days = 30) {
  const since = new Date(Date.now() - days * 24 * 3600000);
  const [total, active, offersSent, dealsCreated, cancelled] = await Promise.all([
    prisma.vehicleRequest.count({ where: { createdAt: { gte: since } } }),
    prisma.vehicleRequest.count({ where: { status: { in: ["SUBMITTED", "INTAKE", "ACTIVE_SOURCING"] } } }),
    prisma.vehicleRequest.count({ where: { status: "OFFER_SENT" } }),
    prisma.vehicleRequest.count({ where: { status: "DEAL_CREATED" } }),
    prisma.vehicleRequest.count({ where: { status: "CANCELLED", updatedAt: { gte: since } } }),
  ]);
  const conversionRate = total > 0 ? Math.round((dealsCreated / total) * 100) : 0;
  return { total, active, offersSent, dealsCreated, cancelled, conversionRate, period: `${days}d` };
}
