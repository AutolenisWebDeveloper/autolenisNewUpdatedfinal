// POST /api/admin/affiliates/[affiliateId]/approve
// Transitions PENDING/SUSPENDED/REJECTED → ACTIVE
// Regenerates referral code if missing. Sends activation email with referral code.
// Requires admin auth, Zod validation, writes audit log via service.

import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { approveAffiliateByAdmin } from "@/lib/services/admin/admin-affiliate-command-center.service";
import { sendAffiliateActivationEmail } from "@/lib/services/email/resend.service";
import { z } from "zod";

interface Props { params: Promise<{ affiliateId: string }> }

const schema = z.object({
  // Default reason used when admin approves without providing one (e.g., from the action menu).
  // Approval does not require an explicit reason; rejection does (it's sent in the rejection email).
  reason: z.string().min(1).default("Approved from admin command center"),
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
        console.error("[affiliates/approve] activation email failed", err);
      }
    }

    return adminSuccess(result);
  } catch (err) {
    return adminError("ACTION_FAILED", err instanceof Error ? err.message : "Approve failed", 400);
  }
}
