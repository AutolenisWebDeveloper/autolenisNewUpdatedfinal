"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  LayoutDashboard, Users, Building2, Share2, Gavel, FileText, Package,
  MapPin, PenLine, AlertOctagon, ClipboardList, MessageSquare, FolderOpen,
  Shield, BarChart2, Activity, TrendingUp, DollarSign, RefreshCw,
  Search, Brain, Settings, LifeBuoy, Star, BookOpen, LogOut, Menu, X, CheckCircle2,
  CreditCard, FileCheck, Send,
  ClipboardCheck, ArrowDownCircle, RotateCcw, Bell,
  Trophy,
  Map, TrendingDown, Globe, PlusCircle, Car,
} from "lucide-react";

type NavItem = {
  label: string;
  href: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  visibleTo?: string[];
};

type NavGroup = {
  label: string;
  items: NavItem[];
};

const NAV_GROUPS: NavGroup[] = [
  { label: "Overview", items: [
    { label: "Dashboard", href: "/admin/dashboard", icon: LayoutDashboard },
    { label: "Ops Dashboard", href: "/admin/ops-dashboard", icon: Activity },
  ]},
  { label: "Users", items: [
    { label: "Buyers",            href: "/admin/buyers",      icon: Users },
    { label: "Prequalifications", href: "/admin/prequal",     icon: FileCheck },
    { label: "Journey Map",       href: "/admin/journey",     icon: ClipboardList },
    { label: "Dealers",           href: "/admin/dealers",     icon: Building2 },
    { label: "Affiliates",        href: "/admin/affiliates",  icon: Share2 },
  ]},
  { label: "Transactions", items: [
    { label: "Auctions", href: "/admin/auctions", icon: Gavel },
    { label: "Deals", href: "/admin/deals", icon: FileText },
    { label: "Offers", href: "/admin/offers", icon: DollarSign },
    { label: "Payment Hub", href: "/admin/payments", icon: CreditCard },
  ]},
  { label: "Operations", items: [
    { label: "Queues", href: "/admin/queues", icon: AlertOctagon },
    { label: "Manual Reviews", href: "/admin/manual-reviews", icon: ClipboardCheck },
    { label: "Pickups", href: "/admin/pickups", icon: MapPin },
    { label: "E-Sign", href: "/admin/esign", icon: PenLine },
    { label: "Requests (4C)", href: "/admin/requests", icon: ClipboardList },
    { label: "Vehicle Requests", href: "/admin/vehicle-requests", icon: ClipboardList },
    { label: "Vehicle Offers", href: "/admin/vehicle-offers", icon: Car },
    { label: "Dealer Health", href: "/admin/dealers/health", icon: TrendingUp },
    { label: "External Pre-Approvals", href: "/admin/external-preapprovals", icon: FileCheck },
    { label: "Insurance Requests",     href: "/admin/insurance-requests",    icon: Shield },
    { label: "Contracts", href: "/admin/contracts", icon: Shield },
    { label: "Comms", href: "/admin/comms", icon: Send },
  ]},
  { label: "CRM & Communications", items: [
    { label: "CRM", href: "/admin/crm", icon: LayoutDashboard },
  ]},
  { label: "Inventory", items: [
    { label: "Inventory", href: "/admin/inventory", icon: Package },
    { label: "Add Vehicle", href: "/admin/inventory/new", icon: Package },
    { label: "Bulk Upload", href: "/admin/inventory/upload", icon: Package },
    { label: "Search Tool", href: "/admin/inventory/search-tool", icon: Search },
    { label: "Coverage Map",     href: "/admin/inventory/coverage-map",     icon: Map },
    { label: "Dealer Discovery", href: "/admin/inventory/dealer-discovery", icon: Search },
    { label: "Demand Gap",       href: "/admin/inventory/demand-gap",       icon: TrendingDown },
    { label: "Markets",          href: "/admin/inventory/markets",          icon: Globe },
    { label: "Contributions",    href: "/admin/inventory/contributions",    icon: PlusCircle },
  ]},
  { label: "Reports", items: [
    { label: "Reports", href: "/admin/reports", icon: BarChart2 },
    { label: "Finance", href: "/admin/finance", icon: DollarSign, visibleTo: ["SUPER_ADMIN", "FINANCE_ADMIN"] },
    { label: "Activity Feed", href: "/admin/activity", icon: Activity },
    { label: "Deal Risk", href: "/admin/reports/risk", icon: TrendingUp },
    { label: "Pipeline", href: "/admin/reports/pipeline", icon: BarChart2 },
    { label: "Funnel", href: "/admin/reports/funnel", icon: BarChart2 },
    { label: "Affiliates", href: "/admin/reports/affiliate", icon: Share2 },
    { label: "Referral Milestones", href: "/admin/referral-milestones", icon: Trophy },
  ]},
  { label: "Platform", items: [
    { label: "Messages", href: "/admin/messages", icon: MessageSquare },
    { label: "Documents", href: "/admin/documents", icon: FolderOpen },
    { label: "Contract Shield", href: "/admin/contract-shield", icon: Shield },
    { label: "Refinance", href: "/admin/refinance", icon: RefreshCw },
    { label: "SEO", href: "/admin/seo", icon: Search },
    { label: "AI Console", href: "/admin/ai", icon: Brain },
    { label: "Faith Content", href: "/admin/faith-content", icon: BookOpen },
    { label: "Testimonials", href: "/admin/testimonials", icon: Star },
  ]},
  { label: "System", items: [
    { label: "Settings", href: "/admin/settings", icon: Settings },
    { label: "Security", href: "/admin/security/mfa", icon: Shield },
    { label: "System Health", href: "/admin/system-health", icon: Activity },
    { label: "Platform Status", href: "/status", icon: CheckCircle2 },
    { label: "Support", href: "/admin/support", icon: LifeBuoy },
    { label: "Notifications", href: "/admin/notifications", icon: Bell },
  ]},
];

async function handleSignOut() {
  await fetch("/api/admin/auth/signout", { method: "POST" });
  window.location.href = "/admin/auth/signin";
}

function Inner({ pathname, adminRole, onNavigate }: { pathname: string; adminRole?: string; onNavigate?: () => void }) {
  return (
    <>
      <div className="px-5 py-5 border-b border-[#E2E8F0]">
        <Link href="/admin/dashboard" className="flex items-center gap-2.5" onClick={onNavigate}>
          <div className="w-8 h-8 rounded-lg bg-[#0B5FD1] flex items-center justify-center shrink-0">
            <Shield size={14} className="text-white" />
          </div>
          <div>
            <p className="text-sm font-bold text-[#0F172A] tracking-tight leading-none">
              AutoLenis
            </p>
            <p className="text-[9px] text-[#94A3B8] font-semibold tracking-widest uppercase mt-0.5">
              Admin Console
            </p>
          </div>
        </Link>
      </div>
      <nav className="flex-1 px-3 py-3 space-y-1 overflow-y-auto">
        {NAV_GROUPS.map(group => {
          const visibleItems = group.items.filter(item =>
            !item.visibleTo || !adminRole || item.visibleTo.includes(adminRole)
          );
          if (visibleItems.length === 0) return null;
          return (
            <div key={group.label}>
              <p className="px-3 pt-5 pb-1.5 text-[9px] font-bold text-[#94A3B8] uppercase tracking-[0.15em]">{group.label}</p>
              <ul className="space-y-0.5">
                {visibleItems.map(item => {
                  const active = pathname === item.href || pathname.startsWith(item.href + "/");
                  return (
                    <li key={item.href}>
                      <Link href={item.href} onClick={onNavigate}
                        data-testid={`admin-nav-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
                        className={`flex items-center gap-2.5 px-3 py-1.5 rounded-md text-xs transition-all ${
                          active
                            ? "bg-[#EFF6FF] text-[#0B5FD1] font-semibold border-l-2 border-[#0B5FD1] pl-[10px]"
                            : "text-[#475569] hover:bg-[#F8FAFF] hover:text-[#0F172A]"
                        }`}>
                        <item.icon size={13} className="shrink-0" />{item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>
      <div className="px-3 py-4 border-t border-[#E2E8F0]">
        <button onClick={handleSignOut} data-testid="admin-signout-btn"
          className="flex items-center gap-2 px-3 py-1.5 w-full rounded-md text-xs text-[#94A3B8] hover:bg-[#FEF2F2] hover:text-[#DC2626] transition-colors">
          <LogOut size={12} />Sign Out
        </button>
      </div>
    </>
  );
}

export default function AdminSidebar({ adminRole }: { adminRole?: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(false); }, [pathname]);

  return (
    <>
      <aside className="hidden lg:flex w-[220px] shrink-0 bg-white border-r border-[#E2E8F0] flex-col h-screen sticky top-0" data-testid="admin-sidebar">
        <Inner pathname={pathname} adminRole={adminRole} />
      </aside>
      <div className="lg:hidden fixed top-0 left-0 right-0 z-30 flex items-center justify-between bg-white border-b border-[#E2E8F0] px-4 h-14 shadow-sm" data-testid="admin-mobile-topbar">
        <Link href="/admin/dashboard" className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-[#0B5FD1] flex items-center justify-center shrink-0">
            <Shield size={14} className="text-white" />
          </div>
          <div>
            <p className="text-sm font-bold text-[#0F172A] tracking-tight leading-none">AutoLenis</p>
            <p className="text-[9px] text-[#94A3B8] font-semibold tracking-widest uppercase mt-0.5">Admin Console</p>
          </div>
        </Link>
        <button type="button" onClick={() => setOpen(true)} aria-label="Open navigation"
          data-testid="admin-mobile-menu-toggle"
          className="p-2 rounded-md text-[#475569] hover:bg-[#F8FAFF] hover:text-[#0B5FD1] transition-colors">
          <Menu size={22} />
        </button>
      </div>
      {open && (
        <>
          <div className="lg:hidden fixed inset-0 z-40 bg-[#94A3B8]/30" onClick={() => setOpen(false)}
            data-testid="admin-mobile-drawer-backdrop" />
          <aside className="lg:hidden fixed top-0 left-0 z-50 w-72 max-w-[85vw] h-screen bg-white shadow-xl flex flex-col"
            data-testid="admin-mobile-drawer">
            <button type="button" onClick={() => setOpen(false)} aria-label="Close navigation"
              data-testid="admin-mobile-menu-close"
              className="absolute top-3 right-3 p-2 rounded-md text-[#475569] hover:bg-[#F8FAFF] hover:text-[#0B5FD1] transition-colors">
              <X size={20} />
            </button>
            <Inner pathname={pathname} adminRole={adminRole} onNavigate={() => setOpen(false)} />
          </aside>
        </>
      )}
    </>
  );
}
