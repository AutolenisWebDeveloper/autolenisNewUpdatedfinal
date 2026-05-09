// GET  /api/admin/contract-shield/rules — list all rules
// POST /api/admin/contract-shield/rules — create a new rule
import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const createSchema = z.object({
  name:        z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  ruleType:    z.string().min(1),
  severity:    z.enum(["HIGH", "MEDIUM", "LOW"]),
  isActive:    z.boolean().default(true),
  threshold:   z.number().optional(),
  config:      z.record(z.unknown()).default({}),
});

export async function GET(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const rules = await prisma.contractScanRule.findMany({
    orderBy: [{ severity: "asc" }, { name: "asc" }],
  });
  return adminSuccess({ rules });
}

export async function POST(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);
  if (!["SUPER_ADMIN", "OPERATIONS_ADMIN"].includes(admin.role)) {
    return adminError("FORBIDDEN", "Insufficient permissions", 403);
  }

  const body = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return adminError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid", 400);
  }

  // ContractScanRule has no `threshold` column — fold it into `config` if provided.
  const { threshold, config, ...rest } = parsed.data;
  const mergedConfig: Record<string, unknown> =
    threshold !== undefined ? { ...config, threshold } : { ...config };

  const rule = await prisma.contractScanRule.create({
    data: { ...rest, config: mergedConfig as never },
  });

  await prisma.adminAuditLog.create({
    data: {
      adminId:    admin.adminId,
      adminEmail: admin.email,
      action:     "CONTRACT_SHIELD_RULE_CREATED",
      entityType: "ContractScanRule",
      entityId:   rule.id,
      metadata:   { name: rule.name, ruleType: rule.ruleType },
    },
  }).catch(() => {});

  return adminSuccess({ rule }, 201);
}
