// POST /api/admin/affiliates/commissions/[commissionId]/clawback
// Claws back a commission by creating an OFFSETTING (negative) Commission
// record. The original record is never modified. Affiliate is notified.
// Requires reason (min 10 chars). FINANCE_ADMIN or SUPER_ADMIN only.

import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { z } from "zod";
import { clawbackCommission } from "@/lib/services/admin/admin-affiliate-command-center.service";

interface Props { params: Promise<{ commissionId: string }> }

const schema = z.object({
  reason: z.string().min(10, "Reason must be at least 10 characters"),
});

const ALLOWED_ROLES = new Set(["SUPER_ADMIN", "FINANCE_ADMIN"]);

export async function POST(request: NextRequest, { params }: Props) {
  const { commissionId } = await params;
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);
  if (!ALLOWED_ROLES.has(admin.role)) return adminError("FORBIDDEN", "SUPER_ADMIN or FINANCE_ADMIN required", 403);

  let body: unknown;
  try { body = await request.json(); } catch { return adminError("VALIDATION_ERROR", "Invalid JSON", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return adminError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);

  try {
    const result = await clawbackCommission(commissionId, admin.adminId, admin.email, parsed.data.reason);
    return adminSuccess(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Clawback failed";
    const status = message.includes("not found") ? 404 : 400;
    return adminError("ACTION_FAILED", message, status);
  }
}
