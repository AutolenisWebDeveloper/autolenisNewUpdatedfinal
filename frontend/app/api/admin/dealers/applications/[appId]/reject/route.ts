// POST /api/admin/dealers/applications/[appId]/reject

import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { getAdminFromRequest } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import {
  sendDealerApplicationRejectedEmail,
  sendDealerRejectionEmail,
} from "@/lib/services/email/resend.service";

interface RouteContext { params: Promise<{ appId: string }> }

export async function POST(request: NextRequest, { params }: RouteContext) {
  const admin = await getAdminFromRequest(request);
  if (!admin) {
    return NextResponse.json(
      { error: { code: "UNAUTHENTICATED", message: "Admin session required" } },
      { status: 401 },
    );
  }
  const { appId } = await params;

  let reason: string | undefined;
  try {
    const body = await request.json();
    reason = body.reason as string | undefined;
  } catch { /* no body required */ }

  const app = await prisma.dealerApplication.findUnique({ where: { id: appId } });
  if (!app) return NextResponse.json({ error: "Application not found" }, { status: 404 });
  if (app.status !== "PENDING") return NextResponse.json({ error: "Application already reviewed" }, { status: 409 });

  await prisma.dealerApplication.update({
    where: { id: appId },
    data: {
      status: "REJECTED",
      reviewedBy: admin.adminId,
      reviewedAt: new Date(),
      rejectReason: reason ?? null,
    },
  });

  await prisma.adminAuditLog.create({
    data: {
      adminId: admin.adminId,
      adminEmail: admin.email,
      action: "STATUS_CHANGE",
      entityType: "DealerApplication",
      entityId: appId,
      reason: reason ?? "Application rejected",
    },
  }).catch(() => {});

  try {
    await sendDealerApplicationRejectedEmail({ to: app.contactEmail, contactName: app.contactName, dealershipName: app.dealershipName });
  } catch (err) {
    logger.error("[dealer/applications/reject] Email error:", err);
  }

  // Plain-text rejection notice with optional reason — non-blocking.
  await sendDealerRejectionEmail(app.contactEmail, app.contactName, reason)
    .catch(err => logger.error("[dealer/applications/reject] rejection email failed:", err));

  return NextResponse.json({ success: true });
}
