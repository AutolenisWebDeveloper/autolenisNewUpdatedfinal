// /affiliate/portal/notifications — Client component with mark-read support
"use client";

import { useState, useEffect, useCallback } from "react";
import { Bell, CheckCheck, Check } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Notification {
  id: string;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
}

export default function AffiliateNotificationsPage() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [markingAll, setMarkingAll] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/affiliate/notifications");
      const json = await res.json() as { success?: boolean; data?: { notifications: Notification[]; unreadCount: number } };
      if (json.success && json.data) {
        setNotifications(json.data.notifications);
        setUnreadCount(json.data.unreadCount);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function markRead(id: string) {
    try {
      await fetch(`/api/affiliate/notifications/${id}/read`, { method: "PATCH" });
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, readAt: new Date().toISOString() } : n));
      setUnreadCount(c => Math.max(0, c - 1));
    } catch { /* ignore */ }
  }

  async function markAllRead() {
    setMarkingAll(true);
    try {
      await fetch("/api/affiliate/notifications/mark-all-read", { method: "POST" });
      const now = new Date().toISOString();
      setNotifications(prev => prev.map(n => ({ ...n, readAt: n.readAt ?? now })));
      setUnreadCount(0);
    } catch { /* ignore */ }
    setMarkingAll(false);
  }

  return (
    <div className="p-6 md:p-8 max-w-2xl" data-testid="affiliate-notifications-page">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Bell size={22} className="text-al-primary" />
          <h1 className="text-xl font-bold text-slate-900">Notifications</h1>
          {unreadCount > 0 && (
            <span className="bg-al-primary text-white text-xs font-bold px-2 py-0.5 rounded-full" data-testid="affiliate-unread-badge">
              {unreadCount} new
            </span>
          )}
        </div>
        {unreadCount > 0 && (
          <Button
            variant="secondary"
            size="sm"
            onClick={markAllRead}
            disabled={markingAll}
            data-testid="affiliate-mark-all-read-btn"
          >
            <CheckCheck size={13} className="mr-1.5" />
            {markingAll ? "Marking…" : "Mark all read"}
          </Button>
        )}
      </div>

      {loading ? (
        <div className="text-center py-12 text-slate-400" data-testid="notifications-loading">Loading…</div>
      ) : notifications.length === 0 ? (
        <div className="text-center py-16 text-slate-400" data-testid="no-affiliate-notifications">
          <Bell size={28} className="mx-auto mb-3 opacity-30" />
          <p>No notifications yet</p>
        </div>
      ) : (
        <div className="space-y-2">
          {notifications.map(n => (
            <div
              key={n.id}
              data-testid={`affiliate-notification-${n.id}`}
              className={`bg-white border rounded-xl p-4 flex items-start gap-3 ${!n.readAt ? "border-al-primary/20 bg-al-primary/2" : "border-slate-200"}`}
            >
              {!n.readAt && <div className="w-2 h-2 rounded-full bg-al-primary mt-1.5 shrink-0" data-testid={`unread-dot-${n.id}`} />}
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-slate-900 text-sm">{n.title}</p>
                <p className="text-slate-500 text-sm mt-0.5">{n.body}</p>
                <p className="text-xs text-slate-400 mt-1">{new Date(n.createdAt).toLocaleDateString()}</p>
              </div>
              {!n.readAt && (
                <button
                  onClick={() => markRead(n.id)}
                  className="shrink-0 p-1.5 rounded-lg hover:bg-slate-100 transition-colors text-slate-400 hover:text-al-primary"
                  aria-label="Mark as read"
                  data-testid={`mark-read-btn-${n.id}`}
                >
                  <Check size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
