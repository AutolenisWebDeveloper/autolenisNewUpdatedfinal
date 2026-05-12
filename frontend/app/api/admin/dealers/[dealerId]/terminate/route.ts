// POST /api/admin/dealers/[dealerId]/terminate
import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { z } from "zod";
import { terminateDealerByAdmin } from "@/lib/services/admin/admin-dealer-command-center.service";
import { prisma } from "@/lib/prisma";
import { sendDealerAccountTerminatedEmail } from "@/lib/services/email/resend.service";

interface Props { params: Promise<{ dealerId: string }> }

const schema = z.object({
  reason: z.string().min(5, "Reason must be at least 5 characters"),
});

export async function POST(request: NextRequest, { params }: Props) {
  const { dealerId } = await params;
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  if (admin.role !== "SUPER_ADMIN") {
    return adminError("FORBIDDEN", "Only SUPER_ADMIN can terminate dealer accounts.", 403);
  }

  let body: unknown;
  try { body = await request.json(); } catch { return adminError("VALIDATION_ERROR", "Invalid JSON", 400); }

  const parsed = schema.safeParse(body);
  if (!parsed.success) return adminError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);

  try {
    const result = await terminateDealerByAdmin(dealerId, admin.adminId, admin.email, parsed.data.reason);

    try {
      const dealer = await prisma.dealer.findUnique({
        where: { id: dealerId },
        include: { user: { select: { email: true } } },
      });
      if (dealer?.user?.email) {
        await sendDealerAccountTerminatedEmail({
          to: dealer.user.email,
          contactName: dealer.dealershipName,
          dealershipName: dealer.dealershipName,
        });
      }
    } catch (err) {
      console.error("[dealers/terminate] terminated email failed:", err);
    }

    return adminSuccess(result);
  } catch (err) {
    return adminError("ACTION_FAILED", err instanceof Error ? err.message : "Terminate failed", 400);
  }
}
