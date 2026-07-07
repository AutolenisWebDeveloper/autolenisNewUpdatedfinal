// Admin update/delete for a referral milestone threshold (GAP-CRIT #8).
// Money config → gated to SUPER_ADMIN / FINANCE_ADMIN.
import { NextRequest } from "next/server";
import { getAdminWithRole, adminSuccess, adminError, createAuditLog } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

interface Props { params: Promise<{ id: string }> }

const patchSchema = z.object({
  threshold:   z.number().int().positive().optional(),
  label:       z.string().trim().min(1).max(80).optional(),
  rewardType:  z.enum(["CASH", "CREDIT", "GIFT"]).optional(),
  rewardValue: z.number().int().nonnegative().max(100_000_00).optional(),
  active:      z.boolean().optional(),
}).refine(o => Object.keys(o).length > 0, { message: "No fields to update" });

export async function PATCH(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const admin = await getAdminWithRole(request, ["SUPER_ADMIN", "FINANCE_ADMIN"]);
  if (!admin) return adminError("FORBIDDEN", "Insufficient permissions", 403);

  let body: unknown;
  try { body = await request.json(); } catch { return adminError("VALIDATION_ERROR", "Invalid JSON", 400); }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return adminError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);

  const existing = await prisma.referralMilestoneConfig.findUnique({ where: { id } });
  if (!existing) return adminError("NOT_FOUND", "Config not found", 404);

  // A threshold change must not collide with another tier.
  if (parsed.data.threshold && parsed.data.threshold !== existing.threshold) {
    const clash = await prisma.referralMilestoneConfig.findUnique({ where: { threshold: parsed.data.threshold } });
    if (clash) return adminError("CONFLICT", `A tier for ${parsed.data.threshold} referrals already exists`, 409);
  }

  const config = await prisma.referralMilestoneConfig.update({ where: { id }, data: parsed.data });

  await createAuditLog(admin, request, {
    action: "REFERRAL_MILESTONE_CONFIG_UPDATED",
    entityType: "ReferralMilestoneConfig",
    entityId: id,
    metadata: { before: { threshold: existing.threshold, label: existing.label, rewardValue: existing.rewardValue, active: existing.active }, after: parsed.data },
  }).catch(() => {});

  return adminSuccess({ config });
}

export async function DELETE(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const admin = await getAdminWithRole(request, ["SUPER_ADMIN", "FINANCE_ADMIN"]);
  if (!admin) return adminError("FORBIDDEN", "Insufficient permissions", 403);

  const existing = await prisma.referralMilestoneConfig.findUnique({ where: { id } });
  if (!existing) return adminError("NOT_FOUND", "Config not found", 404);

  await prisma.referralMilestoneConfig.delete({ where: { id } });

  await createAuditLog(admin, request, {
    action: "REFERRAL_MILESTONE_CONFIG_DELETED",
    entityType: "ReferralMilestoneConfig",
    entityId: id,
    metadata: { threshold: existing.threshold, label: existing.label },
  }).catch(() => {});

  return adminSuccess({ deleted: true });
}
