// PATCH /api/dealer/notifications/[notificationId]/read — mark a single notification as read.
import { NextRequest } from "next/server";
import { getRequestDealer, successResponse, errorResponse } from "@/lib/auth/dealer-api";
import { prisma } from "@/lib/prisma";

interface Props { params: Promise<{ notificationId: string }> }

export async function PATCH(request: NextRequest, { params }: Props) {
  const dealer = await getRequestDealer(request);
  if (!dealer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);
  const { notificationId } = await params;

  const notification = await prisma.notification.findFirst({
    where: { id: notificationId, dealerId: dealer.id },
  });
  if (!notification) return errorResponse("NOT_FOUND", "Notification not found", 404);

  await prisma.notification.update({
    where: { id: notificationId },
    data: { readAt: notification.readAt ?? new Date() },
  });

  const unreadCount = await prisma.notification.count({
    where: { dealerId: dealer.id, readAt: null },
  });

  return successResponse({ id: notificationId, unreadCount });
}
