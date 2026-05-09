import { NextRequest } from "next/server";
import { getRequestAffiliate, successResponse, errorResponse } from "@/lib/auth/affiliate-api";
import { prisma } from "@/lib/prisma";

interface Props { params: Promise<{ id: string }> }

// PATCH /api/affiliate/notifications/[id]/read — mark a single notification as read
export async function PATCH(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const affiliate = await getRequestAffiliate(request);
  if (!affiliate) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  const notification = await prisma.notification.findFirst({
    where: { id, affiliateId: affiliate.id },
  });
  if (!notification) return errorResponse("NOT_FOUND", "Notification not found", 404);

  if (notification.readAt) {
    return successResponse({ id: notification.id, readAt: notification.readAt });
  }

  const updated = await prisma.notification.update({
    where: { id },
    data: { readAt: new Date() },
  });

  return successResponse({ id: updated.id, readAt: updated.readAt });
}
