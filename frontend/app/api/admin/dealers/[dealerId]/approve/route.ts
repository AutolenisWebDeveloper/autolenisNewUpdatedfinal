// POST /api/admin/dealers/[dealerId]/approve
import { logger } from "@/lib/logger";
import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { z } from "zod";
import { approveDealerByAdmin } from "@/lib/services/admin/admin-dealer-command-center.service";
import { prisma } from "@/lib/prisma";
import { sendDealerAccountApprovedEmail } from "@/lib/services/email/resend.service";
import { syncGhlTag } from "@/lib/services/ghl/tag-sync";
import { emitDomainEvent } from "@/lib/events/emit";

interface Props { params: Promise<{ dealerId: string }> }

const schema = z.object({
  reason: z.string().min(5, "Reason must be at least 5 characters"),
});

export async function POST(request: NextRequest, { params }: Props) {
  const { dealerId } = await params;
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  let body: unknown;
  try { body = await request.json(); } catch { return adminError("VALIDATION_ERROR", "Invalid JSON", 400); }

  const parsed = schema.safeParse(body);
  if (!parsed.success) return adminError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);

  try {
    const result = await approveDealerByAdmin(dealerId, admin.adminId, admin.email, parsed.data.reason);

    // Notify dealer that their account is now active — non-blocking.
    const dealer = await prisma.dealer.findUnique({
      where: { id: dealerId },
      include: { user: { select: { email: true } } },
    });
    const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "https://autolenis.com").trim();
    if (dealer?.user?.email) {
      await sendDealerAccountApprovedEmail({
        to: dealer.user.email,
        contactName: dealer.dealershipName,
        dealershipName: dealer.dealershipName,
        dashboardUrl: `${appUrl}/dealer/dashboard`,
      }).catch(err => logger.error("[admin/dealers/approve] account approved email failed:", err));
    }
    syncGhlTag(dealer?.user?.email, "dealer-approved");

    // CRM spine: dealer verified/approved → timeline + Make (non-blocking, never
    // throws). Forward no-ops until MAKE_WEBHOOK_URL is set.
    if (dealer?.user?.email) {
      await emitDomainEvent("dealer_verified", {
        domainEntityId: dealerId,
        contact: {
          email: dealer.user.email,
          firstName: dealer.dealershipName ?? undefined,
          source: "dealer_signup",
        },
        data: { dealer_id: dealerId, dealership_name: dealer.dealershipName, approved_by: admin.email },
      });
    }

    return adminSuccess(result);
  } catch (err) {
    return adminError("ACTION_FAILED", err instanceof Error ? err.message : "Approve failed", 400);
  }
}
