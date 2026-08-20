import { requireDealer } from "@/lib/auth/dealer-session";
import { prisma } from "@/lib/prisma";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
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
          {notifications.map((n) => {
            const cardClass = cn(
              "block bg-white rounded-2xl shadow-sm p-4 border",
              !n.readAt ? "border-al-primary/25 bg-al-primary-subtle/30" : "border-slate-200/80",
            );
            const inner = (
              <>
                {!n.readAt && <div className="w-2 h-2 rounded-full bg-al-primary mb-2" />}
                <p className="font-semibold text-slate-900 text-sm">{n.title}</p>
                <p className="text-sm text-slate-500 mt-0.5">{n.body}</p>
                <p className="text-xs text-slate-500 mt-1 tabular-nums">{n.createdAt.toLocaleDateString()}</p>
              </>
            );
            // A notification that carries an actionUrl is a dead end if it can't
            // be followed. Make those rows navigate to the relevant deal/auction
            // (parity with the buyer notification center).
            return n.actionUrl ? (
              <Link
                key={n.id}
                href={n.actionUrl}
                data-testid={`dealer-notification-${n.id}`}
                className={cn(cardClass, "hover:border-al-primary/40 hover:shadow-md transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-al-focus")}
              >
                {inner}
              </Link>
            ) : (
              <div key={n.id} data-testid={`dealer-notification-${n.id}`} className={cardClass}>
                {inner}
              </div>
            );
          })}
        </div>
      )}
    </PageContainer>
  );
}
