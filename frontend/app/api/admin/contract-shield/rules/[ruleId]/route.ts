// PATCH  /api/admin/contract-shield/rules/[ruleId] — update a rule
// DELETE /api/admin/contract-shield/rules/[ruleId] — delete a rule
import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

interface Props { params: Promise<{ ruleId: string }> }

const updateSchema = z.object({
  name:        z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional().nullable(),
  severity:    z.enum(["HIGH", "MEDIUM", "LOW"]).optional(),
  isActive:    z.boolean().optional(),
  threshold:   z.number().optional().nullable(),
  config:      z.record(z.unknown()).optional(),
});

export async function PATCH(request: NextRequest, { params }: Props) {
  const { ruleId } = await params;
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);
  if (!["SUPER_ADMIN", "OPERATIONS_ADMIN"].includes(admin.role)) {
    return adminError("FORBIDDEN", "Insufficient permissions", 403);
  }

  const body = await request.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return adminError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid", 400);
  }

  // ContractScanRule has no `threshold` column — fold it into `config` if provided.
  const { threshold, config, ...rest } = parsed.data;
  const data: Record<string, unknown> = { ...rest };
  if (threshold !== undefined || config !== undefined) {
    const existing = await prisma.contractScanRule.findUnique({ where: { id: ruleId } });
    if (!existing) return adminError("NOT_FOUND", "Rule not found", 404);
    const baseConfig =
      config ?? ((existing.config as Record<string, unknown> | null) ?? {});
    const merged: Record<string, unknown> = { ...baseConfig };
    if (threshold === null) {
      delete merged.threshold;
    } else if (threshold !== undefined) {
      merged.threshold = threshold;
    }
    data.config = merged as never;
  }

  const rule = await prisma.contractScanRule.update({
    where: { id: ruleId },
    data,
  }).catch(() => null);

  if (!rule) return adminError("NOT_FOUND", "Rule not found", 404);

  await prisma.adminAuditLog.create({
    data: {
      adminId:    admin.adminId,
      adminEmail: admin.email,
      action:     "CONTRACT_SHIELD_RULE_UPDATED",
      entityType: "ContractScanRule",
      entityId:   ruleId,
      metadata:   JSON.parse(JSON.stringify(parsed.data)) as never,
    },
  }).catch(() => {});

  return adminSuccess({ rule });
}

export async function DELETE(request: NextRequest, { params }: Props) {
  const { ruleId } = await params;
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);
  if (admin.role !== "SUPER_ADMIN") {
    return adminError("FORBIDDEN", "Only SUPER_ADMIN can delete rules", 403);
  }

  await prisma.contractScanRule.delete({ where: { id: ruleId } }).catch(() => null);

  await prisma.adminAuditLog.create({
    data: {
      adminId:    admin.adminId,
      adminEmail: admin.email,
      action:     "CONTRACT_SHIELD_RULE_DELETED",
      entityType: "ContractScanRule",
      entityId:   ruleId,
    },
  }).catch(() => {});

  return adminSuccess({ deleted: true });
}
