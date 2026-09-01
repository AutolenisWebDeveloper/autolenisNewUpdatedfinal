"use client";

import { logger } from "@/lib/logger";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { signOutAction } from "@/lib/auth/actions";
import { AutoLenisLogo } from "@/components/shared/AutoLenisLogo";
import {
  LayoutDashboard, Car, Gavel, FileText, FileCheck, Shield, PenLine,
  MapPin, Bell, MessageSquare, FolderOpen, User, Settings, LogOut,
  ClipboardList, TrendingUp, Heart, Search, Menu, CreditCard,
  Bookmark, Activity, Share2, Receipt, Lock,
} from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { NOTIFICATION_CLEARED_EVENT } from "@/lib/events/notifications";
import { api } from "@/lib/api/client";
import { isNavItemReachable, type JourneyView } from "@/lib/services/buyer/nav-gating";

const NAV_GROUPS = [
  {
    label: "Your Journey",
    items: [
      { label: "Dashboard", href: "/buyer/dashboard", icon: LayoutDashboard },
      { label: "Prequal & Budget", href: "/buyer/prequal", icon: TrendingUp },
      { label: "Search Vehicles", href: "/buyer/search", icon: Search },
      { label: "My Shortlist", href: "/buyer/shortlist", icon: Heart },
    ],
  },
  {
    label: "Auction & Deal",
    items: [
      { label: "My Auction", href: "/buyer/auctions", icon: Gavel },
      { label: "My Deal", href: "/buyer/deal", icon: Car },
      { label: "Financing", href: "/buyer/deal/financing", icon: FileText },
      { label: "Contract Shield", href: "/buyer/contract-shield", icon: Shield },
      { label: "Contracts", href: "/buyer/contracts", icon: FileCheck },
      { label: "Service Fee", href: "/buyer/fee", icon: CreditCard },
      { label: "Sign Documents", href: "/buyer/esign", icon: PenLine },
      { label: "Vehicle Pickup", href: "/buyer/pickup", icon: MapPin },
    ],
  },
  {
    label: "Account",
    items: [
      { label: "My Requests", href: "/buyer/requests", icon: ClipboardList },
      { label: "Trade-In", href: "/buyer/trade-in", icon: Car },
      { label: "Notifications", href: "/buyer/notifications", icon: Bell },
      { label: "Messages", href: "/buyer/messages", icon: MessageSquare },
      { label: "Documents", href: "/buyer/documents", icon: FolderOpen },
      { label: "Insurance", href: "/buyer/insurance", icon: Shield },
      { label: "Billing", href: "/buyer/billing", icon: Receipt },
      { label: "Saved Searches", href: "/buyer/searches", icon: Bookmark },
      { label: "Activity", href: "/buyer/activity", icon: Activity },
      { label: "Referral Hub", href: "/buyer/referral", icon: Share2 },
      { label: "Profile", href: "/buyer/profile", icon: User },
      { label: "Settings", href: "/buyer/settings", icon: Settings },
    ],
  },
];

// Why a locked item is locked, so the affordance explains itself instead of
// leaving the buyer to guess why a link did nothing.
function lockReason(journey: JourneyView | null): string {
  if (!journey) return "Not available yet";
  return journey.completedStages.includes("onboarding")
    ? "Unlocks as your deal progresses"
    : "Finish setting up your account to unlock this";
}

function SidebarContent({
  pathname,
  onNavigate,
  unreadCount,
  journey,
}: {
  pathname: string;
  onNavigate?: () => void;
  unreadCount: number;
  journey: JourneyView | null;
}) {
  return (
    <>
      <div className="px-5 py-4 border-b border-slate-100">
        <AutoLenisLogo size="sm" variant="dark" href="/buyer/dashboard" testId="buyer-sidebar-logo" subtitle="Buyer Portal" />
      </div>
      <nav className="flex-1 px-3 py-4 space-y-6 overflow-y-auto">
        {NAV_GROUPS.map((group) => (
          <div key={group.label}>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest px-2 mb-1.5">{group.label}</p>
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const active = pathname === item.href || pathname.startsWith(item.href + "/");
                const showBadge = item.href === "/buyer/notifications" && unreadCount > 0;
                const testId = `sidebar-nav-${item.label.toLowerCase().replace(/\s+/g, "-")}`;
                // Journey-aware gating (lib/services/buyer/nav-gating). Until the
                // journey is known, render everything as a link — the server
                // layout is the authority and will redirect if needed; showing a
                // flash of locks would be worse than a brief live link.
                const reachable = journey ? isNavItemReachable(item.href, journey) : true;

                if (!reachable) {
                  // A LOCKED affordance, not a dead link. These used to be live
                  // links that silently redirected to /buyer/onboarding (or to a
                  // "nothing here yet" page) with no explanation at all.
                  return (
                    <li key={item.href}>
                      <span
                        data-testid={testId}
                        data-locked="true"
                        aria-disabled="true"
                        title={lockReason(journey)}
                        className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-slate-400 cursor-not-allowed select-none"
                      >
                        <item.icon size={15} className="shrink-0" aria-hidden="true" />
                        <span className="flex-1">{item.label}</span>
                        <Lock size={12} className="shrink-0 text-slate-300" aria-hidden="true" />
                        <span className="sr-only">— locked. {lockReason(journey)}</span>
                      </span>
                    </li>
                  );
                }

                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      data-testid={testId}
                      className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                        active
                          ? "bg-al-primary/10 text-al-primary font-semibold"
                          : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                      }`}
                    >
                      <item.icon size={15} className="shrink-0" aria-hidden="true" />
                      <span className="flex-1">{item.label}</span>
                      {showBadge && (
                        <span
                          data-testid="sidebar-notification-badge"
                          className="min-w-[18px] h-[18px] rounded-full bg-al-primary text-white text-[10px] font-bold flex items-center justify-center px-1"
                        >
                          {unreadCount > 99 ? "99+" : unreadCount}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
      <div className="px-3 py-4 border-t border-slate-100">
        <form action={signOutAction}>
          <button type="submit" data-testid="buyer-signout-btn" className="flex items-center gap-2.5 px-3 py-2 w-full rounded-lg text-sm text-slate-500 hover:bg-slate-50 hover:text-slate-700 transition-colors">
            <LogOut size={15} />Sign Out
          </button>
        </form>
      </div>
    </>
  );
}

export default function BuyerSidebar({ journey = null }: { journey?: JourneyView | null }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  // Unread count is fetched on mount and refreshed on each navigation away from
  // the notifications page. It does NOT poll continuously — this is intentional.
  // Real-time unread count updates are out of scope; badge accuracy on navigation
  // is sufficient for this feature. Do not add a setInterval here.
  useEffect(() => {
    api.get<{ count: number }>("/api/buyer/notifications/unread-count")
      .then(data => { if (data?.count) setUnreadCount(data.count); })
      .catch(err => { logger.error("[BuyerSidebar] Failed to fetch unread count:", err); });

    function handleCleared() { setUnreadCount(0); }
    window.addEventListener(NOTIFICATION_CLEARED_EVENT, handleCleared);
    return () => window.removeEventListener(NOTIFICATION_CLEARED_EVENT, handleCleared);
  }, []);

  // Refresh unread count when navigating away from notifications
  useEffect(() => {
    if (pathname === "/buyer/notifications") {
      setUnreadCount(0);
    }
  }, [pathname]);

  // Close drawer on route change
  useEffect(() => { setOpen(false); }, [pathname]);

  return (
    <>
      {/* Desktop sidebar (lg+) */}
      <aside
        className="hidden lg:flex w-60 shrink-0 bg-white border-r border-slate-200 flex-col h-screen sticky top-0"
        data-testid="buyer-sidebar"
      >
        <SidebarContent pathname={pathname} unreadCount={unreadCount} journey={journey} />
      </aside>

      {/* Mobile top bar (< lg) */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-30 flex items-center justify-between bg-white border-b border-slate-200 px-4 h-14" data-testid="buyer-mobile-topbar">
        <AutoLenisLogo size="sm" variant="dark" href="/buyer/dashboard" testId="buyer-mobile-logo" />
        <div className="flex items-center gap-2">
          {unreadCount > 0 && (
            <Link href="/buyer/notifications" className="relative p-2" data-testid="mobile-notification-bell">
              <Bell size={20} className="text-slate-600" />
              <span className="absolute top-1 right-1 min-w-[16px] h-[16px] rounded-full bg-al-primary text-white text-[9px] font-bold flex items-center justify-center px-0.5">
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            </Link>
          )}
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Open navigation"
            data-testid="buyer-mobile-menu-toggle"
            className="p-2 rounded-md text-slate-600 hover:bg-slate-100"
          >
            <Menu size={22} />
          </button>
        </div>
      </div>
      {/* Mobile drawer — shared kit Dialog (sheet variant): focus trap, Escape,
          aria-modal, scroll-lock and overlay dismissal come from Radix. */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent variant="sheet" side="left" className="flex flex-col p-0" data-testid="buyer-mobile-drawer">
          <DialogTitle className="sr-only">Buyer navigation</DialogTitle>
          <SidebarContent pathname={pathname} onNavigate={() => setOpen(false)} unreadCount={unreadCount} journey={journey} />
        </DialogContent>
      </Dialog>
    </>
  );
}
