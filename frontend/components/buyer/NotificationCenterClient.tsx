// Feature 15 — In-App Notification Center
// Enhanced notification center with per-item mark-as-read, type icons, and action links.
// Data: real Notification records from Prisma. Empty state shown when no notifications exist.
"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  Bell, CheckCheck, CheckCircle2, Gavel, Car, CreditCard, FileText,
  PenLine, MapPin, TrendingUp, AlertCircle, Gift, ArrowRight,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { emitNotificationsCleared } from "@/lib/events/notifications";

interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string;
  actionUrl: string | null;
  readAt: string | null;
  createdAt: string;
}

interface Props {
  initialNotifications: NotificationItem[];
}

// Map notification type → icon + accent color
function getTypeDisplay(type: string): { Icon: React.ElementType; color: string; bg: string } {
  const MAP: Record<string, { Icon: React.ElementType; color: string; bg: string }> = {
    AUCTION_STARTED:      { Icon: Gavel,        color: "text-amber-600",  bg: "bg-amber-50" },
    AUCTION_CLOSING_SOON: { Icon: Gavel,        color: "text-orange-600", bg: "bg-orange-50" },
    OFFER_RECEIVED:       { Icon: Gavel,        color: "text-amber-600",  bg: "bg-amber-50" },
    DEAL_SELECTED:        { Icon: Car,          color: "text-[#0B5FD1]",  bg: "bg-[#0B5FD1]/8" },
    DEAL_STAGE_CHANGED:   { Icon: Car,          color: "text-[#0B5FD1]",  bg: "bg-[#0B5FD1]/8" },
    CONTRACT_READY:       { Icon: FileText,     color: "text-blue-600",   bg: "bg-blue-50" },
    CONTRACT_APPROVED:    { Icon: CheckCircle2, color: "text-green-600",  bg: "bg-green-50" },
    SIGNING_READY:        { Icon: PenLine,      color: "text-indigo-600", bg: "bg-indigo-50" },
    PICKUP_SCHEDULED:     { Icon: MapPin,       color: "text-teal-600",   bg: "bg-teal-50" },
    PICKUP_READY:         { Icon: MapPin,       color: "text-teal-600",   bg: "bg-teal-50" },
    PREQUAL_APPROVED:     { Icon: TrendingUp,   color: "text-green-600",  bg: "bg-green-50" },
    PREQUAL_DECLINED:     { Icon: AlertCircle,  color: "text-red-500",    bg: "bg-red-50" },
    DEPOSIT_CONFIRMED:    { Icon: CheckCircle2, color: "text-green-600",  bg: "bg-green-50" },
    FEE_PAID:             { Icon: CreditCard,   color: "text-green-600",  bg: "bg-green-50" },
    INSURANCE_BOUND:      { Icon: CheckCircle2, color: "text-green-600",  bg: "bg-green-50" },
    COMMISSION_EARNED:    { Icon: Gift,         color: "text-purple-600", bg: "bg-purple-50" },
    COMMISSION_PAID:      { Icon: Gift,         color: "text-purple-600", bg: "bg-purple-50" },
    REFERRAL_SIGNED_UP:   { Icon: Gift,         color: "text-purple-600", bg: "bg-purple-50" },
    REFERRAL_DEAL_COMPLETED: { Icon: Gift,      color: "text-purple-600", bg: "bg-purple-50" },
    SYSTEM_ALERT:         { Icon: AlertCircle,  color: "text-slate-600",  bg: "bg-slate-50" },
    ADMIN_MESSAGE:        { Icon: AlertCircle,  color: "text-slate-600",  bg: "bg-slate-50" },
    REQUEST_STATUS_UPDATE:{ Icon: CheckCircle2, color: "text-blue-600",   bg: "bg-blue-50" },
    OFFER_SENT:           { Icon: Gavel,        color: "text-amber-600",  bg: "bg-amber-50" },
    OFFER_ACCEPTED:       { Icon: CheckCircle2, color: "text-green-600",  bg: "bg-green-50" },
    OFFER_DECLINED:       { Icon: AlertCircle,  color: "text-red-500",    bg: "bg-red-50" },
  };
  return MAP[type] ?? { Icon: Bell, color: "text-slate-500", bg: "bg-slate-50" };
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

export default function NotificationCenterClient({ initialNotifications }: Props) {
  const [notifications, setNotifications] = useState(initialNotifications);
  const [isPending, startTransition] = useTransition();

  const unreadCount = notifications.filter(n => !n.readAt).length;

  async function markOneRead(id: string) {
    // Optimistic update — revert on failure
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, readAt: new Date().toISOString() } : n));
    try {
      const res = await fetch(`/api/buyer/notifications/${id}/mark-read`, { method: "POST" });
      if (!res.ok) {
        // Revert optimistic update
        setNotifications(prev => prev.map(n => n.id === id ? { ...n, readAt: null } : n));
      }
    } catch {
      // Revert optimistic update on network error
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, readAt: null } : n));
    }
  }

  function markAllRead() {
    startTransition(async () => {
      const now = new Date().toISOString();
      setNotifications(prev => prev.map(n => ({ ...n, readAt: n.readAt ?? now })));
      try {
        await fetch("/api/buyer/notifications/mark-read", { method: "POST" });
        emitNotificationsCleared();
      } catch {
        // Non-critical — page will show correct state on next load
      }
    });
  }

  return (
    <div className="p-6 md:p-8 max-w-2xl" data-testid="notification-center">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Bell size={22} className="text-[#0B5FD1]" />
          <h1 className="text-xl font-bold text-slate-900">Notifications</h1>
          {unreadCount > 0 && (
            <Badge data-testid="unread-badge">{unreadCount} new</Badge>
          )}
        </div>
        {unreadCount > 0 && (
          <button
            onClick={markAllRead}
            disabled={isPending}
            data-testid="mark-all-read-btn"
            className="flex items-center gap-1.5 text-xs text-[#0B5FD1] font-semibold hover:underline disabled:opacity-50"
          >
            <CheckCheck size={14} /> Mark all read
          </button>
        )}
      </div>

      {/* Empty state */}
      {notifications.length === 0 ? (
        <div className="text-center py-20 text-slate-400" data-testid="no-notifications">
          <Bell size={32} className="mx-auto mb-3 opacity-30" />
          <p className="font-medium text-slate-600 mb-1">No notifications yet</p>
          <p className="text-sm">You&apos;ll be notified here about auction updates, deal progress, and important actions.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {notifications.map((n) => {
            const { Icon, color, bg } = getTypeDisplay(n.type);
            const isUnread = !n.readAt;
            return (
              <div
                key={n.id}
                data-testid={`notification-${n.id}`}
                className={`bg-white border rounded-xl p-4 transition-colors group ${isUnread ? "border-[#0B5FD1]/25 shadow-sm" : "border-slate-200"}`}
              >
                <div className="flex items-start gap-3">
                  {/* Icon */}
                  <div className={`w-9 h-9 rounded-full ${bg} flex items-center justify-center shrink-0 mt-0.5`}>
                    <Icon size={16} className={color} />
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        {isUnread && (
                          <div className="w-2 h-2 rounded-full bg-[#0B5FD1] mb-1.5" data-testid={`unread-dot-${n.id}`} />
                        )}
                        <p className={`text-sm font-semibold ${isUnread ? "text-slate-900" : "text-slate-700"}`}>
                          {n.title}
                        </p>
                        <p className="text-slate-500 text-sm mt-0.5 leading-relaxed">{n.body}</p>
                      </div>
                      <p className="text-xs text-slate-400 shrink-0">{timeAgo(n.createdAt)}</p>
                    </div>

                    {/* Action row */}
                    <div className="flex items-center gap-3 mt-2.5">
                      {n.actionUrl && (
                        <Link
                          href={n.actionUrl}
                          data-testid={`notification-action-${n.id}`}
                          className={`flex items-center gap-1 text-xs font-semibold ${color} hover:underline`}
                          onClick={() => { if (isUnread) markOneRead(n.id); }}
                        >
                          View <ArrowRight size={11} />
                        </Link>
                      )}
                      {isUnread && (
                        <button
                          onClick={() => markOneRead(n.id)}
                          data-testid={`mark-read-${n.id}`}
                          className="text-xs text-slate-400 hover:text-slate-600 transition-colors ml-auto"
                        >
                          Mark read
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
