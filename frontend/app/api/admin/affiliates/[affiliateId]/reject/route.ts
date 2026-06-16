// POST /api/admin/affiliates/[affiliateId]/reject
// Transitions affiliate → REJECTED. Sends polite rejection email.
// Requires admin auth, Zod validation, writes audit log via service.
// Note: rejection requires an explicit reason (unlike approval which has a default) because
// the reason is included in the rejection email sent to the affiliate applicant.

import { logger } from "@/lib/logger";
import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { rejectAffiliateByAdmin } from "@/lib/services/admin/admin-affiliate-command-center.service";
import { sendAffiliateRejectionEmail } from "@/lib/services/email/resend.service";
import { z } from "zod";

interface Props { params: Promise<{ affiliateId: string }> }

const schema = z.object({
  reason: z.string().min(1, "Reason is required"),
});

export async function POST(request: NextRequest, { params }: Props) {
  const { affiliateId } = await params;
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  let body: unknown = {};
  try { body = await request.json(); } catch { /* body optional */ }

  const parsed = schema.safeParse(body);
  if (!parsed.success) return adminError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);

  try {
    // Service handles status update + audit log
    const result = await rejectAffiliateByAdmin(affiliateId, admin.adminId, admin.email, parsed.data.reason);

    // Fetch email for rejection notification
    const affiliate = await prisma.affiliate.findUnique({
      where: { id: affiliateId },
      include: { user: { select: { email: true } } },
    });
    if (affiliate?.user?.email) {
      const firstName = affiliate.user.email.split("@")[0];
      try {
        await sendAffiliateRejectionEmail(affiliate.user.email, firstName, parsed.data.reason);
      } catch (err) {
        logger.error("[affiliates/reject] rejection email failed", err);
      }
    }

    return adminSuccess(result);
  } catch (err) {
    return adminError("ACTION_FAILED", err instanceof Error ? err.message : "Reject failed", 400);
  }
}
