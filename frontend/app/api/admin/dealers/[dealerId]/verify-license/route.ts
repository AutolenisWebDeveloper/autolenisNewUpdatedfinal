// POST /api/admin/dealers/[dealerId]/verify-license
// Batch 2 — authoritative admin verification (or un-verification) of a dealer's
// license. This is the ONLY path that sets DealerVerification.verified = true, and
// therefore the only way (besides an already-verified dealer) to satisfy the
// activation gate when it is enforced.

import { NextRequest } from "next/server";
import { getAdminWithRole, adminSuccess, adminError, OPERATIONAL_ROLES } from "@/lib/auth/admin-api";
import { z } from "zod";
import { verifyDealerLicense } from "@/lib/services/dealer/dealer-verification.service";

interface Props { params: Promise<{ dealerId: string }> }

const schema = z.object({
  verified: z.boolean(),
  reason: z.string().min(5, "Reason must be at least 5 characters"),
});

export async function POST(request: NextRequest, { params }: Props) {
  const { dealerId } = await params;
  const admin = await getAdminWithRole(request, OPERATIONAL_ROLES);
  if (!admin) return adminError("FORBIDDEN", "Operational admin role required to verify a dealer license.", 403);

  let body: unknown;
  try { body = await request.json(); } catch { return adminError("VALIDATION_ERROR", "Invalid JSON", 400); }

  const parsed = schema.safeParse(body);
  if (!parsed.success) return adminError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);

  try {
    const result = await verifyDealerLicense(dealerId, admin.adminId, admin.email, parsed.data.verified, parsed.data.reason);
    return adminSuccess(result);
  } catch (err) {
    return adminError("ACTION_FAILED", err instanceof Error ? err.message : "License verification failed", 400);
  }
}
