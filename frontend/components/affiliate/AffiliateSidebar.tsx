"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { signOutAction } from "@/lib/auth/actions";
import { AutoLenisLogo } from "@/components/shared/AutoLenisLogo";
import {
  LayoutDashboard, Users, DollarSign, Network,
  Calculator, Bell, ShieldCheck, FileText, User, Settings, LogOut,
  FileCheck, Landmark, Share2, Menu, X, Trophy,
} from "lucide-react";

const NAV_ITEMS = [
  { label: "Dashboard",         href: "/affiliate/portal/dashboard",         icon: LayoutDashboard },
  { label: "My Referrals",      href: "/affiliate/portal/referrals",         icon: Users },
  { label: "Referral Hub",      href: "/affiliate/portal/referral-hub",      icon: Share2 },
  { label: "Earnings",          href: "/affiliate/portal/earnings",          icon: DollarSign },
  { label: "Finance Hub",       href: "/affiliate/portal/finance",           icon: Landmark },
  { label: "Documents",         href: "/affiliate/portal/documents",         icon: FileCheck },
  { label: "Network Tree",      href: "/affiliate/portal/network",           icon: Network },
  { label: "Leaderboard",       href: "/affiliate/portal/leaderboard",       icon: Trophy },
  { label: "Income Calculator", href: "/affiliate/portal/income-calculator", icon: Calculator },
  { label: "Notifications",     href: "/affiliate/portal/notifications",     icon: Bell },
  { label: "Compliance",        href: "/affiliate/portal/compliance",        icon: ShieldCheck },
  { label: "Resources",         href: "/affiliate/portal/resources",         icon: FileText },
  { label: "Profile",           href: "/affiliate/portal/profile",           icon: User },
  { label: "Settings",          href: "/affiliate/portal/settings",          icon: Settings },
];

function Inner({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <>
      <div className="px-5 py-4 border-b border-slate-100">
        <AutoLenisLogo size="sm" variant="dark" href="/" testId="affiliate-sidebar-logo" subtitle="Affiliate Portal" />
      </div>
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {NAV_ITEMS.map(item => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link key={item.href} href={item.href} onClick={onNavigate}
              data-testid={`affiliate-nav-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                active ? "bg-[#0B5FD1]/10 text-[#0B5FD1] font-semibold" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              }`}>
              <item.icon size={15} className="shrink-0" />{item.label}
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

export default function AffiliateSidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(false); }, [pathname]);
  return (
    <>
      <aside className="hidden lg:flex w-60 shrink-0 bg-white border-r border-slate-200 flex-col h-screen sticky top-0" data-testid="affiliate-sidebar">
        <Inner pathname={pathname} />
      </aside>
      <div className="lg:hidden fixed top-0 left-0 right-0 z-30 flex items-center justify-between bg-white border-b border-slate-200 px-4 h-14" data-testid="affiliate-mobile-topbar">
        <AutoLenisLogo size="sm" variant="dark" href="/" testId="affiliate-mobile-logo" />
        <button type="button" onClick={() => setOpen(true)} aria-label="Open navigation"
          data-testid="affiliate-mobile-menu-toggle"
          className="p-2 rounded-md text-slate-600 hover:bg-slate-100">
          <Menu size={22} />
        </button>
      </div>
      {open && (
        <>
          <div className="lg:hidden fixed inset-0 z-40 bg-black/40" onClick={() => setOpen(false)}
            data-testid="affiliate-mobile-drawer-backdrop" />
          <aside className="lg:hidden fixed top-0 left-0 z-50 w-72 max-w-[85vw] h-screen bg-white shadow-xl flex flex-col"
            data-testid="affiliate-mobile-drawer">
            <button type="button" onClick={() => setOpen(false)} aria-label="Close navigation"
              data-testid="affiliate-mobile-menu-close"
              className="absolute top-3 right-3 p-2 rounded-md text-slate-600 hover:bg-slate-100">
              <X size={20} />
            </button>
            <Inner pathname={pathname} onNavigate={() => setOpen(false)} />
          </aside>
        </>
      )}
    </>
  );
}
