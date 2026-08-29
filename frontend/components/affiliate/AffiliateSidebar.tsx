"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { signOutAction } from "@/lib/auth/actions";
import { AutoLenisLogo } from "@/components/shared/AutoLenisLogo";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  LayoutDashboard, Users, DollarSign, Network,
  Calculator, Bell, ShieldCheck, FileText, User, Settings, LogOut,
  FileCheck, Landmark, Share2, Menu, Trophy, Lock,
} from "lucide-react";

// `gated: true` marks destinations the server-side onboarding gate
// (requireAffiliateWithOnboarding) redirects to the wizard while onboarding
// is NOT_STARTED — the sidebar mirrors that gate with a lock affordance so
// nav truthfully reflects what a click will do. UX only; the layout enforces.
// Exported so the onboarding-gate test can prove nav gating and the server
// gate's exempt set never drift apart.
export const NAV_ITEMS = [
  { label: "Dashboard",         href: "/affiliate/portal/dashboard",         icon: LayoutDashboard, gated: false },
  { label: "My Referrals",      href: "/affiliate/portal/referrals",         icon: Users,           gated: true },
  { label: "Referral Hub",      href: "/affiliate/portal/referral-hub",      icon: Share2,          gated: true },
  { label: "Earnings",          href: "/affiliate/portal/earnings",          icon: DollarSign,      gated: true },
  { label: "Finance Hub",       href: "/affiliate/portal/finance",           icon: Landmark,        gated: true },
  { label: "Documents",         href: "/affiliate/portal/documents",         icon: FileCheck,       gated: true },
  { label: "Referral Network",  href: "/affiliate/portal/network",           icon: Network,         gated: true },
  { label: "Leaderboard",       href: "/affiliate/portal/leaderboard",       icon: Trophy,          gated: true },
  { label: "Income Calculator", href: "/affiliate/portal/income-calculator", icon: Calculator,      gated: true },
  { label: "Notifications",     href: "/affiliate/portal/notifications",     icon: Bell,            gated: false },
  { label: "Compliance",        href: "/affiliate/portal/compliance",        icon: ShieldCheck,     gated: false },
  { label: "Resources",         href: "/affiliate/portal/resources",         icon: FileText,        gated: false },
  { label: "Profile",           href: "/affiliate/portal/profile",           icon: User,            gated: false },
  { label: "Settings",          href: "/affiliate/portal/settings",          icon: Settings,        gated: false },
];

function Inner({ pathname, onNavigate, unreadCount, onboardingRequired }: { pathname: string; onNavigate?: () => void; unreadCount: number; onboardingRequired: boolean }) {
  return (
    <>
      <div className="px-5 py-4 border-b border-slate-100">
        <AutoLenisLogo size="sm" variant="dark" href="/affiliate/portal/dashboard" testId="affiliate-sidebar-logo" subtitle="Affiliate Portal" />
      </div>
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {NAV_ITEMS.map(item => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          const showBadge = item.href === "/affiliate/portal/notifications" && unreadCount > 0;
          const locked = onboardingRequired && item.gated;
          return (
            <Link key={item.href} href={item.href} onClick={onNavigate}
              data-testid={`affiliate-nav-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
              title={locked ? "Complete onboarding to unlock" : undefined}
              aria-label={locked ? `${item.label} — locked until onboarding is complete` : undefined}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                active ? "bg-al-primary/10 text-al-primary font-semibold"
                : locked ? "text-slate-400 hover:bg-slate-50 hover:text-slate-500"
                : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              }`}>
              <item.icon size={15} className="shrink-0" aria-hidden="true" />
              <span className="flex-1">{item.label}</span>
              {locked && <Lock size={12} className="shrink-0" aria-hidden="true" data-testid={`affiliate-nav-lock-${item.label.toLowerCase().replace(/\s+/g, "-")}`} />}
              {showBadge && (
                <span
                  data-testid="affiliate-sidebar-notification-badge"
                  className="min-w-[18px] h-[18px] rounded-full bg-al-primary text-white text-[10px] font-bold flex items-center justify-center px-1"
                >
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
      <div className="px-3 py-4 border-t border-slate-100">
        <form action={signOutAction}>
          <button type="submit" data-testid="affiliate-signout-btn"
            className="flex items-center gap-2.5 px-3 py-2 w-full rounded-lg text-sm text-slate-500 hover:bg-slate-50 hover:text-slate-700 transition-colors">
            <LogOut size={15} />Sign Out
          </button>
        </form>
      </div>
    </>
  );
}

export default function AffiliateSidebar({ onboardingRequired = false }: { onboardingRequired?: boolean }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    fetch("/api/affiliate/notifications/unread-count")
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.data?.count) setUnreadCount(d.data.count); })
      .catch(() => { /* badge stays at 0 on failure */ });
  }, []);

  useEffect(() => {
    if (pathname === "/affiliate/portal/notifications") setUnreadCount(0);
  }, [pathname]);

  useEffect(() => { setOpen(false); }, [pathname]);
  return (
    <>
      <aside className="hidden lg:flex w-60 shrink-0 bg-white border-r border-slate-200 flex-col h-screen sticky top-0" data-testid="affiliate-sidebar">
        <Inner pathname={pathname} unreadCount={unreadCount} onboardingRequired={onboardingRequired} />
      </aside>
      <div className="lg:hidden fixed top-0 left-0 right-0 z-30 flex items-center justify-between bg-white border-b border-slate-200 px-4 h-14" data-testid="affiliate-mobile-topbar">
        <AutoLenisLogo size="sm" variant="dark" href="/affiliate/portal/dashboard" testId="affiliate-mobile-logo" />
        <div className="flex items-center gap-2">
          {unreadCount > 0 && (
            <Link href="/affiliate/portal/notifications" className="relative p-2" data-testid="affiliate-mobile-notification-bell">
              <Bell size={20} className="text-slate-600" />
              <span className="absolute top-1 right-1 min-w-[16px] h-[16px] rounded-full bg-al-primary text-white text-[9px] font-bold flex items-center justify-center px-0.5">
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            </Link>
          )}
          <button type="button" onClick={() => setOpen(true)} aria-label="Open navigation"
            data-testid="affiliate-mobile-menu-toggle"
            className="p-2 rounded-md text-slate-600 hover:bg-slate-100">
            <Menu size={22} />
          </button>
        </div>
      </div>
      {/* Mobile drawer — shared kit Dialog (sheet): focus trap, Escape,
          aria-modal, scroll-lock and overlay dismissal from Radix. */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent variant="sheet" side="left" className="flex flex-col p-0" data-testid="affiliate-mobile-drawer">
          <DialogTitle className="sr-only">Affiliate navigation</DialogTitle>
          <Inner pathname={pathname} onNavigate={() => setOpen(false)} unreadCount={unreadCount} onboardingRequired={onboardingRequired} />
        </DialogContent>
      </Dialog>
    </>
  );
}
