// Admin CRUD for referral milestone thresholds (GAP-CRIT #8).
// GET  — list all configured tiers.
// POST — create a tier. Money config → gated to SUPER_ADMIN / FINANCE_ADMIN.
import { NextRequest } from "next/server";
import { getAdminFromRequest, getAdminWithRole, adminSuccess, adminError, createAuditLog } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const createSchema = z.object({
  threshold:   z.number().int().positive("Threshold must be a positive integer"),
  label:       z.string().trim().min(1).max(80),
  rewardType:  z.enum(["CASH", "CREDIT", "GIFT"]).default("CASH"),
  rewardValue: z.number().int().nonnegative("Reward value (cents) must be ≥ 0").max(100_000_00),
  active:      z.boolean().optional(),
});

export async function GET(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);
  const configs = await prisma.referralMilestoneConfig.findMany({ orderBy: { threshold: "asc" } });
  return adminSuccess({ configs });
}

export async function POST(request: NextRequest) {
  const admin = await getAdminWithRole(request, ["SUPER_ADMIN", "FINANCE_ADMIN"]);
  if (!admin) return adminError("FORBIDDEN", "Insufficient permissions", 403);

  let body: unknown;
  try { body = await request.json(); } catch { return adminError("VALIDATION_ERROR", "Invalid JSON", 400); }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return adminError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);

  const { threshold, label, rewardType, rewardValue, active } = parsed.data;

  const existing = await prisma.referralMilestoneConfig.findUnique({ where: { threshold } });
  if (existing) return adminError("CONFLICT", `A tier for ${threshold} referrals already exists`, 409);

  const config = await prisma.referralMilestoneConfig.create({
    data: { threshold, label, rewardType, rewardValue, active: active ?? true },
  });

  await createAuditLog(admin, request, {
    action: "REFERRAL_MILESTONE_CONFIG_CREATED",
    entityType: "ReferralMilestoneConfig",
    entityId: config.id,
    metadata: { threshold, label, rewardType, rewardValue },
  }).catch(() => {});

  return adminSuccess({ config }, 201);
}
