import type { Metadata } from "next";

export const metadata: Metadata = { title: "Notifications" };

// Feature 15 — In-App Notification Center (Phase 3 — Buyer Deal Confidence)
// Shows real Notification records from Prisma.
// Empty state: shown when no notifications exist.
// Data: buyerId-scoped notifications, ordered by createdAt desc, last 50.
import { requireBuyer } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import NotificationCenterClient from "@/components/buyer/NotificationCenterClient";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const buyer = await requireBuyer();
  const notifications = await prisma.notification.findMany({
    where: { buyerId: buyer.id },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true, type: true, title: true, body: true,
      actionUrl: true, readAt: true, createdAt: true,
    },
  });

  const serialized = notifications.map(n => ({
    ...n,
    type: n.type as string,
    readAt: n.readAt?.toISOString() ?? null,
    createdAt: n.createdAt.toISOString(),
  }));

  return <NotificationCenterClient initialNotifications={serialized} />;
}
