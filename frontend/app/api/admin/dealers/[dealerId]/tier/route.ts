// POST /api/admin/dealers/[dealerId]/tier
// Overrides dealer tier (STANDARD/GOLD/PLATINUM/PROBATION).
// Writes AuditLog: DEALER_TIER_OVERRIDDEN with previousState/newState.
// Requires reason (min 10 chars).

import { NextRequest } from "next/server";
import { getAdminWithRole, adminSuccess, adminError, OPERATIONAL_ROLES } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

interface Props { params: Promise<{ dealerId: string }> }

const VALID_TIERS = ["STANDARD", "GOLD", "PLATINUM", "PROBATION"] as const;

const schema = z.object({
  tier: z.enum(VALID_TIERS),
  reason: z.string().min(10, "Reason must be at least 10 characters"),
});

export async function POST(request: NextRequest, { params }: Props) {
  const { dealerId } = await params;
  const admin = await getAdminWithRole(request, OPERATIONAL_ROLES);
  if (!admin) return adminError("FORBIDDEN", "OPERATIONS_ADMIN or higher required for tier changes.", 403);

  const dealer = await prisma.dealer.findUnique({ where: { id: dealerId }, include: { user: true } });
  if (!dealer) return adminError("NOT_FOUND", "Dealer not found", 404);

  let body: unknown;
  try { body = await request.json(); } catch { return adminError("VALIDATION_ERROR", "Invalid JSON", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return adminError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);

  const { tier, reason } = parsed.data;
  const oldTier = dealer.tier;

  const updated = await prisma.dealer.update({
    where: { id: dealerId },
    data: { tier },
    select: { id: true, tier: true },
  });

  const ipAddress = request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip") ?? undefined;

  await prisma.adminAuditLog.create({
    data: {
      adminId: admin.adminId,
      adminEmail: admin.email,
      action: "DEALER_TIER_OVERRIDDEN",
      entityType: "Dealer",
      entityId: dealerId,
      reason,
      previousState: { tier: oldTier },
      newState: { tier },
      ipAddress: ipAddress ?? null,
      metadata: { dealerEmail: dealer.user.email },
    },
  });

  return adminSuccess({ dealer: { id: updated.id, tier: updated.tier } });
}
