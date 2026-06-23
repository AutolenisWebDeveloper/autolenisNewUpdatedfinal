// POST /api/admin/dealers/[dealerId]/suspend
import { logger } from "@/lib/logger";
import { NextRequest } from "next/server";
import { getAdminWithRole, adminSuccess, adminError, OPERATIONAL_ROLES } from "@/lib/auth/admin-api";
import { z } from "zod";
import { suspendDealerByAdmin } from "@/lib/services/admin/admin-dealer-command-center.service";
import { prisma } from "@/lib/prisma";
import { sendDealerAccountSuspendedEmail } from "@/lib/services/email/resend.service";

interface Props { params: Promise<{ dealerId: string }> }

const schema = z.object({
  reason: z.string().min(5, "Reason must be at least 5 characters"),
});

export async function POST(request: NextRequest, { params }: Props) {
  const { dealerId } = await params;
  const admin = await getAdminWithRole(request, OPERATIONAL_ROLES);
  if (!admin) return adminError("FORBIDDEN", "Operational admin role required to suspend a dealer.", 403);

  let body: unknown;
  try { body = await request.json(); } catch { return adminError("VALIDATION_ERROR", "Invalid JSON", 400); }

  const parsed = schema.safeParse(body);
  if (!parsed.success) return adminError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);

  try {
    const result = await suspendDealerByAdmin(dealerId, admin.adminId, admin.email, parsed.data.reason);

    // Notify dealer of account suspension — non-blocking.
    const dealer = await prisma.dealer.findUnique({
      where: { id: dealerId },
      include: { user: { select: { email: true } } },
    });
    if (dealer?.user?.email) {
      await sendDealerAccountSuspendedEmail({
        to: dealer.user.email,
        contactName: dealer.dealershipName,
        dealershipName: dealer.dealershipName,
        reasonCategory: parsed.data.reason,
        adminContactEmail: process.env.ADMIN_NOTIFICATION_EMAIL ?? "support@autolenis.com",
      }).catch(err => logger.error("[admin/dealers/suspend] suspend email failed:", err));
    }

    return adminSuccess(result);
  } catch (err) {
    return adminError("ACTION_FAILED", err instanceof Error ? err.message : "Suspend failed", 400);
  }
}
