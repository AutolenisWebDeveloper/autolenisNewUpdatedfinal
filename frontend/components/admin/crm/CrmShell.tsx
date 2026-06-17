'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Users,
  Inbox,
  CheckSquare,
  Send,
  FileText,
  Filter,
  ShieldOff,
  ShieldCheck,
  Workflow,
  BarChart3,
  Activity,
  Search,
  Menu,
  X,
  Bell,
  UserPlus,
  ChevronLeft,
  PanelLeftClose,
  PanelLeftOpen,
  Moon,
  Sun,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { GlobalSearch } from './GlobalSearch';
import { CopilotPanel } from './CopilotPanel';

type NavItem = {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  badge?: 'unread' | 'overdue';
  exact?: boolean;
};

type NavSection = {
  title: string;
  items: NavItem[];
};

const SECTIONS: NavSection[] = [
  {
    title: 'CRM',
    items: [
      { href: '/admin/crm',          label: 'Overview', icon: LayoutDashboard, exact: true },
      { href: '/admin/crm/contacts', label: 'Contacts', icon: Users },
      { href: '/admin/crm/leads',    label: 'Leads',    icon: UserPlus },
      { href: '/admin/crm/inbox',    label: 'Messages', icon: Inbox,        badge: 'unread' },
      { href: '/admin/crm/tasks',    label: 'Tasks',    icon: CheckSquare,  badge: 'overdue' },
    ],
  },
  {
    title: 'Messaging',
    items: [
      { href: '/admin/crm/campaigns',   label: 'Campaigns',   icon: Send },
      { href: '/admin/crm/templates',   label: 'Templates',   icon: FileText },
      { href: '/admin/crm/segments',    label: 'Segments',    icon: Filter },
      { href: '/admin/crm/suppression', label: 'Suppression', icon: ShieldOff },
    ],
  },
  {
    title: 'Automation',
    items: [
      // Workflows (in-app builder) retired — Make.com owns automation. The
      // Automation nav now points at the Make scenarios monitor.
      { href: '/admin/crm/scenarios',   label: 'Scenarios', icon: Workflow },
    ],
  },
  {
    title: 'Insights',
    items: [
      { href: '/admin/crm/analytics', label: 'Analytics',  icon: BarChart3 },
      { href: '/admin/crm/coverage',  label: 'Coverage',   icon: ShieldCheck },
      { href: '/admin/operations',    label: 'Operations', icon: Activity },
    ],
  },
];

function isActive(itemHref: string, pathname: string, exact?: boolean): boolean {
  if (exact) return pathname === itemHref;
  return pathname === itemHref || pathname.startsWith(`${itemHref}/`);
}

function slug(label: string) {
  return label.toLowerCase().replace(/\s+/g, '-');
}

export function CrmShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [badges, setBadges] = useState<{ unread: number; overdue: number }>({
    unread: 0,
    overdue: 0,
  });
  const [searchOpen, setSearchOpen] = useState(false);
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    let cancelled = false;
    fetch('/api/admin/crm/badges')
      .then((r) => r.json())
      .then((json) => {
        if (!cancelled) {
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
  }, [pathname]);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const sidebarWidth = collapsed ? 'lg:w-16' : 'lg:w-60';
  const mainPad = collapsed ? 'lg:pl-16' : 'lg:pl-60';

  return (
    <div
      className="crm-root min-h-screen bg-[var(--crm-bg-secondary)] text-[var(--crm-text-primary)]"
      data-theme={theme}
      data-testid="crm-shell"
    >
      {/* Top bar */}
      <header
        className={cn(
          'sticky top-0 z-40 flex h-14 items-center gap-2 border-b border-[var(--crm-border)] crm-hairline bg-[var(--crm-bg-primary)] px-3 transition-[padding]',
          mainPad,
        )}
        data-testid="crm-topbar"
      >
        <button
          className="rounded-[var(--crm-radius-sm)] p-2 text-[var(--crm-text-tertiary)] hover:bg-[var(--crm-bg-tertiary)] hover:text-[var(--crm-text-primary)] lg:hidden"
          onClick={() => setMobileOpen(true)}
          aria-label="Open navigation"
          data-testid="crm-nav-mobile-open"
        >
          <Menu className="h-5 w-5" />
        </button>

        {/* Command / search pill (⌘K) */}
        <div className="flex flex-1 items-center justify-center px-2">
          <button
            onClick={() => setSearchOpen(true)}
            data-testid="crm-command-pill"
            className="flex w-full max-w-md items-center gap-2 rounded-[var(--crm-radius-md)] border border-[var(--crm-border)] crm-hairline bg-[var(--crm-bg-secondary)] px-3 py-1.5 text-[13px] text-[var(--crm-text-tertiary)] transition-colors hover:border-[var(--crm-border-strong)] hover:text-[var(--crm-text-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--crm-ring)]"
          >
            <Search className="h-4 w-4" />
            <span className="flex-1 text-left">Search contacts, leads, tasks…</span>
            <kbd className="rounded-[var(--crm-radius-sm)] border border-[var(--crm-border)] bg-[var(--crm-bg-tertiary)] px-1.5 py-0.5 text-[10px] text-[var(--crm-text-tertiary)]">
              ⌘K
            </kbd>
          </button>
        </div>

        <button
          onClick={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
          aria-label="Toggle theme"
          data-testid="crm-theme-toggle"
          className="rounded-[var(--crm-radius-sm)] p-2 text-[var(--crm-text-tertiary)] hover:bg-[var(--crm-bg-tertiary)] hover:text-[var(--crm-text-primary)]"
        >
          {theme === 'light' ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />}
        </button>

        <button
          className="rounded-[var(--crm-radius-sm)] p-2 text-[var(--crm-text-tertiary)] hover:bg-[var(--crm-bg-tertiary)] hover:text-[var(--crm-text-primary)]"
          aria-label="Notifications"
          data-testid="crm-notifications"
        >
          <Bell className="h-5 w-5" />
        </button>

        <button
          aria-label="Account"
          data-testid="crm-account"
          className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--crm-primary)] text-[12px] font-medium text-[var(--crm-on-primary)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--crm-ring)]"
        >
          AL
        </button>
      </header>

      {/* Mobile overlay */}
      {mobileOpen && (
        <button
          aria-label="Close navigation overlay"
          className="fixed inset-0 z-40 bg-black/30 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        data-testid="crm-sidebar"
        className={cn(
          'fixed left-0 top-0 z-50 flex h-screen w-60 flex-col border-r border-[var(--crm-border)] crm-hairline bg-[var(--crm-bg-primary)] transition-transform',
          sidebarWidth,
          mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
        )}
      >
        <div className="flex h-14 items-center justify-between border-b border-[var(--crm-border)] crm-hairline px-3">
          <Link
            href="/admin/crm"
            data-testid="crm-brand"
            className="flex items-center gap-2 overflow-hidden text-[14px] font-medium tracking-tight text-[var(--crm-text-primary)]"
          >
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[var(--crm-radius-sm)] bg-[var(--crm-primary)] text-[12px] font-medium text-[var(--crm-on-primary)]">
              A
            </span>
            {!collapsed && (
              <span className="truncate">
                AutoLenis <span className="text-[var(--crm-primary)]">CRM</span>
              </span>
            )}
          </Link>
          <button
            className="rounded-[var(--crm-radius-sm)] p-1 text-[var(--crm-text-tertiary)] hover:text-[var(--crm-text-primary)] lg:hidden"
            onClick={() => setMobileOpen(false)}
            aria-label="Close navigation"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {!collapsed && (
          <div className="px-2 pt-2">
            <Link
              href="/admin/dashboard"
              data-testid="crm-back-admin"
              className="flex items-center gap-2 rounded-[var(--crm-radius-sm)] px-2.5 py-2 text-[13px] text-[var(--crm-text-tertiary)] transition-colors hover:bg-[var(--crm-bg-tertiary)] hover:text-[var(--crm-text-secondary)]"
            >
              <ChevronLeft className="h-4 w-4" /> Admin console
            </Link>
          </div>
        )}

        <nav className="flex-1 overflow-y-auto px-2 py-3">
          {SECTIONS.map((section) => (
            <div key={section.title} className="mb-4 last:mb-0">
              {!collapsed && (
                <div className="px-2 pb-1.5 text-[10px] font-medium uppercase tracking-wider text-[var(--crm-text-tertiary)]">
                  {section.title}
                </div>
              )}
              <div className="space-y-0.5">
                {section.items.map((item) => {
                  const Icon = item.icon;
                  const active = isActive(item.href, pathname, item.exact);
                  const badgeVal =
                    item.badge === 'unread'
                      ? badges.unread
                      : item.badge === 'overdue'
                        ? badges.overdue
                        : 0;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      title={collapsed ? item.label : undefined}
                      data-testid={`crm-nav-${slug(item.label)}`}
                      className={cn(
                        'group flex items-center gap-2.5 rounded-[var(--crm-radius-sm)] px-2.5 py-2 text-[13px] transition-colors',
                        collapsed && 'justify-center',
                        active
                          ? 'bg-[var(--crm-primary-subtle)] font-medium text-[var(--crm-primary)]'
                          : 'text-[var(--crm-text-secondary)] hover:bg-[var(--crm-bg-tertiary)] hover:text-[var(--crm-text-primary)]',
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0" strokeWidth={active ? 2 : 1.75} />
                      {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
                      {item.badge && badgeVal > 0 && (
                        <span
                          data-testid={`crm-nav-badge-${item.badge}`}
                          className={cn(
                            'rounded-full px-1.5 py-0.5 text-[10px] font-medium',
                            collapsed && 'absolute',
                            item.badge === 'unread'
                              ? 'bg-[var(--crm-info-subtle)] text-[var(--crm-info)]'
                              : 'bg-[var(--crm-danger-subtle)] text-[var(--crm-danger)]',
                          )}
                        >
                          {badgeVal > 99 ? '99+' : badgeVal}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Collapse toggle (desktop) */}
        <div className="hidden border-t border-[var(--crm-border)] crm-hairline p-2 lg:block">
          <button
            onClick={() => setCollapsed((c) => !c)}
            data-testid="crm-nav-collapse"
            aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
            className={cn(
              'flex w-full items-center gap-2.5 rounded-[var(--crm-radius-sm)] px-2.5 py-2 text-[13px] text-[var(--crm-text-tertiary)] transition-colors hover:bg-[var(--crm-bg-tertiary)] hover:text-[var(--crm-text-secondary)]',
              collapsed && 'justify-center',
            )}
          >
            {collapsed ? (
              <PanelLeftOpen className="h-4 w-4" />
            ) : (
              <>
                <PanelLeftClose className="h-4 w-4" />
                <span>Collapse</span>
              </>
            )}
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main
        className={cn('min-h-[calc(100vh-56px)] bg-[var(--crm-bg-secondary)] transition-[padding]', mainPad)}
      >
        {children}
      </main>

      <GlobalSearch
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onOpenCopilot={() => setCopilotOpen(true)}
      />
      <CopilotPanel open={copilotOpen} onClose={() => setCopilotOpen(false)} />
    </div>
  );
}
