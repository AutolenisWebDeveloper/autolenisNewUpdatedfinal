import { logger } from "@/lib/logger";
import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError, createAuditLog } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const schema = z.object({
  weightOtd:      z.number().min(0).max(1),
  weightMonthly:  z.number().min(0).max(1),
  weightFees:     z.number().min(0).max(1),
  weightJunkFees: z.number().min(0).max(1),
}).refine(
  (d) => Math.abs(d.weightOtd + d.weightMonthly + d.weightFees + d.weightJunkFees - 1) < 0.001,
  { message: "Weights must sum to 1.0" }
);

// GET /api/admin/best-price/weights
export async function GET(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const config = await prisma.bestPriceWeightConfig.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: "desc" },
  });

  if (!config) {
    // Return defaults
    return adminSuccess({
      weightOtd: 0.4, weightMonthly: 0.25, weightFees: 0.2, weightJunkFees: 0.15,
      isDefault: true,
    });
  }

  return adminSuccess({
    id: config.id,
    name: config.name,
    weightOtd: config.weightOtd,
    weightMonthly: config.weightMonthly,
    weightFees: config.weightFees,
    weightJunkFees: config.weightJunkFees,
    updatedAt: config.updatedAt,
    isDefault: false,
  });
}

// PATCH /api/admin/best-price/weights
export async function PATCH(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  if (admin.role !== "SUPER_ADMIN") {
    return adminError("FORBIDDEN", "Only SUPER_ADMIN can modify Best Price Engine weights.", 403);
  }

  let body: unknown;
  try { body = await request.json(); } catch { return adminError("VALIDATION_ERROR", "Invalid JSON", 400); }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return adminError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid weights", 400);
  }

  // Atomically deactivate previous active config and create the new one to
  // prevent a concurrent request from leaving two active configs.
  const config = await prisma.$transaction(async (tx) => {
    await tx.bestPriceWeightConfig.updateMany({
      where: { isActive: true },
      data: { isActive: false },
    });
    return tx.bestPriceWeightConfig.create({
      data: {
        name: `Admin update ${new Date().toISOString().slice(0, 10)}`,
        isActive: true,
        createdBy: admin.adminId,
        ...parsed.data,
      },
    });
  });

  await createAuditLog(admin, request, {
    action: "BEST_PRICE_WEIGHTS_UPDATED",
    entityType: "BestPriceWeightConfig",
    entityId: config.id,
    reason: "Admin updated Best Price Engine scoring weights",
    metadata: { ...parsed.data, configId: config.id },
  }).catch(err => logger.error("[best-price/weights] audit log error:", err));

  return adminSuccess({
    id: config.id,
    name: config.name,
    weightOtd: config.weightOtd,
    weightMonthly: config.weightMonthly,
    weightFees: config.weightFees,
    weightJunkFees: config.weightJunkFees,
    updatedAt: config.updatedAt,
  });
}
