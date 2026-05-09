import { requireDealer } from "@/lib/auth/dealer-session";
import { prisma } from "@/lib/prisma";
import { Badge } from "@/components/ui/badge";
import { Bell } from "lucide-react";
import DealerMarkAllReadButton from "@/components/dealer/DealerMarkAllReadButton";

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
    <div className="p-6 md:p-8 max-w-2xl" data-testid="dealer-notifications-page">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Bell size={22} className="text-[#0B5FD1]" />
          <h1 className="text-xl font-bold text-slate-900">Notifications</h1>
          {unreadCount > 0 && <Badge>{unreadCount} new</Badge>}
        </div>
        {unreadCount > 0 && <DealerMarkAllReadButton />}
      </div>
      {notifications.length === 0 ? (
        <div className="text-center py-16 text-slate-400" data-testid="no-dealer-notifications">
          <Bell size={28} className="mx-auto mb-3 opacity-30" />
          <p>No notifications yet</p>
        </div>
      ) : (
        <div className="space-y-2">
          {notifications.map((n) => (
            <div
              key={n.id}
              data-testid={`dealer-notification-${n.id}`}
              className={`bg-white border rounded-xl p-4 ${!n.readAt ? "border-[#0B5FD1]/20" : "border-slate-200"}`}
            >
              {!n.readAt && <div className="w-2 h-2 rounded-full bg-[#0B5FD1] mb-2" />}
              <p className="font-semibold text-slate-900 text-sm">{n.title}</p>
              <p className="text-sm text-slate-500 mt-0.5">{n.body}</p>
              <p className="text-xs text-slate-400 mt-1">{n.createdAt.toLocaleDateString()}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
