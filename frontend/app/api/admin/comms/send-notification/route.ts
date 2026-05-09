// POST /api/admin/comms/send-notification
// Sends an in-app notification to a buyer, dealer, affiliate, all buyers, or all active dealers.
// Body: { recipientType: "BUYER"|"DEALER"|"AFFILIATE"|"ALL_BUYERS"|"ALL_ACTIVE_DEALERS"; recipientId?: string; title: string; body: string; actionUrl?: string }
// Creates Notification records using the Prisma model.
// For "All" variants, creates batch notifications.
// Writes AuditLog: ADMIN_NOTIFICATION_SENT
// Requires reason (min 10 chars).

import { NextRequest } from "next/server";
import { getAdminWithRole, OPERATIONAL_ROLES, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const schema = z.object({
  recipientType: z.enum(["BUYER", "DEALER", "AFFILIATE", "ALL_BUYERS", "ALL_ACTIVE_DEALERS"]),
  recipientId: z.string().optional(),
  title: z.string().min(1).max(80, "Title must be at most 80 characters"),
  body: z.string().min(1).max(200, "Body must be at most 200 characters"),
  actionUrl: z.string().url().optional().or(z.literal("")),
  reason: z.string().min(10, "Reason must be at least 10 characters"),
});

export async function POST(request: NextRequest) {
  const admin = await getAdminWithRole(request, OPERATIONAL_ROLES);
  if (!admin) return adminError("FORBIDDEN", "Insufficient permissions. OPERATIONS_ADMIN or higher required.", 403);

  let body: unknown;
  try { body = await request.json(); } catch { return adminError("VALIDATION_ERROR", "Invalid JSON", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return adminError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);

  const { recipientType, recipientId, title, body: notifBody, actionUrl, reason } = parsed.data;
  const isBulk = recipientType === "ALL_BUYERS" || recipientType === "ALL_ACTIVE_DEALERS";

  // Validate recipientId for single-recipient types
  if (!isBulk && !recipientId) {
    return adminError("VALIDATION_ERROR", "recipientId is required for non-bulk notifications", 400);
  }

  const notifActionUrl = actionUrl || null;
  let notificationsCreated = 0;

  if (recipientType === "BUYER" && recipientId) {
    const buyer = await prisma.buyer.findUnique({ where: { id: recipientId }, select: { id: true } });
    if (!buyer) return adminError("NOT_FOUND", "Buyer not found", 404);
    await prisma.notification.create({
      data: { buyerId: recipientId, type: "ADMIN_MESSAGE", channel: "IN_APP", title, body: notifBody, actionUrl: notifActionUrl },
    });
    notificationsCreated = 1;
  } else if (recipientType === "DEALER" && recipientId) {
    const dealer = await prisma.dealer.findUnique({ where: { id: recipientId }, select: { id: true } });
    if (!dealer) return adminError("NOT_FOUND", "Dealer not found", 404);
    await prisma.notification.create({
      data: { dealerId: recipientId, type: "ADMIN_MESSAGE", channel: "IN_APP", title, body: notifBody, actionUrl: notifActionUrl },
    });
    notificationsCreated = 1;
  } else if (recipientType === "AFFILIATE" && recipientId) {
    const affiliate = await prisma.affiliate.findUnique({ where: { id: recipientId }, select: { id: true } });
    if (!affiliate) return adminError("NOT_FOUND", "Affiliate not found", 404);
    await prisma.notification.create({
      data: { affiliateId: recipientId, type: "ADMIN_MESSAGE", channel: "IN_APP", title, body: notifBody, actionUrl: notifActionUrl },
    });
    notificationsCreated = 1;
  } else if (recipientType === "ALL_BUYERS") {
    const buyers = await prisma.buyer.findMany({ select: { id: true } });
    if (buyers.length > 0) {
      await prisma.notification.createMany({
        data: buyers.map(b => ({
          buyerId: b.id,
          type: "ADMIN_MESSAGE" as const,
          channel: "IN_APP" as const,
          title,
          body: notifBody,
          actionUrl: notifActionUrl,
        })),
      });
    }
    notificationsCreated = buyers.length;
  } else if (recipientType === "ALL_ACTIVE_DEALERS") {
    const dealers = await prisma.dealer.findMany({ where: { status: "ACTIVE" }, select: { id: true } });
    if (dealers.length > 0) {
      await prisma.notification.createMany({
        data: dealers.map(d => ({
          dealerId: d.id,
          type: "ADMIN_MESSAGE" as const,
          channel: "IN_APP" as const,
          title,
          body: notifBody,
          actionUrl: notifActionUrl,
        })),
      });
    }
    notificationsCreated = dealers.length;
  }

  const ipAddress = request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip") ?? undefined;

  await prisma.adminAuditLog.create({
    data: {
      adminId: admin.adminId,
      adminEmail: admin.email,
      action: "ADMIN_NOTIFICATION_SENT",
      entityType: isBulk ? "BulkNotification" : recipientType,
      entityId: recipientId ?? recipientType,
      reason,
      ipAddress: ipAddress ?? null,
      metadata: { recipientType, recipientId: recipientId ?? null, notificationsCreated, title },
    },
  });

  return adminSuccess({ sent: notificationsCreated, recipientType });
}
