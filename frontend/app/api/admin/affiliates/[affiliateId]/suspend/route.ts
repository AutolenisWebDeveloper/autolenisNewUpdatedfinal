// POST /api/admin/affiliates/[affiliateId]/suspend
import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { z } from "zod";
import { suspendAffiliateByAdmin } from "@/lib/services/admin/admin-affiliate-command-center.service";
import { prisma } from "@/lib/prisma";
import { sendAffiliateSuspendedEmail } from "@/lib/services/email/resend.service";

interface Props { params: Promise<{ affiliateId: string }> }

const schema = z.object({
  reason: z.string().min(5, "Reason must be at least 5 characters"),
});

export async function POST(request: NextRequest, { params }: Props) {
  const { affiliateId } = await params;
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  let body: unknown;
  try { body = await request.json(); } catch { return adminError("VALIDATION_ERROR", "Invalid JSON", 400); }

  const parsed = schema.safeParse(body);
  if (!parsed.success) return adminError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);

  try {
    const result = await suspendAffiliateByAdmin(affiliateId, admin.adminId, admin.email, parsed.data.reason);

    // Notify affiliate of suspension with reason — non-blocking.
    const affiliate = await prisma.affiliate.findUnique({
      where: { id: affiliateId },
      include: { user: { select: { email: true } } },
    });
    if (affiliate?.user?.email) {
      const firstName = affiliate.user.email.split("@")[0];
      await sendAffiliateSuspendedEmail(affiliate.user.email, firstName, parsed.data.reason)
        .catch(err => console.error("[affiliates/suspend] suspension email failed:", err));
    }

    return adminSuccess(result);
  } catch (err) {
    return adminError("ACTION_FAILED", err instanceof Error ? err.message : "Suspend failed", 400);
  }
}
