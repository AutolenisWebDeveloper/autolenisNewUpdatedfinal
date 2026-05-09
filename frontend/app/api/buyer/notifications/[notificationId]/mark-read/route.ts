import { NextRequest } from "next/server";
import { getRequestBuyer, successResponse, errorResponse } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";

// POST /api/buyer/notifications/[notificationId]/mark-read
// Marks a single notification as read for the authenticated buyer.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ notificationId: string }> },
) {
  const buyer = await getRequestBuyer(request);
  if (!buyer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  const { notificationId } = await params;

  const notification = await prisma.notification.findFirst({
    where: { id: notificationId, buyerId: buyer.id },
    select: { id: true, readAt: true },
  });

  if (!notification) return errorResponse("NOT_FOUND", "Notification not found", 404);
  if (notification.readAt) return successResponse({ alreadyRead: true });

  await prisma.notification.update({
    where: { id: notificationId },
    data: { readAt: new Date() },
  });

  return successResponse({ marked: true });
}
