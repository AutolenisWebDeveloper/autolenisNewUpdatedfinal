import { requireDealer } from "@/lib/auth/dealer-session";
import { prisma } from "@/lib/prisma";
import { Badge } from "@/components/ui/badge";
import { Bell } from "lucide-react";
import DealerMarkAllReadButton from "@/components/dealer/DealerMarkAllReadButton";
import { PageContainer, PageHeader, EmptyState } from "@/components/ui/patterns";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function DealerNotificationsPage() {
  const dealer = await requireDealer();
  const notifications = await prisma.notification.findMany({
    where: { dealerId: dealer.id },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const unreadCount = notifications.filter((n) => !n.readAt).length;

  return (
    <PageContainer testId="dealer-notifications-page">
      <PageHeader
        title="Notifications"
        subtitle="Auction, offer, deal, and account updates."
        eyebrow={unreadCount > 0 ? <Badge>{unreadCount} new</Badge> : undefined}
        actions={unreadCount > 0 ? <DealerMarkAllReadButton /> : undefined}
      />
      {notifications.length === 0 ? (
        <EmptyState
          icon={Bell}
          title="No notifications yet"
          body="Updates about your auctions, offers, and deals will appear here."
          testId="no-dealer-notifications"
        />
      ) : (
        <div className="space-y-2">
          {notifications.map((n) => (
            <div
              key={n.id}
              data-testid={`dealer-notification-${n.id}`}
              className={cn(
                "bg-white rounded-2xl shadow-sm p-4 border",
                !n.readAt ? "border-al-primary/25 bg-al-primary-subtle/30" : "border-slate-200/80",
              )}
            >
              {!n.readAt && <div className="w-2 h-2 rounded-full bg-al-primary mb-2" />}
              <p className="font-semibold text-slate-900 text-sm">{n.title}</p>
              <p className="text-sm text-slate-500 mt-0.5">{n.body}</p>
              <p className="text-xs text-slate-500 mt-1 tabular-nums">{n.createdAt.toLocaleDateString()}</p>
            </div>
          ))}
        </div>
      )}
    </PageContainer>
  );
}
