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
  Zap,
  Workflow,
  BarChart3,
  Activity,
  Search,
  Menu,
  X,
  Bell,
  UserPlus,
  ChevronLeft,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { GlobalSearch } from './GlobalSearch';

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
      { href: '/admin/crm/automations', label: 'Workflows', icon: Zap },
      { href: '/admin/crm/scenarios',   label: 'Scenarios', icon: Workflow },
    ],
  },
  {
    title: 'Insights',
    items: [
      { href: '/admin/crm/analytics', label: 'Analytics',  icon: BarChart3 },
      { href: '/admin/operations',    label: 'Operations', icon: Activity },
    ],
  },
];

function isActive(itemHref: string, pathname: string, exact?: boolean): boolean {
  if (exact) return pathname === itemHref;
  return pathname === itemHref || pathname.startsWith(`${itemHref}/`);
}

export function CrmShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [badges, setBadges] = useState<{ unread: number; overdue: number }>({
    unread: 0,
    overdue: 0,
  });
  const [searchOpen, setSearchOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

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

  return (
    <div className="min-h-screen bg-white text-gray-900">
      {/* Top bar */}
      <header className="sticky top-0 z-40 h-14 bg-white/95 backdrop-blur border-b border-gray-200 flex items-center px-4 lg:pl-60">
        <button
          className="lg:hidden p-2 -ml-2 text-gray-500 hover:text-gray-900 rounded-md hover:bg-gray-100"
          onClick={() => setMobileOpen(true)}
          aria-label="Open navigation"
        >
          <Menu className="w-5 h-5" />
        </button>
        <div className="flex-1 flex items-center justify-center px-4">
          <button
            onClick={() => setSearchOpen(true)}
            className="flex items-center gap-2 text-sm text-gray-500 bg-white hover:bg-gray-50 border border-gray-300 hover:border-gray-400 rounded-lg px-3 py-1.5 w-full max-w-md transition-colors"
          >
            <Search className="w-4 h-4" />
            <span className="flex-1 text-left">Search contacts…</span>
            <kbd className="text-[10px] text-gray-500 bg-gray-100 border border-gray-200 px-1.5 py-0.5 rounded">
              ⌘K
            </kbd>
          </button>
        </div>
        <button
          className="p-2 text-gray-500 hover:text-gray-900 rounded-md hover:bg-gray-100"
          aria-label="Notifications"
        >
          <Bell className="w-5 h-5" />
        </button>
      </header>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-black/30"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed top-0 left-0 z-50 w-56 h-screen bg-white border-r border-gray-200 flex flex-col transition-transform',
          mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
        )}
      >
        <div className="h-14 px-5 flex items-center justify-between border-b border-gray-200">
          <Link href="/admin/crm" className="text-sm font-bold text-gray-900 tracking-tight">
            AutoLenis <span className="text-blue-600">CRM</span>
          </Link>
          <button
            className="lg:hidden p-1 text-gray-500 hover:text-gray-900"
            onClick={() => setMobileOpen(false)}
            aria-label="Close navigation"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-3 pt-3 pb-1">
          <Link
            href="/admin/dashboard"
            className="flex items-center gap-2 px-3 py-2 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <ChevronLeft className="w-4 h-4" /> Admin Console
          </Link>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-6">
          {SECTIONS.map((section) => (
            <div key={section.title}>
              <div className="px-2 pb-2 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
                {section.title}
              </div>
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
                      className={cn(
                        'flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm transition-colors border-l-2',
                        active
                          ? 'bg-blue-50 text-blue-700 border-l-blue-600 font-medium'
                          : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50 border-l-transparent',
                      )}
                    >
                      <Icon className="w-4 h-4 shrink-0" />
                      <span className="flex-1">{item.label}</span>
                      {item.badge && badgeVal > 0 && (
                        <span
                          className={cn(
                            'text-[10px] font-semibold px-1.5 py-0.5 rounded-full',
                            item.badge === 'unread'
                              ? 'bg-blue-100 text-blue-700'
                              : 'bg-red-100 text-red-700',
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
      </aside>

      {/* Main content */}
      <main className="lg:pl-56 min-h-[calc(100vh-56px)] bg-white">{children}</main>

      <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  );
}
