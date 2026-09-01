// POST /api/admin/affiliates/[affiliateId]/approve
// Transitions PENDING/SUSPENDED/REJECTED → ACTIVE
// Regenerates referral code if missing. Sends activation email with referral code.
// Requires admin auth, Zod validation, writes audit log via service.

import { logger } from "@/lib/logger";
import { NextRequest } from "next/server";
import { adminSuccess, adminError } from "@/lib/auth/admin-api";
import { requirePermissionStrict } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";
import { approveAffiliateByAdmin } from "@/lib/services/admin/admin-affiliate-command-center.service";
import { sendAffiliateActivationEmail } from "@/lib/services/email/resend.service";
import { syncGhlTag } from "@/lib/services/ghl/tag-sync";
import { emitDomainEvent } from "@/lib/events/emit";
import { z } from "zod";

interface Props { params: Promise<{ affiliateId: string }> }

const schema = z.object({
  // Default reason used when admin approves without providing one (e.g., from the action menu).
  // Approval does not require an explicit reason; rejection does (it's sent in the rejection email).
  reason: z.string().min(1).default("Approved from admin command center"),
});

export async function POST(request: NextRequest, { params }: Props) {
  const { affiliateId } = await params;
  // Tier 1 (Finding 5): enforced directly from PERMISSION_ROLES.
  // Gates whether an affiliate can earn commissions.
  const adminCheck = await requirePermissionStrict(request, "affiliates.account_state");
  if (!adminCheck.ok) return adminError(adminCheck.code, adminCheck.message, adminCheck.status);
  const admin = adminCheck.admin;

  let body: unknown = {};
  try { body = await request.json(); } catch { /* body optional */ }

  const parsed = schema.safeParse(body);
  if (!parsed.success) return adminError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);

  try {
    // Service handles status update + audit log
    const result = await approveAffiliateByAdmin(affiliateId, admin.adminId, admin.email, parsed.data.reason);

    // Fetch email for notification (service already updated the record)
    const affiliate = await prisma.affiliate.findUnique({
      where: { id: affiliateId },
      include: { user: { select: { email: true } } },
    });
    if (affiliate?.user?.email && result.referralCode) {
      const firstName = affiliate.user.email.split("@")[0];
      try {
        await sendAffiliateActivationEmail(affiliate.user.email, firstName, result.referralCode);
      } catch (err) {
        logger.error("[affiliates/approve] activation email failed", err);
      }
    }
    syncGhlTag(affiliate?.user?.email, "affiliate-approved");

    // CRM spine: affiliate approved/activated → timeline + Make (non-blocking,
    // never throws). Forward no-ops until MAKE_WEBHOOK_URL is set.
    if (affiliate?.user?.email) {
      await emitDomainEvent("affiliate_approved", {
        domainEntityId: affiliateId,
        contact: {
          email: affiliate.user.email,
          firstName: affiliate.user.email.split("@")[0],
          source: "affiliate_signup",
        },
        data: { affiliate_id: affiliateId, referral_code: result.referralCode, approved_by: admin.email },
      });
    }

    return adminSuccess(result);
  } catch (err) {
    return adminError("ACTION_FAILED", err instanceof Error ? err.message : "Approve failed", 400);
  }
}
