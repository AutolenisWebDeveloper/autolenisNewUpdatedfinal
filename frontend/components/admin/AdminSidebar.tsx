"use client";

import Link from "next/link";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  LayoutDashboard, Users, Building2, Share2, Gavel, FileText, Package,
  MapPin, PenLine, AlertOctagon, ClipboardList, MessageSquare, FolderOpen,
  Shield, BarChart2, Activity, TrendingUp, DollarSign, RefreshCw,
  Search, Brain, Settings, LifeBuoy, Star, BookOpen, LogOut, Menu, CheckCircle2,
  CreditCard, FileCheck, Send, ClipboardCheck, Bell, Trophy,
  TrendingDown, Globe, Inbox, ScrollText, Phone, Newspaper, Radio,
  CheckSquare, Filter, ShieldOff, ShieldCheck, Workflow, BarChart3,
  ChevronRight, UserPlus,
} from "lucide-react";
import {
  ALL_SECTIONS,
  isNavItemActive,
  isNavItemVisible,
  sectionForPathname,
  type NavItem,
  type NavSection,
} from "@/lib/admin/nav";

// The IA itself lives in lib/admin/nav.ts so it can be unit-tested without
// React (see lib/admin/__tests__/nav-capability-preservation.test.ts). This
// component only renders it. Icons are resolved by name here because the nav
// module must stay importable from a plain node test.
const ICONS: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  LayoutDashboard, Users, Building2, Share2, Gavel, FileText, Package,
  MapPin, PenLine, AlertOctagon, ClipboardList, MessageSquare, FolderOpen,
  Shield, BarChart2, Activity, TrendingUp, DollarSign, RefreshCw,
  Search, Brain, Settings, LifeBuoy, Star, BookOpen, CheckCircle2,
  CreditCard, FileCheck, Send, ClipboardCheck, Bell, Trophy,
  TrendingDown, Globe, Inbox, ScrollText, Phone, Newspaper, Radio,
  CheckSquare, Filter, ShieldOff, ShieldCheck, Workflow, BarChart3, UserPlus,
};

type Badges = { unread: number; overdue: number };

async function handleSignOut() {
  await fetch("/api/admin/auth/signout", { method: "POST" });
  window.location.href = "/admin/auth/signin";
}

function NavLink({
  item,
  pathname,
  badges,
  onNavigate,
}: {
  item: NavItem;
  pathname: string;
  badges: Badges;
  onNavigate?: () => void;
}) {
  const Icon = ICONS[item.icon] ?? Activity;
  const active = isNavItemActive(item, pathname);
  const badgeValue = item.badge ? badges[item.badge] : 0;

  return (
    <li>
      <Link
        href={item.href}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        data-testid={`admin-nav-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
        className={`flex items-center gap-2.5 px-3 py-1.5 rounded-md text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-al-primary focus-visible:ring-offset-1 ${
          active
            ? "bg-al-primary-subtle text-al-primary font-semibold border-l-2 border-al-primary pl-[10px]"
            : "text-[#475569] hover:bg-[#F8FAFF] hover:text-[#0F172A]"
        }`}
      >
        <Icon size={13} className="shrink-0" />
        <span className="flex-1 truncate">{item.label}</span>
        {item.badge && badgeValue > 0 && (
          <span
            data-testid={`admin-nav-badge-${item.badge}`}
            aria-label={`${badgeValue} ${item.badge}`}
            className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${
              item.badge === "unread"
                ? "bg-al-primary-subtle text-al-primary"
                : "bg-al-danger-subtle text-al-danger"
            }`}
          >
            {badgeValue > 99 ? "99+" : badgeValue}
          </span>
        )}
      </Link>
    </li>
  );
}

function Section({
  section,
  pathname,
  adminRole,
  badges,
  expanded,
  onToggle,
  onNavigate,
}: {
  section: NavSection;
  pathname: string;
  adminRole?: string;
  badges: Badges;
  expanded: boolean;
  onToggle: () => void;
  onNavigate?: () => void;
}) {
  const items = section.items.filter((item) => isNavItemVisible(item, adminRole));
  if (items.length === 0) return null;

  const panelId = `admin-nav-section-${section.label.toLowerCase().replace(/[^a-z]+/g, "-")}`;
  // A collapsed section still has to advertise attention it is holding,
  // otherwise collapsing the rail hides the unread count that made the badge
  // worth having.
  const hiddenBadgeTotal = expanded
    ? 0
    : items.reduce((sum, i) => sum + (i.badge ? badges[i.badge] : 0), 0);

  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={panelId}
        data-testid={`admin-nav-section-${section.label.toLowerCase().replace(/\s+/g, "-")}`}
        className="flex w-full items-center gap-1.5 px-3 pt-5 pb-1.5 text-[9px] font-bold text-[#94A3B8] uppercase tracking-[0.15em] hover:text-[#475569] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-al-primary rounded"
      >
        <ChevronRight
          size={11}
          className={`shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`}
          aria-hidden="true"
        />
        <span className="flex-1 text-left">{section.label}</span>
        {hiddenBadgeTotal > 0 && (
          <span className="rounded-full bg-al-danger-subtle px-1.5 py-0.5 text-[9px] font-bold text-al-danger tabular-nums">
            {hiddenBadgeTotal > 99 ? "99+" : hiddenBadgeTotal}
          </span>
        )}
      </button>
      <ul id={panelId} className="space-y-0.5" hidden={!expanded}>
        {items.map((item) => (
          <NavLink
            key={item.href}
            item={item}
            pathname={pathname}
            badges={badges}
            onNavigate={onNavigate}
          />
        ))}
      </ul>
    </div>
  );
}

function Inner({
  pathname,
  adminRole,
  badges,
  onNavigate,
}: {
  pathname: string;
  adminRole?: string;
  badges: Badges;
  onNavigate?: () => void;
}) {
  const activeSection = useMemo(() => sectionForPathname(pathname), [pathname]);

  // Only the section you are working in is expanded. This is the density fix:
  // the rail used to render every one of 74 entries at all times, roughly
  // 2,500px of navigation in a ~950px viewport.
  const [openSections, setOpenSections] = useState<Set<string>>(
    () => new Set(activeSection ? [activeSection] : []),
  );
  useEffect(() => {
    if (activeSection) setOpenSections((prev) => new Set(prev).add(activeSection));
  }, [activeSection]);

  const toggle = (label: string) =>
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });

  return (
    <>
      <div className="px-5 py-5 border-b border-[#E2E8F0]">
        <Link
          href="/admin/dashboard"
          className="flex items-center gap-2.5 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-al-primary"
          onClick={onNavigate}
        >
          <div className="w-8 h-8 rounded-lg bg-al-primary flex items-center justify-center shrink-0">
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
      <nav aria-label="Admin" className="flex-1 px-3 py-3 space-y-1 overflow-y-auto">
        {ALL_SECTIONS.map((section) => (
          <Section
            key={section.label}
            section={section}
            pathname={pathname}
            adminRole={adminRole}
            badges={badges}
            expanded={openSections.has(section.label)}
            onToggle={() => toggle(section.label)}
            onNavigate={onNavigate}
          />
        ))}
      </nav>
      <div className="px-3 py-4 border-t border-[#E2E8F0]">
        <button
          onClick={handleSignOut}
          data-testid="admin-signout-btn"
          className="flex items-center gap-2 px-3 py-1.5 w-full rounded-md text-xs text-[#94A3B8] hover:bg-[#FEF2F2] hover:text-[#DC2626] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-al-primary"
        >
          <LogOut size={12} />
          Sign Out
        </button>
      </div>
    </>
  );
}

export default function AdminSidebar({ adminRole }: { adminRole?: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [badges, setBadges] = useState<Badges>({ unread: 0, overdue: 0 });

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // CRM unread/overdue counts, previously owned by CrmShell's sidebar. The
  // Engage entries now live in this rail, so the counts follow them. Refetched
  // on mount and on CRM navigation only — the same cadence CrmShell used,
  // rather than a request on every admin page change.
  const badgeKey = pathname.startsWith("/admin/crm") ? pathname : "static";
  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/crm/badges")
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (!cancelled && json) {
          setBadges({
            unread: Number(json.unread ?? 0),
            overdue: Number(json.overdue ?? 0),
          });
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [badgeKey]);

  return (
    <>
      <aside
        className="hidden lg:flex w-[220px] shrink-0 bg-white border-r border-[#E2E8F0] flex-col h-screen sticky top-0"
        data-testid="admin-sidebar"
      >
        <Inner pathname={pathname} adminRole={adminRole} badges={badges} />
      </aside>
      <div
        className="lg:hidden fixed top-0 left-0 right-0 z-30 flex items-center justify-between bg-white border-b border-[#E2E8F0] px-4 h-14 shadow-sm"
        data-testid="admin-mobile-topbar"
      >
        <Link href="/admin/dashboard" className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-al-primary flex items-center justify-center shrink-0">
            <Shield size={14} className="text-white" />
          </div>
          <div>
            <p className="text-sm font-bold text-[#0F172A] tracking-tight leading-none">AutoLenis</p>
            <p className="text-[9px] text-[#94A3B8] font-semibold tracking-widest uppercase mt-0.5">
              Admin Console
            </p>
          </div>
        </Link>
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open navigation"
          data-testid="admin-mobile-menu-toggle"
          className="p-2 rounded-md text-[#475569] hover:bg-[#F8FAFF] hover:text-al-primary transition-colors"
        >
          <Menu size={22} />
        </button>
      </div>
      {/* Mobile drawer — shared kit Dialog (sheet): focus trap, Escape,
          aria-modal, scroll-lock and overlay dismissal from Radix. */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          variant="sheet"
          side="left"
          className="flex flex-col p-0"
          data-testid="admin-mobile-drawer"
        >
          <DialogTitle className="sr-only">Admin navigation</DialogTitle>
          <Inner
            pathname={pathname}
            adminRole={adminRole}
            badges={badges}
            onNavigate={() => setOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
