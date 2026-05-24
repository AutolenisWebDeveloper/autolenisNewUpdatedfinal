"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AutoLenisLogo } from "@/components/shared/AutoLenisLogo";
import {
  LayoutDashboard, Gavel, FileText, Shield, BarChart2,
  Bell, MessageSquare, FolderOpen, Settings, LogOut, Star,
  CreditCard, Handshake, Menu, X, Sparkles, Briefcase,
  Package, Banknote, Truck, User,
} from "lucide-react";

// 14 required V4 dealer portal destinations — exactly one entry per route
const NAV_GROUPS = [
  { label: "Operations", items: [
    { label: "Dashboard",     href: "/dealer/dashboard",     icon: LayoutDashboard },
    { label: "Opportunities", href: "/dealer/opportunities", icon: Sparkles },
    { label: "Auctions",      href: "/dealer/auctions",      icon: Gavel },
    { label: "My Offers",     href: "/dealer/offers",        icon: FileText },
    { label: "My Deals",      href: "/dealer/deals",         icon: Handshake },
    { label: "Leads",         href: "/dealer/leads",         icon: Briefcase },
    { label: "Inventory",     href: "/dealer/inventory",     icon: Package },
  ]},
  { label: "Performance", items: [
    { label: "Scorecard",  href: "/dealer/scorecard",  icon: Star },
    { label: "Analytics",  href: "/dealer/analytics",  icon: BarChart2 },
    { label: "Financing",  href: "/dealer/financing",  icon: Banknote },
    { label: "Pickups",    href: "/dealer/pickups",    icon: Truck },
    { label: "Payments",   href: "/dealer/payments",   icon: CreditCard },
  ]},
  { label: "Account", items: [
    { label: "Notifications", href: "/dealer/notifications", icon: Bell },
    { label: "Messages",      href: "/dealer/messages",      icon: MessageSquare },
    { label: "Contracts",     href: "/dealer/contracts",     icon: Shield },
    { label: "Documents",     href: "/dealer/documents",     icon: FolderOpen },
    { label: "Profile",       href: "/dealer/profile",       icon: User },
    { label: "Settings",      href: "/dealer/settings",      icon: Settings },
  ]},
];

function SignOutButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleSignOut() {
    setLoading(true);
    try {
      const res = await fetch("/api/dealer/auth/signout", { method: "POST" });
      if (!res.ok) {
        console.error("Sign-out request failed:", res.status);
      }
    } catch {
      // Network error — still redirect; the cookie will expire naturally
    } finally {
      router.push("/dealer/sign-in");
    }
  }

  return (
    <button
      type="button"
      onClick={handleSignOut}
      disabled={loading}
      data-testid="dealer-signout-btn"
      className="flex items-center gap-2.5 px-3 py-2 w-full rounded-lg text-sm text-slate-400 hover:text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50"
    >
      <LogOut size={15} />{loading ? "Signing out\u2026" : "Sign Out"}
    </button>
  );
}

function Inner({ pathname, onNavigate, unreadCount }: { pathname: string; onNavigate?: () => void; unreadCount: number }) {
  return (
    <>
      <div className="px-5 py-5 border-b border-slate-100">
        <AutoLenisLogo size="sm" variant="dark" href="/dealer/dashboard" testId="dealer-sidebar-logo" subtitle="Dealer Portal" />
      </div>
      <nav className="flex-1 px-3 py-4 space-y-5 overflow-y-auto">
        {NAV_GROUPS.map(group => (
          <div key={group.label}>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest px-2 mb-1.5">{group.label}</p>
            <ul className="space-y-0.5">
              {group.items.map(item => {
                const active = pathname === item.href || pathname.startsWith(item.href + "/");
                const showBadge = item.href === "/dealer/notifications" && unreadCount > 0;
                return (
                  <li key={item.href}>
                    <Link href={item.href} onClick={onNavigate}
                      data-testid={`dealer-nav-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
                      className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                        active ? "bg-[#0B5FD1]/10 text-[#0B5FD1] font-semibold" : "text-slate-500 hover:bg-slate-50 hover:text-slate-800"
                      }`}>
                      <item.icon size={15} className="shrink-0" />
                      <span className="flex-1">{item.label}</span>
                      {showBadge && (
                        <span
                          data-testid="dealer-sidebar-notification-badge"
                          className="min-w-[18px] h-[18px] rounded-full bg-[#0B5FD1] text-white text-[10px] font-bold flex items-center justify-center px-1"
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
        <SignOutButton />
      </div>
    </>
  );
}

export default function DealerSidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    fetch("/api/dealer/notifications/unread-count")
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.data?.count) setUnreadCount(d.data.count); })
      .catch(() => { /* badge stays at 0 on failure */ });
  }, []);

  useEffect(() => {
    if (pathname === "/dealer/notifications") setUnreadCount(0);
  }, [pathname]);

  useEffect(() => { setOpen(false); }, [pathname]);
  return (
    <>
      <aside className="hidden lg:flex w-60 shrink-0 bg-white border-r border-slate-200 flex-col h-screen sticky top-0" data-testid="dealer-sidebar">
        <Inner pathname={pathname} unreadCount={unreadCount} />
      </aside>
      <div className="lg:hidden fixed top-0 left-0 right-0 z-30 flex items-center justify-between bg-white border-b border-slate-200 px-4 h-14" data-testid="dealer-mobile-topbar">
        <AutoLenisLogo size="sm" variant="dark" href="/dealer/dashboard" testId="dealer-mobile-logo" />
        <div className="flex items-center gap-2">
          {unreadCount > 0 && (
            <Link href="/dealer/notifications" className="relative p-2" data-testid="dealer-mobile-notification-bell">
              <Bell size={20} className="text-slate-600" />
              <span className="absolute top-1 right-1 min-w-[16px] h-[16px] rounded-full bg-[#0B5FD1] text-white text-[9px] font-bold flex items-center justify-center px-0.5">
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            </Link>
          )}
          <button type="button" onClick={() => setOpen(true)} aria-label="Open navigation"
            data-testid="dealer-mobile-menu-toggle"
            className="p-2 rounded-md text-slate-600 hover:bg-slate-100">
            <Menu size={22} />
          </button>
        </div>
      </div>
      {open && (
        <>
          <div className="lg:hidden fixed inset-0 z-40 bg-black/40" onClick={() => setOpen(false)}
            data-testid="dealer-mobile-drawer-backdrop" />
          <aside className="lg:hidden fixed top-0 left-0 z-50 w-72 max-w-[85vw] h-screen bg-white shadow-xl flex flex-col"
            data-testid="dealer-mobile-drawer">
            <button type="button" onClick={() => setOpen(false)} aria-label="Close navigation"
              data-testid="dealer-mobile-menu-close"
              className="absolute top-3 right-3 p-2 rounded-md text-slate-600 hover:bg-slate-100">
              <X size={20} />
            </button>
            <Inner pathname={pathname} onNavigate={() => setOpen(false)} unreadCount={unreadCount} />
          </aside>
        </>
      )}
    </>
  );
}
